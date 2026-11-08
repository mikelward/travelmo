// Forward-to-import: a per-user address people without Gmail forward a
// confirmation to. The address's local part is a random token; this module
// holds what is pure about it: the token's shape, the address, and reading
// the original sender and subject back out of a forwarded email.

// Lowercase base32 (RFC 4648 alphabet, lowercased): reads aloud, needs no
// quoting in an address, and 20 characters carry 100 bits.
export const forwardTokenAlphabet = "abcdefghijklmnopqrstuvwxyz234567";
export const forwardTokenLength = 20;
const tokenPattern = /^[a-z2-7]{20}$/;

export function isForwardToken(token: string): boolean {
  return tokenPattern.test(token);
}

export function forwardAddress(token: string, domain: string): string {
  return `${token}@${domain}`;
}

// The token an address was sent to, or undefined when the address is not
// one of ours: another domain, a display name wrapped around it, a local
// part of another shape. Case is ignored, as mail clients and servers
// disagree on it.
export function forwardTokenOf(address: string, domain: string): string | undefined {
  const bare = address.trim().replace(/^.*<([^>]+)>.*$/, "$1").toLowerCase();
  const at = bare.lastIndexOf("@");
  if (at === -1 || bare.slice(at + 1) !== domain.toLowerCase()) return undefined;
  const local = bare.slice(0, at);
  return isForwardToken(local) ? local : undefined;
}

// "Fwd: ", "FW: ", "Fw: ", "TR: " (French clients), "WG: " (German), any
// number of times, with or without the space.
const forwardPrefix = /^\s*(?:(?:fwd?|fw|tr|wg)\s*:\s*)+/i;

export function stripForwardPrefix(subject: string): string {
  return subject.replace(forwardPrefix, "").trim();
}

export type ForwardedParts = {
  // The original sender and subject when the body carries a forwarding
  // header block the clients write, else the forwarder's own.
  from: string;
  subject: string;
  // Whether such a block was found.
  unwrapped: boolean;
};

// The header block Gmail, Apple Mail, Outlook and Thunderbird put above a
// forwarded message, in their several spellings: a marker line, then
// `From:`, `Date:`/`Sent:`, `Subject:`, `To:` in any order. Only the first
// block counts: a forwarded forward keeps its outer original, which is the
// email the user meant.
const markers = [
  /^-{3,}\s*forwarded message\s*-{3,}\s*$/im,
  /^begin forwarded message:\s*$/im,
  /^-{3,}\s*original message\s*-{3,}\s*$/im,
  /^-{3,}\s*forwarded message\s*$/im,
];

function headerAfter(block: string, name: string): string | undefined {
  const match = block.match(new RegExp(`^\\s*\\**${name}\\**\\s*:\\**\\s*(.+)$`, "im"));
  return match?.[1]?.trim() || undefined;
}

export function unwrapForwarded(message: { from: string; subject: string; text: string }): ForwardedParts {
  const positions = markers.map((marker) => message.text.search(marker)).filter((i) => i !== -1);
  const subject = stripForwardPrefix(message.subject);
  if (positions.length === 0) return { from: message.from, subject, unwrapped: false };
  // The header block is the dozen lines after the marker; a quoted body
  // further down may carry "From:" lines of its own.
  const start = Math.min(...positions);
  const block = message.text.slice(start).split("\n").slice(0, 12).join("\n");
  const from = headerAfter(block, "From");
  const innerSubject = headerAfter(block, "Subject");
  if (!from) return { from: message.from, subject, unwrapped: false };
  return { from, subject: innerSubject ? stripForwardPrefix(innerSubject) : subject, unwrapped: true };
}
