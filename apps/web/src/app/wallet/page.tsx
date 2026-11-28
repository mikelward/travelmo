"use client";

import {
  allLoyalty,
  allLoyaltyWithSource,
  buildDocumentEntry,
  buildLoyaltyEntry,
  defaultDocumentTitle,
  findFoundLoyalty,
  formatDate,
  localTime,
  loyaltyByPerson,
  loyaltySummary,
  parseDocumentEntry,
  parseLoyaltyEntry,
  sameMembership,
  travelDocuments,
  upcomingBoardingFlights,
  type DocumentInput,
  type DocumentInputType,
  type FoundLoyalty,
  type LoyaltyInput,
  type PersonDoc,
  type ProfileEntry,
  type Segment,
  type TravelProfile,
} from "@travelmo/core";
import type { User } from "firebase/auth";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { BoardingPassModal } from "@/components/BoardingPassModal";
import { Dialog } from "@/components/BookingMenu";
import { PeoplePicker } from "@/components/ProfileSettingsSections";
import { SignInGate } from "@/components/SignInGate";
import { firestore } from "@/lib/firebase";
import { useSaveForOffline } from "@/lib/offline";
import { sayWhoIs, usePeople } from "@/lib/people";
import {
  removeFoundLoyalty,
  saveTravelDocuments,
  saveTravelLoyalty,
  setLoyaltyPerson,
  useSharedProfiles,
  useTravelProfile,
} from "@/lib/travelProfile";
import { useLocalToday, useNow, useSegmentsOf, useTrips } from "@/lib/trips";

const GOOGLE_WALLET_URL = "https://wallet.google.com";

const buttonClass =
  "rounded-lg border border-zinc-300 px-3 py-2 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

const pillClass = (active: boolean) =>
  active
    ? "rounded-full border border-foreground bg-foreground px-3 py-1 text-background"
    : "rounded-full border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900";

const inputClass = "w-full rounded-lg border border-field bg-background px-3 py-2";

const documentTypes: { value: DocumentInputType; label: string }[] = [
  { value: "passport", label: "Passport" },
  { value: "visa", label: "Visa / eVisa / ETA" },
  { value: "share_code", label: "UK share code" },
  { value: "ktn", label: "Known Traveler (KTN / Global Entry)" },
  { value: "id", label: "National ID / Driver's license" },
  { value: "insurance", label: "Travel insurance" },
  { value: "other", label: "Other" },
];

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      console.error("Copying to clipboard failed", e);
    }
  };
  return (
    <button type="button" aria-label={label} onClick={() => void copy()} className={buttonClass}>
      {copied ? "Copied" : "Copy number"}
    </button>
  );
}

