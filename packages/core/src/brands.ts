import type { ExtractedSegment, SegmentType } from "./schema";

// The brands a booking's logo can name, as the traveler knows them: a hotel
// brand ("Hampton by Hilton"), not its group or loyalty program, each
// pointing to its parent for a logo when it has none of its own; rental
// companies, ride apps, rail operators, booking and ticket sites. A booking
// site (`site`) is the brand only when nothing it sells names one. Airlines
// are airlines.ts's. Mirrored in the Android app's core (Brands.kt): keep
// the two the same.
export type Brand = { id: string; name: string; types?: readonly SegmentType[]; site?: boolean; parent?: string; aliases: readonly string[] };

export const brands: readonly Brand[] = [
  { id: "airbnb", name: "Airbnb", types: ["lodging", "activity", "other"], site: true, aliases: ["Airbnb"] },
  { id: "vrbo", name: "Vrbo", types: ["lodging"], site: true, aliases: ["Vrbo", "HomeAway"] },
  { id: "booking", name: "Booking.com", site: true, aliases: ["Booking.com"] },
  { id: "expedia", name: "Expedia", site: true, aliases: ["Expedia"] },
  { id: "hotelscom", name: "Hotels.com", types: ["lodging"], site: true, aliases: ["Hotels.com"] },
  { id: "tripcom", name: "Trip.com", site: true, aliases: ["Trip.com"] },
  { id: "agoda", name: "Agoda", site: true, aliases: ["Agoda"] },
  { id: "hostelworld", name: "Hostelworld", types: ["lodging"], site: true, aliases: ["Hostelworld"] },
  { id: "tripadvisor", name: "Tripadvisor", site: true, aliases: ["Tripadvisor", "Trip Advisor"] },
  { id: "trivago", name: "trivago", types: ["lodging"], site: true, aliases: ["trivago"] },
  { id: "hilton", name: "Hilton", types: ["lodging"], aliases: ["Hilton", "Hilton Hotels & Resorts"] },
  { id: "hampton", name: "Hampton by Hilton", types: ["lodging"], parent: "hilton", aliases: ["Hampton Inn", "Hampton by Hilton"] },
  { id: "doubletree", name: "DoubleTree by Hilton", types: ["lodging"], parent: "hilton", aliases: ["DoubleTree"] },
  { id: "embassysuites", name: "Embassy Suites", types: ["lodging"], parent: "hilton", aliases: ["Embassy Suites"] },
  { id: "conrad", name: "Conrad", types: ["lodging"], parent: "hilton", aliases: ["Conrad Hotels", "Conrad"] },
  { id: "waldorfastoria", name: "Waldorf Astoria", types: ["lodging"], parent: "hilton", aliases: ["Waldorf Astoria"] },
  { id: "curio", name: "Curio Collection", types: ["lodging"], parent: "hilton", aliases: ["Curio Collection"] },
  { id: "canopy", name: "Canopy by Hilton", types: ["lodging"], parent: "hilton", aliases: ["Canopy by Hilton"] },
  { id: "homewoodsuites", name: "Homewood Suites", types: ["lodging"], parent: "hilton", aliases: ["Homewood Suites"] },
  { id: "home2suites", name: "Home2 Suites", types: ["lodging"], parent: "hilton", aliases: ["Home2 Suites"] },
  { id: "tru", name: "Tru by Hilton", types: ["lodging"], parent: "hilton", aliases: ["Tru by Hilton"] },
  { id: "tapestry", name: "Tapestry Collection", types: ["lodging"], parent: "hilton", aliases: ["Tapestry Collection"] },
  { id: "motto", name: "Motto by Hilton", types: ["lodging"], parent: "hilton", aliases: ["Motto by Hilton"] },
  { id: "spark", name: "Spark by Hilton", types: ["lodging"], parent: "hilton", aliases: ["Spark by Hilton"] },
  { id: "tempo", name: "Tempo by Hilton", types: ["lodging"], parent: "hilton", aliases: ["Tempo by Hilton"] },
  { id: "signia", name: "Signia by Hilton", types: ["lodging"], parent: "hilton", aliases: ["Signia by Hilton"] },
  { id: "lxr", name: "LXR Hotels", types: ["lodging"], parent: "hilton", aliases: ["LXR Hotels"] },
  { id: "marriott", name: "Marriott", types: ["lodging"], aliases: ["Marriott", "JW Marriott"] },
  { id: "ritzcarlton", name: "The Ritz-Carlton", types: ["lodging"], parent: "marriott", aliases: ["Ritz-Carlton", "Ritz Carlton"] },
  { id: "courtyard", name: "Courtyard by Marriott", types: ["lodging"], parent: "marriott", aliases: ["Courtyard"] },
  { id: "sheraton", name: "Sheraton", types: ["lodging"], parent: "marriott", aliases: ["Sheraton"] },
  { id: "westin", name: "Westin", types: ["lodging"], parent: "marriott", aliases: ["Westin"] },
  { id: "whotels", name: "W Hotels", types: ["lodging"], parent: "marriott", aliases: ["W Hotels"] },
  { id: "stregis", name: "St. Regis", types: ["lodging"], parent: "marriott", aliases: ["St. Regis", "St Regis"] },
  { id: "renaissance", name: "Renaissance Hotels", types: ["lodging"], parent: "marriott", aliases: ["Renaissance Hotel", "Renaissance Hotels"] },
  { id: "lemeridien", name: "Le Méridien", types: ["lodging"], parent: "marriott", aliases: ["Le Méridien", "Le Meridien"] },
  { id: "aloft", name: "Aloft", types: ["lodging"], parent: "marriott", aliases: ["Aloft"] },
  { id: "moxy", name: "Moxy", types: ["lodging"], parent: "marriott", aliases: ["Moxy"] },
  { id: "fairfield", name: "Fairfield by Marriott", types: ["lodging"], parent: "marriott", aliases: ["Fairfield Inn", "Fairfield by Marriott"] },
  { id: "residenceinn", name: "Residence Inn", types: ["lodging"], parent: "marriott", aliases: ["Residence Inn"] },
  { id: "springhill", name: "SpringHill Suites", types: ["lodging"], parent: "marriott", aliases: ["SpringHill Suites"] },
  { id: "autograph", name: "Autograph Collection", types: ["lodging"], parent: "marriott", aliases: ["Autograph Collection"] },
  { id: "fourpoints", name: "Four Points", types: ["lodging"], parent: "marriott", aliases: ["Four Points"] },
  { id: "achotels", name: "AC Hotels", types: ["lodging"], parent: "marriott", aliases: ["AC Hotel", "AC Hotels"] },
  { id: "towneplace", name: "TownePlace Suites", types: ["lodging"], parent: "marriott", aliases: ["TownePlace Suites"] },
  { id: "gaylord", name: "Gaylord Hotels", types: ["lodging"], parent: "marriott", aliases: ["Gaylord"] },
  { id: "deltahotels", name: "Delta Hotels", types: ["lodging"], parent: "marriott", aliases: ["Delta Hotels"] },
  { id: "luxurycollection", name: "The Luxury Collection", types: ["lodging"], parent: "marriott", aliases: ["Luxury Collection"] },
  { id: "element", name: "Element", types: ["lodging"], parent: "marriott", aliases: ["Element by Westin", "Element Hotel"] },
  { id: "ihg", name: "IHG", types: ["lodging"], aliases: ["IHG", "IHG Hotels & Resorts"] },
  { id: "holidayinnexpress", name: "Holiday Inn Express", types: ["lodging"], parent: "ihg", aliases: ["Holiday Inn Express"] },
  { id: "holidayinn", name: "Holiday Inn", types: ["lodging"], parent: "ihg", aliases: ["Holiday Inn"] },
  { id: "crowneplaza", name: "Crowne Plaza", types: ["lodging"], parent: "ihg", aliases: ["Crowne Plaza"] },
  { id: "intercontinental", name: "InterContinental", types: ["lodging"], parent: "ihg", aliases: ["InterContinental"] },
  { id: "kimpton", name: "Kimpton", types: ["lodging"], parent: "ihg", aliases: ["Kimpton"] },
  { id: "hotelindigo", name: "Hotel Indigo", types: ["lodging"], parent: "ihg", aliases: ["Hotel Indigo"] },
  { id: "staybridge", name: "Staybridge Suites", types: ["lodging"], parent: "ihg", aliases: ["Staybridge Suites"] },
  { id: "candlewood", name: "Candlewood Suites", types: ["lodging"], parent: "ihg", aliases: ["Candlewood Suites"] },
  { id: "voco", name: "voco", types: ["lodging"], parent: "ihg", aliases: ["voco"] },
  { id: "even", name: "EVEN Hotels", types: ["lodging"], parent: "ihg", aliases: ["EVEN Hotels"] },
  { id: "avid", name: "avid hotels", types: ["lodging"], parent: "ihg", aliases: ["avid hotels"] },
  { id: "regent", name: "Regent", types: ["lodging"], parent: "ihg", aliases: ["Regent Hotels"] },
  { id: "wyndham", name: "Wyndham", types: ["lodging"], aliases: ["Wyndham"] },
  { id: "ramada", name: "Ramada", types: ["lodging"], parent: "wyndham", aliases: ["Ramada"] },
  { id: "daysinn", name: "Days Inn", types: ["lodging"], parent: "wyndham", aliases: ["Days Inn"] },
  { id: "super8", name: "Super 8", types: ["lodging"], parent: "wyndham", aliases: ["Super 8"] },
  { id: "laquinta", name: "La Quinta", types: ["lodging"], parent: "wyndham", aliases: ["La Quinta"] },
  { id: "microtel", name: "Microtel", types: ["lodging"], parent: "wyndham", aliases: ["Microtel"] },
  { id: "wingate", name: "Wingate", types: ["lodging"], parent: "wyndham", aliases: ["Wingate"] },
  { id: "baymont", name: "Baymont", types: ["lodging"], parent: "wyndham", aliases: ["Baymont"] },
  { id: "howardjohnson", name: "Howard Johnson", types: ["lodging"], parent: "wyndham", aliases: ["Howard Johnson"] },
  { id: "hawthorn", name: "Hawthorn Suites", types: ["lodging"], parent: "wyndham", aliases: ["Hawthorn Suites"] },
  { id: "trademark", name: "Trademark Collection", types: ["lodging"], parent: "wyndham", aliases: ["Trademark Collection"] },
  { id: "radisson", name: "Radisson", types: ["lodging"], aliases: ["Radisson", "Radisson Blu", "Radisson RED"] },
  { id: "parkinn", name: "Park Inn by Radisson", types: ["lodging"], parent: "radisson", aliases: ["Park Inn by Radisson", "Park Inn"] },
  { id: "parkplaza", name: "Park Plaza", types: ["lodging"], parent: "radisson", aliases: ["Park Plaza"] },
  { id: "countryinn", name: "Country Inn & Suites", types: ["lodging"], parent: "radisson", aliases: ["Country Inn & Suites", "Country Inn and Suites"] },
  { id: "accor", name: "Accor", types: ["lodging"], aliases: ["Accor", "ALL Accor"] },
  { id: "novotel", name: "Novotel", types: ["lodging"], parent: "accor", aliases: ["Novotel"] },
  { id: "ibis", name: "ibis", types: ["lodging"], parent: "accor", aliases: ["ibis"] },
  { id: "mercure", name: "Mercure", types: ["lodging"], parent: "accor", aliases: ["Mercure"] },
  { id: "sofitel", name: "Sofitel", types: ["lodging"], parent: "accor", aliases: ["Sofitel"] },
  { id: "pullman", name: "Pullman", types: ["lodging"], parent: "accor", aliases: ["Pullman"] },
  { id: "swissotel", name: "Swissôtel", types: ["lodging"], parent: "accor", aliases: ["Swissôtel", "Swissotel"] },
  { id: "movenpick", name: "Mövenpick", types: ["lodging"], parent: "accor", aliases: ["Mövenpick", "Movenpick"] },
  { id: "fairmont", name: "Fairmont", types: ["lodging"], parent: "accor", aliases: ["Fairmont"] },
  { id: "raffles", name: "Raffles", types: ["lodging"], parent: "accor", aliases: ["Raffles"] },
  { id: "adagio", name: "Adagio", types: ["lodging"], parent: "accor", aliases: ["Adagio"] },
  { id: "mgallery", name: "MGallery", types: ["lodging"], parent: "accor", aliases: ["MGallery"] },
  { id: "25hours", name: "25hours Hotels", types: ["lodging"], parent: "accor", aliases: ["25hours"] },
  { id: "sixt", name: "SIXT", types: ["car_rental"], aliases: ["Sixt"] },
  { id: "enterprise", name: "Enterprise", types: ["car_rental"], aliases: ["Enterprise", "Enterprise Rent-A-Car"] },
  { id: "turo", name: "Turo", types: ["car_rental"], aliases: ["Turo"] },
  { id: "zipcar", name: "Zipcar", types: ["car_rental"], aliases: ["Zipcar"] },
  { id: "uber", name: "Uber", types: ["car_rental", "other"], aliases: ["Uber"] },
  { id: "lyft", name: "Lyft", types: ["car_rental", "other"], aliases: ["Lyft"] },
  { id: "bolt", name: "Bolt", types: ["car_rental", "other"], aliases: ["Bolt"] },
  { id: "grab", name: "Grab", types: ["car_rental", "other"], aliases: ["Grab"] },
  { id: "cabify", name: "Cabify", types: ["car_rental", "other"], aliases: ["Cabify"] },
  { id: "eurostar", name: "Eurostar", types: ["train"], aliases: ["Eurostar"] },
  { id: "trainline", name: "Trainline", types: ["train", "bus"], site: true, aliases: ["Trainline"] },
  { id: "amtrak", name: "Amtrak", types: ["train"], aliases: ["Amtrak"] },
  { id: "deutschebahn", name: "Deutsche Bahn", types: ["train", "bus"], aliases: ["Deutsche Bahn", "DB Fernverkehr", "DB Bahn"] },
  { id: "sncf", name: "SNCF", types: ["train", "bus"], aliases: ["SNCF", "TGV INOUI"] },
  { id: "ouigo", name: "OUIGO", types: ["train"], aliases: ["Ouigo"] },
  { id: "obb", name: "ÖBB", types: ["train", "bus"], aliases: ["ÖBB", "OEBB", "Nightjet"] },
  { id: "sbb", name: "SBB", types: ["train"], aliases: ["SBB", "SBB CFF FFS"] },
  { id: "renfe", name: "Renfe", types: ["train"], aliases: ["Renfe"] },
  { id: "trenitalia", name: "Trenitalia", types: ["train"], aliases: ["Trenitalia"] },
  { id: "italo", name: "Italo", types: ["train"], aliases: ["Italo", "Italo Treno"] },
  { id: "nationalrail", name: "National Rail", types: ["train"], aliases: ["National Rail"] },
  { id: "lner", name: "LNER", types: ["train"], aliases: ["LNER"] },
  { id: "avanti", name: "Avanti West Coast", types: ["train"], aliases: ["Avanti West Coast"] },
  { id: "flixbus", name: "FlixBus", types: ["bus", "train"], aliases: ["FlixBus", "Flix", "FlixTrain"] },
  { id: "opentable", name: "OpenTable", types: ["activity", "other"], site: true, aliases: ["OpenTable"] },
  { id: "getyourguide", name: "GetYourGuide", types: ["activity", "other"], site: true, aliases: ["GetYourGuide"] },
  { id: "klook", name: "Klook", types: ["activity", "other"], site: true, aliases: ["Klook"] },
  { id: "eventbrite", name: "Eventbrite", types: ["activity", "other"], site: true, aliases: ["Eventbrite"] },
  { id: "ticketmaster", name: "Ticketmaster", types: ["activity", "other"], site: true, aliases: ["Ticketmaster"] },
  { id: "seatgeek", name: "SeatGeek", types: ["activity", "other"], site: true, aliases: ["SeatGeek"] },
  { id: "stubhub", name: "StubHub", types: ["activity", "other"], site: true, aliases: ["StubHub"] },
  { id: "disneyland", name: "Disney Parks", types: ["activity", "lodging", "other"], aliases: ["Disneyland", "Walt Disney World", "Disney World", "Disneyland Paris"] },
  { id: "universal", name: "Universal Studios", types: ["activity", "lodging", "other"], aliases: ["Universal Studios", "Universal Orlando"] },
];

