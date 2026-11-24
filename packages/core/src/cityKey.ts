// A city's name as the city table keys it: lower case, accents and
// punctuation gone, spaces single ("São Paulo" and "Sao  Paulo" are one).
export function cityKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
