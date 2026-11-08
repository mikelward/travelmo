import { emailLinkFor, type EmailLinks } from "@/lib/sourceLinks";
import {
  formatDate,
  localDate,
  localTime,
  loyaltyLine,
  segmentSources,
  type ProfileEntry,
  type Segment,
  type SegmentType,
  type SourceRef,
  type Trip,
} from "@travelmo/core";

const labels: Record<SegmentType, string> = {
  flight: "Flight",
  train: "Train",
  bus: "Bus",
  ferry: "Ferry",
  lodging: "Stay",
  car_rental: "Car",
  activity: "Activity",
  other: "Other",
};

function place(p: Segment["origin"]): string | undefined {
  if (!p) return undefined;
  return p.code ? `${p.code} ${p.city ?? p.name}` : p.city ?? p.name;
}

// The row sits under its start day's heading, so an end on another day
// carries its date.
function endLabel(segment: Segment): string | undefined {
  if (!segment.end) return undefined;
  const time = localTime(segment.end);
  return localDate(segment.end) === localDate(segment.start) ? time : `${formatDate(localDate(segment.end))} ${time}`;
}

const sourceKinds: Record<SourceRef["kind"], string> = { gmail: "Email", tripit: "TripIt", ics: "Calendar", forward: "Forwarded email" };

const plural = (n: number) => (n === 1 ? "1 star" : `${n} stars`);

