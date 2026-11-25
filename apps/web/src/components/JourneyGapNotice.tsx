import { gmailSearchUrl, journeyGapSearch, journeyGapText, type JourneyGap } from "@travelmo/core";

// The journeys a trip seems to be missing (journeyGaps): each with a Gmail
// search for its email and, for those who may, adding it by hand; and, when
// one is at the trip's ends, saying the trip goes one way.
export function JourneyGapNotice({ gaps, onAdd, onOneWay }: { gaps: readonly JourneyGap[]; onAdd?: (date: string) => void; onOneWay: () => void }) {
  const link = "underline hover:no-underline";
  return (
    <div className="mt-4 space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950" data-testid="journey-gap">
      {gaps.map((gap) => (
        <div key={`${gap.direction}-${gap.date}-${gap.from}-${gap.to}`}>
          <p className="text-amber-800 dark:text-amber-300">{journeyGapText(gap)}</p>
          <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            <a href={gmailSearchUrl(journeyGapSearch(gap))} target="_blank" rel="noreferrer" className={link}>
              Find it in Gmail
            </a>
            {onAdd && (
              <button type="button" onClick={() => onAdd(gap.date)} className={link}>
                Add it yourself
              </button>
            )}
          </p>
        </div>
      ))}
      {gaps.some((gap) => gap.direction !== "between") && (
        <p>
          <button type="button" onClick={onOneWay} className={link}>
            This trip is one way
          </button>
        </p>
      )}
    </div>
  );
}
