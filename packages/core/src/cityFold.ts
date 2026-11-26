// Letters that are not an accented letter, so no accent comes off them.
const plainLetters: Record<string, string> = { ø: "o", æ: "ae", œ: "oe", ß: "ss", ł: "l", đ: "d", ð: "d", þ: "th", ı: "i" };

// A city's name with case, accents and spacing set aside ("Göteborg" is
// "goteborg"), as the city names table (cityNames.json) keys it.
export function foldCity(city: string): string {
  return city
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/[øæœßłđðþı]/g, (c) => plainLetters[c]!)
    .replace(/\s+/g, " ");
}
