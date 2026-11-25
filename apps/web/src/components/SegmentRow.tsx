"use client";

import { useState, type MouseEvent } from "react";
import { SegmentIcon } from "@/components/SegmentIcon";
import { BookingMenu } from "@/components/BookingMenu";
import { BookingDetailsDialog } from "@/components/BookingDetails";
import type { EmailLinks } from "@/lib/sourceLinks";
import {
  formatDate,
  isUntimed,
  isCancelled,
  localDate,
  localTime,
  type ProfileEntry,
  type Segment,
  type SegmentType,
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

const plural = (n: number) => (n === 1 ? "1 star" : `${n} stars`);

// The traveler's verdict: one to five stars (tapping the current rating
// clears it) and a heart for a favorite. Read-only for a viewer who cannot
// edit, and absent when there is nothing to show them.
function Verdict({ segment, onRate, onFavorite }: { segment: Segment; onRate?: (rating: number | null) => void; onFavorite?: (favorite: boolean) => void }) {
  const rating = segment.rating ?? 0;
  const favorite = segment.favorite === true;
  if (!onRate && !onFavorite && !rating && !favorite) return null;
  const starClass = (n: number) => (n <= rating ? "text-amber-500" : "text-muted");
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
          className={`ml-1 ${favorite ? "text-rose-500" : "text-muted hover:text-rose-400"}`}
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

export function SegmentRow({
  segment,
  onEdit,
  onDelete,
  onLearnSender,
  onNeverSender,
  moveTargets,
  onMove,
  onMoveToNew,
  emailLinks,
  programs,
  onRate,
  onFavorite,
  flightLines,
  checkIn,
  onRestore,
  onMarkCancelled,
}: {
  segment: Segment;
  onEdit?: () => void;
  onDelete?: () => void;
  onLearnSender?: () => void;
  onNeverSender?: () => void;
  moveTargets?: Trip[];
  onMove?: (tripId: string) => void;
  onMoveToNew?: () => void;
  emailLinks?: EmailLinks;
  // The viewer's loyalty programs this booking's provider belongs to.
  programs?: readonly ProfileEntry[];
  // Stars and the favorite mark; without these the row only shows them.
  onRate?: (rating: number | null) => void;
  onFavorite?: (favorite: boolean) => void;
  // A flight's live delays, gates and carousel (flightStatusLines).
  flightLines?: readonly string[];
  // A flight's "I've checked in" (flightCheckInState): offered, or marked
  // with an undo. The viewer's own, whoever's trip it is.
  checkIn?: { state: "offer" | "done"; onChange: (checkedIn: boolean) => void };
  // Takes back a cancellation; offered only on a cancelled booking.
  onRestore?: () => void;
  // Says the booking didn't happen; offered only on one still booked.
  onMarkCancelled?: () => void;
}) {
  const [details, setDetails] = useState(false);
  const cancelled = isCancelled(segment);
  const route = [place(segment.origin), place(segment.destination)].filter(Boolean).join(" → ");
  // A tap anywhere on the row but its own controls opens the booking.
  const open = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, a, input, [role=menu]")) return;
    setDetails(true);
  };
  const verdict = <Verdict segment={segment} {...(onRate ? { onRate } : {})} {...(onFavorite ? { onFavorite } : {})} />;
  const end = endLabel(segment);
  // A day out with no time of its own shows none, not 00:00.
  const times = isUntimed(segment)
    ? undefined
    : segment.type === "lodging"
      ? `Check-in ${localTime(segment.start)}${end ? ` · Check-out ${end}` : ""}`
      : `${localTime(segment.start)}${end ? ` – ${end}` : ""}`;
  return (
    <li className="flex gap-4 py-3">
      {details && (
        <BookingDetailsDialog
          segment={segment}
          route={route || undefined}
          times={times}
          verdict={verdict}
          programs={programs}
          emailLinks={emailLinks}
          onEdit={onEdit}
          onLearnSender={onLearnSender}
          onNeverSender={onNeverSender}
          onClose={() => setDetails(false)}
        />
      )}
      <SegmentIcon type={segment.type} label={labels[segment.type]} className="mt-0.5 shrink-0 text-muted" />
      <div className="min-w-0 flex-1 cursor-pointer" onClick={open}>
        {cancelled && (
          <p className="text-xs font-medium uppercase tracking-wide text-danger" data-testid="segment-cancelled">
            Cancelled
          </p>
        )}
        <p className={`font-medium${cancelled ? " text-muted line-through" : ""}`}>
          <button type="button" onClick={() => setDetails(true)} className="block w-full text-left hover:underline">
            {segment.title}
          </button>
        </p>
        {route && <p className={`text-sm text-zinc-600 dark:text-zinc-400${cancelled ? " line-through" : ""}`}>{route}</p>}
        {times && <p className={`text-sm text-zinc-600 dark:text-zinc-400${cancelled ? " line-through" : ""}`}>{times}</p>}
        {flightLines && flightLines.length > 0 && (
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300" data-testid="segment-flight-status">
            {flightLines.join(" · ")}
          </p>
        )}
        {checkIn?.state === "offer" && (
          <p className="mt-1 text-sm">
            <button type="button" onClick={() => checkIn.onChange(true)} className="font-medium underline hover:no-underline">
              I&rsquo;ve checked in
            </button>
          </p>
        )}
        {checkIn?.state === "done" && (
          <p className="mt-1 flex gap-3 text-sm" data-testid="segment-checked-in">
            <span>Checked in</span>
            <button type="button" onClick={() => checkIn.onChange(false)} className="text-muted underline hover:no-underline">
              Undo
            </button>
          </p>
        )}
        {verdict}
      </div>
      <BookingMenu
        segment={segment}
        {...(onEdit ? { onEdit } : {})}
        {...(cancelled && onRestore ? { onRestore } : {})}
        {...(!cancelled && onMarkCancelled ? { onMarkCancelled } : {})}
        {...(onDelete ? { onDelete } : {})}
        {...(moveTargets ? { moveTargets } : {})}
        {...(onMove ? { onMove } : {})}
        {...(onMoveToNew ? { onMoveToNew } : {})}
      />
    </li>
  );
}
