"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { directionsUrl, formatDateRange, isCancelled, nearbyTrips, segmentSources, sourceSearch, type Segment, type SourceRef, type Trip } from "@travelmo/core";
import { emailLinkFor, sourceKindLabels, type EmailLinks } from "@/lib/sourceLinks";

const buttonClass = "rounded-lg border border-field px-3 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900";

// A modal on the browser's own <dialog>: it traps focus, closes on Escape
// and hands focus back to whatever opened it.
export function Dialog({ title, onClose, children, actions }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      // A click on the backdrop lands on the dialog itself.
      onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-zinc-200 bg-background p-0 text-foreground backdrop:bg-black/40 dark:border-zinc-800"
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-medium">{title}</h2>
          {actions}
        </div>
        <div className="mt-3 max-h-[60vh] overflow-y-auto">{children}</div>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className={buttonClass}>
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}

// Every email, TripIt trip or calendar event the booking was read from,
// including ones dropped as duplicates of it, then the sender, as Android's
// booking details list them. An email the viewer imported opens in Gmail.
export function SourcesList({
  segment,
  emailLinks,
  onLearnSender,
  onNeverSender,
}: {
  segment: Segment;
  emailLinks?: EmailLinks;
  onLearnSender?: () => void;
  onNeverSender?: () => void;
}) {
  const sources = segmentSources(segment);
  const [copied, setCopied] = useState(false);
  // On a phone, Gmail's mobile site drops the link's message id, so the
  // tap also copies a search for the email to paste there.
  const copySearch = (source: SourceRef) => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    const search = sourceSearch(segment, source);
    navigator.clipboard.writeText(search).then(
      () => setCopied(true),
      (error: unknown) => console.error("Copying the Gmail search failed", error),
    );
  };
  return (
    <>
      {copied && <p className="pb-2">Search copied. Paste it in Gmail&apos;s search.</p>}
      <ul data-testid="segment-sources">
        {sources.map((source) => {
          const kind = sourceKindLabels[source.kind];
          const href = emailLinkFor(source, emailLinks);
          const name = source.label ?? kind;
          return (
            <li key={`${source.kind}/${source.id}`} className="py-2">
              {href ? (
                <a href={href} target="_blank" rel="noreferrer" onClick={() => copySearch(source)} className="underline">
                  {name}
                </a>
              ) : (
                <p>{name}</p>
              )}
              {source.label && <p className="text-muted">{kind}</p>}
            </li>
          );
        })}
      </ul>
      {segment.sender && (
        <p className="py-2 text-muted">
          From {segment.sender}
          {onLearnSender && (
            <>
              {" · "}
              <button
                type="button"
                onClick={onLearnSender}
                className="underline"
              >
                Always import this sender
              </button>
            </>
          )}
          {onNeverSender && (
            <>
              {" · "}
              <button
                type="button"
                onClick={onNeverSender}
                className="underline"
              >
                Never import this sender
              </button>
            </>
          )}
        </p>
      )}
    </>
  );
}

// "New trip" first, then the trips around the booking's dates, the rest
// behind "More…".
function MoveDialog({
  segment,
  targets,
  onMove,
  onMoveToNew,
  onClose,
}: {
  segment: Segment;
  targets: Trip[];
  onMove: (tripId: string) => void;
  onMoveToNew?: () => void;
  onClose: () => void;
}) {
  const nearby = nearbyTrips(targets, segment);
  const [all, setAll] = useState(false);
  const shown = all ? targets : nearby;
  const choice = (key: string, label: ReactNode, onClick: () => void) => (
    <li key={key}>
      <button
        type="button"
        onClick={() => {
          onClick();
          onClose();
        }}
        className="w-full rounded-lg px-2 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-900"
      >
        {label}
      </button>
    </li>
  );
  return (
    <Dialog title="Move to another trip" onClose={onClose}>
      <ul>
        {onMoveToNew && choice("new", "New trip", onMoveToNew)}
        {shown.map((t) =>
          choice(
            t.id,
            <>
              {t.title}
              <span className="block text-xs text-muted">{formatDateRange(t.start, t.end)}</span>
            </>,
            () => onMove(t.id),
          ),
        )}
      </ul>
      {!all && shown.length < targets.length && (
        <button type="button" onClick={() => setAll(true)} className={`mt-2 ${buttonClass}`}>
          More…
        </button>
      )}
    </Dialog>
  );
}

