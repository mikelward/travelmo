import { describe, expect, it } from "vitest";
import { LANDMARKS, placeSetting, tripBookingType, tripLandmark, tripPicture, tripSetting } from "./landmarks";
import { PlaceSetting, type ExtractedSegment } from "./schema";
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
    expect(tripLandmark("Salt Lake City").id).toBe("salt-lake-city");
    expect(tripLandmark("Santa Fe").id).toBe("santa-fe");
    expect(tripLandmark("Pittsburgh").id).toBe("pittsburgh");
    expect(tripLandmark("Memphis").id).toBe("memphis");
    expect(tripLandmark("Halifax").id).toBe("halifax");
    expect(tripLandmark("Victoria, BC").id).toBe("victoria");
    expect(tripLandmark("Oaxaca").id).toBe("oaxaca");
    expect(tripLandmark("Guadalajara").id).toBe("guadalajara");
    expect(tripLandmark("Mont Saint-Michel").id).toBe("mont-saint-michel");
    expect(tripLandmark("Santiago de Compostela").id).toBe("santiago-de-compostela");
    expect(tripLandmark("Heidelberg").id).toBe("heidelberg");
    expect(tripLandmark("Innsbruck").id).toBe("innsbruck");
    expect(tripLandmark("Utrecht").id).toBe("utrecht");
    expect(tripLandmark("Newcastle").id).toBe("newcastle");
    expect(tripLandmark("Thessaloniki").id).toBe("thessaloniki");
    expect(tripLandmark("Bucharest").id).toBe("bucharest");
    expect(tripLandmark("Belgrade").id).toBe("belgrade");
    expect(tripLandmark("Xi'an").id).toBe("xian");
    expect(tripLandmark("Chengdu").id).toBe("chengdu");
    expect(tripLandmark("Hangzhou").id).toBe("hangzhou");
    expect(tripLandmark("Nara").id).toBe("nara");
    expect(tripLandmark("Kolkata").id).toBe("kolkata");
    expect(tripLandmark("Hyderabad").id).toBe("hyderabad");
    expect(tripLandmark("Amritsar").id).toBe("amritsar");
    expect(tripLandmark("Udaipur").id).toBe("udaipur");
    expect(tripLandmark("Samarkand").id).toBe("samarkand");
    expect(tripLandmark("Tbilisi").id).toBe("tbilisi");
    expect(tripLandmark("Baku").id).toBe("baku");
    expect(tripLandmark("Hobart").id).toBe("hobart");
    expect(tripLandmark("Christchurch").id).toBe("christchurch");
    expect(tripLandmark("Fez").id).toBe("fez");
    expect(tripLandmark("Quito").id).toBe("quito");
    expect(tripLandmark("Montevideo").id).toBe("montevideo");
    expect(tripLandmark("Makarska").id).toBe("makarska");
    expect(tripLandmark("Makarska Riviera").id).toBe("makarska");
    expect(tripLandmark("Biokovo").id).toBe("makarska");
    expect(tripLandmark("Johannesburg").id).toBe("johannesburg");
    expect(tripLandmark("Joburg").id).toBe("johannesburg");
    expect(tripLandmark("Graz").id).toBe("graz");
    expect(tripLandmark("San Jose").id).toBe("san-jose");
    expect(tripLandmark("Silicon Valley").id).toBe("san-jose");
    expect(tripLandmark("San Jose del Cabo").id).toBe("beach");
    expect(tripLandmark("San Jose, Costa Rica").id).toBe("trip");
    expect(tripLandmark("Oakland").id).toBe("oakland");
    expect(tripLandmark("Leipzig").id).toBe("leipzig");
    expect(tripLandmark("Lausanne").id).toBe("lausanne");
    expect(tripLandmark("Osijek").id).toBe("osijek");
    expect(tripLandmark("Marseilles").id).toBe("marseille");
    expect(tripLandmark("Gold Coast").id).toBe("gold-coast");
    expect(tripLandmark("Surfers Paradise").id).toBe("gold-coast");
    expect(tripLandmark("Surfer's Paradise").id).toBe("gold-coast");
    expect(tripLandmark("Uluru").id).toBe("uluru");
    expect(tripLandmark("Ayers Rock").id).toBe("uluru");
    expect(tripLandmark("Alice Springs").id).toBe("uluru");
    expect(tripLandmark("Yulara").id).toBe("uluru");
    expect(tripLandmark("Mackay").id).toBe("mackay");
    expect(tripLandmark("Townsville").id).toBe("townsville");
    expect(tripLandmark("Darwin").id).toBe("darwin");
    expect(tripLandmark("Cairns").id).toBe("cairns");
    expect(tripLandmark("Byron Bay").id).toBe("byron-bay");
    expect(tripLandmark("Rotorua").id).toBe("rotorua");
    expect(tripLandmark("Dunedin").id).toBe("dunedin");
    expect(tripLandmark("Launceston").id).toBe("launceston");
    expect(tripLandmark("Kuta").id).toBe("bali");
    expect(tripLandmark("Seminyak").id).toBe("bali");
    expect(tripLandmark("Canggu").id).toBe("bali");
    expect(tripLandmark("Nusa Dua").id).toBe("bali");
    expect(tripLandmark("Jimbaran").id).toBe("bali");
    expect(tripLandmark("Sanur").id).toBe("bali");
    expect(tripLandmark("Flinders Ranges").id).toBe("flinders-ranges");
    expect(tripLandmark("Wilpena Pound").id).toBe("flinders-ranges");
    expect(tripLandmark("Rawnsley Park").id).toBe("flinders-ranges");
    expect(tripLandmark("Quorn").id).toBe("flinders-ranges");
    expect(tripLandmark("Parachilna").id).toBe("flinders-ranges");
    expect(tripLandmark("Blinman").id).toBe("flinders-ranges");
    expect(tripLandmark("Arkaroola").id).toBe("flinders-ranges");
    expect(tripLandmark("Flinders Street").id).toBe("trip");
    expect(tripLandmark("Daintree").id).toBe("daintree");
    expect(tripLandmark("Cape Tribulation").id).toBe("daintree");
    expect(tripLandmark("Port Douglas").id).toBe("daintree");
    expect(tripLandmark("Mossman").id).toBe("daintree");
    expect(tripLandmark("Cow Bay").id).toBe("daintree");
    expect(tripLandmark("Raleigh").id).toBe("raleigh");
    expect(tripLandmark("Raleigh/Durham").id).toBe("raleigh");
    expect(tripLandmark("Durham/Raleigh").id).toBe("raleigh");
    expect(tripLandmark("Durham, NC").id).toBe("raleigh");
    expect(tripLandmark("Chapel Hill").id).toBe("raleigh");
    expect(tripLandmark("Research Triangle").id).toBe("raleigh");
    expect(tripLandmark("Durham").id).toBe("durham");
    expect(tripLandmark("Venice Beach").id).toBe("beach");
    expect(tripLandmark("Venice, CA").id).toBe("beach");
    expect(tripLandmark("Venice, FL").id).toBe("beach");
    expect(tripLandmark("Naples, FL").id).toBe("beach");
    expect(tripLandmark("Cambridge, MA").id).toBe("boston");
    expect(tripLandmark("Portland, ME").id).toBe("trip");
    expect(tripLandmark("Newcastle, NSW").id).toBe("trip");
    expect(tripLandmark("Victoria, Australia").id).toBe("trip");
    expect(tripLandmark("Vancouver, Washington").id).toBe("trip");
    expect(tripLandmark("Rome, New York").id).toBe("trip");
    expect(tripLandmark("London, Ontario").id).toBe("trip");
    expect(tripLandmark("Melbourne, FL").id).toBe("trip");
    expect(tripLandmark("Perth, Scotland").id).toBe("trip");
    expect(tripLandmark("Manchester, NH").id).toBe("trip");
    expect(tripLandmark("Athens, GA").id).toBe("trip");
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
    expect(tripLandmark("Córdoba").id).toBe("cordoba");
    expect(tripLandmark("Gdańsk").id).toBe("gdansk");
    expect(tripLandmark("Tromsø").id).toBe("tromso");
    expect(tripLandmark("Malmö").id).toBe("malmo");
    expect(tripLandmark("Medellín").id).toBe("medellin");
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
    expect(tripLandmark("Orange, CA").id).toBe("orange");
    expect(tripLandmark("Weekend in Orange").id).toBe("orange");
    expect(tripLandmark("Orange juice").id).toBe("trip");
    expect(tripLandmark("Strawberry").id).toBe("strawberry");
    expect(tripLandmark("Strawberry picking").id).toBe("trip");
    expect(tripLandmark("Eagle, CO").id).toBe("eagle");
    expect(tripLandmark("Eagle watching").id).toBe("trip");
  });

  it("leaves out a longer name containing a city's", () => {
    expect(tripLandmark("Santiago de Cuba").id).toBe("trip");
    expect(tripLandmark("Santiago de Compostela").id).toBe("santiago-de-compostela");
    expect(tripLandmark("Victoria Falls").id).toBe("trip");
    expect(tripLandmark("Lake Victoria").id).toBe("lake");
    expect(tripLandmark("Lake Victoria holiday").id).toBe("lake");
    expect(tripLandmark("Lake Victoria, then Victoria").id).toBe("victoria");
    expect(tripLandmark("Milford Sound").id).toBe("lake");
    expect(tripLandmark("Rio Grande").id).toBe("trip");
    expect(tripLandmark("Washington State").id).toBe("trip");
    expect(tripLandmark("Washington State road trip").id).toBe("road-trip");
    expect(tripLandmark("Canton, Ohio").id).toBe("trip");
    expect(tripLandmark("Santa Cruz de la Sierra").id).toBe("trip");
    expect(tripLandmark("Santiago").id).toBe("santiago");
    expect(tripLandmark("Washington, DC").id).toBe("washington");
    expect(tripLandmark("Rio Grande, then Rio").id).toBe("rio-de-janeiro");
  });

  it("gives places named after a real-world noun a matching drawing", () => {
    expect(tripLandmark("Roseville").id).toBe("rose");
    expect(tripLandmark("Santa Rosa").id).toBe("rose");
    expect(tripLandmark("Fair Oaks").id).toBe("acorn");
    expect(tripLandmark("Thousand Oaks").id).toBe("acorn");
    expect(tripLandmark("Appleton").id).toBe("apple");
    expect(tripLandmark("Orangevale").id).toBe("orange");
    expect(tripLandmark("Cherry Hill").id).toBe("cherry");
    expect(tripLandmark("Peachtree City").id).toBe("peach");
    expect(tripLandmark("Lemon Grove").id).toBe("lemon");
    expect(tripLandmark("Strawberry Plains").id).toBe("strawberry");
    expect(tripLandmark("Cloverdale").id).toBe("clover");
    expect(tripLandmark("Sunnyvale").id).toBe("sunflower");
    expect(tripLandmark("Anchorage").id).toBe("anchor");
    expect(tripLandmark("Bellevue").id).toBe("bell");
    expect(tripLandmark("Coronado").id).toBe("crown");
    expect(tripLandmark("Diamond Bar").id).toBe("diamond");
    expect(tripLandmark("Big Bear").id).toBe("bear");
    expect(tripLandmark("Swansea").id).toBe("swan");
    expect(tripLandmark("Foxborough").id).toBe("fox");
    expect(tripLandmark("Elk Grove").id).toBe("stag");
    expect(tripLandmark("Mariposa").id).toBe("butterfly");
    expect(tripLandmark("Mill Valley").id).toBe("windmill");
    expect(tripLandmark("Orcas Island").id).toBe("whale");
    expect(tripLandmark("Eagle River").id).toBe("eagle");
    expect(tripLandmark("Shell Beach").id).toBe("shell");
    expect(tripLandmark("Northstar").id).toBe("star");
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
    expect(tripLandmark("City break").id).toBe("city");
    expect(tripLandmark("Kansas City").id).toBe("city");
    expect(tripLandmark("Old town weekend").id).toBe("town");
    expect(tripLandmark("Camping trip").id).toBe("camp");
    expect(tripLandmark("Cotswolds").id).toBe("countryside");
    expect(tripLandmark("Countryside cottage").id).toBe("countryside");
    expect(tripLandmark("Grand Canyon").id).toBe("desert");
    expect(tripLandmark("Desert dunes").id).toBe("desert");
    expect(tripLandmark("Napa Valley").id).toBe("wine");
    expect(tripLandmark("Winery weekend").id).toBe("wine");
    expect(tripLandmark("Pacific Coast Highway").id).toBe("road-trip");
    expect(tripLandmark("Serengeti").id).toBe("safari");
    expect(tripLandmark("Safari week").id).toBe("safari");
    expect(tripLandmark("Disneyland").id).toBe("theme-park");
    expect(tripLandmark("Theme park trip").id).toBe("theme-park");
    expect(tripLandmark("Wedding weekend").id).toBe("celebration");
    expect(tripLandmark("Honeymoon").id).toBe("celebration");
    expect(tripLandmark("Neuschwanstein").id).toBe("castle");
    expect(tripLandmark("Medieval castle tour").id).toBe("castle");
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
    expect(tripLandmark("Wedding in Tuscany").id).toBe("wine");
    expect(tripLandmark("Road trip to Sedona").id).toBe("desert");
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
    expect(LANDMARKS.length).toBe(320);
  });
});

