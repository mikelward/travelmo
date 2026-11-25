"use client";

import { useEffect, useState, type ReactNode } from "react";
import { bookingHeading, formatDate, isCancelled, localDate, loyaltyLine, mapsUrl, segmentSources, type Place, type ProfileEntry, type Segment } from "@travelmo/core";
import { Dialog, SourcesList } from "@/components/BookingMenu";
import type { EmailLinks } from "@/lib/sourceLinks";

// A booking in full, opened by tapping its row, as Android's details page
// shows it: when and where, each place (a tap shows it in Google Maps), the
// provider, the reference (a tap copies it), who it is for, the viewer's
// loyalty programs, the notes and the sources. The ✎ edits it, for those who
// may.
export function BookingDetailsDialog({
  segment,
  route,
  times,
  verdict,
  programs,
  emailLinks,
  onEdit,
  onLearnSender,
  onNeverSender,
  onClose,
}: {
  segment: Segment;
  route?: string | undefined;
  times?: string | undefined;
  // The stars and heart, as the row shows them.
  verdict?: ReactNode;
  programs?: readonly ProfileEntry[] | undefined;
  emailLinks?: EmailLinks | undefined;
  onEdit?: (() => void) | undefined;
  onLearnSender?: (() => void) | undefined;
  onNeverSender?: (() => void) | undefined;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<string>();
  // "Copied" stands for a moment where the browser gives no sign of its own.
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(undefined), 2000);
    return () => clearTimeout(timer);
  }, [status]);
  const reference = segment.confirmation?.trim() || undefined;
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied");
    } catch (e) {
      console.error("Copying a booking reference failed", e);
      setStatus("Couldn't copy");
    }
  };
  // Both ends, unless they are the same place: a one-way rental's two desks share a name, not an address.
  const places = [segment.origin, segment.destination].filter((p): p is Place => !!p).filter((p, i, all) => all.findIndex((q) => JSON.stringify(q) === JSON.stringify(p)) === i);
  const cancelled = isCancelled(segment);
  const hasSources = segmentSources(segment).length > 0 || !!segment.sender;
  return (
    <Dialog
      title={bookingHeading(segment).headline}
      onClose={onClose}
      actions={
        onEdit && (
          <button
            type="button"
            aria-label="Edit"
            title="Edit"
            onClick={() => {
              onClose();
              onEdit();
            }}
            className="rounded-lg px-2 py-1 text-lg leading-none hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            ✎
          </button>
        )
      }
    >
      <div className="space-y-1" data-testid="booking-details">
        {cancelled && <p className="text-danger">Cancelled</p>}
        {route && <p className="text-muted">{route}</p>}
        {/* The trip page's day heading isn't here, so the day the booking starts is. */}
        <p className="text-muted">{formatDate(localDate(segment.start))}</p>
        {times && <p className="text-muted">{times}</p>}
        {places.map((place) => (
          <a key={JSON.stringify(place)} href={mapsUrl(place)} target="_blank" rel="noopener noreferrer" className="block py-1" title="Show in Maps">
            <span className="underline">{place.name}</span>
            {(place.address ?? place.city) && <span className="block text-muted">{place.address ?? place.city}</span>}
          </a>
        ))}
        {segment.provider && <p className="pt-2">{segment.provider}</p>}
        {reference && (
          <p>
            <button type="button" title="Copy reference" onClick={() => void copy(reference)} className="py-1 text-left hover:underline">
              Ref {reference}
            </button>
            {status && (
              <span role="status" className="ml-2 text-muted">
                {status}
              </span>
            )}
          </p>
        )}
        {segment.travelers && segment.travelers.length > 0 && <p data-testid="segment-travelers">For {segment.travelers.join(", ")}</p>}
        {programs && programs.length > 0 && (
          // One program a line, so whose each number is stays plain.
          <ul className="text-muted" data-testid="segment-loyalty">
            {programs.map((p, i) => (
              <li key={`${p.title}-${i}`}>{loyaltyLine(p)}</li>
            ))}
          </ul>
        )}
        {segment.notes && <p className="whitespace-pre-line pt-2">{segment.notes}</p>}
        {verdict}
        {hasSources && (
          <>
            <h3 className="pt-4 text-lg font-medium">Sources</h3>
            <SourcesList
              segment={segment}
              {...(emailLinks ? { emailLinks } : {})}
              {...(onLearnSender ? { onLearnSender } : {})}
              {...(onNeverSender ? { onNeverSender } : {})}
            />
          </>
        )}
      </div>
    </Dialog>
  );
}
