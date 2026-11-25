"use client";

import { filtering, type ListFilters } from "@travelmo/core";
import { useEffect, useRef, useState } from "react";

// Material Icons paths (Apache License 2.0), as Android draws them: search,
// arrow_back, close, and filter_alt outlined (no filter on) or filled.
const searchPath =
  "M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z";
const backPath = "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z";
const addPath = "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z";
const closePath = "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z";
const filterOffPath =
  "M7 6h10l-5.01 6.3L7 6zm-2.75-.39C6.27 8.2 10 13 10 13v6c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-6s3.72-4.8 5.74-7.39A.998.998 0 0 0 18.95 4H5.04c-.83 0-1.3.95-.79 1.61z";
const filterOnPath = "M4.25 5.61C6.27 8.2 10 13 10 13v6c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-6s3.72-4.8 5.74-7.39A.998.998 0 0 0 18.95 4H5.04c-.83 0-1.3.95-.79 1.61z";

const iconButton = "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-zinc-100 dark:hover:bg-zinc-900";

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="currentColor">
      <path d={path} />
    </svg>
  );
}

// The funnel, filled while a filter is on, opening the switches (SPEC
// "Filtering the trip list"); they stay open while flipped, and a click
// elsewhere or Escape closes them.
function FilterButton({ filters, onFilters }: { filters: ListFilters; onFilters: (next: ListFilters) => void }) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrapper.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const on = filtering(filters);
  return (
    <div ref={wrapper} className="relative" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <button type="button" aria-label="Filters" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={iconButton}>
        <Icon path={on ? filterOnPath : filterOffPath} />
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-10 min-w-48 space-y-1 rounded-lg border border-zinc-200 bg-background p-3 shadow-lg dark:border-zinc-800">
          <label className="flex items-center gap-2 whitespace-nowrap">
            <input type="checkbox" checked={filters.hideCancelled} onChange={(e) => onFilters({ ...filters, hideCancelled: e.target.checked })} />
            Hide cancelled
          </label>
          <label className="flex items-center gap-2 whitespace-nowrap">
            <input type="checkbox" checked={filters.hideLocal} onChange={(e) => onFilters({ ...filters, hideLocal: e.target.checked })} />
            Hide local events
          </label>
          <label className="flex items-center gap-2 whitespace-nowrap">
            <input type="checkbox" checked={filters.hideWatching} onChange={(e) => onFilters({ ...filters, hideWatching: e.target.checked })} />
            Hide trips I&apos;m not on
          </label>
        </div>
      )}
    </div>
  );
}

// The trip list's bar, as Android's top bar has it: "Trips" with Search and
// the filters; Search puts the search field in the title's place, with Back
// (or Escape) to leave it and clear the search. A click elsewhere takes the
// focus away as any field's does, and an empty search closes then.
export function TripListToolbar({
  query,
  onQuery,
  filters,
  onFilters,
  onAddTrip,
}: {
  query: string;
  onQuery: (next: string) => void;
  filters: ListFilters;
  onFilters: (next: ListFilters) => void;
  onAddTrip: () => void;
}) {
  const [searching, setSearching] = useState(query !== "");
  const close = () => {
    onQuery("");
    setSearching(false);
  };
  return (
    <div className="mb-4 flex h-12 items-center gap-1">
      {searching ? (
        <>
          <button type="button" aria-label="Close search" onClick={close} className={`${iconButton} -ml-2`}>
            <Icon path={backPath} />
          </button>
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
            }}
            onBlur={() => {
              if (!query.trim()) setSearching(false);
            }}
            placeholder="Search trips"
            aria-label="Search trips"
            className="min-w-0 flex-1 bg-transparent px-1 py-2 text-lg outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button type="button" aria-label="Clear search" onClick={() => onQuery("")} className={iconButton}>
              <Icon path={closePath} />
            </button>
          )}
        </>
      ) : (
        <>
          <h1 className="flex-1 text-2xl font-semibold">Trips</h1>
          <button type="button" aria-label="Search trips" onClick={() => setSearching(true)} className={iconButton}>
            <Icon path={searchPath} />
          </button>
        </>
      )}
      <FilterButton filters={filters} onFilters={onFilters} />
      {!searching && (
        <button type="button" aria-label="Add a trip" onClick={onAddTrip} className={iconButton}>
          <Icon path={addPath} />
        </button>
      )}
    </div>
  );
}
