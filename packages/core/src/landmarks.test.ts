import { describe, expect, it } from "vitest";
import { LANDMARKS, tripLandmark } from "./landmarks";
import { foldText } from "./tripSearch";

describe("tripLandmark", () => {
  it("finds the city a title names", () => {
    expect(tripLandmark("Boston").id).toBe("boston");
    expect(tripLandmark("Las Vegas").id).toBe("las-vegas");
    expect(tripLandmark("Vegas, baby").id).toBe("las-vegas");
    expect(tripLandmark("Weekend in Paris").id).toBe("paris");
  });

  it("ignores accents and case", () => {
    expect(tripLandmark("LISBOA").id).toBe("lisbon");
    expect(tripLandmark("Édinburgh").id).toBe("edinburgh");
  });

  it("takes the city named first", () => {
    expect(tripLandmark("Dublin and Liverpool").id).toBe("dublin");
    expect(tripLandmark("Liverpool and Dublin").id).toBe("liverpool");
  });

  it("matches whole words only", () => {
    expect(tripLandmark("Parisian cafés").id).toBe("trip");
    expect(tripLandmark("Bostonia").id).toBe("trip");
  });

  it("gives a place with no landmark the suitcase", () => {
    expect(tripLandmark("Woburn").id).toBe("trip");
    expect(tripLandmark("").id).toBe("trip");
  });

  it("keeps every city name folded, so it can match", () => {
    for (const landmark of LANDMARKS) for (const city of landmark.cities) expect(foldText(city)).toBe(city);
  });
});
