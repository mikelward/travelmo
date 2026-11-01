import { GoogleGenAI } from "@google/genai";
import { ExtractedBooking } from "@travelmo/core";
import { z } from "zod";
import type { EmailMessage } from "./gmail";
import type { Embedder } from "./importer";
import { embeddingDimensions } from "./similarity";

export type Extractor = (message: EmailMessage) => Promise<ExtractedBooking>;

const responseJsonSchema = z.toJSONSchema(ExtractedBooking, { target: "draft-7" });

const instructions = `You read a single email and extract any travel bookings it confirms.

Rules:
- Set isBooking=false with no segments for marketing, reminders about unrelated things, receipts for non-travel purchases, or messages that only mention travel in passing.
- One segment per leg or stay: each flight leg, each train leg, each hotel stay, each car rental period, each ticketed activity. A return journey is two segments.
- type: flight, train, bus, ferry, lodging, car_rental, activity, or other.
- title: short and specific, e.g. "BA 117 LHR to JFK", "Cove Liverpool", "Hertz Manchester Airport".
- start/end: ISO 8601 with the local UTC offset of the place where the event happens. Infer the offset from the airport/city. For lodging, start is check-in and end is check-out; if times are not stated use 15:00 and 11:00. If a year is missing, use the email's Date header to infer it.
- origin/destination: for transport, where it departs and arrives (name, IATA/station code, city, ISO 3166-1 alpha-2 country). For lodging and activities use destination only.
- confirmation: the booking reference / PNR / confirmation number if present.
- provider: airline, hotel brand, rental company or booking site.
- Do not invent details that are not in the email.`;

export function geminiExtractor(client: GoogleGenAI, model: string): Extractor {
  return async (message) => {
    const prompt = [
      `From: ${message.from}`,
      `Subject: ${message.subject}`,
      `Date: ${message.date}`,
      "",
      message.text,
    ].join("\n");
    const response = await client.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: instructions,
        responseMimeType: "application/json",
        responseJsonSchema,
        temperature: 0,
      },
    });
    const text = response.text;
    if (!text) throw new Error(`Gemini returned no text for message ${message.id}`);
    return parseExtraction(text, message.id);
  };
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
  return result.data;
}
