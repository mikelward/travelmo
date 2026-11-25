import { gmailSearchUrl, journeyGapSearch, journeyGapText, type JourneyGap } from "@travelmo/core";

// A trip whose journeys don't come back to where they started (journeyGap):
// what seems missing, a Gmail search for its email, and, for those who may,
// adding it by hand or saying the trip goes one way.
export function JourneyGapNotice({ gap, onAdd, onOneWay }: { gap: JourneyGap; onAdd?: () => void; onOneWay: () => void }) {
  const link = "underline hover:no-underline";
  return (
    <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950" data-testid="journey-gap">
      <p className="text-amber-800 dark:text-amber-300">{journeyGapText(gap)}</p>
      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        <a href={gmailSearchUrl(journeyGapSearch(gap))} target="_blank" rel="noreferrer" className={link}>
          Find it in Gmail
        </a>
        {onAdd && (
          <button type="button" onClick={onAdd} className={link}>
            Add it yourself
          </button>
        )}
        <button type="button" onClick={onOneWay} className={link}>
          This trip is one way
        </button>
      </p>
    </div>
  );
}
