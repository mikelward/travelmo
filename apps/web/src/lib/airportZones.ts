export type ZoneKey = "startZone" | "endZone";
export type CodeKey = "originCode" | "destinationCode";
export type AirportZone = (code: string) => string | undefined;

// Which end each airport code belongs to.
export const zoneOfCode: Record<CodeKey, ZoneKey> = { originCode: "startZone", destinationCode: "endZone" };

// The zones the airport codes imply, leaving out ends whose zone the user
// picked themselves. Applied when a code is typed and again when the table
// arrives, since a code typed before then found no table.
export function zonesFromCodes(
  codes: Record<CodeKey, string>,
  airportZone: AirportZone,
  picked: ReadonlySet<ZoneKey>,
): Partial<Record<ZoneKey, string>> {
  const zones: Partial<Record<ZoneKey, string>> = {};
  for (const [codeKey, zoneKey] of Object.entries(zoneOfCode) as [CodeKey, ZoneKey][]) {
    if (picked.has(zoneKey)) continue;
    const zone = airportZone(codes[codeKey]);
    if (zone) zones[zoneKey] = zone;
  }
  return zones;
}
