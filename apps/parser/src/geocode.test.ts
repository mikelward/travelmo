import { GeocodeError } from "@travelmo/core";
import { describe, expect, it } from "vitest";
import { cachedGeocoder, googleGeocoder, memoryGeocodeStore } from "./geocode";

// Invented places; no real address or key.
const ok = (country: string, city?: string) =>
  ({
    status: "OK",
    results: [
      {
        address_components: [
          ...(city ? [{ long_name: city, short_name: city, types: ["locality", "political"] }] : []),
          { long_name: "Exampleland", short_name: country, types: ["country", "political"] },
        ],
      },
    ],
  }) as const;

const fakeFetch = (handler: (url: string) => unknown, status = 200): typeof fetch =>
  (async (input: string | URL | Request) => {
    const url = String(input);
    const body = handler(url);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

describe("googleGeocoder", () => {
  it("asks Google for the address with the key and reads the answer", async () => {
    const urls: string[] = [];
    const geocode = googleGeocoder("secret-key", fakeFetch((url) => (urls.push(url), ok("FR", "Exampleville"))));
    expect(await geocode("Hotel Example, Exampleville")).toEqual({ country: "FR", city: "Exampleville" });
    expect(urls[0]).toContain("address=Hotel+Example%2C+Exampleville");
    expect(urls[0]).toContain("key=secret-key");
  });

  it("reports an HTTP failure or an unreachable host by status, never the key", async () => {
    await expect(googleGeocoder("secret-key", fakeFetch(() => ({}), 503))("x")).rejects.toThrow("HTTP_503");
    const down: typeof fetch = async (input) => {
      throw new Error(`connect failed for ${String(input)}`);
    };
    const error: unknown = await googleGeocoder("secret-key", down)("x").then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(GeocodeError);
    expect((error as Error).message).toContain("key=…");
    expect((error as Error).message).not.toContain("secret-key");
  });
});

describe("cachedGeocoder", () => {
  const options = (geocoder: (q: string) => Promise<ReturnType<typeof ok> | "none" | never>, limit = 300) => {
    const store = memoryGeocodeStore();
    const logs: [string, Record<string, unknown>][] = [];
    const calls: string[] = [];
    const lookup = cachedGeocoder({
      store,
      geocoder: async (q) => {
        calls.push(q);
        const r = await geocoder(q);
        return r === "none" ? "none" : { country: r.results[0]!.address_components.at(-1)!.short_name, city: r.results[0]!.address_components[0]!.long_name };
      },
      limit,
      now: () => "2026-11-07T10:00:00Z",
      log: (event, fields) => logs.push([event, fields]),
    });
    return { store, logs, calls, lookup };
  };

  it("answers from the cache after one call, whatever the spelling, including a 'none'", async () => {
    const { lookup, calls, store } = options(async (q) => (q.startsWith("Nowhere") ? "none" : ok("FR", "Exampleville")));
    expect(await lookup("Hotel Example, Exampleville")).toEqual({ country: "FR", city: "Exampleville" });
    expect(await lookup("hotel example exampleville")).toEqual({ country: "FR", city: "Exampleville" });
    expect(await lookup("Nowhere Special")).toBe("none");
    expect(await lookup("Nowhere Special")).toBe("none");
    expect(calls).toEqual(["Hotel Example, Exampleville", "Nowhere Special"]);
    expect(store.calls.get("2026-11-07")).toBe(2);
    expect([...store.entries.values()].map((e) => e.status)).toEqual(["ok", "none"]);
  });

  it("stops calling when the day's budget is spent, saying so once, and caches nothing then", async () => {
    const { lookup, calls, logs, store } = options(async () => ok("FR"), 1);
    expect(await lookup("Hotel Example")).toEqual({ country: "FR", city: "Exampleland" });
    expect(await lookup("Hotel Sample")).toBe("none");
    expect(await lookup("Hotel Other")).toBe("none");
    expect(calls).toEqual(["Hotel Example"]);
    expect(logs).toEqual([["geocode_budget_exhausted", { day: "2026-11-07", limit: 1 }]]);
    expect(store.entries.size).toBe(1);
    // A cached answer costs nothing even when the budget is gone.
    expect(await lookup("hotel example")).toEqual({ country: "FR", city: "Exampleland" });
  });

  it("logs a failure by status and rethrows it", async () => {
    const { lookup, logs } = options(async () => {
      throw new GeocodeError("REQUEST_DENIED", "The provided API key is invalid.");
    });
    await expect(lookup("Hotel Example")).rejects.toThrow(GeocodeError);
    expect(logs).toEqual([["geocode_failed", { status: "REQUEST_DENIED", reason: "REQUEST_DENIED: The provided API key is invalid." }]]);
  });
});
