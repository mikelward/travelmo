"use client";

import {
  ExtractedSegment,
  compareInstants,
  composeInstant,
  fixedOffsetPrefix,
  localTimeZone,
  countryCodes,
  resolveOffset,
  segmentTypes,
  splitInstant,
  timeZones,
  zoneForOffset,
  type Location,
  type PlaceDetails,
  type Segment,
  type SegmentType,
} from "@travelmo/core";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { countryName } from "@/lib/countries";
import { formCountry, formPlace } from "@/lib/places";
import type { PickedPlace } from "@/lib/placesApi";
import { PlaceInput } from "./PlaceInput";
import { zoneOfCode, zonesFromCodes, type AirportZone, type CodeKey, type ZoneKey } from "@/lib/airportZones";

// The airport table is loaded only once a form is open; codes typed before
// it arrives are looked up then.
function useAirportZone(): AirportZone | undefined {
  const [lookup, setLookup] = useState<{ airportZone: AirportZone }>();
  useEffect(() => {
    let current = true;
    import("@travelmo/core/airports")
      .then((module) => {
        if (current) setLookup({ airportZone: module.airportZone });
      })
      .catch((error) => console.error("Loading the airport table failed", error));
    return () => {
      current = false;
    };
  }, []);
  return lookup?.airportZone;
}

export const segmentTypeLabels: Record<SegmentType, string> = {
  flight: "Flight",
  train: "Train",
  bus: "Bus",
  ferry: "Ferry",
  lodging: "Stay",
  car_rental: "Car rental",
  activity: "Activity",
  other: "Other",
};

type Fields = {
  type: SegmentType;
  title: string;
  provider: string;
  confirmation: string;
  startDate: string;
  startTime: string;
  startZone: string;
  endDate: string;
  endTime: string;
  endZone: string;
  originName: string;
  originCode: string;
  destinationName: string;
  destinationCode: string;
  // ISO codes, "" for none; not shown for a flight, whose airport says.
  originCountry: string;
  destinationCountry: string;
  // Set by an address pick in this form, "" (null for the location) once the
  // name is typed over (the picked city, address and spot no longer describe
  // it); undefined keeps whatever the booking had.
  originCity?: string;
  originAddress?: string;
  originLocation?: Location | null;
  destinationCity?: string;
  destinationAddress?: string;
  destinationLocation?: Location | null;
  // Whether an address pick set the country: a flight shows no picker, so
  // only a pick may change its country.
  originCountryPicked?: boolean;
  destinationCountryPicked?: boolean;
  notes: string;
};

function initialFields(segment: Segment | undefined, defaultDate: string): Fields {
  const here = localTimeZone();
  const start = segment ? splitInstant(segment.start) : undefined;
  const end = segment?.end ? splitInstant(segment.end) : undefined;
  const startZone = start ? zoneForOffset(start.offset, start.date, start.time, here) : here;
  return {
    type: segment?.type ?? "flight",
    title: segment?.title ?? "",
    provider: segment?.provider ?? "",
    confirmation: segment?.confirmation ?? "",
    startDate: start?.date ?? defaultDate,
    startTime: start?.time ?? "09:00",
    startZone,
    endDate: end?.date ?? "",
    endTime: end?.time ?? "",
    endZone: end ? zoneForOffset(end.offset, end.date, end.time, startZone.startsWith(fixedOffsetPrefix) ? here : startZone) : startZone,
    originName: segment?.origin?.name ?? "",
    originCode: segment?.origin?.code ?? "",
    destinationName: segment?.destination?.name ?? "",
    destinationCode: segment?.destination?.code ?? "",
    originCountry: segment?.origin?.country ?? "",
    destinationCountry: segment?.destination?.country ?? "",
    notes: segment?.notes ?? "",
  };
}

// The fields a text input can be bound to (the pick flags are booleans).
type StringField = { [K in keyof Fields]-?: Fields[K] extends string ? K : never }[keyof Fields];

const text = (value: string) => (value.trim() ? value.trim() : undefined);

const details = (city: string | undefined, address: string | undefined, location: Location | null | undefined): PlaceDetails => ({
  ...(city !== undefined ? { city } : {}),
  ...(address !== undefined ? { address } : {}),
  ...(location !== undefined ? { location } : {}),
});


