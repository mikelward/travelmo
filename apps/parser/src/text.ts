import { convert } from "html-to-text";

export type MimePart = {
  mimeType?: string | null;
  body?: { data?: string | null } | null;
  parts?: MimePart[] | null;
};

export const maxEmailChars = 24_000;

function decode(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

function collect(part: MimePart, out: { plain: string[]; html: string[] }): void {
  const data = part.body?.data;
  if (data && part.mimeType === "text/plain") out.plain.push(decode(data));
  else if (data && part.mimeType === "text/html") out.html.push(decode(data));
  for (const child of part.parts ?? []) collect(child, out);
}

export function htmlToText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "a", options: { ignoreHref: true } },
      ...["h1", "h2", "h3", "h4", "h5", "h6"].map((selector) => ({ selector, options: { uppercase: false } })),
      { selector: "img", format: "skip" },
      { selector: "style", format: "skip" },
      { selector: "script", format: "skip" },
    ],
  });
}

export function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Plain text when the sender provides it in full; otherwise HTML flattened.
// Most bookings put the itinerary in both parts, and the plain one costs
// fewer tokens, but some (Virgin Atlantic's e-tickets) send only a footer
// as plain text: a plain part under a third the length of the HTML's text
// is such a stub.
export function emailText(payload: MimePart): string {
  const out = { plain: [] as string[], html: [] as string[] };
  collect(payload, out);
  return bodyText(out.plain.join("\n\n"), out.html.join("\n"));
}

// The text an import reads from a message's plain and HTML bodies (either
// may be empty), as emailText chooses.
export function bodyText(plainBody: string, htmlBody: string): string {
  const plain = tidy(plainBody);
  const html = htmlBody.trim() ? tidy(htmlToText(htmlBody)) : "";
  const text = plain && plain.length * 3 >= html.length ? plain : html || plain;
  return text.slice(0, maxEmailChars);
}
