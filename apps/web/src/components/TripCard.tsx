import {
  mixedTrip,
  tripCancelled,
  checkInLine,
  displayBounds,
  formatDate,
  formatDateRange,
  localDate,
  localTime,
  tripNextUp,
  tripSetting,
  tripStatus,
  type FlightStatus,
  type Segment,
  type Trip,
} from "@travelmo/core";
import Link from "next/link";
import { memo } from "react";
import { TripLandmark } from "@/components/TripLandmark";

// A trip in its section's card: its picture (TripLandmark), the title (as displayTitles shows it among the list), its
// dates, both struck through once it was cancelled, and given the time now (for a
// trip under way) what comes next (tripNextUp), with the live status of its
// next flight, and the flight's online check-in until the viewer says they
// checked in, and a journey it seems to be missing (`missing`, from
// journeyGaps). The list's top carries the document warnings.
export const TripCard = memo(function TripCard({
  trip,
  title = trip.title,
  shared,
  segments,
  now,
  flightStatuses,
  checkedIn,
  onCheckedIn,
  missing,
  watching = false,
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
  // "No flight from Boston back to London found", the first journey a trip
  // seems to miss.
  missing?: string;
  // Whether the viewer is only watching it: none of its travelers is them.
  watching?: boolean;
}) {
  // Bookings that look like two trips in one, by the trip's flag or, before
  // it is kept, its bookings; unless the owner said it is one.
  const check = !trip.oneTrip && (trip.mixed ?? (segments ? mixedTrip(segments, trip.removedTravelers) !== undefined : false));
  const badge = trip.deleting
    ? "Deleting"
    : check
      ? "Check"
      : watching
      ? "Watching"
      : shared
        ? "Shared"
        : undefined;
  // A cancelled trip (by hand, or every booking) is struck through, as a
  // cancelled booking is, and has nothing coming.
  const cancelled = tripCancelled(trip, segments);
  const going = segments && now && !cancelled;
  const { stay, checkIn } = going ? tripStatus(segments, now) : {};
  const next = going ? tripNextUp(segments, now, flightStatuses) : undefined;
  // Check-in is the traveler's to do, not someone watching the trip.
  const showCheckIn = checkIn && !watching && !checkedIn?.has(checkIn.segment.id);
  return (
    // The check-in button sits outside the link: a button can't be inside one.
    <div
      data-testid="trip-card"
      className={`transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900 ${trip.deleting ? "opacity-60" : ""}`}
    >
      <Link href={`/trips/${trip.id}`} className="block px-4 py-3">
        {/* The landmark beside the title and dates; what comes next runs below, in line with the title. */}
        <div className="flex items-center gap-3">
          {/* Until the trip says what kind of place it goes to, its bookings do, where the list has them. */}
          <TripLandmark
            title={title}
            setting={trip.setting ?? (segments && tripSetting(segments))}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-4">
              <h3
                className={`truncate text-2xl font-semibold${cancelled ? " text-muted line-through" : ""}`}
              >
                {title}
                {cancelled && (
                  <span className="sr-only" data-testid="trip-cancelled">
                    {" "}
                    (cancelled)
                  </span>
                )}
              </h3>
              {badge && (
                <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-muted">
                  {badge}
                </span>
              )}
            </div>
            <p
              className={`mt-1 text-zinc-600 dark:text-zinc-400${cancelled ? " line-through" : ""}`}
            >
              {formatDateRange(
                displayBounds(trip).start,
                displayBounds(trip).end,
              )}
            </p>
          </div>
        </div>
        <div className="pl-[52px]">
          {missing && !cancelled && (
            <p
              className="mt-2 text-amber-800 dark:text-amber-300"
              data-testid="trip-missing"
            >
              {missing}
            </p>
          )}
          {stay && (
            <p
              className="mt-2 text-zinc-600 dark:text-zinc-400"
              data-testid="trip-stay"
            >
              Staying at {stay.title}
              {stay.end && (
                <span className="text-muted">
                  {" · "}until {formatDate(localDate(stay.end))}{" "}
                  {localTime(stay.end)}
                </span>
              )}
            </p>
          )}
          {next && (
            <div className="mt-2" data-testid="trip-next">
              <p className="font-medium" data-testid="trip-next-title">
                {next.title}
              </p>
              <p className="text-muted" data-testid="trip-next-when">
                {next.when}
              </p>
              {next.step && (
                <p className="text-muted" data-testid="trip-next-step">
                  {next.step}
                </p>
              )}
              {next.then && (
                <p className="text-muted" data-testid="trip-next-then">
                  {next.then}
                </p>
              )}
            </div>
          )}
        </div>
      </Link>
      {showCheckIn && (
        <div className="-mt-2 flex flex-wrap items-baseline gap-x-3 pb-3 pl-[68px] pr-4">
          <p
            className={
              checkIn.open ? "text-amber-800 dark:text-amber-300" : "text-muted"
            }
            data-testid="trip-checkin"
          >
            {checkInLine(checkIn)}
          </p>
          {checkIn.open && onCheckedIn && (
            <button
              type="button"
              onClick={() => onCheckedIn(checkIn.segment.id)}
              className="font-medium underline hover:no-underline"
            >
              I&rsquo;ve checked in
            </button>
          )}
        </div>
      )}
    </div>
  );
});
