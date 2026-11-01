"use client";

import {
  ExtractedSegment,
  compareInstants,
  composeInstant,
  fixedOffsetPrefix,
  localTimeZone,
  mergePlace,
  resolveOffset,
  segmentTypes,
  splitInstant,
  timeZones,
  zoneForOffset,
  type Segment,
  type SegmentType,
} from "@travelmo/core";
import { useMemo, useState, type FormEvent } from "react";
import { z } from "zod";

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
    notes: segment?.notes ?? "",
  };
}

const text = (value: string) => (value.trim() ? value.trim() : undefined);

// Fields the form does not edit (place city/country, source, ids) come from
// the existing segment; what the form shows, the form decides.
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
    origin: mergePlace(existing?.origin, f.originName, f.originCode),
    destination: mergePlace(existing?.destination, f.destinationName, f.destinationCode),
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

const inputClass = "w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700";
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
  const zones = useMemo(() => timeZones(), []);
  const set = (key: keyof Fields) => (event: { target: { value: string } }) =>
    setFields((f) => ({ ...f, [key]: event.target.value }));
  const setZone = (key: "startZone" | "endZone") => (zone: string) => setFields((f) => ({ ...f, [key]: zone }));

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
  const when = (label: string, date: keyof Fields, time: keyof Fields, zone: "startZone" | "endZone", required: boolean) => (
    <label className={labelClass}>
      {label}
      <div className="grid grid-cols-[1fr_6rem_minmax(10rem,1.2fr)] gap-2">
        <input type="date" required={required} value={fields[date]} onChange={set(date)} className={inputClass} />
        <input type="time" value={fields[time]} onChange={set(time)} className={inputClass} />
        <ZoneSelect value={fields[zone]} onChange={setZone(zone)} zones={zones} />
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
              <input value={fields.originName} onChange={set("originName")} placeholder="London Heathrow" className={inputClass} />
              <input value={fields.originCode} onChange={set("originCode")} placeholder="LHR" className={`${inputClass} w-20`} />
            </div>
          </label>
          <label className={labelClass}>
            To
            <div className="flex gap-2">
              <input value={fields.destinationName} onChange={set("destinationName")} placeholder="New York JFK" className={inputClass} />
              <input value={fields.destinationCode} onChange={set("destinationCode")} placeholder="JFK" className={`${inputClass} w-20`} />
            </div>
          </label>
        </div>
      ) : (
        <label className={labelClass}>
          Where
          <input value={fields.destinationName} onChange={set("destinationName")} placeholder="Cove Liverpool" className={inputClass} />
        </label>
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
          disabled={busy}
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
