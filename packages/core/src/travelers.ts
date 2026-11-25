// Travelers: who a booking is for (SPEC "Travelers"). Emails write a
// passenger's name every way there is ("SMITH/JOHN MR", "Smith, John",
// "MRS JANE DOE"); these turn one into the form people write it in and tell
// whether two are the same person, so an import can match a name to someone
// the user already has, or add them.

// Words that say how to address someone, not who they are, wherever an
// airline or hotel puts them; the passenger-type codes some fares carry too.
const titles = new Set(["mr", "mrs", "ms", "miss", "mstr", "master", "mx", "dr", "prof", "sir", "dame", "madam", "rev", "chd", "inf", "adt"]);
// Titles an airline's record glues onto the given name ("SMITH/JOHNMR"),
// stripped when filing. "MS" isn't: too many given names end in it
// ("SHAMS"); a name written with it glued on matches the same name without
// it instead (gluedTitle).
const glued = /(MRS|MR|MSTR|MISS)$/;
const gluedTitles = ["mrs", "mr", "mstr", "miss", "ms"];

// Whether one first name is the other with a title glued on ("janems", "jane").
const gluedTitle = (a: string, b: string) => gluedTitles.some((t) => a === b + t || b === a + t);

const isTitle = (word: string) => titles.has(word.toLowerCase().replace(/\./g, ""));

// "JOHN" or "john" as "John", and each part of "o'neil-smith" or "mcdonald"'s
// first letter only: a name written in one case says nothing of its own.
function titleCase(word: string): string {
  return word.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_, sep: string, letter: string) => sep + letter.toUpperCase());
}

// A passenger's name as people write it, or undefined when it holds no
// name: "SMITH/JOHN MR", "Smith, John" and "Mr John Smith" are all "John
// Smith". A name written in mixed case keeps its case ("Ronan McDonald").
export function canonicalName(raw: string): string | undefined {
  let text = raw.replace(/\s+/g, " ").trim();
  if (!/\p{L}/u.test(text)) return undefined;
  let given: string;
  let family: string;
  const slash = text.match(/^([^/]+)\/(.+)$/);
  const comma = text.match(/^([^,]+),(.+)$/);
  if (slash) {
    family = slash[1]!.trim();
    given = slash[2]!.trim();
    // "JOHNMR": a title the record glued on, when something is left of the name.
    const words = given.split(" ");
    const last = words[words.length - 1]!;
    const stripped = last.replace(glued, "");
    if (last === last.toUpperCase() && stripped !== last && stripped.length >= 2) words[words.length - 1] = stripped;
    given = words.join(" ");
  } else if (comma) {
    family = comma[1]!.trim();
    given = comma[2]!.trim();
  } else {
    given = text;
    family = "";
  }
  text = [given, family].join(" ");
  const words = text.split(" ").filter((w) => w && !isTitle(w));
  if (words.length === 0) return undefined;
  const oneCase = text === text.toUpperCase() || text === text.toLowerCase();
  return words.map((w) => (oneCase ? titleCase(w) : w)).join(" ");
}

// Latin letters with accents and the letters they are compared as, the same
// table as Travelers.kt's, so both apps match names alike.
const accented = "àáâãäåāăąạảấầẩẫậắằẳẵặçćčďđèéêëēėęěẹẻẽếềểễệìíîïīįỉịñńňòóôõöøōőơọỏốồổỗộớờởỡợŕřśšşťùúûüūůűųưụủứừửữựýÿỳỵỷỹźżž";
const plain = "aaaaaaaaaaaaaaaaaaaaacccddeeeeeeeeeeeeeeeeiiiiiiiinnnooooooooooooooooooooorrssstuuuuuuuuuuuuuuuuyyyyyyzzz";

// A name's words as compared: lowercase, accents and punctuation gone.
function nameWords(name: string): string[] {
  return [...name.toLowerCase()]
    .map((c) => {
      const i = accented.indexOf(c);
      return i >= 0 ? plain[i]! : c;
    })
    .join("")
    .replace(/[^\p{L}\s-]/gu, "")
    .split(/[\s-]+/)
    .filter(Boolean);
}

// Whether two names are one person's: the same words, or the same first and
// last ones (a middle name written or not), or the same last with one first
// an initial of the other ("J Smith" is "John Smith"). Case, accents and
// titles don't count.
export function sameTraveler(a: string, b: string): boolean {
  const x = nameWords(canonicalName(a) ?? a);
  const y = nameWords(canonicalName(b) ?? b);
  if (x.length === 0 || y.length === 0) return false;
  if (x.join(" ") === y.join(" ")) return true;
  if (x.length < 2 || y.length < 2) return false;
  if (x[x.length - 1] !== y[y.length - 1]) return false;
  const [fx, fy] = [x[0]!, y[0]!];
  return fx === fy || gluedTitle(fx, fy) || (fx.length === 1 && fy.startsWith(fx)) || (fy.length === 1 && fx.startsWith(fy));
}

// Someone the user has seen on their bookings: the name they are shown by,
// every other way it was written, and whether it is the user themself.
export type Person = { id: string; name: string; aliases?: readonly string[]; me?: boolean };

// The person a name is, among those known, or undefined: by their name or
// any alias (sameTraveler), the user themself first when it could be either.
export function findPerson<P extends Person>(people: readonly P[], raw: string): P | undefined {
  const name = canonicalName(raw);
  if (!name) return undefined;
  const matches = people.filter((p) => [p.name, ...(p.aliases ?? [])].some((known) => sameTraveler(known, name)));
  return matches.find((p) => p.me) ?? matches[0];
}

const firstWord = (name: string) => (name.split(" ")[0] ?? "").toLowerCase();

// Whether `name` is the better spelling of `kept`, one person's: a whole
// first name over an initial, and none with a title glued on over one with.
function fuller(name: string, kept: string): boolean {
  const [a, b] = [firstWord(name), firstWord(kept)];
  if (gluedTitle(a, b)) return a.length < b.length;
  return a.length > b.length;
}

// The most travelers a booking keeps, as the stored schema allows.
export const maxTravelers = 20;

// A booking's travelers as filed: each name as people write it, once
// (sameTraveler), in the email's order, the first `maxTravelers` of them
// (several emails' together can name more); undefined when none is a name.
export function canonicalTravelers(raw: readonly string[] | undefined): string[] | undefined {
  const names: string[] = [];
  for (const each of raw ?? []) {
    if (names.length === maxTravelers) break;
    const name = canonicalName(each);
    if (!name) continue;
    // One name for each person, the fuller spelling kept: "John Smith"
    // takes "J Smith"'s place, so "Jane Smith" then stays apart.
    const i = names.findIndex((n) => sameTraveler(n, name));
    if (i < 0) names.push(name);
    else if (fuller(name, names[i]!)) names[i] = name;
  }
  return names.length > 0 ? names : undefined;
}
