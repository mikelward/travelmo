import { duplicateFlightCancel, duplicateFlightText, type DuplicateFlight, type Segment } from "@travelmo/core";

const link = "underline hover:no-underline";

// One flight booked on two days near each other (duplicateFlights): which
// wasn't taken, or, for the owner, that both were.
export function DuplicateFlightNotice({
  pair,
  onCancel,
  onBothTaken,
}: {
  pair: DuplicateFlight<Segment>;
  onCancel?: ((segmentId: string) => void) | undefined;
  onBothTaken?: (() => void) | undefined;
}) {
  return (
    <div className="mt-4 space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950" data-testid="duplicate-flight">
      <p>{duplicateFlightText(pair)}</p>
      {(onCancel || onBothTaken) && (
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          {onCancel &&
            [pair.first, pair.second].map((flight) => (
              <button key={flight.id} type="button" onClick={() => onCancel(flight.id)} className={link}>
                {duplicateFlightCancel(flight)}
              </button>
            ))}
          {onBothTaken && (
            <button type="button" onClick={onBothTaken} className={link}>
              Both were taken
            </button>
          )}
        </p>
      )}
    </div>
  );
}
