"use client";

import { useEffect, useState, type ReactNode } from "react";
import { bookingHeading, formatDate, isCancelled, localDate, loyaltyLine, mapsUrl, segmentSources, type Place, type ProfileEntry, type Segment } from "@travelmo/core";
import { BoardingPassModal } from "@/components/BoardingPassModal";
import { Dialog, SourcesList } from "@/components/BookingMenu";
import type { EmailLinks } from "@/lib/sourceLinks";

const GOOGLE_WALLET_URL = "https://wallet.google.com";

const actionButtonClass =
  "rounded-lg border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900";

const primaryButtonClass =
  "rounded-lg border border-foreground bg-foreground px-3 py-1.5 text-background hover:opacity-90";

// A booking in full, opened by tapping its row, as Android's details page
// shows it: schedule hero, boarding passes (for flights), grouped details
// (provider, confirmation with copy, travelers, loyalty, notes, rating), and
// collapsible sources. The ✎ edits it, for those who may.
export function BookingDetailsDialog({
  segment,
  route,
  times,
  flightLines,
  checkIn,
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
  flightLines?: readonly string[] | undefined;
  checkIn?: { state: "offer" | "done"; onChange: (checkedIn: boolean) => void } | undefined;
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
  const [selectedPass, setSelectedPass] = useState(0);
  const [passModalOpen, setPassModalOpen] = useState(false);

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
  const sources = segmentSources(segment);
  const hasSources = sources.length > 0 || !!segment.sender;
  const passes = segment.boardingPasses ?? [];
  const activePass = passes[selectedPass] ?? passes[0];

  const hasDetailRows =
    !!segment.provider ||
    !!reference ||
    (segment.travelers && segment.travelers.length > 0) ||
    (programs && programs.length > 0) ||
    !!segment.notes ||
    !!verdict;

  return (
    <>
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
        <div className="space-y-4" data-testid="booking-details">
          {/* Hero schedule card */}
          <div className="space-y-1.5 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            {cancelled && (
              <p className="text-xs font-medium uppercase tracking-wide text-danger">
                Cancelled
              </p>
            )}
            {route && <p className="text-lg font-medium">{route}</p>}
            {/* The trip page's day heading isn't here, so the day the booking starts is. */}
            <p className="text-muted">
              {formatDate(localDate(segment.start))}
              {times ? ` · ${times}` : ""}
            </p>
            {flightLines && flightLines.length > 0 && (
              <p className="font-medium text-amber-800 dark:text-amber-300">
                {flightLines.join(" · ")}
              </p>
            )}
            {places.length > 0 && (
              <div className="space-y-1 pt-1">
                {places.map((place) => (
                  <a
                    key={JSON.stringify(place)}
                    href={mapsUrl(place)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block py-0.5"
                    title="Show in Maps"
                  >
                    <span className="underline">{place.name}</span>
                    {(place.address ?? place.city) && (
                      <span className="block text-muted">{place.address ?? place.city}</span>
                    )}
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Boarding passes card (flights) */}
          {segment.type === "flight" && !cancelled && (passes.length > 0 || checkIn) && (
            <section
              aria-label="Boarding passes"
              data-testid="booking-boarding-passes"
              className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-lg font-medium">Boarding passes</h3>
                {passes.length > 0 && (
                  <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs uppercase tracking-wide text-muted dark:border-zinc-700">
                    Offline
                  </span>
                )}
              </div>

              {passes.length > 0 && activePass ? (
                <>
                  {passes.length > 1 && (
                    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Passengers">
                      {passes.map((p, idx) => (
                        <button
                          key={`${p.passenger}-${p.seat ?? idx}`}
                          type="button"
                          role="tab"
                          aria-selected={idx === selectedPass}
                          onClick={() => setSelectedPass(idx)}
                          className={
                            idx === selectedPass
                              ? "rounded-full border border-foreground bg-foreground px-3 py-1 text-background"
                              : "rounded-full border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                          }
                        >
                          {p.passenger}
                        </button>
                      ))}
                    </div>
                  )}

                  {passes.length === 1 && <p className="text-muted">{activePass.passenger}</p>}

                  <div className="grid grid-cols-4 gap-2 rounded-lg border border-zinc-200 px-2 py-2 text-center dark:border-zinc-800">
                    <div>
                      <p className="text-muted">Gate</p>
                      <p className="font-medium">{activePass.gate ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-muted">Board</p>
                      <p className="font-medium">{activePass.boardingTime ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-muted">Group</p>
                      <p className="font-medium">{activePass.boardingGroup ?? "—"}</p>
                    </div>
                    <div>
                      <p className="text-muted">Seat</p>
                      <p className="font-medium">{activePass.seat ?? "—"}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPassModalOpen(true)}
                      className={primaryButtonClass}
                    >
                      Show boarding pass
                    </button>
                    <a
                      href={GOOGLE_WALLET_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={actionButtonClass}
                    >
                      Google Wallet
                    </a>
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {checkIn?.state === "offer" && (
                    <button
                      type="button"
                      onClick={() => checkIn.onChange(true)}
                      className={actionButtonClass}
                    >
                      I&rsquo;ve checked in
                    </button>
                  )}
                  {checkIn?.state === "done" && (
                    <span className="flex items-center gap-3">
                      <span>Checked in</span>
                      <button
                        type="button"
                        onClick={() => checkIn.onChange(false)}
                        className="text-muted underline hover:no-underline"
                      >
                        Undo
                      </button>
                    </span>
                  )}
                  <a
                    href={GOOGLE_WALLET_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={actionButtonClass}
                  >
                    Google Wallet
                  </a>
                </div>
              )}
            </section>
          )}

          {/* Grouped Details card */}
          {hasDetailRows && (
            <div className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {segment.provider && (
                <div className="px-3 py-2.5">
                  <p className="text-muted">Provider</p>
                  <p>{segment.provider}</p>
                </div>
              )}

              {reference && (
                <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-muted">Confirmation</p>
                    <p>
                      <button
                        type="button"
                        title="Copy reference"
                        onClick={() => void copy(reference)}
                        className="text-left hover:underline"
                      >
                        Ref {reference}
                      </button>
                      {status && (
                        <span role="status" className="ml-2 text-muted">
                          {status}
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void copy(reference)}
                    className={actionButtonClass}
                  >
                    Copy
                  </button>
                </div>
              )}

              {segment.travelers && segment.travelers.length > 0 && (
                <div className="px-3 py-2.5">
                  <p className="text-muted">Travelers</p>
                  <p data-testid="segment-travelers">For {segment.travelers.join(", ")}</p>
                </div>
              )}

              {programs && programs.length > 0 && (
                <div className="px-3 py-2.5">
                  <p className="text-muted">Loyalty</p>
                  {/* One program a line, so whose each number is stays plain. */}
                  <ul className="space-y-1 text-muted" data-testid="segment-loyalty">
                    {programs.map((p, i) => (
                      <li key={`${p.title}-${i}`}>{loyaltyLine(p)}</li>
                    ))}
                  </ul>
                </div>
              )}

              {segment.notes && (
                <div className="px-3 py-2.5">
                  <p className="text-muted">Notes</p>
                  <p className="whitespace-pre-line">{segment.notes}</p>
                </div>
              )}

              {verdict && (
                <div className="px-3 py-2.5">
                  <p className="text-muted">Your rating</p>
                  {verdict}
                </div>
              )}
            </div>
          )}

          {/* Collapsible Sources */}
          {hasSources && (
            <details open className="rounded-lg border border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
              <summary className="cursor-pointer text-lg font-medium">
                Sources{sources.length > 0 ? ` (${sources.length})` : ""}
              </summary>
              <div className="pt-2">
                <SourcesList
                  segment={segment}
                  {...(emailLinks ? { emailLinks } : {})}
                  {...(onLearnSender ? { onLearnSender } : {})}
                  {...(onNeverSender ? { onNeverSender } : {})}
                />
              </div>
            </details>
          )}
        </div>
      </Dialog>

      {passModalOpen && passes.length > 0 && (
        <BoardingPassModal
          segment={segment}
          passes={passes}
          initialIndex={selectedPass}
          onClose={() => setPassModalOpen(false)}
        />
      )}
    </>
  );
}
