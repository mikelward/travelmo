import { allCancelled, checkInLine, displayBounds, formatDate, formatDateRange, localDate, localTime, tripNextUp, tripStatus, type FlightStatus, type Segment, type Trip } from "@travelmo/core";
import Link from "next/link";

// A trip's card: the title (as displayTitles shows it among the list), its
// dates, whether every booking was cancelled, and given the time now (for a
// trip under way) what comes next (tripNextUp), with the live status of its
// next flight. The list's top carries the document warnings.
export function TripCard({
  trip,
  title = trip.title,
  shared,
  segments,
  now,
  flightStatuses,
}: {
  trip: Trip;
  title?: string;
  shared: boolean;
  segments?: Segment[];
  now?: string;
  flightStatuses?: Record<string, FlightStatus>;
}) {
  const badge = trip.deleting ? "Deleting" : shared ? "Shared" : undefined;
  const { stay, checkIn } = segments && now ? tripStatus(segments, now) : {};
  const next = segments && now ? tripNextUp(segments, now, flightStatuses) : undefined;
  return (
    <Link
      href={`/trips/${trip.id}`}
      className={`block rounded-xl border border-zinc-200 p-4 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600 ${trip.deleting ? "opacity-60" : ""}`}
    >
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="truncate text-lg font-medium">{title}</h3>
        {badge && <span className="shrink-0 text-xs uppercase tracking-wide text-muted">{badge}</span>}
      </div>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{formatDateRange(displayBounds(trip).start, displayBounds(trip).end)}</p>
      {segments && allCancelled(segments) && (
        <p className="mt-2 text-sm text-danger" data-testid="trip-cancelled">
          Every booking cancelled
        </p>
      )}
      {stay && (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400" data-testid="trip-stay">
          Staying at {stay.title}
          {stay.end && (
            <span className="text-muted">
              {" · "}until {formatDate(localDate(stay.end))} {localTime(stay.end)}
            </span>
          )}
        </p>
      )}
      {next && (
        <div className="mt-2 text-sm" data-testid="trip-next">
          <p className="font-medium" data-testid="trip-next-title">
            {next.title}
          </p>
          <p className="text-muted" data-testid="trip-next-when">
            {next.when}
          </p>
          {next.step && <p data-testid="trip-next-step">{next.step}</p>}
        </div>
      )}
      {checkIn && (
        <p className={`mt-1 text-sm ${checkIn.open ? "text-amber-800 dark:text-amber-300" : "text-muted"}`} data-testid="trip-checkin">
          {checkInLine(checkIn)}
        </p>
      )}
    </Link>
  );
}
