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
    expect(tripLandmark("Galway").id).toBe("galway");
    expect(tripLandmark("Loch Ness").id).toBe("inverness");
    expect(tripLandmark("Borobudur").id).toBe("yogyakarta");
    expect(tripLandmark("Riyadh").id).toBe("riyadh");
    expect(tripLandmark("Wellington").id).toBe("wellington");
    expect(tripLandmark("Zagreb").id).toBe("zagreb");
    expect(tripLandmark("Adelaide").id).toBe("adelaide");
    expect(tripLandmark("Park City").id).toBe("park-city");
    expect(tripLandmark("Bergen").id).toBe("bergen");
    expect(tripLandmark("Tenerife").id).toBe("tenerife");
    expect(tripLandmark("Winchester").id).toBe("winchester");
    expect(tripLandmark("Chelmsford").id).toBe("chelmsford");
    expect(tripLandmark("Sacramento").id).toBe("sacramento");
    expect(tripLandmark("Hurghada").id).toBe("hurghada");
    expect(tripLandmark("Heraklion").id).toBe("heraklion");
    expect(tripLandmark("Valetta").id).toBe("valletta");
    expect(tripLandmark("Malta").id).toBe("valletta");
    expect(tripLandmark("Carmel").id).toBe("carmel");
    expect(tripLandmark("Ravenna").id).toBe("ravenna");
    expect(tripLandmark("Split").id).toBe("split");
    expect(tripLandmark("Lake Tahoe").id).toBe("lake-tahoe");
    expect(tripLandmark("Kahului").id).toBe("kahului");
    expect(tripLandmark("Waikiki").id).toBe("honolulu");
    expect(tripLandmark("Nadi").id).toBe("nadi");
    expect(tripLandmark("Suva").id).toBe("suva");
    expect(tripLandmark("Kihei").id).toBe("beach");
    expect(tripLandmark("Lahaina").id).toBe("beach");
    expect(tripLandmark("Bora Bora").id).toBe("beach");
    expect(tripLandmark("Santa Cruz").id).toBe("beach");
    expect(tripLandmark("Santa Cruz de Tenerife").id).toBe("tenerife");
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
    expect(tripLandmark("São Paulo").id).toBe("sao-paulo");
    expect(tripLandmark("Bogotá").id).toBe("bogota");
    expect(tripLandmark("Torino").id).toBe("turin");
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

  it("takes a name that is also a word only as a place", () => {
    expect(tripLandmark("Nice").id).toBe("nice");
    expect(tripLandmark("Nice, France").id).toBe("nice");
    expect(tripLandmark("Weekend in Nice").id).toBe("nice");
    expect(tripLandmark("Nice weekend").id).toBe("trip");
    expect(tripLandmark("A nice break").id).toBe("trip");
    expect(tripLandmark("NICE").id).toBe("trip");
    expect(tripLandmark("Bath").id).toBe("bath");
    expect(tripLandmark("Bath time").id).toBe("trip");
    expect(tripLandmark("Nice weekend in Bath").id).toBe("bath");
    expect(tripLandmark("Split, Croatia").id).toBe("split");
    expect(tripLandmark("Week in Split").id).toBe("split");
    expect(tripLandmark("Split stay").id).toBe("trip");
  });

  it("leaves out a longer name that begins with a city's", () => {
    expect(tripLandmark("Santiago de Compostela").id).toBe("trip");
    expect(tripLandmark("Rio Grande").id).toBe("trip");
    expect(tripLandmark("Washington State road trip").id).toBe("trip");
    expect(tripLandmark("Canton, Ohio").id).toBe("trip");
    expect(tripLandmark("Santa Cruz de la Sierra").id).toBe("trip");
    expect(tripLandmark("Santiago").id).toBe("santiago");
    expect(tripLandmark("Washington, DC").id).toBe("washington");
    expect(tripLandmark("Rio Grande, then Rio").id).toBe("rio-de-janeiro");
  });

  it("falls back to place kind, season, holiday or vacation when no city is named", () => {
    expect(tripLandmark("Alps").id).toBe("mountains");
    expect(tripLandmark("Whistler").id).toBe("mountains");
    expect(tripLandmark("Mountain getaway").id).toBe("mountains");
    expect(tripLandmark("Yosemite").id).toBe("forest");
    expect(tripLandmark("Forest cabin").id).toBe("forest");
    expect(tripLandmark("Lake Como").id).toBe("lake");
    expect(tripLandmark("Lake house").id).toBe("lake");
    expect(tripLandmark("Farm stay").id).toBe("farm");
    expect(tripLandmark("Beach week").id).toBe("beach");
    expect(tripLandmark("Summer vacation").id).toBe("summer");
    expect(tripLandmark("Autumn foliage").id).toBe("autumn");
    expect(tripLandmark("Fall break").id).toBe("autumn");
    expect(tripLandmark("Winter getaway").id).toBe("winter");
    expect(tripLandmark("Spring break").id).toBe("spring");
    expect(tripLandmark("Thanksgiving").id).toBe("thanksgiving");
    expect(tripLandmark("Christmas break").id).toBe("christmas");
    expect(tripLandmark("New Year's Eve").id).toBe("new-year");
    expect(tripLandmark("Lunar New Year").id).toBe("new-year");
    expect(tripLandmark("Easter weekend").id).toBe("easter");
    expect(tripLandmark("Halloween").id).toBe("halloween");
    expect(tripLandmark("Caribbean cruise").id).toBe("cruise");
    expect(tripLandmark("Family holiday").id).toBe("vacation");
    expect(tripLandmark("Passover").id).toBe("vacation");
  });

  it("prefers a named place over an earlier season, holiday or theme word", () => {
    expect(tripLandmark("Summer in Paris").id).toBe("paris");
    expect(tripLandmark("Thanksgiving in Boston").id).toBe("boston");
    expect(tripLandmark("Beach trip to Sydney").id).toBe("sydney");
    expect(tripLandmark("Christmas in Kihei").id).toBe("beach");
    expect(tripLandmark("Summer in the Alps").id).toBe("mountains");
    expect(tripLandmark("Fall in Yosemite").id).toBe("forest");
    expect(tripLandmark("Summer at Lake Como").id).toBe("lake");
    expect(tripLandmark("Ski trip to Banff").id).toBe("banff");
    expect(tripLandmark("Summer holiday").id).toBe("summer");
    expect(tripLandmark("Christmas holiday").id).toBe("christmas");
  });

  it("gives a place with no landmark the suitcase", () => {
    expect(tripLandmark("Woburn").id).toBe("trip");
    expect(tripLandmark("Niagara Falls").id).toBe("trip");
    expect(tripLandmark("Springfield").id).toBe("trip");
    expect(tripLandmark("Cornwall").id).toBe("trip");
    expect(tripLandmark("").id).toBe("trip");
  });

  it("keeps every id, city and fallback unique, folded, and backed by a path", () => {
    const ids = new Set<string>();
    const cities = new Set<string>();
    const fallbacks = new Set<string>();
    for (const landmark of LANDMARKS) {
      expect(ids.has(landmark.id)).toBe(false);
      ids.add(landmark.id);
      expect(landmark.d.trim().length).toBeGreaterThan(0);
      for (const city of landmark.cities) {
        expect(foldText(city)).toBe(city);
        expect(cities.has(city)).toBe(false);
        cities.add(city);
      }
      for (const name of landmark.capitalized ?? []) {
        expect(foldText(name)).toBe(name.toLowerCase());
        expect(name.charAt(0)).toBe(name.charAt(0).toUpperCase());
        expect(cities.has(foldText(name))).toBe(false);
        cities.add(foldText(name));
      }
      for (const name of landmark.not ?? []) expect(foldText(name)).toBe(name);
      for (const word of landmark.fallback ?? []) {
        expect(foldText(word)).toBe(word);
        expect(fallbacks.has(word)).toBe(false);
        fallbacks.add(word);
      }
    }
    expect(LANDMARKS.length).toBe(225);
  });
});
