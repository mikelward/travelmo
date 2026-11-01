import { describe, expect, it } from "vitest";
import {
  addExample,
  cosine,
  embeddingText,
  embeddingTextLength,
  emptyExamples,
  exampleLimit,
  minExamples,
  similarityVerdict,
  type Examples,
} from "./similarity";

const unit = (angle: number) => [Math.cos(angle), Math.sin(angle)];
const examples = (bookingAngle: number, otherAngle: number, count = minExamples): Examples => ({
  bookings: Array.from({ length: count }, (_, i) => ({ subject: `Booking ${i}`, vector: unit(bookingAngle) })),
  others: Array.from({ length: count }, (_, i) => ({ subject: `Newsletter ${i}`, vector: unit(otherAngle) })),
});

describe("cosine", () => {
  it("is 1 for the same direction, 0 for perpendicular, -1 for opposite", () => {
    expect(cosine([1, 0], [2, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 3])).toBeCloseTo(0);
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it("refuses vectors of different lengths", () => {
    expect(() => cosine([1, 0], [1])).toThrow(/dimensions/);
  });
});

describe("similarityVerdict", () => {
  it("skips an email close to past non-bookings and far from past bookings", () => {
    const verdict = similarityVerdict(unit(0.1), examples(Math.PI / 2, 0));
    expect(verdict).toEqual({ skip: true, reason: 'resembles "Newsletter 0", which was not a booking' });
  });

  it("passes an email close to a past booking even when non-bookings are close too", () => {
    expect(similarityVerdict(unit(0.1), examples(0.05, 0.15))).toEqual({ skip: false });
  });

  it("passes an email that resembles nothing", () => {
    expect(similarityVerdict(unit(Math.PI), examples(Math.PI / 2, 0))).toEqual({ skip: false });
  });

  it("only learns until there are enough examples of both kinds", () => {
    expect(similarityVerdict(unit(0.1), examples(Math.PI / 2, 0, minExamples - 1))).toEqual({ skip: false });
    const fewBookings = { ...examples(Math.PI / 2, 0), bookings: examples(Math.PI / 2, 0, 1).bookings };
    expect(similarityVerdict(unit(0.1), fewBookings)).toEqual({ skip: false });
  });
});

describe("addExample", () => {
  it("keeps the newest examples up to the limit, per list", () => {
    let current = emptyExamples();
    for (let i = 0; i < exampleLimit + 3; i++) current = addExample(current, "others", { subject: `n${i}`, vector: [1] });
    current = addExample(current, "bookings", { subject: "b", vector: [1] });
    expect(current.others).toHaveLength(exampleLimit);
    expect(current.others[0]?.subject).toBe("n3");
    expect(current.others.at(-1)?.subject).toBe(`n${exampleLimit + 2}`);
    expect(current.bookings).toEqual([{ subject: "b", vector: [1] }]);
  });
});

describe("embeddingText", () => {
  it("names the sender's domain, the subject and the start of the body", () => {
    const text = embeddingText({ from: "Cove <stay@cove.example>", subject: "Your stay", text: "  Check-in\n\n12 Dec " });
    expect(text).toBe("From: cove.example\nSubject: Your stay\n\nCheck-in 12 Dec");
  });

  it("cuts the body short", () => {
    const text = embeddingText({ from: "a@b.example", subject: "s", text: "x".repeat(5000) });
    expect(text.length).toBe("From: b.example\nSubject: s\n\n".length + embeddingTextLength);
  });
});
