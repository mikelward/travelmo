import { formatDateRange, type Trip } from "@travelmo/core";
import Link from "next/link";

export function TripCard({ trip, shared }: { trip: Trip; shared: boolean }) {
  return (
    <Link
      href={`/trips/${trip.id}`}
      className="block rounded-xl border border-zinc-200 p-4 transition-colors hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="truncate text-lg font-medium">{trip.title}</h3>
        {shared && <span className="shrink-0 text-xs uppercase tracking-wide text-zinc-500">Shared</span>}
      </div>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{formatDateRange(trip.start, trip.end)}</p>
    </Link>
  );
}
