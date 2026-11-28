"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { bookingHeading, encodeQrMatrix, formatDate, localDate, localTime, type BoardingPass, type Segment } from "@travelmo/core";

function QrSvg({ matrix, label }: { matrix: boolean[][]; label: string }) {
  const quiet = 4;
  const n = matrix.length;
  const size = n + quiet * 2;
  const paths: string[] = [];
  for (let y = 0; y < n; y++) {
    const row = matrix[y]!;
    for (let x = 0; x < n; x++) {
      if (row[x]) {
        paths.push(`M${x + quiet},${y + quiet}h1v1h-1z`);
      }
    }
  }
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      className="h-52 w-52 max-w-full rounded-lg bg-white"
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={paths.join("")} fill="#000000" />
    </svg>
  );
}

export function BoardingPassModal({
  segment,
  passes,
  initialIndex = 0,
  onClose,
}: {
  segment: Segment;
  passes: readonly BoardingPass[];
  initialIndex?: number;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(Math.min(initialIndex, Math.max(0, passes.length - 1)));
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  const pass = passes[selected] ?? passes[0];
  const barcode = pass?.barcode;
  const qrMatrix = useMemo(() => (barcode ? encodeQrMatrix(barcode) : undefined), [barcode]);
  if (!pass) return null;

  const heading = bookingHeading(segment);
  const originCode = segment.origin?.code ?? segment.origin?.name;
  const destCode = segment.destination?.code ?? segment.destination?.name;
  const route = originCode && destCode ? `${originCode} → ${destCode}` : undefined;
  const pnr = segment.confirmation;

  return (
    <dialog
      ref={dialogRef}
      aria-label="Boarding pass"
      data-testid="boarding-pass-modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-xl bg-white p-0 text-zinc-950 shadow-xl backdrop:bg-black/75"
    >
      <div className="w-full">
        <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold">{heading.headline}</h2>
            <p className="text-zinc-600">
              {[route, formatDate(localDate(segment.start)), localTime(segment.start)].filter(Boolean).join(" · ")}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-zinc-600 hover:bg-zinc-100"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          {passes.length > 1 && (
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Passengers">
              {passes.map((p, idx) => (
                <button
                  key={`${p.passenger}-${p.seat ?? idx}`}
                  type="button"
                  role="tab"
                  aria-selected={idx === selected}
                  onClick={() => setSelected(idx)}
                  className={
                    idx === selected
                      ? "rounded-full border border-zinc-950 bg-zinc-950 px-3 py-1 text-white"
                      : "rounded-full border border-zinc-300 px-3 py-1 text-zinc-900 hover:bg-zinc-100"
                  }
                >
                  {p.passenger}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-zinc-600">Passenger</p>
              <p className="text-lg font-medium">{pass.passenger}</p>
            </div>
            <span className="rounded-full border border-zinc-300 px-2.5 py-0.5 text-xs uppercase tracking-wide text-zinc-700">
              Saved offline
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 text-center">
            <div>
              <p className="text-zinc-600">Gate</p>
              <p className="text-lg font-medium">{pass.gate ?? "—"}</p>
            </div>
            <div>
              <p className="text-zinc-600">Board</p>
              <p className="text-lg font-medium">{pass.boardingTime ?? "—"}</p>
            </div>
            <div>
              <p className="text-zinc-600">Group</p>
              <p className="text-lg font-medium">{pass.boardingGroup ?? "—"}</p>
            </div>
            <div>
              <p className="text-zinc-600">Seat</p>
              <p className="text-lg font-medium">{pass.seat ?? "—"}</p>
            </div>
          </div>

          {qrMatrix ? (
            <div className="flex flex-col items-center rounded-lg border border-zinc-200 bg-white p-4">
              <QrSvg matrix={qrMatrix} label={`Boarding pass barcode for ${pass.passenger}`} />
              <p className="mt-2 text-zinc-600">Scan at security or gate</p>
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-zinc-700">
              No scannable barcode could be rendered for this pass. Use your confirmation reference at the counter or open Google Wallet.
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-3 text-zinc-600">
            <span>{[pnr ? `Ref ${pnr}` : undefined, pass.sequence ? `Seq ${pass.sequence}` : undefined, pass.cabin].filter(Boolean).join(" · ")}</span>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-zinc-950 hover:bg-zinc-100"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
