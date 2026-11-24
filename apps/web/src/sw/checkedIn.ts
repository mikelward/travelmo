// A check-in reminder's "I've checked in" action, for the service worker
// (sw.ts). The worker has no sign-in to save the mark with, so the action
// opens the trip page, signed in as the viewer, with the booking in its
// query; the page saves it (lib/checkedIn.ts).

export type CheckedIn = { tripId: string; segmentId: string };

export const checkedInAction = "checked-in";

// The query the trip page reads the booking from.
export const checkedInParam = "checkedIn";

// The booking a push names, if it names one.
export function checkedInOf(value: unknown): CheckedIn | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { tripId, segmentId } = value as Partial<CheckedIn>;
  return typeof tripId === "string" && tripId && typeof segmentId === "string" && segmentId ? { tripId, segmentId } : undefined;
}

// The trip page that saves the mark.
export const checkedInUrl = ({ tripId, segmentId }: CheckedIn): string =>
  `/trips/${encodeURIComponent(tripId)}?${checkedInParam}=${encodeURIComponent(segmentId)}`;
