export type InstantParts = { date: string; time: string; offset: string };

const offsetPattern = /^[+-]\d{2}:\d{2}$/;

// Splits "2026-12-01T09:05:00+01:00" into the pieces a form edits. A trailing
// "Z" reads as "+00:00" so every instant round-trips through the same fields.
export function splitInstant(instant: string): InstantParts {
  const date = instant.slice(0, 10);
  const time = instant.slice(11, 16);
  const tail = instant.slice(19);
  const offset = tail === "Z" || tail === "" ? "+00:00" : tail.replace(/^([+-]\d{2}):?(\d{2})$/, "$1:$2");
  return { date, time, offset };
}

export function composeInstant({ date, time, offset }: InstantParts): string {
  if (!offsetPattern.test(offset)) throw new Error(`Offset must look like +01:00, got ${offset}`);
  return `${date}T${time}:00${offset}`;
}

// The viewer's current UTC offset as "+HH:MM", the usual default for a new
// booking entered by hand.
export function offsetOf(at: Date): string {
  const minutes = -at.getTimezoneOffset();
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}
