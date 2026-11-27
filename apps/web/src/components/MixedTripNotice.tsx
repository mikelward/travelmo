import type { MixedTrip } from "@travelmo/core";

const link = "underline hover:no-underline";

// What makes a trip look like two in one (mixedTrip), in words.
export function mixedTripText(mixed: MixedTrip): string {
  switch (mixed.kind) {
    case "overlap":
      return `${mixed.first.title} and ${mixed.second.title} are in the air at the same time.`;
    case "elsewhere":
      return `${mixed.second.title} leaves from another country hours after ${mixed.first.title} lands.`;
    case "travelers":
      return `some bookings are for ${mixed.groups[0]!.join(", ")}, others for ${mixed.groups[1]!.join(", ")}.`;
  }
}

// A trip whose bookings look like two trips filed as one: why, and, for the
// owner, what to do about it.
export function MixedTripNotice({
  mixed,
  onSplit,
  onTravelers,
  onOneTrip,
}: {
  mixed: MixedTrip;
  onSplit?: (() => void) | undefined;
  onTravelers?: (() => void) | undefined;
  onOneTrip?: (() => void) | undefined;
}) {
  return (
    <div className="mt-4 space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950" data-testid="mixed-trip">
      <p>This may be two trips: {mixedTripText(mixed)}</p>
      {(onSplit || onTravelers || onOneTrip) && (
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          {onSplit && (
            <button type="button" onClick={onSplit} className={link}>
              Split…
            </button>
          )}
          {onTravelers && (
            <button type="button" onClick={onTravelers} className={link}>
              Travelers…
            </button>
          )}
          {onOneTrip && (
            <button type="button" onClick={onOneTrip} className={link}>
              It&apos;s one trip
            </button>
          )}
        </p>
      )}
    </div>
  );
}