const fold = (text: string) => ` ${text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

type FoldedBrand = { brand: Brand; foldedAliases: readonly string[] };
let foldedBrandsCache: { nonSite: FoldedBrand[]; site: FoldedBrand[] } | undefined;

function getFoldedBrands(): { nonSite: FoldedBrand[]; site: FoldedBrand[] } {
  if (!foldedBrandsCache) {
    const nonSite: FoldedBrand[] = [];
    const site: FoldedBrand[] = [];
    for (const brand of brands) {
      const foldedAliases = brand.aliases.map(fold).filter((a) => a.trim().length > 0);
      if (foldedAliases.length === 0) continue;
      (brand.site ? site : nonSite).push({ brand, foldedAliases });
    }
    foldedBrandsCache = { nonSite, site };
  }
  return foldedBrandsCache;
}

// The brand a booking names, if any: the one whose name or alias its title
// or provider says, as whole words, the longest found (Hampton by Hilton
// rather than Hilton), a booking site only when no other is. Only brands of
// the booking's kind: a hotel brand never names a flight.
export function bookingBrand(segment: Pick<ExtractedSegment, "type" | "title" | "provider">): Brand | undefined {
  const title = fold(segment.title);
  const provider = segment.provider ? fold(segment.provider) : "";
  const { nonSite, site } = getFoldedBrands();
  for (const group of [nonSite, site]) {
    let best: { brand: Brand; length: number } | undefined;
    for (const { brand, foldedAliases } of group) {
      if (brand.types && !brand.types.includes(segment.type)) continue;
      for (const wanted of foldedAliases) {
        if ((title.includes(wanted) || (provider !== "" && provider.includes(wanted))) && (!best || wanted.length > best.length)) {
          best = { brand, length: wanted.length };
        }
      }
    }
    if (best) return best.brand;
  }
  return undefined;
}

// The brands whose logo a booking can show, its own first, then its parent's.
export function brandLogoIds(segment: Pick<ExtractedSegment, "type" | "title" | "provider">): string[] {
  const brand = bookingBrand(segment);
  return brand ? [brand.id, ...(brand.parent ? [brand.parent] : [])] : [];
}
