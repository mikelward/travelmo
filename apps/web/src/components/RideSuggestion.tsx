"use client";

import { rideCompaniesFor, type RideCompany, type RideNeedKind, type Segment } from "@travelmo/core";

// Where the suggestion is: the airport by its name, a city by its own.
function question(kind: RideNeedKind, flight: Segment): string {
  const from = flight.origin?.name ?? flight.origin?.code ?? "the airport";
  const to = flight.destination?.name ?? flight.destination?.code ?? "the airport";
  if (kind === "toAirport") return `Need a ride to ${from}?`;
  if (kind === "fromAirport") return `Need a ride home from ${to}?`;
  return `Need a car in ${flight.destination?.city ?? to}?`;
}

/**
 * Under a flight with no car or ride booked: links to book one, the
 * traveler's own companies among them, and a way to hide it. Nothing shows
 * for a ride at home until the traveler adds a company near home.
 */
export function RideSuggestion({
  kind,
  flight,
  companies,
  onHide,
}: {
  kind: RideNeedKind;
  flight: Segment;
  companies: readonly RideCompany[];
  onHide: () => void;
}) {
  const offers = rideCompaniesFor(kind, companies);
  if (offers.length === 0) return null;
  return (
    <li className="py-3 pl-10" data-testid="ride-suggestion">
      <div className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
        <div className="flex items-start justify-between gap-3">
          <p className="font-medium">{question(kind, flight)}</p>
          <button type="button" onClick={onHide} className="shrink-0 text-xs text-muted hover:underline">
            Hide
          </button>
        </div>
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {offers.map((c) => (
            <a key={`${c.name}|${c.url}`} href={c.url} target="_blank" rel="noreferrer" className="underline">
              {c.name}
            </a>
          ))}
        </p>
      </div>
    </li>
  );
}
