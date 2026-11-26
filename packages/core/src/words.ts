// Text as its words, for matching words rather than letters anywhere: a
// reference 1234 is not in "Room 12345", nor Rome in "Romeo Hotel". Case
// and accents set aside; anything not a letter or digit separates words;
// a number's leading zeros too, however a source pads it ("Gate 01" is
// "Gate 1", "UA0122" is "UA122").
export function wordsOf(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map(unpadded);
}

// A text's numbers without their leading zeros, where a number starts it or
// follows a letter ("0123" and "AB0123" are "123" and "AB123"); a lone zero
// stays.
export function unpadded(text: string): string {
  return text.replace(/(^|\p{L})0+(?=\p{N})/gu, "$1");
}

// Whether `text` says `phrase` as whole words, in order and together.
export function hasWords(text: string, phrase: string): boolean {
  const words = wordsOf(text);
  const wanted = wordsOf(phrase);
  if (wanted.length === 0) return false;
  for (let i = 0; i + wanted.length <= words.length; i++) {
    if (wanted.every((w, j) => words[i + j] === w)) return true;
  }
  return false;
}

// Whether each word of `query` starts a word of `text`, as a search box
// finds as you type: "par" finds Paris, "ba" finds BA but not Cuba.
export function hasWordStarts(text: string, query: string): boolean {
  const words = wordsOf(text);
  return wordsOf(query).every((q) => words.some((w) => w.startsWith(q)));
}
