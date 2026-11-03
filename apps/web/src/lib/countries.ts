const regionNames = new Intl.DisplayNames("en", { type: "region" });

// A country's English name from its ISO code.
export function countryName(code: string): string {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    // Not a code Intl accepts (an import may hold any two letters): shown as
    // it is.
    return code;
  }
}
