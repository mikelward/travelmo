import { parseDocumentDate } from "./documents";
import { stripForwardPrefix, unwrapForwarded } from "./forward";
import type { BoardingPass, ExtractedDocument, ProfileEntry, ProfileField } from "./schema";
import { sameTraveler } from "./travelers";

const govUkStatusSender = /status\.service@notifications\.service\.gov\.uk/i;
const shareCodeRe = /\bshare\s+code\s+([A-Z0-9]{3}\s*[A-Z0-9]{3}\s*[A-Z0-9]{3})\b/i;
const shareExpiryRe = /this\s+share\s+code\s+will\s+expire\s+on\s+([0-9]{1,2}\s+[A-Za-z]{3,}\s+[0-9]{4})/i;
const subjectNameRe = /^(.+?)\s*[–—-]\s*immigration\s+status\s+details$/i;
const bodyNameRe = /view\s+immigration\s+status\s+details\s+for\s+([A-Z][A-Z\s'-]{2,80}?)(?:\s*\n|\s+They\s+have\s+used)/i;

function titleCaseName(raw: string): string {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (collapsed === collapsed.toUpperCase()) {
    return collapsed
      .toLowerCase()
      .replace(/(^|[\s'-])\p{L}/gu, (c) => c.toUpperCase());
  }
  return collapsed;
}

function formatShareCode(raw: string): string {
  const clean = raw.replace(/\s+/g, "").toUpperCase();
  if (clean.length === 9) return `${clean.slice(0, 3)} ${clean.slice(3, 6)} ${clean.slice(6, 9)}`;
  return clean;
}

// Deterministic zero-cost parser for GOV.UK "View and prove your immigration
// status" share code emails (direct or forwarded).
export function extractUkShareCode(
  message: {
    from: string;
    subject: string;
    text: string;
  },
  updatedAt?: string,
): ProfileEntry | undefined {
  const unwrapped = unwrapForwarded(message);
  const effectiveFrom = unwrapped.from || message.from;
  const effectiveSubject = stripForwardPrefix(unwrapped.subject || message.subject);
  const text = message.text;

  const isGovUk =
    govUkStatusSender.test(effectiveFrom) ||
    govUkStatusSender.test(text) ||
    /immigration\s+status\s+details/i.test(effectiveSubject);
  if (!isGovUk) return undefined;

  const codeMatch = shareCodeRe.exec(text);
  if (!codeMatch) return undefined;
  const code = formatShareCode(codeMatch[1]!);

  const expiryMatch = shareExpiryRe.exec(text);
  const expires = expiryMatch ? parseDocumentDate(expiryMatch[1]!) : undefined;

  const subjName = subjectNameRe.exec(effectiveSubject)?.[1];
  const bodyName = bodyNameRe.exec(text)?.[1];
  const holder = subjName ? titleCaseName(subjName) : bodyName ? titleCaseName(bodyName) : undefined;

  const fields: ProfileField[] = [
    { label: "Document type", value: "UK share code" },
    { label: "Country", value: "United Kingdom" },
    { label: "Number", value: code },
  ];
  if (expires) fields.push({ label: "Expiration date", value: expires });
  if (holder) fields.push({ label: "Holder", value: holder });
  fields.push({ label: "From email", value: effectiveSubject || "GOV.UK immigration status" });

  return {
    title: holder ? `UK share code — ${holder}` : "UK share code",
    fields,
    ...(updatedAt ? { updatedAt } : {}),
  };
}

const extractedTypeLabels: Record<ExtractedDocument["type"], string> = {
  share_code: "UK share code",
  visa: "Visa",
  eta: "Visa",
  esta: "Visa",
  evisa: "Visa",
  other: "Document",
};

// Converts an LLM-extracted travel document (ETA, ESTA, eVisa, UK share code)
// into a Wallet ProfileEntry compatible with travelDocuments() and the Wallet editor.
export function extractedDocumentEntry(doc: ExtractedDocument, sourceLabel?: string, updatedAt?: string): ProfileEntry {
  const fields: ProfileField[] = [{ label: "Document type", value: extractedTypeLabels[doc.type] }];
  const country = doc.country?.trim();
  if (country) fields.push({ label: "Country", value: country });
  const number = doc.number?.trim();
  if (number) fields.push({ label: "Number", value: doc.type === "share_code" ? formatShareCode(number) : number });
  const expires = doc.expires ? (parseDocumentDate(doc.expires) ?? doc.expires.trim()) : undefined;
  if (expires) fields.push({ label: "Expiration date", value: expires });
  const issued = doc.issued ? (parseDocumentDate(doc.issued) ?? doc.issued.trim()) : undefined;
  if (issued) fields.push({ label: "Issue date", value: issued });
  const holder = doc.holder?.trim();
  if (holder) fields.push({ label: "Holder", value: titleCaseName(holder) });
  const notes = doc.notes?.trim();
  if (notes) fields.push({ label: "Notes", value: notes });
  if (sourceLabel?.trim()) fields.push({ label: "From email", value: sourceLabel.trim() });
  return { title: doc.title.trim(), fields, ...(updatedAt ? { updatedAt } : {}) };
}

const normPassenger = (name: string) => name.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const samePassPassenger = (a: string, b: string) =>
  sameTraveler(a, b) || (normPassenger(a) !== "" && normPassenger(a) === normPassenger(b));

// Merges extracted boarding passes for one flight segment by normalized passenger
// name, filling in any newly learned fields (seat, gate, boardingGroup, barcode)
// without losing previously extracted passes for other passengers.
export function mergeBoardingPasses(
  existing: readonly BoardingPass[] | undefined,
  incoming: readonly BoardingPass[] | undefined,
  preferIncoming = true,
): BoardingPass[] | undefined {
  const a = existing ?? [];
  const b = incoming ?? [];
  if (a.length === 0 && b.length === 0) return undefined;
  const out: BoardingPass[] = [...a];
  for (const pass of b) {
    const idx = out.findIndex((p) => samePassPassenger(p.passenger, pass.passenger));
    if (idx >= 0) {
      const prev = out[idx]!;
      const useIncoming = preferIncoming || (!!prev.messageId && prev.messageId === pass.messageId);
      const pick = <T,>(oldVal: T | undefined, newVal: T | undefined): T | undefined => (useIncoming ? (newVal ?? oldVal) : (oldVal ?? newVal));
      const seat = pick(prev.seat, pass.seat);
      const gate = pick(prev.gate, pass.gate);
      const boardingGroup = pick(prev.boardingGroup, pass.boardingGroup);
      const boardingTime = pick(prev.boardingTime, pass.boardingTime);
      const sequence = pick(prev.sequence, pass.sequence);
      const cabin = pick(prev.cabin, pass.cabin);
      const terminal = pick(prev.terminal, pass.terminal);
      const barcode = pick(prev.barcode, pass.barcode);
      const barcodeFormat = pick(prev.barcodeFormat, pass.barcodeFormat);
      const messageId = pick(prev.messageId, pass.messageId);
      out[idx] = {
        passenger: (useIncoming ? (pass.passenger || prev.passenger) : (prev.passenger || pass.passenger)),
        ...(seat ? { seat } : {}),
        ...(gate ? { gate } : {}),
        ...(boardingGroup ? { boardingGroup } : {}),
        ...(boardingTime ? { boardingTime } : {}),
        ...(sequence ? { sequence } : {}),
        ...(cabin ? { cabin } : {}),
        ...(terminal ? { terminal } : {}),
        ...(barcode ? { barcode } : {}),
        ...(barcodeFormat ? { barcodeFormat } : {}),
        ...(messageId ? { messageId } : {}),
      };
    } else if (out.length < 20) {
      out.push(pass);
    }
  }
  return out;
}

// Finds raw IATA Resolution 792 BCBP strings (starting with M1..M9, >= 60 chars)
// when present in email or extracted PDF text, honoring each leg's 2-hex-digit
// variable field length (and optional ^ security section) without crossing newlines.
const bcbpHeaderRe =
  /\bM([1-9])[A-Z /]{20}[A-Z0-9 ][A-Z0-9 ]{7}[A-Z]{6}[A-Z0-9 ]{3}[0-9A-Z ]{5}[0-9]{3}[A-Z ][0-9A-Z ]{4}[0-9A-Z ]{5}[0-9A-Z ]([0-9A-F]{2})/g;
const repeatedLegRe =
  /^[A-Z0-9 ]{7}[A-Z]{6}[A-Z0-9 ]{3}[0-9A-Z ]{5}[0-9]{3}[A-Z ][0-9A-Z ]{4}[0-9A-Z ]{5}[0-9A-Z ]([0-9A-F]{2})/;
const securityHeaderRe = /^\^[0-9A-Z]([0-9A-F]{2})/;

export function extractBcbpStrings(text: string): string[] {
  const out = new Set<string>();
  for (const match of text.matchAll(bcbpHeaderRe)) {
    const start = match.index;
    if (start === undefined) continue;
    const legs = Number(match[1]);
    const nl = text.indexOf("\n", start);
    const cr = text.indexOf("\r", start);
    const lineEnd = nl < 0 ? (cr < 0 ? text.length : cr) : cr < 0 ? nl : Math.min(nl, cr);
    let pos = start + 60;
    const firstVar = parseInt(match[2]!, 16);
    if (pos + firstVar > lineEnd) continue;
    pos += firstVar;
    let valid = true;
    for (let leg = 2; leg <= legs; leg++) {
      const legMatch = repeatedLegRe.exec(text.slice(pos, lineEnd));
      if (!legMatch) {
        valid = false;
        break;
      }
      const legVar = parseInt(legMatch[1]!, 16);
      pos += 37 + legVar;
      if (pos > lineEnd) {
        valid = false;
        break;
      }
    }
    if (!valid) continue;
    const secMatch = securityHeaderRe.exec(text.slice(pos, lineEnd));
    if (secMatch) {
      const secLen = parseInt(secMatch[1]!, 16);
      if (pos + 4 + secLen <= lineEnd) pos += 4 + secLen;
    }
    const payload = text.slice(start, pos);
    if (payload.length >= 60) out.add(payload);
  }
  return [...out];
}