// Fields the form does not edit (place city, a flight's place country,
// source, ids) come from the existing segment; what the form shows, the form
// decides.
export function toExtracted(f: Fields, existing?: Segment): ExtractedSegment {
  const hasEnd = f.endDate !== "" || f.endTime !== "";
  const startTime = f.startTime || "00:00";
  const endDate = f.endDate || f.startDate;
  const endTime = f.endTime || startTime;
  const candidate = {
    type: f.type,
    title: f.title.trim(),
    provider: text(f.provider),
    confirmation: text(f.confirmation),
    start: composeInstant({ date: f.startDate, time: startTime, offset: resolveOffset(f.startZone, f.startDate, startTime) }),
    end: hasEnd
      ? composeInstant({ date: endDate, time: endTime, offset: resolveOffset(f.endZone || f.startZone, endDate, endTime) })
      : undefined,
    origin: formPlace(existing?.origin, f.originName, f.originCode, formCountry(f.type, f.originCountry, f.originCountryPicked), details(f.originCity, f.originAddress, f.originLocation)),
    destination: formPlace(
      existing?.destination,
      f.destinationName,
      f.destinationCode,
      formCountry(f.type, f.destinationCountry, f.destinationCountryPicked),
      details(f.destinationCity, f.destinationAddress, f.destinationLocation),
    ),
    notes: text(f.notes),
  };
  // Firestore rejects undefined field values, so absent fields must be absent.
  const present = Object.fromEntries(Object.entries(candidate).filter(([, v]) => v !== undefined));
  const result = ExtractedSegment.safeParse(present);
  if (!result.success) throw new Error(z.prettifyError(result.error));
  if (result.data.end && compareInstants(result.data.end, result.data.start) < 0) {
    throw new Error("End must not be before start");
  }
  return result.data;
}

// min-w-0: a grid or flex item is otherwise as wide as its longest option
// (a time zone, a country), pushing the form past a phone's width.
const fieldClass = "min-w-0 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700";
const inputClass = `w-full ${fieldClass}`;
const labelClass = "block text-xs font-medium uppercase tracking-wide text-zinc-500";

// Whatever the field holds is always an option, so the select never shows a
// zone other than the one that will be saved.
function ZoneSelect({ value, onChange, zones }: { value: string; onChange: (zone: string) => void; zones: string[] }) {
  const pinned = value.startsWith(fixedOffsetPrefix) ? value : undefined;
  const unlisted = !pinned && !zones.includes(value) ? value : undefined;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} title="Time zone" className={inputClass}>
      {pinned && <option value={pinned}>UTC{pinned.slice(fixedOffsetPrefix.length)} (as imported)</option>}
      {unlisted && <option value={unlisted}>{unlisted.replace(/_/g, " ")}</option>}
      {zones.map((zone) => (
        <option key={zone} value={zone}>
          {zone.replace(/_/g, " ")}
        </option>
      ))}
    </select>
  );
}

