import { describe, expect, it } from "vitest";
import { autocomplete, placeDetails } from "./placesApi";

// Invented places; no real address or key.
type Call = { url: string; init?: RequestInit };
const fakeFetch = (calls: Call[], body: unknown, status = 200): typeof fetch =>
  (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), ...(init ? { init } : {}) });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

describe("autocomplete", () => {
  it("posts the typed text with the session token and key, and reads place predictions only", async () => {
    const calls: Call[] = [];
    const suggestions = await autocomplete(
      "10 Example St",
      "session-1",
      "public-key",
      fakeFetch(calls, {
        suggestions: [
          { placePrediction: { placeId: "p1", text: { text: "10 Example Street, Exampleville" }, structuredFormat: { mainText: { text: "10 Example Street" }, secondaryText: { text: "Exampleville, Exampleland" } } } },
          { queryPrediction: { text: { text: "example street" } } },
          { placePrediction: { placeId: "p2", text: { text: "Example Street" } } },
        ],
      }),
    );
    expect(suggestions).toEqual([
      { placeId: "p1", mainText: "10 Example Street", secondaryText: "Exampleville, Exampleland" },
      { placeId: "p2", mainText: "Example Street" },
    ]);
    expect(calls[0]!.url).toBe("https://places.googleapis.com/v1/places:autocomplete");
    expect(calls[0]!.init?.method).toBe("POST");
    expect(calls[0]!.init?.headers).toEqual({ "Content-Type": "application/json", "X-Goog-Api-Key": "public-key" });
    expect(JSON.parse(calls[0]!.init?.body as string)).toEqual({ input: "10 Example St", sessionToken: "session-1", languageCode: "en" });
  });

  it("fails plainly on an HTTP error", async () => {
    await expect(autocomplete("x", "s", "k", fakeFetch([], {}, 403))).rejects.toThrow("Place lookup failed (403)");
  });
});

describe("placeDetails", () => {
  it("asks for the address fields with the session token and maps them to a place", async () => {
    const calls: Call[] = [];
    const details = await placeDetails(
      "p1",
      "session-1",
      "public-key",
      fakeFetch(calls, {
        formattedAddress: "10 Example Street, Exampleville EX1 2MP, Exampleland",
        addressComponents: [
          { longText: "10", shortText: "10", types: ["street_number"] },
          { longText: "Exampleville", shortText: "Exampleville", types: ["postal_town"] },
          { longText: "Exampleland", shortText: "GB", types: ["country", "political"] },
        ],
        location: { latitude: 51.5, longitude: -0.25 },
      }),
    );
    expect(details).toEqual({
      address: "10 Example Street, Exampleville EX1 2MP, Exampleland",
      city: "Exampleville",
      country: "GB",
      location: { lat: 51.5, lon: -0.25 },
    });
    expect(calls[0]!.url).toBe("https://places.googleapis.com/v1/places/p1?sessionToken=session-1");
    expect(calls[0]!.init?.headers).toEqual({ "X-Goog-Api-Key": "public-key", "X-Goog-FieldMask": "addressComponents,formattedAddress,location" });
  });

  it("gives only what the answer holds", async () => {
    expect(await placeDetails("p2", "s", "k", fakeFetch([], { formattedAddress: "Somewhere" }))).toEqual({ address: "Somewhere" });
    expect(await placeDetails("p3", "s", "k", fakeFetch([], {}))).toEqual({});
  });
});