/**
 * A booking's ⋮ menu, in the order Android's has: Directions (to where it
 * leads, directionsUrl) and Copy reference (when it has one) for anyone who
 * sees the trip (the sources are on the booking's details), then Edit, Mark cancelled (for a booking still booked) or Restore
 * (for a cancelled one), Move to and Delete
 * for those who may edit.
 */
export function BookingMenu({
  segment,
  onEdit,
  onRestore,
  onMarkCancelled,
  onDelete,
  moveTargets,
  onMove,
  onMoveToNew,
}: {
  segment: Segment;
  onEdit?: () => void;
  // Takes back the cancellation an email set; offered only while it's cancelled.
  onRestore?: () => void;
  // Says it didn't happen; offered only while it's booked.
  onMarkCancelled?: () => void;
  onDelete?: () => void;
  moveTargets?: Trip[];
  onMove?: (tripId: string) => void;
  // Moves the booking into a trip made for it.
  onMoveToNew?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<"move">();
  const [status, setStatus] = useState<string>();
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const reference = segment.confirmation?.trim() || undefined;
  const directions = directionsUrl(segment);
  const canMove = !!onMove && ((moveTargets?.length ?? 0) > 0 || !!onMoveToNew);
  const canRestore = !!onRestore && isCancelled(segment);
  const canMarkCancelled = !!onMarkCancelled && !isCancelled(segment);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  // The menu item that opened a dialog is gone by the time it closes, so
  // the browser can't hand focus back on its own.
  const closeDialog = () => {
    setDialog(undefined);
    trigger.current?.focus();
  };

  // A click anywhere else closes the menu.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  // "Copied" stands for a moment where the browser gives no sign of its own.
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(undefined), 2000);
    return () => clearTimeout(timer);
  }, [status]);

  if (!directions && !reference && !onEdit && !canRestore && !canMarkCancelled && !onDelete && !canMove) return null;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied");
    } catch (e) {
      console.error("Copying a booking reference failed", e);
      setStatus("Couldn't copy");
    }
  };

  const keys = (e: KeyboardEvent) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      items[(at + step + items.length) % items.length]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  };

  const item = (label: string, action: () => void) => (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        setOpen(false);
        action();
      }}
      className="block w-full px-4 py-2 text-left text-sm hover:bg-zinc-100 focus:bg-zinc-100 focus:outline-none dark:hover:bg-zinc-900 dark:focus:bg-zinc-900"
    >
      {label}
    </button>
  );

  return (
    <div ref={wrapper} className="relative shrink-0 self-start">
      <button
        ref={trigger}
        type="button"
        aria-label="Booking actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="-mt-1 flex h-8 w-8 items-center justify-center rounded-full text-lg leading-none text-muted hover:bg-zinc-100 dark:hover:bg-zinc-900"
      >
        ⋮
      </button>
      {status && (
        <p role="status" className="absolute right-0 top-8 whitespace-nowrap text-xs text-muted">
          {status}
        </p>
      )}
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label="Booking actions"
          onKeyDown={keys}
          className="absolute right-0 top-8 z-10 min-w-48 rounded-lg border border-zinc-200 bg-background py-1 shadow-lg dark:border-zinc-800"
        >
          {directions && (
            <a
              role="menuitem"
              href={directions}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="block w-full px-4 py-2 text-left text-sm hover:bg-zinc-100 focus:bg-zinc-100 focus:outline-none dark:hover:bg-zinc-900 dark:focus:bg-zinc-900"
            >
              Directions
            </a>
          )}
          {reference && item("Copy reference", () => void copy(reference))}
          {onEdit && item("Edit", onEdit)}
          {canMarkCancelled && onMarkCancelled && item("Mark cancelled", onMarkCancelled)}
          {canRestore && onRestore && item("Restore", onRestore)}
          {canMove && item("Move to another trip…", () => setDialog("move"))}
          {onDelete && item("Delete", onDelete)}
        </div>
      )}
      {dialog === "move" && onMove && (
        <MoveDialog segment={segment} targets={moveTargets ?? []} onMove={onMove} {...(onMoveToNew ? { onMoveToNew } : {})} onClose={closeDialog} />
      )}
    </div>
  );
}
