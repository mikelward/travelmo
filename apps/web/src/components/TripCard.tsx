import { eventVerb, formatDate, formatDateRange, localDate, localTime, relativeTime, tripStatus, type Segment, type Trip } from "@travelmo/core";
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
  const { next: event, stay, checkIn } = segments && now ? tripStatus(segments, now) : {};
  const soon = event && now ? relativeTime(now, event.at) : undefined;
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
      {stay && (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400" data-testid="trip-stay">
          Staying at {stay.title}
          {stay.end && (
            <span className="text-zinc-500">
              {" · "}until {formatDate(localDate(stay.end))} {localTime(stay.end)}
            </span>
          )}
        </p>
      )}
      {event && (
        <p className="mt-2 text-sm" data-testid="trip-next">
          <span className="font-medium">{eventVerb(event)}</span> {event.segment.title}
          <span className="text-zinc-500">
            {" · "}
            {formatDate(localDate(event.at))} {localTime(event.at)}
            {soon && ` · ${soon}`}
          </span>
        </p>
      )}
      {checkIn && (
        <p className={`mt-1 text-sm ${checkIn.open ? "text-amber-800 dark:text-amber-300" : "text-zinc-500"}`} data-testid="trip-checkin">
          {checkIn.open ? "Online check-in open, usually until departure" : `Online check-in usually opens ${formatDate(localDate(checkIn.opensAt))} ${localTime(checkIn.opensAt)}`}
          {checkIn.segment.confirmation && ` · Ref ${checkIn.segment.confirmation}`}
        </p>
      )}
      {warnings && today && <DocumentWarnings warnings={warnings} today={today} compact />}
    </Link>
  );
}