describe("tripPicture", () => {
  it("goes by the title first, then the kind of place the trip goes to, else the suitcase", () => {
    expect(tripPicture("Paris", "town").id).toBe("paris");
    expect(tripPicture("Woburn", "town").id).toBe("town");
    expect(tripPicture("Cornwall", "beach").id).toBe("beach");
    expect(tripPicture("Woburn", "none").id).toBe("trip");
    expect(tripPicture("Woburn").id).toBe("trip");
  });

  it("gives a trip that is just an event its booking's icon, whatever its title", () => {
    expect(tripBookingType("other")).toBe("other");
    expect(tripBookingType("activity")).toBe("activity");
    expect(tripBookingType("car_rental")).toBe("car_rental");
    expect(tripBookingType("city")).toBeUndefined();
    expect(tripBookingType("none")).toBeUndefined();
    expect(tripBookingType(undefined)).toBeUndefined();
  });

  it("draws every kind of place", () => {
    for (const setting of PlaceSetting.options) expect(tripPicture("Somewhere", setting).id).toBe(setting);
  });
});

const stay = (over: Partial<ExtractedSegment>): ExtractedSegment => ({ type: "lodging", title: "Stay", start: "2026-12-12T15:00:00Z", end: "2026-12-14T11:00:00Z", ...over });