function DocumentDialog({
  initial,
  existing,
  onSave,
  onClose,
}: {
  initial?: DocumentInput;
  existing?: ProfileEntry;
  onSave: (entry: ProfileEntry) => Promise<void>;
  onClose: () => void;
}) {
  const [type, setType] = useState<DocumentInputType>(initial?.type ?? "passport");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [country, setCountry] = useState(initial?.country ?? "");
  const [number, setNumber] = useState(initial?.number ?? "");
  const [expires, setExpires] = useState(initial?.expires ?? "");
  const [issued, setIssued] = useState(initial?.issued ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const entry = buildDocumentEntry(
        {
          type,
          title: title.trim() || defaultDocumentTitle(type, country),
          ...(country.trim() ? { country: country.trim() } : {}),
          ...(number.trim() ? { number: number.trim() } : {}),
          ...(expires.trim() ? { expires: expires.trim() } : {}),
          ...(issued.trim() ? { issued: issued.trim() } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
        existing,
      );
      await onSave(entry);
      onClose();
    } catch (e) {
      console.error("Saving document failed", e);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={initial ? "Edit document" : "Add document"} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div>
          <label htmlFor="doc-type" className="block text-muted">
            Type
          </label>
          <select
            id="doc-type"
            value={type}
            onChange={(e) => setType(e.target.value as DocumentInputType)}
            className={`mt-1 ${inputClass}`}
          >
            {documentTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="doc-title" className="block text-muted">
            Title
          </label>
          <input
            id="doc-title"
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={defaultDocumentTitle(type, country)}
            className={`mt-1 ${inputClass}`}
          />
        </div>
        <div>
          <label htmlFor="doc-country" className="block text-muted">
            {type === "passport" ? "Nationality / Country" : "Country"}
          </label>
          <input
            id="doc-country"
            value={country}
            maxLength={80}
            onChange={(e) => setCountry(e.target.value)}
            placeholder="e.g. United States, GB"
            className={`mt-1 ${inputClass}`}
          />
        </div>
        <div>
          <label htmlFor="doc-number" className="block text-muted">
            Number
          </label>
          <input
            id="doc-number"
            value={number}
            maxLength={80}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="Document number"
            className={`mt-1 ${inputClass}`}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="doc-expires" className="block text-muted">
              Expiry date
            </label>
            <input
              id="doc-expires"
              type="date"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
              className={`mt-1 ${inputClass}`}
            />
          </div>
          <div>
            <label htmlFor="doc-issued" className="block text-muted">
              Issue date
            </label>
            <input
              id="doc-issued"
              type="date"
              value={issued}
              onChange={(e) => setIssued(e.target.value)}
              className={`mt-1 ${inputClass}`}
            />
          </div>
        </div>
        <div>
          <label htmlFor="doc-notes" className="block text-muted">
            Notes
          </label>
          <input
            id="doc-notes"
            value={notes}
            maxLength={200}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional"
            className={`mt-1 ${inputClass}`}
          />
        </div>
        {error && <p className="text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className={buttonClass}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={buttonClass}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function LoyaltyDialog({
  initial,
  existing,
  onSave,
  onClose,
}: {
  initial?: LoyaltyInput;
  existing?: ProfileEntry;
  onSave: (entry: ProfileEntry) => Promise<void>;
  onClose: () => void;
}) {
  const [program, setProgram] = useState(initial?.program ?? "");
  const [number, setNumber] = useState(initial?.number ?? "");
  const [status, setStatus] = useState(initial?.status ?? "");
  const [balance, setBalance] = useState(initial?.balance ?? "");
  const [person, setPerson] = useState(initial?.person ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async () => {
    if (!program.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      const entry = buildLoyaltyEntry(
        {
          program: program.trim(),
          ...(number.trim() ? { number: number.trim() } : {}),
          ...(status.trim() ? { status: status.trim() } : {}),
          ...(balance.trim() ? { balance: balance.trim() } : {}),
          ...(person.trim() ? { person: person.trim() } : {}),
        },
        existing,
        new Date().toISOString(),
      );
      await onSave(entry);
      onClose();
    } catch (e) {
      console.error("Saving loyalty program failed", e);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={initial ? "Edit loyalty program" : "Add loyalty program"} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div>
          <label htmlFor="loyalty-program" className="block text-muted">
            Program
          </label>
          <input
            id="loyalty-program"
            required
            value={program}
            maxLength={120}
            onChange={(e) => setProgram(e.target.value)}
            placeholder="e.g. Qatar Airways Privilege Club"
            className={`mt-1 ${inputClass}`}
          />
        </div>
        <div>
          <label htmlFor="loyalty-number" className="block text-muted">
            Account number
          </label>
          <input
            id="loyalty-number"
            value={number}
            maxLength={80}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="Membership number"
            className={`mt-1 ${inputClass}`}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="loyalty-status" className="block text-muted">
              Status / tier
            </label>
            <input
              id="loyalty-status"
              value={status}
              maxLength={60}
              onChange={(e) => setStatus(e.target.value)}
              placeholder="e.g. Gold"
              className={`mt-1 ${inputClass}`}
            />
          </div>
          <div>
            <label htmlFor="loyalty-balance" className="block text-muted">
              Balance
            </label>
            <input
              id="loyalty-balance"
              value={balance}
              maxLength={40}
              onChange={(e) => setBalance(e.target.value)}
              placeholder="e.g. 45,000"
              className={`mt-1 ${inputClass}`}
            />
          </div>
        </div>
        <div>
          <label htmlFor="loyalty-person" className="block text-muted">
            Member name (leave blank for yourself)
          </label>
          <input
            id="loyalty-person"
            value={person}
            maxLength={80}
            onChange={(e) => setPerson(e.target.value)}
            placeholder="Optional"
            className={`mt-1 ${inputClass}`}
          />
        </div>
        {error && <p className="text-danger">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className={buttonClass}>
            Cancel
          </button>
          <button type="submit" disabled={busy || !program.trim()} className={buttonClass}>
            Save
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function AddChoiceDialog({
  onDocument,
  onLoyalty,
  onClose,
}: {
  onDocument: () => void;
  onLoyalty: () => void;
  onClose: () => void;
}) {
  const option = "w-full rounded-lg border border-zinc-200 px-3 py-3 text-left hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-900";
  return (
    <Dialog title="Add to Wallet" onClose={onClose}>
      <div className="space-y-2">
        <button
          type="button"
          className={option}
          onClick={() => {
            onClose();
            onDocument();
          }}
        >
          <div className="font-medium">Travel document</div>
          <div className="text-muted">Passport, visa, Known Traveler Number, ID, or insurance</div>
        </button>
        <button
          type="button"
          className={option}
          onClick={() => {
            onClose();
            onLoyalty();
          }}
        >
          <div className="font-medium">Loyalty program</div>
          <div className="text-muted">Frequent flyer, hotel, rail, or car rental number</div>
        </button>
      </div>
    </Dialog>
  );
}

function PersonDialog({
  program,
  number,
  people,
  onPick,
  onClose,
}: {
  program: string;
  number: string;
  people: string[];
  onPick: (person: string | undefined) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const pick = (person: string | undefined) => {
    onPick(person);
    onClose();
  };
  const option = "w-full rounded-lg px-2 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-900";
  return (
    <Dialog title={`Whose is ${program} ${number}?`} onClose={onClose}>
      <ul>
        <li>
          <button type="button" className={option} onClick={() => pick(undefined)}>
            Mine
          </button>
        </li>
        {people.map((p) => (
          <li key={p}>
            <button type="button" className={option} onClick={() => pick(p)}>
              {p}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) pick(name.trim());
        }}
      >
        <input
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          placeholder="Someone else"
          aria-label="Someone else's name"
          className="min-w-0 flex-1 rounded-lg border border-field bg-background px-3 py-2"
        />
        <button type="submit" disabled={!name.trim()} className={buttonClass}>
          Save
        </button>
      </form>
    </Dialog>
  );
}

function expiryMeta(entry: ProfileEntry, today: string): { text?: string; warn?: boolean } {
  const parsed = travelDocuments([entry])[0];
  if (!parsed) return {};
  const formatted = formatDate(parsed.expires, "en-GB", { weekday: undefined, year: "numeric" });
  if (parsed.expires < today) return { text: `Expired ${formatted}`, warn: true };
  // Warn if within ~6 months (180 days)
  const diffDays = Math.round((Date.parse(`${parsed.expires}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (parsed.kind === "passport" && diffDays < 183) return { text: `Expires ${formatted}`, warn: true };
  return { text: `Expires ${formatted}` };
}

function BoardingPassesSection({ user }: { user: User }) {
  const trips = useTrips(user);
  const nowIso = useNow();
  const today = useLocalToday();

  const candidateIds = useMemo(() => {
    if (!trips) return [];
    const minDate = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    const maxDate = new Date(Date.parse(`${today}T00:00:00Z`) + 3 * 86_400_000).toISOString().slice(0, 10);
    return trips
      .filter((t) => !t.cancelledAt && t.end >= minDate && t.start <= maxDate)
      .map((t) => t.id);
  }, [trips, today]);

  const segmentsByTripRecord = useSegmentsOf(candidateIds);

  const upcoming = useMemo(() => {
    if (!trips) return [];
    const byTrip = new Map(Object.entries(segmentsByTripRecord));
    return upcomingBoardingFlights(trips, byTrip, Date.parse(nowIso));
  }, [trips, segmentsByTripRecord, nowIso]);

  const [openPassSegment, setOpenPassSegment] = useState<Segment>();

  return (
    <section aria-label="Boarding passes">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-lg font-medium">Boarding passes</h2>
      </div>
      <div className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {upcoming.map((f) => {
          const passes = f.segment.boardingPasses ?? [];
          if (passes.length > 0) {
            const first = passes[0]!;
            const summary = [
              localTime(f.segment.start),
              first.gate ? `Gate ${first.gate}` : undefined,
              first.seat ? `Seat ${first.seat}` : undefined,
              passes.length > 1 ? `${passes.length} passes` : undefined,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <div key={f.segment.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
                <Link href={`/trips/${f.tripId}`} className="min-w-0 flex-1 hover:underline">
                  <div className="font-medium">{f.segment.title}</div>
                  <div className="text-muted">{summary}</div>
                </Link>
                <button
                  type="button"
                  onClick={() => setOpenPassSegment(f.segment)}
                  className="rounded-lg border border-foreground bg-foreground px-3 py-1.5 text-background hover:opacity-90"
                >
                  Show boarding pass
                </button>
              </div>
            );
          }
          return (
            <Link
              key={f.segment.id}
              href={`/trips/${f.tripId}`}
              className="flex items-center justify-between gap-3 px-3 py-3 hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              <div className="min-w-0">
                <div className="font-medium">{f.segment.title}</div>
                <div className="text-muted">
                  {localTime(f.segment.start)}
                  {f.segment.confirmation ? ` · Ref ${f.segment.confirmation}` : ""}
                </div>
              </div>
              <span aria-hidden="true" className="text-muted">
                ›
              </span>
            </Link>
          );
        })}
        <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-3">
          <div className="min-w-0">
            <div className="font-medium">Google Wallet</div>
            <div className="text-muted">
              {upcoming.length > 0 ? "Open your saved boarding passes" : "Keep boarding passes and transit cards in Google Wallet"}
            </div>
          </div>
          <a href={GOOGLE_WALLET_URL} target="_blank" rel="noopener noreferrer" className={buttonClass}>
            Open Google Wallet
          </a>
        </div>
      </div>
      {openPassSegment && openPassSegment.boardingPasses && openPassSegment.boardingPasses.length > 0 && (
        <BoardingPassModal
          segment={openPassSegment}
          passes={openPassSegment.boardingPasses}
          onClose={() => setOpenPassSegment(undefined)}
        />
      )}
    </section>
  );
}

function DocumentsCard({
  entries,
  today,
  canEdit,
  onAdd,
  onEdit,
  onRemove,
}: {
  entries: ProfileEntry[];
  today: string;
  canEdit: boolean;
  onAdd?: () => void;
  onEdit?: (index: number) => void;
  onRemove?: (index: number) => void;
}) {
  return (
    <section aria-label="Documents">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-lg font-medium">Documents</h2>
        {canEdit && onAdd && (
          <button type="button" onClick={onAdd} className="text-muted hover:underline">
            + Add document
          </button>
        )}
      </div>
      {entries.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 px-3 py-4 dark:border-zinc-800">
          <p className="text-muted">
            {canEdit
              ? "No documents yet. Add a passport, visa, or ID to get expiry warnings on upcoming trips."
              : "No documents shared."}
          </p>
          {canEdit && onAdd && (
            <button type="button" onClick={onAdd} className={`mt-3 ${buttonClass}`}>
              Add document
            </button>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800" aria-label="Documents">
          {entries.map((entry, i) => {
            const parsed = parseDocumentEntry(entry);
            const expiry = expiryMeta(entry, today);
            return (
              <li key={`${entry.title}-${i}`}>
                <details className="px-3 py-3">
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-medium">{entry.title}</div>
                      {expiry.text && <div className={expiry.warn ? "text-danger" : "text-muted"}>{expiry.text}</div>}
                    </div>
                    <span aria-hidden="true" className="text-muted">
                      ›
                    </span>
                  </summary>
                  <div className="mt-3 border-t border-zinc-200 pt-2 dark:border-zinc-800">
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                      {entry.fields.map((field, j) => (
                        <div key={`${field.label}-${j}`} className="contents">
                          <dt className="text-muted">{field.label}</dt>
                          <dd className="break-words">{field.value}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {parsed.number && <CopyButton value={parsed.number} label={`Copy ${entry.title} number`} />}
                      {canEdit && onEdit && (
                        <button type="button" aria-label={`Edit ${entry.title}`} onClick={() => onEdit(i)} className={buttonClass}>
                          Edit
                        </button>
                      )}
                      {canEdit && onRemove && (
                        <button type="button" aria-label={`Remove ${entry.title}`} onClick={() => onRemove(i)} className={buttonClass}>
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function LoyaltyCard({
  entries,
  savedIndexOf,
  found,
  ownUid,
  travelers,
  allPeopleNames,
  personHeader,
  onAdd,
  onEditSaved,
  onRemoveSaved,
  onPersonError,
}: {
  entries: ProfileEntry[];
  savedIndexOf?: (entry: ProfileEntry) => number;
  found?: readonly FoundLoyalty[];
  ownUid?: string;
  travelers?: readonly PersonDoc[];
  allPeopleNames: string[];
  personHeader?: string;
  onAdd?: () => void;
  onEditSaved?: (index: number, displayed: ProfileEntry) => void;
  onRemoveSaved?: (index: number) => void;
  onPersonError?: (msg: string | undefined) => void;
}) {
  const [editingOwner, setEditingOwner] = useState<{ program: string; number: string }>();
  const [naming, setNaming] = useState<string>();

  const pick = async (person: string | undefined) => {
    if (!ownUid || !editingOwner) return;
    onPersonError?.(undefined);
    try {
      await setLoyaltyPerson(ownUid, editingOwner, person);
    } catch (e) {
      console.error("Saving whose a loyalty number is failed", e);
      onPersonError?.((e as Error).message);
    }
  };

  const whoIs = async (name: string, personId: string) => {
    if (!ownUid || !travelers) return;
    onPersonError?.(undefined);
    try {
      await sayWhoIs(firestore(), ownUid, travelers, name, personId);
    } catch (e) {
      console.error("Saving who a loyalty holder is failed", e);
      onPersonError?.((e as Error).message);
    }
  };

  const removeFound = async (f: FoundLoyalty) => {
    if (!ownUid) return;
    onPersonError?.(undefined);
    try {
      await removeFoundLoyalty(ownUid, f);
    } catch (e) {
      console.error("Removing a loyalty number failed", e);
      onPersonError?.((e as Error).message);
    }
  };

  const resolveSavedIndex = (entry: ProfileEntry): number => savedIndexOf?.(entry) ?? -1;

  return (
    <section aria-label="Loyalty programs">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-lg font-medium">Loyalty programs</h2>
        <div className="flex items-center gap-3">
          {personHeader && ownUid && !!travelers?.length && (
            <button type="button" className="text-muted hover:underline" onClick={() => setNaming(personHeader)}>
              Same person as…
            </button>
          )}
          {ownUid && onAdd && (
            <button type="button" onClick={onAdd} className="text-muted hover:underline">
              + Add loyalty
            </button>
          )}
        </div>
      </div>
      {entries.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 px-3 py-4 dark:border-zinc-800">
          <p className="text-muted">
            {ownUid
              ? "No loyalty programs yet. Numbers from booking emails appear here automatically, or add one manually."
              : "No loyalty programs shared."}
          </p>
          {ownUid && onAdd && (
            <button type="button" onClick={onAdd} className={`mt-3 ${buttonClass}`}>
              Add loyalty program
            </button>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800" aria-label="Loyalty programs">
          {entries.map((entry, i) => {
            const r = loyaltySummary(entry);
            const foundMatch = ownUid && found ? findFoundLoyalty(found, entry) : undefined;
            const savedIdx = ownUid ? resolveSavedIndex(entry) : -1;
            const statusText = r.nextStatus && r.status ? `${r.status} (next: ${r.nextStatus})` : r.status;
            const details = entry.fields.filter((f) => f.label !== "Person");
            return (
              <li key={`${r.title}-${r.account ?? i}`}>
                <details className="px-3 py-3">
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 font-medium">
                        <span>{r.title}</span>
                        {foundMatch && savedIdx < 0 && (
                          <span className="text-xs font-medium uppercase tracking-wide text-muted">From emails</span>
                        )}
                      </div>
                      {r.account && <div className="break-all text-muted">{r.account}</div>}
                    </div>
                    <div className="shrink-0 text-right">
                      {r.balance && <div className="tabular-nums">{r.balance}</div>}
                      {statusText && <div className="text-muted">{statusText}</div>}
                    </div>
                  </summary>
                  <div className="mt-3 border-t border-zinc-200 pt-2 dark:border-zinc-800">
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                      {details.map((field, j) => (
                        <div key={`${field.label}-${j}`} className="contents">
                          <dt className="text-muted">{field.label}</dt>
                          <dd className="break-words">{field.value}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {r.account && <CopyButton value={r.account} label={`Copy ${r.title} number`} />}
                      {ownUid && r.account && (
                        <button
                          type="button"
                          aria-label={`Whose is ${r.title} ${r.account}?`}
                          onClick={() => setEditingOwner({ program: r.title, number: r.account! })}
                          className={buttonClass}
                        >
                          Whose is this?
                        </button>
                      )}
                      {ownUid && savedIdx >= 0 && onEditSaved && (
                        <button type="button" aria-label={`Edit ${r.title}`} onClick={() => onEditSaved(savedIdx, entry)} className={buttonClass}>
                          Edit
                        </button>
                      )}
                      {ownUid && savedIdx >= 0 && onRemoveSaved && (
                        <button
                          type="button"
                          aria-label={`Remove ${r.title}`}
                          onClick={() => onRemoveSaved(savedIdx)}
                          className={buttonClass}
                        >
                          Remove
                        </button>
                      )}
                      {ownUid && savedIdx < 0 && foundMatch && (
                        <button
                          type="button"
                          aria-label={`Remove ${foundMatch.program}`}
                          onClick={() => void removeFound(foundMatch)}
                          className={buttonClass}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      )}
      {naming && travelers && (
        <PeoplePicker title={`${naming} is the same person as`} people={travelers} onPick={(id) => void whoIs(naming, id)} onClose={() => setNaming(undefined)} />
      )}
      {editingOwner && (
        <PersonDialog program={editingOwner.program} number={editingOwner.number} people={allPeopleNames} onPick={(p) => void pick(p)} onClose={() => setEditingOwner(undefined)} />
      )}
    </section>
  );
}

type SelectedPerson =
  | { kind: "you" }
  | { kind: "household"; name: string }
  | { kind: "shared"; uid: string };

function PersonParamSync({
  shared,
  onSelect,
}: {
  shared: TravelProfile[];
  onSelect: (person: SelectedPerson) => void;
}) {
  const params = useSearchParams();
  const raw = params.get("person");
  useEffect(() => {
    if (!raw) return;
    if (raw.startsWith("shared:")) {
      const uid = raw.slice("shared:".length);
      if (shared.some((p) => p.ownerUid === uid)) onSelect({ kind: "shared", uid });
    }
  }, [raw, shared, onSelect]);
  return null;
}

function WalletPageContent({ user }: { user: User }) {
  const profile = useTravelProfile(user.uid);
  const people = usePeople(user.uid);
  const sharedAll = useSharedProfiles(user);
  const today = useLocalToday();
  const shared = useMemo(() => (sharedAll ?? []).filter((p) => p.ownerUid !== user.uid), [sharedAll, user.uid]);

  const ownResolvedLoyalty = useMemo(() => (profile ? allLoyaltyWithSource(profile, people) : []), [profile, people]);
  const ownLoyalty = useMemo(() => ownResolvedLoyalty.map((r) => r.entry), [ownResolvedLoyalty]);
  const savedIndexByEntry = useMemo(() => new Map(ownResolvedLoyalty.map((r) => [r.entry, r.savedIndex])), [ownResolvedLoyalty]);
  const loyaltyGroups = useMemo(() => loyaltyByPerson(ownLoyalty), [ownLoyalty]);
  const householdNames = useMemo(() => loyaltyGroups.flatMap((g) => (g.person ? [g.person] : [])), [loyaltyGroups]);

  const [selected, setSelected] = useState<SelectedPerson>({ kind: "you" });
  const [addChoice, setAddChoice] = useState(false);
  const [docDialog, setDocDialog] = useState<{ target?: ProfileEntry; initial?: DocumentInput }>();
  const [loyaltyDialog, setLoyaltyDialog] = useState<{ target?: ProfileEntry; initial?: LoyaltyInput }>();
  const [error, setError] = useState<string>();

  const effectiveSelected: SelectedPerson = useMemo(() => {
    if (selected.kind === "household" && !householdNames.includes(selected.name)) return { kind: "you" };
    if (selected.kind === "shared" && !shared.some((p) => p.ownerUid === selected.uid)) return { kind: "you" };
    return selected;
  }, [selected, householdNames, shared]);

  const showSwitcher = householdNames.length > 0 || shared.length > 0;

  const sameStoredEntry = (a: ProfileEntry, b: ProfileEntry) =>
    a.title === b.title &&
    a.fields.length === b.fields.length &&
    a.fields.every((f, i) => f.label === b.fields[i]?.label && f.value === b.fields[i]?.value);

  const findEntryIndex = (list: readonly ProfileEntry[], target: ProfileEntry | undefined) =>
    target ? list.findIndex((e) => sameStoredEntry(e, target)) : -1;

  const saveDocument = async (entry: ProfileEntry, target?: ProfileEntry) => {
    await saveTravelDocuments(user, (current) => {
      if (target === undefined) return [...current, entry];
      const idx = findEntryIndex(current, target);
      if (idx < 0) throw new Error("This document was changed or removed elsewhere. Refresh and try again.");
      return current.map((d, i) => (i === idx ? entry : d));
    });
  };

  const removeDocument = async (index: number) => {
    setError(undefined);
    const target = profile?.documents[index];
    try {
      await saveTravelDocuments(user, (current) => {
        const idx = findEntryIndex(current, target);
        return idx >= 0 ? current.filter((_, i) => i !== idx) : current;
      });
    } catch (e) {
      console.error("Removing document failed", e);
      setError((e as Error).message);
    }
  };

  const saveLoyalty = async (entry: ProfileEntry, target?: ProfileEntry, prevPerson?: string) => {
    await saveTravelLoyalty(user, (current) => {
      if (target === undefined) return [...current, entry];
      const idx = findEntryIndex(current, target);
      if (idx < 0) throw new Error("This loyalty program was changed or removed elsewhere. Refresh and try again.");
      return current.map((l, i) => (i === idx ? entry : l));
    });
    const summary = loyaltySummary(entry);
    if (summary.account) {
      const hasExistingAttribution =
        !!findFoundLoyalty(profile?.foundLoyalty ?? [], entry) ||
        (profile?.loyaltyPeople ?? []).some((p) => sameMembership(p, { program: entry.title, number: summary.account! }));
      if (hasExistingAttribution || (target !== undefined && summary.person !== prevPerson)) {
        await setLoyaltyPerson(user.uid, { program: entry.title, number: summary.account }, summary.person);
      }
    }
  };

  const removeSavedLoyalty = async (index: number) => {
    setError(undefined);
    const removed = profile?.loyalty[index];
    try {
      await saveTravelLoyalty(user, (current) => {
        const idx = findEntryIndex(current, removed);
        return idx >= 0 ? current.filter((_, i) => i !== idx) : current;
      });
      const matchingFound = removed ? findFoundLoyalty(profile?.foundLoyalty ?? [], removed) : undefined;
      if (matchingFound) await removeFoundLoyalty(user.uid, matchingFound);
    } catch (e) {
      console.error("Removing loyalty program failed", e);
      setError((e as Error).message);
    }
  };

  const activeShared = effectiveSelected.kind === "shared" ? shared.find((p) => p.ownerUid === effectiveSelected.uid) : undefined;
  const activeSharedLoyalty = useMemo(() => (activeShared ? allLoyalty(activeShared) : []), [activeShared]);

  const youLoyalty = useMemo(() => loyaltyGroups.find((g) => !g.person)?.entries ?? [], [loyaltyGroups]);
  const householdLoyalty = useMemo(
    () => (effectiveSelected.kind === "household" ? loyaltyGroups.find((g) => g.person === effectiveSelected.name)?.entries ?? [] : []),
    [effectiveSelected, loyaltyGroups],
  );

  return (
    <>
      <Suspense fallback={null}>
        <PersonParamSync shared={shared} onSelect={setSelected} />
      </Suspense>
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Wallet</h1>
        <button type="button" onClick={() => setAddChoice(true)} className={buttonClass}>
          + Add
        </button>
      </div>

      {showSwitcher && (
        <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Wallet person">
          <button
            type="button"
            aria-pressed={effectiveSelected.kind === "you"}
            onClick={() => setSelected({ kind: "you" })}
            className={pillClass(effectiveSelected.kind === "you")}
          >
            You
          </button>
          {householdNames.map((name) => {
            const active = effectiveSelected.kind === "household" && effectiveSelected.name === name;
            return (
              <button
                key={name}
                type="button"
                aria-pressed={active}
                onClick={() => setSelected({ kind: "household", name })}
                className={pillClass(active)}
              >
                {name}
              </button>
            );
          })}
          {shared.map((p) => {
            const active = effectiveSelected.kind === "shared" && effectiveSelected.uid === p.ownerUid;
            const label = p.ownerEmail ?? "Shared";
            return (
              <button
                key={p.ownerUid}
                type="button"
                aria-pressed={active}
                onClick={() => setSelected({ kind: "shared", uid: p.ownerUid })}
                className={pillClass(active)}
              >
                {label} <span className="ml-1 text-xs font-medium uppercase tracking-wide opacity-75">Shared</span>
              </button>
            );
          })}
        </div>
      )}

      {profile === undefined ? (
        <p className="text-muted">Loading…</p>
      ) : effectiveSelected.kind === "you" ? (
        <div className="space-y-8">
          <BoardingPassesSection user={user} />
          <DocumentsCard
            entries={profile?.documents ?? []}
            today={today}
            canEdit
            onAdd={() => setDocDialog({})}
            onEdit={(index) => {
              const entry = profile?.documents[index];
              if (entry) setDocDialog({ target: entry, initial: parseDocumentEntry(entry) });
            }}
            onRemove={(index) => void removeDocument(index)}
          />
          <LoyaltyCard
            entries={youLoyalty}
            savedIndexOf={(entry) => savedIndexByEntry.get(entry) ?? -1}
            found={profile?.foundLoyalty ?? []}
            ownUid={user.uid}
            {...(people ? { travelers: people } : {})}
            allPeopleNames={householdNames}
            onAdd={() => setLoyaltyDialog({})}
            onEditSaved={(index, displayed) => {
              const target = profile?.loyalty[index];
              if (target) setLoyaltyDialog({ target, initial: parseLoyaltyEntry(displayed) });
            }}
            onRemoveSaved={(index) => void removeSavedLoyalty(index)}
            onPersonError={setError}
          />
        </div>
      ) : effectiveSelected.kind === "household" ? (
        <div className="space-y-8">
          <LoyaltyCard
            entries={householdLoyalty}
            savedIndexOf={(entry) => savedIndexByEntry.get(entry) ?? -1}
            found={profile?.foundLoyalty ?? []}
            ownUid={user.uid}
            {...(people ? { travelers: people } : {})}
            allPeopleNames={householdNames}
            personHeader={effectiveSelected.name}
            onAdd={() => setLoyaltyDialog({ initial: { program: "", person: effectiveSelected.name } })}
            onEditSaved={(index, displayed) => {
              const target = profile?.loyalty[index];
              if (target) setLoyaltyDialog({ target, initial: parseLoyaltyEntry(displayed) });
            }}
            onRemoveSaved={(index) => void removeSavedLoyalty(index)}
            onPersonError={setError}
          />
        </div>
      ) : activeShared ? (
        <div className="space-y-8">
          <p className="text-muted">
            Shared by {activeShared.ownerEmail ?? "someone who trusts you"} · Read-only
          </p>
          <DocumentsCard entries={activeShared.documents} today={today} canEdit={false} />
          <LoyaltyCard entries={activeSharedLoyalty} allPeopleNames={[]} />
        </div>
      ) : null}

      {error && <p className="mt-4 text-danger">{error}</p>}

      {addChoice && (
        <AddChoiceDialog
          onDocument={() => setDocDialog({})}
          onLoyalty={() => setLoyaltyDialog({})}
          onClose={() => setAddChoice(false)}
        />
      )}
      {docDialog && (
        <DocumentDialog
          {...(docDialog.initial ? { initial: docDialog.initial } : {})}
          {...(docDialog.target ? { existing: docDialog.target } : {})}
          onSave={(entry) => saveDocument(entry, docDialog.target)}
          onClose={() => setDocDialog(undefined)}
        />
      )}
      {loyaltyDialog && (
        <LoyaltyDialog
          {...(loyaltyDialog.initial ? { initial: loyaltyDialog.initial } : {})}
          {...(loyaltyDialog.target ? { existing: loyaltyDialog.target } : {})}
          onSave={(entry) => saveLoyalty(entry, loyaltyDialog.target, loyaltyDialog.initial?.person)}
          onClose={() => setLoyaltyDialog(undefined)}
        />
      )}
    </>
  );
}

export default function WalletPage() {
  useSaveForOffline();
  return <SignInGate>{(user) => <WalletPageContent user={user} />}</SignInGate>;
}
