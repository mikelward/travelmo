// What regrouping did, in a line for the Settings page.
export type RegroupResult = { changed: number; deleted: number };

export function describeRegroup({ changed, deleted }: RegroupResult): string {
  if (changed === 0 && deleted === 0) return "Your trips were already grouped this way.";
  const trips = (n: number) => `${n} trip${n === 1 ? "" : "s"}`;
  const parts = [changed ? `${trips(changed)} rebuilt` : "", deleted ? `${trips(deleted)} merged away` : ""].filter(Boolean);
  return `Done: ${parts.join(", ")}.`;
}
