import { tripPicture, type Trip } from "@travelmo/core";

// A trip's picture (tripPicture): the outline of the landmark of the city
// its title names, else of the kind of place it goes to, else a suitcase;
// decoration, since the title says where.
export function TripLandmark({ title, setting }: { title: string; setting?: Trip["setting"] }) {
  const picture = tripPicture(title, setting);
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
      data-landmark={picture.id}
      className="shrink-0 text-muted"
    >
      <path d={picture.d} />
    </svg>
  );
}
