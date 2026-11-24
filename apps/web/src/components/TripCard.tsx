import { allCancelled, checkInLine, displayBounds, formatDate, formatDateRange, localDate, localTime, tripNextUp, tripStatus, type FlightStatus, type Segment, type Trip } from "@travelmo/core";
import Link from "next/link";

// A trip's card: the title (as displayTitles shows it among the list), its
// dates, whether every booking was cancelled, and given the time now (for a
// trip under way) what comes next (tripNextUp), with the live status of its
// next flight, and the flight's online check-in until the viewer says they
// checked in. The list's top carries the document warnings.
export function TripCard({
  trip,
  title = trip.title,
  shared,
  segments,
  now,
  flightStatuses,
  checkedIn,
  onCheckedIn,
}: {
  trip: Trip;
  title?: string;
  shared: boolean;
  segments?: Segment[];
  now?: string;
  flightStatuses?: Record<string, FlightStatus>;
  // The bookings on this trip the viewer marked "I've checked in".
  checkedIn?: ReadonlySet<string>;
  onCheckedIn?: (segmentId: string) => void;
}) {
  const badge = trip.deleting ? "Deleting" : shared ? "Shared" : undefined;
  const { stay, checkIn } = segments && now ? tripStatus(segments, now) : {};
  const next = segments && now ? tripNextUp(segments, now, flightStatuses) : undefined;
  const showCheckIn = checkIn && !checkedIn?.has(checkIn.segment.id);
  return (
    // The check-in button sits outside the link: a button can't be inside one.
    <div
      data-testid="trip-card"
      className={`rounded-xl border border-zinc-200 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600 ${trip.deleting ? "opacity-60" : ""}`}
    >
      <Link href={`/trips/${trip.id}`} className="block p-4">
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
      </Link>
      {showCheckIn && (
        <div className="-mt-3 flex flex-wrap items-baseline gap-x-3 px-4 pb-4 text-sm">
          <p className={checkIn.open ? "text-amber-800 dark:text-amber-300" : "text-muted"} data-testid="trip-checkin">
            {checkInLine(checkIn)}
          </p>
          {checkIn.open && onCheckedIn && (
            <button type="button" onClick={() => onCheckedIn(checkIn.segment.id)} className="font-medium underline hover:no-underline">
              I&rsquo;ve checked in
            </button>
          )}
        </div>
      )}
    </div>
  );
}
