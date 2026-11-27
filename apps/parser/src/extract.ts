import { GoogleGenAI } from "@google/genai";
import { ExtractedBooking, stripForwardPrefix, unwrapForwarded } from "@travelmo/core";
import { z } from "zod";
import type { Attachment, EmailMessage } from "./gmail";
import type { Embedder } from "./importer";
import { embeddingDimensions } from "./similarity";
import { withInferredYears } from "./years";

// The email reader's version: how an email becomes the text the model reads
// (text.ts), the instructions below and the model. Bump it with any change
// that could turn an email it found no booking in into one: "Refresh from
// email" then reads again the emails an older reader judged that way, from
// travel senders (refresh.ts `readAgain`). Records from before versions were
// kept have none, and count as older.
export const readerVersion = 2;

export type Extractor = (message: EmailMessage, attachments?: readonly Attachment[]) => Promise<ExtractedBooking>;

// The model's answer when the project's quota or rate is used up (429,
// RESOURCE_EXHAUSTED): the email is fine, and is read again once it frees up.
export function isModelRateLimit(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { status, code, message } = error as { status?: unknown; code?: unknown; message?: unknown };
  if (status === 429 || code === 429 || status === "RESOURCE_EXHAUSTED") return true;
  return typeof message === "string" && /\b429\b|RESOURCE_EXHAUSTED/.test(message);
}

const responseJsonSchema = z.toJSONSchema(ExtractedBooking, { target: "draft-7" });

const instructions = `You read a single email and extract any travel bookings it confirms.

Rules:
- Set isBooking=false with no segments for marketing, reminders about unrelated things, receipts for non-travel purchases, or messages that only mention travel in passing.
- Memberships, annual or season passes, subscriptions, gift cards and vouchers, and donations are not bookings: set isBooking=false. A ticket is a booking only for a specific date; a date it was bought or becomes valid is not a visit.
- A payment receipt or invoice for something already booked is the same booking: give it the booked event's date, time, provider and booking reference, not the payment date, and title it the event's name followed by "payment".
- One segment per leg or stay: each flight leg, each train leg, each hotel stay, each car rental period, each ticketed activity. A return journey is two segments.
- type: flight, train, bus, ferry, lodging, car_rental, activity, or other.
- title: short and specific, e.g. "BA 117 LHR to JFK", "Cove Liverpool", "Hertz Manchester Airport".
- start/end: ISO 8601 with the local UTC offset of the place where the event happens. Infer the offset from the airport/city. For lodging, start is check-in and end is check-out; if times are not stated use 15:00 and 11:00. For an activity, use the time the event starts if the email gives one; if it gives only a date, use 00:00 local time and no end. Never use 00:00 as a guess otherwise. end is when the journey arrives or the event ends: never a ticket's validity or expiry date; leave end out when the email does not say. An airport train runs between the airport and the city, not from a city to itself. If a year is missing, use the email's Date header to infer it: a booking is for the next such date on or after it, never one before it.
- origin/destination: for transport, where it departs and arrives (name, IATA/station code, city, ISO 3166-1 alpha-2 country). For lodging and activities use destination only.
- address: the place's street address as the email or its attachments give it, on one line (e.g. "4 Hope Street, Liverpool L1 9AB"), for a hotel or other stay, a venue, a car rental desk, or a station or terminal when one is given. Leave it out when the email gives none; never make one up from the name.
- setting: for a stay's or an activity's place, the kind of place it is in: city (a big city), town (a small town or village), beach (a beach or seaside resort), mountains (a ski or mountain resort), lake (a lakeside place) or countryside (a farm, a forest, or a cottage in the country). Go by the email (a "beach resort", a "ski lodge") and by what you know of the town (Woburn, Massachusetts is a town; Las Vegas is a city). Leave it out when neither tells you.
- confirmation: the booking reference / PNR / confirmation number if present.
- provider: airline, hotel brand, rental company or booking site.
- rentalStage, for a car rental only: "reservation" for a booking made ahead, "agreement" for the rental agreement or receipt given when the car is picked up or returned.
- travelers: each passenger, guest or attendee the segment is for, by name exactly as the email writes it (e.g. "SMITH/JOHN MR", "Mrs Jane Doe"); never the person a receipt or marketing greets unless the email says they travel, and never a company. Leave travelers out when the email names nobody.
- If the email cancels a booking (a cancellation confirmation, not a change or a reminder), set isBooking=false with no segments, and list each cancelled booking in cancellations with whatever the email gives: type, provider, confirmation, place (the hotel, venue or route as named), for a stay or event its city when the email gives it, for a flight, train, bus or ferry its origin and destination (the codes or names the email gives), and start/end in the same form as above (with the time the email gives, or 00:00 when it gives none).
- memberships: each loyalty program number the email shows for a traveler (a frequent flyer, hotel rewards or rental club number): program as named (when the email gives only a generic label such as "Frequent flyer", the airline or company whose program it is, e.g. "United MileagePlus" for a number written "UA-…" or on a United booking), number exactly as written, holder (the member's name as written; when the email lists travelers one after another, each with their own details, the name of the traveler whose details the number is listed with), status (tier) and balance (the points, miles or credits as written, e.g. "12,400 points") when given. Never a booking reference, ticket number, card number or payment detail. Leave memberships out when there are none.
- A travel loyalty program's statement, account summary or news of a new status ("Welcome to Silver Medallion Status") from an airline, hotel, car rental, rail or cruise program is not a booking: set isBooking=false with no segments, and list its membership with the number, balance and status it gives (a header such as "#9168692292 Silver Medallion 49,606 Miles" gives all three).
- memberships are travel programs only (airline, hotel, car rental, rail, cruise): never a shop's, supermarket's, restaurant's, coffee chain's, bank's or credit card's, and never a medical, health insurance, political, union, religious, club, gym or any other membership.
- PDFs attached to the email are part of it: a ticket or confirmation may give the journey, times, seats or booking reference only there. Read them as you read the email.
- Do not invent details that are not in the email.`;

