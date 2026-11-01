import { localTime, type Segment, type SegmentType } from "@travelmo/core";

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

export function SegmentRow({ segment }: { segment: Segment }) {
  const route = [place(segment.origin), place(segment.destination)].filter(Boolean).join(" → ");
  const times =
    segment.type === "lodging"
      ? `Check-in ${localTime(segment.start)}${segment.end ? ` · Check-out ${localTime(segment.end)}` : ""}`
      : `${localTime(segment.start)}${segment.end ? ` – ${localTime(segment.end)}` : ""}`;
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
      </div>
    </li>
  );
}
