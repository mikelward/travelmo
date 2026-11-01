const offsetFromName = /GMT(?:([+-])(\d{1,2})(?::?(\d{2}))?)?/;

function offsetAt(zone: string, instant: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
    .formatToParts(instant)
    .find((part) => part.type === "timeZoneName")?.value;
  const match = name ? offsetFromName.exec(name) : null;
  if (!match) throw new Error(`Cannot determine the offset of ${zone}`);
  const [, sign, hours, minutes] = match;
  if (!sign) return 0;
  const total = Number(hours) * 60 + Number(minutes ?? 0);
  return sign === "-" ? -total : total;
}

export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

const dayMs = 24 * 60 * 60_000;

// The UTC offset in force in `zone` at the local wall time `date` `time`,
// DST included. The offsets a day either side of the wall time are the only
// candidates (zones change at most once a day); a candidate is right when
// reading the wall time with it lands on an instant that uses it. A wall time
// in a DST gap matches neither and takes the offset after the jump, which is
// what a clock there showed next; one in a fold matches both and takes the
// first occurrence.
export function zoneOffset(zone: string, date: string, time: string): string {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const wall = Date.UTC(y!, mo! - 1, d!, h ?? 0, mi ?? 0);
  const before = offsetAt(zone, new Date(wall - dayMs));
  const after = offsetAt(zone, new Date(wall + dayMs));
  const fits = (offset: number) => offsetAt(zone, new Date(wall - offset * 60_000)) === offset;
  if (fits(before)) return formatOffset(before);
  if (fits(after)) return formatOffset(after);
  return formatOffset(after);
}

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

// Every zone a form may offer, always including UTC and the zone this runtime
// is in, which `supportedValuesOf` can omit (Etc/GMT-3, say).
export function timeZones(): string[] {
  const supported =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const zones = new Set(["UTC", ...supported]);
  zones.add(localTimeZone());
  return [...zones];
}

// A form field holds either an IANA zone or, for an instant whose zone is
// unknown (everything the parser imports), the literal offset it came with.
export const fixedOffsetPrefix = "offset:";

export function zoneForOffset(offset: string, date: string, time: string, preferred: string): string {
  return zoneOffset(preferred, date, time) === offset ? preferred : `${fixedOffsetPrefix}${offset}`;
}

export function resolveOffset(zoneOrOffset: string, date: string, time: string): string {
  return zoneOrOffset.startsWith(fixedOffsetPrefix)
    ? zoneOrOffset.slice(fixedOffsetPrefix.length)
    : zoneOffset(zoneOrOffset, date, time);
}