export function geminiExtractor(client: GoogleGenAI, model: string): Extractor {
  return async (message, attachments = []) => {
    const prompt = [
      `From: ${message.from}`,
      `Subject: ${message.subject}`,
      `Date: ${message.date}`,
      "",
      message.text,
    ].join("\n");
    const response = await client.models.generateContent({
      model,
      // Attached PDFs go to the model as documents: nothing here parses them.
      contents: attachments.length === 0 ? prompt : [{ role: "user", parts: [{ text: prompt }, ...attachments.map((a) => ({ inlineData: { mimeType: a.mimeType, data: a.data } }))] }],
      config: {
        systemInstruction: instructions,
        responseMimeType: "application/json",
        responseJsonSchema,
        temperature: 0,
      },
    });
    const text = response.text;
    if (!text) throw new Error(`Gemini returned no text for message ${message.id}`);
    // A date the model put before the email in a year the email never shows
    // is the next such date (years.ts), unless a PDF it read may show it.
    const booking = parseExtraction(text, message.id);
    return attachments.length > 0 ? booking : withInferredYears(booking, `${message.subject}\n${message.text}`, bookedOn(message));
  };
}

// When the email a booking came in was sent, to infer its years by: a
// forward's original's date (undefined when its header block gives none, so
// nothing is inferred), never the forward's own, as an old confirmation
// forwarded today is still old.
export function bookedOn(message: Pick<EmailMessage, "from" | "subject" | "text" | "date">): string | undefined {
  const original = unwrapForwarded(message);
  const forwarded = original.unwrapped || stripForwardPrefix(message.subject) !== message.subject.trim();
  return forwarded ? original.date : message.date;
}

// Embeddings for the similarity pre-filter (similarity.ts); truncated to a
// few hundred dimensions, which is plenty for telling bookings from the rest.
export function geminiEmbedder(client: GoogleGenAI, model: string): Embedder {
  return async (text) => {
    const response = await client.models.embedContent({
      model,
      contents: text,
      config: { taskType: "CLASSIFICATION", outputDimensionality: embeddingDimensions },
    });
    const values = response.embeddings?.[0]?.values;
    if (!values || values.length === 0) throw new Error("Gemini returned no embedding");
    return values;
  };
}

export function parseExtraction(text: string, messageId: string): ExtractedBooking {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`Gemini returned invalid JSON for message ${messageId}: ${(error as Error).message}`);
  }
  const result = ExtractedBooking.safeParse(json);
  if (!result.success) {
    throw new Error(`Gemini output failed schema for message ${messageId}: ${z.prettifyError(result.error)}`);
  }
  // One email is a reservation or an agreement; "paired" is only ever the
  // two merged (mergeDetails), never what a model reads.
  for (const segment of result.data.segments) if (segment.rentalStage === "paired") delete segment.rentalStage;
  return result.data;
}
