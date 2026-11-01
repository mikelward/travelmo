export type InstantParts = { date: string; time: string; offset: string };

const offsetPattern = /^[+-]\d{2}:\d{2}$/;
const instantPattern = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

// Splits "2026-12-01T09:05:00+01:00" into the pieces a form edits. Seconds
// and fractions are dropped; a trailing "Z" or no zone reads as "+00:00" so
// every instant round-trips through the same fields.
export function splitInstant(instant: string): InstantParts {
  const match = instantPattern.exec(instant);
  if (!match) throw new Error(`Not an ISO 8601 instant: ${instant}`);
  const [, date, time, zone] = match;
  const offset = !zone || zone === "Z" ? "+00:00" : zone.replace(/^([+-]\d{2}):?(\d{2})$/, "$1:$2");
  return { date: date!, time: time!, offset };
}

export function composeInstant({ date, time, offset }: InstantParts): string {
  if (!offsetPattern.test(offset)) throw new Error(`Offset must look like +01:00, got ${offset}`);
  return `${date}T${time}:00${offset}`;
}

// Orders by the moment in time, not the local wall clock, so a flight that
// lands on an earlier local date than it departed still reads as forward.
export function compareInstants(a: string, b: string): number {
  return Date.parse(a) - Date.parse(b);
}

// The viewer's current UTC offset as "+HH:MM", the usual default for a new
// booking entered by hand.
export function offsetOf(at: Date): string {
  const minutes = -at.getTimezoneOffset();
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}