describe("placeSetting", () => {
  it("takes what the email or the reader said", () => {
    expect(placeSetting({ name: "Sea View", city: "Boston", setting: "beach" })).toBe("beach");
  });

  it("tells a city from a town by its size, in its country", () => {
    expect(placeSetting({ name: "Hotel", city: "Boston", country: "US" })).toBe("city");
    expect(placeSetting({ name: "Hotel", city: "Woburn", country: "US" })).toBe("town");
    expect(placeSetting({ name: "Hotel", city: "São Paulo" })).toBe("city");
    // A city in Canada, a town in England.
    expect(placeSetting({ name: "Hotel", city: "Windsor", country: "CA" })).toBe("city");
    expect(placeSetting({ name: "Hotel", city: "Windsor", country: "GB" })).toBe("town");
  });

  it("says nothing of a place with no town", () => {
    expect(placeSetting({ name: "Terminal 5" })).toBeUndefined();
    expect(placeSetting(undefined)).toBeUndefined();
  });
});

describe("tripSetting", () => {
  it("is the first booking's type for a trip of local events alone", () => {
    const show = { type: "activity", title: "Show", start: "2026-12-12T19:00:00Z", destination: { name: "Theatre", city: "London", country: "GB" } } as const;
    const dinner = { type: "other", title: "Dinner", start: "2026-12-12T17:00:00Z", destination: { name: "Bistro", city: "London" } } as const;
    // The dinner comes first.
    expect(tripSetting([show, dinner])).toBe("other");
    expect(tripSetting([show])).toBe("activity");
    expect(tripSetting([show, stay({ destination: { name: "Inn", city: "Woburn" } })])).toBe("town");
  });

  it("goes by the longest stay", () => {
    const short = stay({ destination: { name: "Airport Inn", city: "Boston", country: "US" }, end: "2026-12-13T11:00:00Z" });
    const long = stay({ destination: { name: "Beach House", city: "Truro", setting: "beach" }, start: "2026-12-13T15:00:00Z", end: "2026-12-20T11:00:00Z" });
    expect(tripSetting([short, long])).toBe("beach");
    expect(tripSetting([long, short])).toBe("beach");
  });

  it("goes by an outing, else where the first journey arrives", () => {
    const show = { type: "activity", title: "Show", start: "2026-12-12T19:00:00Z", destination: { name: "Theatre", city: "Woburn", country: "US" } } as const;
    const out = { type: "flight", title: "XX 1 LHR to BOS", start: "2026-12-12T09:00:00Z", destination: { name: "Logan", city: "Boston", country: "US" } } as const;
    const back = { type: "flight", title: "XX 2 BOS to LHR", start: "2026-12-19T21:00:00Z", destination: { name: "Heathrow", city: "London", country: "GB" } } as const;
    expect(tripSetting([back, out, show])).toBe("town");
    expect(tripSetting([back, out])).toBe("city");
  });

  it("goes by what is still booked", () => {
    const cancelled = stay({ destination: { name: "Ski Lodge", city: "Zermatt", setting: "mountains" }, cancelledAt: "2026-12-01T00:00:00Z" } as Partial<ExtractedSegment>);
    const kept = stay({ destination: { name: "Inn", city: "Woburn" }, end: "2026-12-13T11:00:00Z" });
    expect(tripSetting([cancelled, kept])).toBe("town");
  });

  it("is none when no booking says", () => {
    expect(tripSetting([])).toBe("none");
    expect(tripSetting([stay({ destination: { name: "Somewhere" } })])).toBe("none");
  });
});
