import { tripLandmark } from "@travelmo/core";

// The outline of the landmark of the city a trip's title names
// (tripLandmark), else a suitcase; decoration, since the title says where.
export function TripLandmark({ title }: { title: string }) {
  const landmark = tripLandmark(title);
  return (
    <svg
      viewBox="0 0 48 48"
      width={40}
      height={40}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-landmark={landmark.id}
      className="shrink-0 text-muted"
    >
      <path d={landmark.d} />
    </svg>
  );
}
