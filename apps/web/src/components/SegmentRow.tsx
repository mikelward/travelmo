import { emailLinkFor, type EmailLinks } from "@/lib/sourceLinks";
import {
  formatDate,
  localDate,
  localTime,
  segmentSources,
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

const sourceKinds: Record<SourceRef["kind"], string> = { gmail: "Email", tripit: "TripIt", ics: "Calendar" };

// Every email, TripIt trip or calendar event the booking was read from,
// including ones dropped as duplicates of it: a second room, or a detail
// the extraction left out, is one click away.
function Sources({ segment, emailLinks }: { segment: Segment; emailLinks?: EmailLinks }) {
  const sources = segmentSources(segment);
  if (sources.length === 0) return null;
  return (
    <p className="mt-1 text-xs text-zinc-500" data-testid="segment-sources">
      {sources.length === 1 ? "Source: " : `Sources (${sources.length}): `}
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
}: {
  segment: Segment;
  onEdit?: () => void;
  onDelete?: () => void;
  onLearnSender?: () => void;
  moveTargets?: Trip[];
  onMove?: (tripId: string) => void;
  emailLinks?: EmailLinks;
}) {
  const route = [place(segment.origin), place(segment.destination)].filter(Boolean).join(" → ");
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
        {(segment.confirmation || segment.provider) && (
          <p className="mt-1 text-xs text-zinc-500">
            {[segment.provider, segment.confirmation && `Ref ${segment.confirmation}`].filter(Boolean).join(" · ")}
          </p>
        )}
        {segment.notes && <p className="mt-1 whitespace-pre-line text-xs text-zinc-500">{segment.notes}</p>}
        <Sources segment={segment} {...(emailLinks ? { emailLinks } : {})} />
        {segment.sender && (
          <p className="mt-1 text-xs text-zinc-500">
            From {segment.sender}
            {onLearnSender && (
              <>
                {" · "}
                <button type="button" onClick={onLearnSender} className="hover:underline">
                  Always import this sender
                </button>
              </>
            )}
          </p>
        )}
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
