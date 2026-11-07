// ISO 3166-1 alpha-2 codes, plus XK (Kosovo, in common use though not
// assigned), for choosing a place's country by hand. Names come from Intl
// where they are shown, so this is only the list of which codes are real.
export const countryCodes: readonly string[] = "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW".split(" ");

export const isCountryCode = (code: string) => countryCodes.includes(code.toUpperCase());

// Names people write that Intl does not: short forms, old names, parts of
// a country. "America" alone is left out: too often a continent.
const aliases: Record<string, string> = {
  usa: "US",
  us: "US",
  "united states of america": "US",
  uk: "GB",
  "great britain": "GB",
  britain: "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  "northern ireland": "GB",
  holland: "NL",
  "the netherlands": "NL",
  "czech republic": "CZ",
  "south korea": "KR",
  korea: "KR",
  russia: "RU",
  uae: "AE",
  "ivory coast": "CI",
  macedonia: "MK",
  burma: "MM",
  "republic of ireland": "IE",
};

const normalize = (name: string) =>
  name
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/\bsaint\b/g, "st")
    .replace(/[\s-]+/g, " ")
    .trim();

let byName: Map<string, string> | undefined;

// The ISO code for a country written by name in English ("Australia",
// "U.S.A.", "The Netherlands"), or nothing when the text is not one.
export function countryCodeOf(name: string): string | undefined {
  if (!byName) {
    byName = new Map(Object.entries(aliases));
    const display = new Intl.DisplayNames(["en"], { type: "region" });
    for (const code of countryCodes) {
      const label = display.of(code);
      if (label && label !== code) byName.set(normalize(label), code);
    }
  }
  const key = normalize(name);
  if (!key) return undefined;
  return byName.get(key) ?? byName.get(key.replace(/^the /, ""));
}

const regionNames = new Intl.DisplayNames("en", { type: "region" });

// A country's English name from its ISO code; a code Intl does not know
// (an import may hold any two letters) is shown as it is.
export function countryName(code: string): string {
  try {
    return regionNames.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}
