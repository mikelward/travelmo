"use client";

import {
  DatedReminder,
  StandingReminder,
  defaultLead,
  dueText,
  leadLimits,
  leadText,
  maxStandingReminders,
  maxTripReminders,
  type ChecklistEntry,
  type LeadUnit,
  type OneOffReminder,
} from "@travelmo/core";
import { useState, type FormEvent } from "react";
import { addOneOff, newReminderId, removeOneOff, removeStandingReminder, saveStandingReminder, setDone, useStandingReminders, type Slotted } from "@/lib/checklist";

const buttonClass =
  "rounded-lg border border-zinc-300 px-3 py-1.5  hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";
const fieldClass = "rounded-lg border border-field bg-background px-3 py-2 ";

type When = LeadUnit | "date";

// What to do and when, before a trip: a lead time, or for a one-off a date.
// Returns the reminder, or why it cannot be one.
function parseReminder(id: string, text: string, amount: string, when: When, date: string): OneOffReminder | string {
  if (!text.trim()) return "Enter a reminder.";
  if (when === "date") {
    const parsed = DatedReminder.safeParse({ id, text, date });
    return parsed.success ? parsed.data : "Enter a date.";
  }
  const parsed = StandingReminder.safeParse({ id, text, amount: amount.trim() ? Number(amount) : NaN, unit: when });
  if (parsed.success) return parsed.data;
  return parsed.error.issues[0]?.path[0] === "text" ? "Use at most 200 characters." : `Enter a number from 0 to ${leadLimits[when]}.`;
}

