"use client";

import { addMonths, monthLabel, monthOf, monthWeeks, weekBars, type Trip, type TripBar } from "@travelmo/core";
import type { User } from "firebase/auth";
import Link from "next/link";
import { useState } from "react";
import { SignInGate } from "@/components/SignInGate";
import { localToday } from "@/lib/dates";
import { useSaveForOffline } from "@/lib/offline";
import { useTrips } from "@/lib/trips";

const buttonClass =
  "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// A trip's bar across one week: its title where it starts (or at the
// week's edge when it carried over), the whole bar a link to the trip.
function Bar({ bar, uid }: { bar: TripBar; uid: string }) {
  const shared = bar.trip.ownerUid !== uid;
  const rounded = `${bar.continuesBefore ? "" : "rounded-l-md"} ${bar.continuesAfter ? "" : "rounded-r-md"}`;
  return (
    <Link
      href={`/trips/${bar.trip.id}`}
      data-trip={bar.trip.id}
      data-days={`${bar.from}-${bar.to}`}
      title={bar.trip.title}
      style={{ gridColumn: `${bar.from + 1} / ${bar.to + 2}`, gridRow: bar.lane + 2 }}
      className={`${rounded} mx-px truncate px-1.5 py-0.5 text-xs text-white hover:opacity-90 ${
        shared ? "bg-violet-600 dark:bg-violet-500" : "bg-sky-600 dark:bg-sky-500"
      } ${bar.trip.deleting ? "opacity-50" : ""}`}
    >
      {bar.continuesBefore ? "… " : ""}
      {bar.trip.title}
    </Link>
  );
}

function Week({ week, trips, month, today, uid }: { week: readonly string[]; trips: readonly Trip[]; month: string; today: string; uid: string }) {
  const bars = weekBars(week, trips);
  const lanes = bars.reduce((n, b) => Math.max(n, b.lane + 1), 0);
  return (
    <div
      className="grid gap-y-0.5 border-t border-zinc-200 dark:border-zinc-800"
      style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gridTemplateRows: `auto repeat(${lanes}, auto)` }}
      data-week={week[0]}
    >
      {week.map((date, i) => {
        const inMonth = monthOf(date) === month;
        const isToday = date === today;
        return (
          <div key={date} style={{ gridColumn: i + 1, gridRow: 1 }} className={`px-1.5 pt-1 text-xs ${inMonth ? "" : "text-zinc-400 dark:text-zinc-600"}`}>
            <span
              className={isToday ? "inline-block rounded-full bg-zinc-900 px-1.5 font-medium text-white dark:bg-zinc-100 dark:text-zinc-900" : ""}
              aria-label={isToday ? `Today, ${date}` : undefined}
            >
              {Number(date.slice(8, 10))}
            </span>
          </div>
        );
      })}
      {bars.map((bar) => (
        <Bar key={bar.trip.id} bar={bar} uid={uid} />
      ))}
      {/* Keeps a week with no trips as tall as a day number. */}
      <div style={{ gridColumn: 1, gridRow: 1 }} className="min-h-10" aria-hidden />
    </div>
  );
}

function Calendar({ user }: { user: User }) {
  useSaveForOffline();
  const trips = useTrips(user);
  const today = localToday();
  const [month, setMonth] = useState(monthOf(today));
  if (!trips) return <p className="text-zinc-500">Loading trips…</p>;
  const weeks = monthWeeks(month);
  const inMonth = trips.filter((t) => monthOf(t.start) <= month && monthOf(t.end) >= month);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold" aria-live="polite">
          {monthLabel(month)}
        </h1>
        <div className="flex gap-2">
          <button type="button" className={buttonClass} onClick={() => setMonth((m) => addMonths(m, -1))} aria-label="Previous month">
            ‹
          </button>
          <button type="button" className={buttonClass} onClick={() => setMonth(monthOf(today))} disabled={month === monthOf(today)}>
            Today
          </button>
          <button type="button" className={buttonClass} onClick={() => setMonth((m) => addMonths(m, 1))} aria-label="Next month">
            ›
          </button>
        </div>
      </div>
      <div className="mt-4 rounded-xl border border-zinc-200 dark:border-zinc-800" role="grid" aria-label={`Trips in ${monthLabel(month)}`}>
        <div className="grid text-center text-xs font-medium uppercase tracking-wide text-zinc-500" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
          {weekdays.map((d) => (
            <div key={d} className="py-1">
              {d}
            </div>
          ))}
        </div>
        {weeks.map((week) => (
          <Week key={week[0]} week={week} trips={inMonth} month={month} today={today} uid={user.uid} />
        ))}
      </div>
      {inMonth.length === 0 && (
        <p className="mt-4 text-sm text-zinc-500" data-testid="no-trips">
          No trips in {monthLabel(month)}.
        </p>
      )}
    </>
  );
}

export default function CalendarPage() {
  return <SignInGate>{(user) => <Calendar user={user} />}</SignInGate>;
}
