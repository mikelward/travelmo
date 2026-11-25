import { describe, expect, it } from "vitest";
import { LANDMARKS, tripLandmark } from "./landmarks";
import { foldText } from "./tripSearch";

describe("tripLandmark", () => {
  it("finds the city a title names", () => {
    expect(tripLandmark("Boston").id).toBe("boston");
    expect(tripLandmark("Las Vegas").id).toBe("las-vegas");
    expect(tripLandmark("Vegas, baby").id).toBe("las-vegas");
    expect(tripLandmark("Weekend in Paris").id).toBe("paris");
    expect(tripLandmark("Sydney").id).toBe("sydney");
    expect(tripLandmark("Dubai stopover").id).toBe("dubai");
    expect(tripLandmark("Singapore").id).toBe("singapore");
    expect(tripLandmark("Barcelona").id).toBe("barcelona");
    expect(tripLandmark("NYC weekend").id).toBe("new-york");
    expect(tripLandmark("San Francisco").id).toBe("san-francisco");
    expect(tripLandmark("Tokyo").id).toBe("tokyo");
    expect(tripLandmark("Pisa").id).toBe("pisa");
    expect(tripLandmark("Shanghai").id).toBe("shanghai");
    expect(tripLandmark("Philly").id).toBe("philadelphia");
    expect(tripLandmark("Saigon").id).toBe("ho-chi-minh-city");
    expect(tripLandmark("Machu Picchu").id).toBe("cusco");
    expect(tripLandmark("Petra").id).toBe("amman");
    expect(tripLandmark("Bath").id).toBe("bath");
    expect(tripLandmark("Oxford").id).toBe("oxford");
    expect(tripLandmark("Angkor Wat").id).toBe("siem-reap");
    expect(tripLandmark("Bali").id).toBe("bali");
    expect(tripLandmark("Queenstown").id).toBe("queenstown");
  });

  it("ignores accents and case", () => {
    expect(tripLandmark("LISBOA").id).toBe("lisbon");
    expect(tripLandmark("Édinburgh").id).toBe("edinburgh");
    expect(tripLandmark("München").id).toBe("munich");
    expect(tripLandmark("Reykjavík").id).toBe("reykjavik");
    expect(tripLandmark("Ciudad de México").id).toBe("mexico-city");
    expect(tripLandmark("Roma").id).toBe("rome");
    expect(tripLandmark("Genève").id).toBe("geneva");
    expect(tripLandmark("København").id).toBe("copenhagen");
    expect(tripLandmark("Kraków").id).toBe("krakow");
    expect(tripLandmark("Köln").id).toBe("cologne");
    expect(tripLandmark("Québec").id).toBe("quebec-city");
    expect(tripLandmark("Chichén Itzá").id).toBe("cancun");
  });

  it("takes the city named first", () => {
    expect(tripLandmark("Dublin and Liverpool").id).toBe("dublin");
    expect(tripLandmark("Liverpool and Dublin").id).toBe("liverpool");
    expect(tripLandmark("Sydney via Singapore").id).toBe("sydney");
  });

  it("matches whole words only", () => {
    expect(tripLandmark("Parisian cafés").id).toBe("trip");
    expect(tripLandmark("Bostonia").id).toBe("trip");
    expect(tripLandmark("Romanian coast").id).toBe("trip");
  });

  it("gives a place with no landmark the suitcase", () => {
    expect(tripLandmark("Woburn").id).toBe("trip");
    expect(tripLandmark("").id).toBe("trip");
  });

  it("keeps every id and city unique, folded, and backed by a path", () => {
    const ids = new Set<string>();
    const cities = new Set<string>();
    for (const landmark of LANDMARKS) {
      expect(ids.has(landmark.id)).toBe(false);
      ids.add(landmark.id);
      expect(landmark.d.trim().length).toBeGreaterThan(0);
      for (const city of landmark.cities) {
        expect(foldText(city)).toBe(city);
        expect(cities.has(city)).toBe(false);
        cities.add(city);
      }
    }
    expect(LANDMARKS.length).toBe(143);
  });
});