function ReminderForm(props: {
  initial?: Partial<Pick<StandingReminder, "text" | "amount" | "unit">>;
  dated?: boolean;
  submitLabel: string;
  disabled?: boolean;
  onSave: (reminder: OneOffReminder) => Promise<void>;
  onCancel?: () => void;
  id?: string;
}) {
  const [text, setText] = useState(props.initial?.text ?? "");
  const [amount, setAmount] = useState(String(props.initial?.amount ?? defaultLead.amount));
  const [when, setWhen] = useState<When>(props.initial?.unit ?? defaultLead.unit);
  const [date, setDate] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseReminder(props.id ?? newReminderId(), text, amount, when, date);
    if (typeof parsed === "string") {
      setError(parsed);
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      await props.onSave(parsed);
      if (!props.initial) {
        setText("");
        setDate("");
      }
    } catch (err) {
      console.error("Saving a reminder failed", err);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3">
      <div className="flex flex-wrap gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Apply for a visa"
          aria-label="Reminder"
          maxLength={200}
          className={`min-w-0 flex-[2] basis-48 ${fieldClass}`}
        />
        {when === "date" ? (
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" className={fieldClass} />
        ) : (
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="How long before"
            className={`w-20 ${fieldClass}`}
          />
        )}
        <select value={when} onChange={(e) => setWhen(e.target.value as When)} aria-label="Before the trip" className={fieldClass}>
          <option value="days">days before</option>
          <option value="weeks">weeks before</option>
          <option value="months">months before</option>
          {props.dated && <option value="date">on a date</option>}
        </select>
        <button type="submit" disabled={busy || props.disabled || !text.trim()} className={buttonClass}>
          {props.submitLabel}
        </button>
        {props.onCancel && (
          <button type="button" onClick={props.onCancel} className={buttonClass}>
            Cancel
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-danger">{error}</p>}
    </form>
  );
}

// Settings' "Before international trips": the user's own reminders, each
// with how long before a trip abroad it is due.
export function TripRemindersSection({ uid }: { uid: string }) {
  const reminders = useStandingReminders(uid);
  const [editing, setEditing] = useState<string>();
  const [error, setError] = useState<string>();
  const remove = async (slot: string) => {
    setError(undefined);
    try {
      await removeStandingReminder(uid, slot);
    } catch (err) {
      console.error("Removing a reminder failed", err);
      setError((err as Error).message);
    }
  };
  const list = reminders ?? [];
  return (
    <section className="mt-10">
      <h2 className="text-lg font-medium">Before international trips</h2>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Things to do before every trip abroad. Prescriptions, phone plans, shopping, etc.
      </p>
      {list.length > 0 && (
        <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800" aria-label="Your reminders">
          {list.map((r) =>
            editing === r.slot ? (
              <li key={r.slot} className="py-1">
                <ReminderForm
                  id={r.id}
                  initial={r}
                  submitLabel="Save"
                  onSave={async (next) => {
                    await saveStandingReminder(uid, next as StandingReminder, r.slot);
                    setEditing(undefined);
                  }}
                  onCancel={() => setEditing(undefined)}
                />
              </li>
            ) : (
              <li key={r.slot} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{r.text}</p>
                  <p className="text-zinc-600 dark:text-zinc-400">{leadText(r)}</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" className={buttonClass} onClick={() => setEditing(r.slot)}>
                    Edit
                  </button>
                  <button type="button" className={buttonClass} onClick={() => remove(r.slot)}>
                    Remove
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
      {error && <p className="mt-2 text-danger">{error}</p>}
      <ReminderForm
        submitLabel="Add a reminder"
        disabled={!reminders || list.length >= maxStandingReminders}
        onSave={(r) => saveStandingReminder(uid, r as StandingReminder)}
      />
    </section>
  );
}

// The trip page's "Before you go": the viewer's own reminders for this
// trip, each ticked off for them alone, and a one-off added to it.
export function BeforeYouGo(props: {
  uid: string;
  tripId: string;
  entries: readonly ChecklistEntry[];
  added: readonly Slotted<OneOffReminder>[];
  today: string;
}) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string>();
  const run = async (what: string, action: () => Promise<void>) => {
    setError(undefined);
    try {
      await action();
    } catch (err) {
      console.error(`${what} failed`, err);
      setError((err as Error).message);
    }
  };
  // A box follows the tap at once; the stored value catches up (a
  // transaction waits for the server), and a failure puts it back.
  // Each tap, by reminder, with the stored value it was made against: it
  // shows until the stored value changes.
  const [ticked, setTicked] = useState<Record<string, { on: boolean; was: boolean }>>({});
  // Once the stored value moves (the tap landed, or another device changed
  // it), the tap has done its job and the stored value shows. Dropped
  // while rendering, as React suggests for state that follows props.
  const stale = Object.keys(ticked).filter((id) => props.entries.find((e) => e.id === id)?.done !== ticked[id]!.was);
  if (stale.length) setTicked((t) => Object.fromEntries(Object.entries(t).filter(([id]) => !stale.includes(id))));
  const isDone = (e: ChecklistEntry) => {
    const tap = ticked[e.id];
    return tap && tap.was === e.done ? tap.on : e.done;
  };
  const tick = (e: ChecklistEntry, on: boolean) => {
    setTicked((t) => ({ ...t, [e.id]: { on, was: e.done } }));
    void run("Ticking a reminder", async () => {
      try {
        await setDone(props.uid, props.tripId, e.id, on);
      } catch (err) {
        setTicked((t) => ({ ...t, [e.id]: { on: e.done, was: e.done } }));
        throw err;
      }
    });
  };
  const slotOf = (id: string) => props.added.find((r) => r.id === id)?.slot;
  return (
    <section className="mt-6" aria-labelledby="before-you-go">
      <h2 id="before-you-go" className="text-lg font-medium">
        Before you go
      </h2>
      {props.entries.length > 0 && (
        <ul className="mt-1 divide-y divide-zinc-200 dark:divide-zinc-800" aria-label="Before you go">
          {props.entries.map((e) => {
            const done = isDone(e);
            return (
              <li key={e.id} className="flex items-center gap-3 py-2">
                <input type="checkbox" checked={done} aria-label={e.text} onChange={(ev) => tick(e, ev.target.checked)} />
                <span className={`min-w-0 flex-1 ${done ? "text-muted line-through" : ""}`}>{e.text}</span>
                <span className={done || e.due > props.today ? "text-muted" : "text-danger"}>{dueText(e.due, props.today)}</span>
                {e.oneOff && slotOf(e.id) && (
                  <button
                    type="button"
                    className="text-muted hover:underline"
                    aria-label={`Remove ${e.text}`}
                    onClick={() => void run("Removing a reminder", () => removeOneOff(props.uid, props.tripId, slotOf(e.id)!))}
                  >
                    Remove
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="mt-2 text-danger">{error}</p>}
      {adding ? (
        <ReminderForm
          dated
          submitLabel="Add"
          disabled={props.added.length >= maxTripReminders}
          onSave={async (r) => {
            await addOneOff(props.uid, props.tripId, r);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className={`${buttonClass} mt-2`}>
          Add a reminder
        </button>
      )}
    </section>
  );
}
