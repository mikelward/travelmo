import { eventVerb, formatDate, formatDateRange, localDate, localTime, nextEvent, type Segment, type Trip } from "@travelmo/core";
import Link from "next/link";
import { DocumentWarnings } from "@/components/DocumentWarnings";
import type { PersonWarning } from "@travelmo/core";

export function TripCard({
  trip,
  shared,
  segments,
  now,
  warnings,
  today,
}: {
  trip: Trip;
  shared: boolean;
  segments?: Segment[];
  now?: string;
  warnings?: readonly PersonWarning[];
  today?: string;
}) {
  const badge = trip.deleting ? "Deleting" : shared ? "Shared" : undefined;
  const event = segments && now ? nextEvent(segments, now) : undefined;
  return (
    <Link
      href={`/trips/${trip.id}`}
      className={`block rounded-xl border border-zinc-200 p-4 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600 ${trip.deleting ? "opacity-60" : ""}`}
    >
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="truncate text-lg font-medium">{trip.title}</h3>
        {badge && <span className="shrink-0 text-xs uppercase tracking-wide text-zinc-500">{badge}</span>}
      </div>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{formatDateRange(trip.start, trip.end)}</p>
      {event && (
        <p className="mt-2 text-sm">
          <span className="font-medium">{eventVerb(event)}</span> {event.segment.title}
          <span className="text-zinc-500">
            {" · "}
            {formatDate(localDate(event.at))} {localTime(event.at)}
          </span>
        </p>
      )}
      {warnings && today && <DocumentWarnings warnings={warnings} today={today} compact />}
    </Link>
  );
}
