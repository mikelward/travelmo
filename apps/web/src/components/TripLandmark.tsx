import { tripBookingType, tripPicture, type Trip } from "@travelmo/core";
import { SegmentIcon } from "@/components/SegmentIcon";

// A trip's picture: for a trip that is just an event, its booking's own
// icon (tripBookingType: a dinner's fork and knife, a show's ticket); else
// (tripPicture) the outline of the landmark of the city its title names, else
// of the kind of place it goes to, else a suitcase. Decoration, since the
// title says where.
export function TripLandmark({ title, setting }: { title: string; setting?: Trip["setting"] }) {
  const booking = tripBookingType(setting);
  if (booking) {
    return (
      <span aria-hidden="true" data-landmark={booking} className="flex size-10 shrink-0 items-center justify-center text-muted">
        <SegmentIcon type={booking} label="" className="size-7" />
      </span>
    );
  }
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