// Optional, and never asked for: most imports fill it in, and a flight's
// airport code says it. It only helps reports place a booking.
function CountrySelect({ value, onChange, label, wide }: { value: string; onChange: (code: string) => void; label: string; wide?: boolean }) {
  const options = useMemo(
    () => countryCodes.map((code) => ({ code, name: countryName(code) })).sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className={wide ? inputClass : `${fieldClass} w-32 shrink-0`}>
      <option value="">Country</option>
      {value && !options.some((o) => o.code === value) && <option value={value}>{value}</option>}
      {options.map((o) => (
        <option key={o.code} value={o.code}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

export function SegmentForm({
  segment,
  defaultDate,
  onSave,
  onCancel,
}: {
  segment?: Segment;
  defaultDate: string;
  onSave: (segment: ExtractedSegment) => Promise<void>;
  onCancel: () => void;
}) {
  const [fields, setFields] = useState<Fields>(() => initialFields(segment, defaultDate));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  // Address picks whose details are still on their way: saving now would
  // keep the name and lose the rest.
  const [pendingPlaces, setPendingPlaces] = useState(0);
  const zones = useMemo(() => timeZones(), []);
  const airportZone = useAirportZone();
  // Ends whose zone the user chose in the picker; a code typed afterwards
  // chooses again, the table arriving does not.
  const pickedZones = useRef(new Set<ZoneKey>());
  // Codes typed in this form: the only ones the table looks up when it
  // arrives, so an existing booking keeps its zones until its codes change.
  const typedCodes = useRef(new Set<CodeKey>());
  const set = (key: keyof Fields) => (event: { target: { value: string } }) =>
    setFields((f) => ({ ...f, [key]: event.target.value }));
  const setZone = (key: ZoneKey) => (zone: string) => {
    pickedZones.current.add(key);
    setFields((f) => ({ ...f, [key]: zone }));
  };
  // A known airport code also sets that end's time zone.
  function codeTyped(key: CodeKey, code: string) {
    typedCodes.current.add(key);
    const zone = airportZone?.(code);
    if (zone) pickedZones.current.delete(zoneOfCode[key]);
    setFields((f) => ({ ...f, [key]: code, ...(zone ? { [zoneOfCode[key]]: zone } : {}) }));
  }
  useEffect(() => {
    if (!airportZone) return;
    const typed = typedCodes.current;
    setFields((f) => ({
      ...f,
      ...zonesFromCodes(
        {
          originCode: typed.has("originCode") ? f.originCode : "",
          destinationCode: typed.has("destinationCode") ? f.destinationCode : "",
        },
        airportZone,
        pickedZones.current,
      ),
    }));
  }, [airportZone]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      await onSave(toExtracted(fields, segment));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const transport = fields.type !== "lodging" && fields.type !== "activity";
  // A picked place fills the end's name, city, country, address and spot; a
  // name typed afterwards keeps the country (still likely, and for a flight
  // the pick is the only way it was set) and drops the rest.
  const placeField = (end: "origin" | "destination", label: string, placeholder: string) => (
    <PlaceInput
      value={fields[`${end}Name`]}
      label={label}
      placeholder={placeholder}
      className={inputClass}
      onChange={(name) => setFields((f) => ({ ...f, [`${end}Name`]: name, [`${end}City`]: "", [`${end}Address`]: "", [`${end}Location`]: null }))}
      onPending={(pending) => setPendingPlaces((n) => n + (pending ? 1 : -1))}
      onPick={(place: PickedPlace) =>
        setFields((f) => ({
          ...f,
          [`${end}Name`]: place.name,
          [`${end}City`]: place.city ?? "",
          [`${end}Address`]: place.address ?? "",
          [`${end}Location`]: place.location ?? null,
          ...(place.country ? { [`${end}Country`]: place.country, [`${end}CountryPicked`]: true } : { [`${end}CountryPicked`]: false }),
        }))
      }
    />
  );
  const country = (key: "originCountry" | "destinationCountry", label: string, wide = false) =>
    fields.type === "flight" ? null : (
      <CountrySelect value={fields[key]} onChange={(code) => setFields((f) => ({ ...f, [key]: code }))} label={label} wide={wide} />
    );
  const when = (label: string, date: StringField, time: StringField, zone: "startZone" | "endZone", required: boolean) => (
    <label className={labelClass}>
      {label}
      {/* On a phone the zone takes its own line, so the date keeps room. */}
      <div className="grid grid-cols-[1fr_6rem] gap-2 sm:grid-cols-[1fr_6rem_minmax(10rem,1.2fr)]">
        <input type="date" required={required} value={fields[date]} onChange={set(date)} className={inputClass} />
        <input type="time" value={fields[time]} onChange={set(time)} className={inputClass} />
        <div className="col-span-2 sm:col-span-1">
          <ZoneSelect value={fields[zone]} onChange={setZone(zone)} zones={zones} />
        </div>
      </div>
    </label>
  );

  return (
    <form onSubmit={submit} className="mt-4 grid gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="grid grid-cols-[8rem_1fr] gap-3">
        <label className={labelClass}>
          Type
          <select value={fields.type} onChange={set("type")} className={inputClass}>
            {segmentTypes.map((t) => (
              <option key={t} value={t}>
                {segmentTypeLabels[t]}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Title
          <input required value={fields.title} onChange={set("title")} placeholder="BA 117 LHR to JFK" className={inputClass} />
        </label>
      </div>
      {when(fields.type === "lodging" ? "Check-in (local time)" : "Start (local time)", "startDate", "startTime", "startZone", true)}
      {when(fields.type === "lodging" ? "Check-out (local time)" : "End (local time)", "endDate", "endTime", "endZone", false)}
      {transport ? (
        <div className="grid grid-cols-2 gap-3">
          <label className={labelClass}>
            From
            <div className="flex gap-2">
              {placeField("origin", "From", "London Heathrow")}
              <input
                value={fields.originCode}
                onChange={(e) => codeTyped("originCode", e.target.value)}
                placeholder="LHR"
                className={`${fieldClass} w-20 shrink-0`}
              />
            </div>
          </label>
          <label className={labelClass}>
            To
            <div className="flex gap-2">
              {placeField("destination", "To", "New York JFK")}
              <input
                value={fields.destinationCode}
                onChange={(e) => codeTyped("destinationCode", e.target.value)}
                placeholder="JFK"
                className={`${fieldClass} w-20 shrink-0`}
              />
            </div>
          </label>
        </div>
      ) : (
        <label className={labelClass}>
          Where
          <div className="flex gap-2">
            {placeField("destination", "Where", "Cove Liverpool")}
            {country("destinationCountry", "Country")}
          </div>
        </label>
      )}
      {transport && fields.type !== "flight" && (
        <div className="grid grid-cols-2 gap-3">
          {country("originCountry", "From country", true)}
          {country("destinationCountry", "To country", true)}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          Provider
          <input value={fields.provider} onChange={set("provider")} placeholder="British Airways" className={inputClass} />
        </label>
        <label className={labelClass}>
          Confirmation
          <input value={fields.confirmation} onChange={set("confirmation")} placeholder="ABC123" className={inputClass} />
        </label>
      </div>
      <label className={labelClass}>
        Notes
        <textarea rows={2} value={fields.notes} onChange={set("notes")} className={inputClass} />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy || pendingPlaces > 0}
          title={pendingPlaces > 0 ? "Looking up the place…" : undefined}
          className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {segment ? "Save" : "Add"}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
          Cancel
        </button>
      </div>
    </form>
  );
}