// The traveler's verdict: one to five stars (tapping the current rating
// clears it) and a heart for a favorite. Read-only for a viewer who cannot
// edit, and absent when there is nothing to show them.
function Verdict({ segment, onRate, onFavorite }: { segment: Segment; onRate?: (rating: number | null) => void; onFavorite?: (favorite: boolean) => void }) {
  const rating = segment.rating ?? 0;
  const favorite = segment.favorite === true;
  if (!onRate && !onFavorite && !rating && !favorite) return null;
  const starClass = (n: number) => (n <= rating ? "text-amber-500" : "text-zinc-300 dark:text-zinc-700");
  return (
    <p className="mt-1 flex items-center gap-1 text-sm" data-testid="segment-verdict">
      <span role="group" aria-label={rating ? `Rated ${plural(rating)}` : "Not rated"} className="flex">
        {[1, 2, 3, 4, 5].map((n) =>
          onRate ? (
            <button
              key={n}
              type="button"
              aria-label={n === rating ? `Clear the rating` : `Rate ${plural(n)}`}
              aria-pressed={n <= rating}
              onClick={() => onRate(n === rating ? null : n)}
              className={`${starClass(n)} hover:text-amber-600`}
            >
              ★
            </button>
          ) : (
            <span key={n} aria-hidden className={starClass(n)}>
              ★
            </span>
          ),
        )}
      </span>
      {onFavorite ? (
        <button
          type="button"
          aria-label={favorite ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={favorite}
          onClick={() => onFavorite(!favorite)}
          className={`ml-1 ${favorite ? "text-rose-500" : "text-zinc-300 hover:text-rose-400 dark:text-zinc-700"}`}
        >
          ♥
        </button>
      ) : (
        favorite && (
          <span className="ml-1 text-rose-500" aria-label="Favorite">
            ♥
          </span>
        )
      )}
    </p>
  );
}

// Every email, TripIt trip or calendar event the booking was read from,
// including ones dropped as duplicates of it: a second room, or a detail
// the extraction left out, is one click away. The sender follows on the
// same line, with the offer to always import it.
function Sources({ segment, emailLinks, onLearnSender }: { segment: Segment; emailLinks?: EmailLinks; onLearnSender?: () => void }) {
  const sources = segmentSources(segment);
  if (sources.length === 0 && !segment.sender) return null;
  return (
    <p className="mt-1 text-xs text-zinc-500" data-testid="segment-sources">
      {sources.length > 0 && (sources.length === 1 ? "Source: " : `Sources (${sources.length}): `)}
      {sources.map((source, i) => {
        const text = `${sourceKinds[source.kind]}${source.label ? ` “${source.label}”` : ""}`;
        const href = emailLinkFor(source, emailLinks);
        return (
          <span key={`${source.kind}/${source.id}`}>
            {i > 0 && " · "}
            {href ? (
              <a href={href} target="_blank" rel="noreferrer" className="hover:underline">
                {text}
              </a>
            ) : (
              text
            )}
          </span>
        );
      })}
      {segment.sender && (
        <>
          {sources.length > 0 && " · "}
          From {segment.sender}
          {onLearnSender && (
            <>
              {" · "}
              <button type="button" onClick={onLearnSender} className="hover:underline">
                Always import this sender
              </button>
            </>
          )}
        </>
      )}
    </p>
  );
}

export function SegmentRow({
  segment,
  onEdit,
  onDelete,
  onLearnSender,
  moveTargets,
  onMove,
  emailLinks,
  programs,
  onRate,
  onFavorite,
}: {
  segment: Segment;
  onEdit?: () => void;
  onDelete?: () => void;
  onLearnSender?: () => void;
  moveTargets?: Trip[];
  onMove?: (tripId: string) => void;
  emailLinks?: EmailLinks;
  // The viewer's loyalty programs this booking's provider belongs to.
  programs?: readonly ProfileEntry[];
  // Stars and the favorite mark; without these the row only shows them.
  onRate?: (rating: number | null) => void;
  onFavorite?: (favorite: boolean) => void;
}) {
  const route = [place(segment.origin), place(segment.destination)].filter(Boolean).join(" → ");
  // Addresses an address pick recorded, under the route they belong to.
  const addresses = [segment.origin?.address, segment.destination?.address].filter(Boolean).join(" → ");
  const end = endLabel(segment);
  const times =
    segment.type === "lodging"
      ? `Check-in ${localTime(segment.start)}${end ? ` · Check-out ${end}` : ""}`
      : `${localTime(segment.start)}${end ? ` – ${end}` : ""}`;
  return (
    <li className="flex gap-4 py-3">
      <span className="w-16 shrink-0 text-xs font-medium uppercase tracking-wide text-zinc-500">{labels[segment.type]}</span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{segment.title}</p>
        {route && <p className="text-sm text-zinc-600 dark:text-zinc-400">{route}</p>}
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{times}</p>
        {addresses && <p className="mt-1 text-xs text-zinc-500">{addresses}</p>}
        {(segment.confirmation || segment.provider) && (
          <p className="mt-1 text-xs text-zinc-500">
            {[segment.provider, segment.confirmation && `Ref ${segment.confirmation}`].filter(Boolean).join(" · ")}
          </p>
        )}
        {programs && programs.length > 0 && (
          <p className="mt-1 text-xs text-zinc-500" data-testid="segment-loyalty">
            {programs.map(loyaltyLine).join(" · ")}
          </p>
        )}
        {segment.notes && <p className="mt-1 whitespace-pre-line text-xs text-zinc-500">{segment.notes}</p>}
        <Verdict segment={segment} {...(onRate ? { onRate } : {})} {...(onFavorite ? { onFavorite } : {})} />
        <Sources segment={segment} {...(emailLinks ? { emailLinks } : {})} {...(onLearnSender ? { onLearnSender } : {})} />
      </div>
      {(onEdit || onDelete || (onMove && moveTargets && moveTargets.length > 0)) && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 self-start text-xs text-zinc-500">
          {onEdit && (
            <button type="button" onClick={onEdit} className="hover:underline">
              Edit
            </button>
          )}
          {onDelete && (
            <button type="button" onClick={onDelete} className="hover:underline">
              Delete
            </button>
          )}
          {onMove && moveTargets && moveTargets.length > 0 && (
            <select
              value=""
              onChange={(e) => e.target.value && onMove(e.target.value)}
              title="Move to another trip"
              className="rounded border border-zinc-300 bg-transparent px-1 py-0.5 text-xs dark:border-zinc-700"
            >
              <option value="">Move to…</option>
              {moveTargets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
    </li>
  );
}
