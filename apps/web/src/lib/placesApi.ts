import { placeFromComponents, readLocation, type AddressComponent, type Location } from "@travelmo/core";

// Google's Places API (New), called from the browser with a public key
// restricted to this app's origins: typing the start of an address, a UK
// postcode or a US ZIP offers places, and picking one fills the place's
// name, city, country, address and coordinates. Without a key the form is a
// plain input.

export const placesKey = (): string | undefined => process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || undefined;

const base = "https://places.googleapis.com/v1";

export type Suggestion = { placeId: string; mainText: string; secondaryText?: string };

type Prediction = {
  placePrediction?: {
    placeId?: string;
    text?: { text?: string };
    structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
  };
};

// The requests of one lookup (every keystroke, then the details of the pick)
// share a session token, which Google bills as one session.
export async function autocomplete(input: string, sessionToken: string, key: string, fetchFn: typeof fetch = fetch, signal?: AbortSignal): Promise<Suggestion[]> {
  const response = await fetchFn(`${base}/places:autocomplete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key },
    body: JSON.stringify({ input, sessionToken, languageCode: "en" }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`Place lookup failed (${response.status})`);
  const json = (await response.json()) as { suggestions?: Prediction[] };
  return (json.suggestions ?? []).flatMap((s) => {
    const p = s.placePrediction;
    const mainText = p?.structuredFormat?.mainText?.text ?? p?.text?.text;
    if (!p?.placeId || !mainText) return [];
    const secondaryText = p.structuredFormat?.secondaryText?.text;
    return [{ placeId: p.placeId, mainText, ...(secondaryText ? { secondaryText } : {}) }];
  });
}

export type PickedPlace = { name: string; city?: string; country?: string; address?: string; location?: Location };

// The address components, formatted address and location of a picked place:
// all in the cheapest field mask that gives a country, and the request that
// closes the autocomplete session.
export async function placeDetails(
  placeId: string,
  sessionToken: string,
  key: string,
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<Omit<PickedPlace, "name">> {
  const response = await fetchFn(`${base}/places/${encodeURIComponent(placeId)}?${new URLSearchParams({ sessionToken })}`, {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "addressComponents,formattedAddress,location" },
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new Error(`Place details failed (${response.status})`);
  const json = (await response.json()) as { addressComponents?: AddressComponent[]; formattedAddress?: string; location?: unknown };
  const found = placeFromComponents(json.addressComponents);
  const address = json.formattedAddress?.trim();
  const location = readLocation(json.location);
  return {
    ...(address ? { address } : {}),
    ...(found?.city ? { city: found.city } : {}),
    ...(found ? { country: found.country } : {}),
    ...(location ? { location } : {}),
  };
}
