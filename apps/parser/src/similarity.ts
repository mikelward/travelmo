import { z } from "zod";
import { senderDomain } from "./prefilter";

// The similarity pre-filter sits between the keyword check and the model:
// an email that passed the keywords is embedded and compared with emails the
// model has already judged for this user. Only when it clearly resembles
// past non-bookings, and none of the past bookings, is the model call saved.
// The user can still ask for it from the review list, and that verdict
// becomes an example too, so the filter learns from its mistakes.

export const Example = z.object({ subject: z.string(), vector: z.array(z.number()).min(1) });
export type Example = z.infer<typeof Example>;

export const Examples = z.object({
  bookings: z.array(Example).default([]),
  others: z.array(Example).default([]),
});
export type Examples = z.infer<typeof Examples>;
export type ExampleLabel = keyof Examples;

export const emptyExamples = (): Examples => ({ bookings: [], others: [] });

// Kept per list, newest last; enough to cover a user's senders, small enough
// for one document.
export const exampleLimit = 40;
// Below this many of either kind the filter only learns.
export const minExamples = 5;
// A non-booking at least this similar, and this much more similar than the
// nearest booking, is skipped.
export const skipSimilarity = 0.85;
export const skipMargin = 0.1;
// Truncated embeddings; the comparison normalizes them.
export const embeddingDimensions = 256;

export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) throw new Error(`Cannot compare vectors of ${a.length} and ${b.length} dimensions`);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

export function nearest(vector: readonly number[], list: readonly Example[]): { similarity: number; example: Example } | undefined {
  let best: { similarity: number; example: Example } | undefined;
  for (const example of list) {
    const similarity = cosine(vector, example.vector);
    if (!best || similarity > best.similarity) best = { similarity, example };
  }
  return best;
}

export type SimilarityVerdict = { skip: false } | { skip: true; reason: string };

export function similarityVerdict(vector: readonly number[], examples: Examples): SimilarityVerdict {
  if (examples.bookings.length < minExamples || examples.others.length < minExamples) return { skip: false };
  const other = nearest(vector, examples.others);
  const booking = nearest(vector, examples.bookings);
  if (!other || !booking) return { skip: false };
  if (other.similarity >= skipSimilarity && other.similarity - booking.similarity >= skipMargin) {
    return { skip: true, reason: `resembles "${other.example.subject}", which was not a booking` };
  }
  return { skip: false };
}

export function addExample(examples: Examples, label: ExampleLabel, example: Example): Examples {
  const list = [...examples[label], example].slice(-exampleLimit);
  return { ...examples, [label]: list };
}

// What gets embedded: who sent it, what it says it is, and how it starts.
// The whole body would cost more and say less.
export const embeddingTextLength = 600;
export function embeddingText(message: { from: string; subject: string; text: string }): string {
  const sender = senderDomain(message.from) ?? message.from;
  const body = message.text.replace(/\s+/g, " ").trim().slice(0, embeddingTextLength);
  return `From: ${sender}\nSubject: ${message.subject}\n\n${body}`;
}
