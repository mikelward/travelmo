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
export type Person = { id: string; name: string; aliases?: readonly string[] | undefined; me?: boolean | undefined };

// A name's first and last words as compared, when it has both.
function firstAndLast(name: string): [string, string] | undefined {
  const words = nameWords(canonicalName(name) ?? name);
  return words.length < 2 ? undefined : [words[0]!, words[words.length - 1]!];
}

// Whether two names are one person's only through an initial ("J Smith"
// and "John Smith").
function throughInitial(a: string, b: string): boolean {
  const [x, y] = [firstAndLast(a), firstAndLast(b)];
  return !!x && !!y && sameTraveler(a, b) && x[0] !== y[0] && (x[0].length === 1 || y[0].length === 1);
}

// Whether two names are surely two people's: one last name, two whole
// first names ("John Smith" and "Jane Smith").
function twoPeople(a: string, b: string): boolean {
  const [x, y] = [firstAndLast(a), firstAndLast(b)];
  return !!x && !!y && x[1] === y[1] && x[0].length > 1 && y[0].length > 1 && !sameTraveler(a, b);
}

// The person a name is, among those known, or undefined: by their name or
// any alias (sameTraveler), the user themself first when it could be either.
// Through an initial only when none of their spellings is surely someone
// else's, so "J Smith" known as John doesn't take Jane too.
export function findPerson<P extends Person>(people: readonly P[], raw: string): P | undefined {
  const name = canonicalName(raw);
  if (!name) return undefined;
  const matches = people.filter((p) => {
    const spellings = [p.name, ...(p.aliases ?? [])];
    if (spellings.some((known) => sameTraveler(known, name) && !throughInitial(known, name))) return true;
    return spellings.some((known) => sameTraveler(known, name)) && !spellings.some((known) => twoPeople(known, name));
  });
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

// One booking as filing it teaches about people: whom it names now, and
// whom it named before this email (already counted), if it was filed
// already.
export type NamedBooking = { travelers: readonly string[]; before?: readonly string[] | undefined };

// What filing bookings teaches about the user's people: each traveler is
// someone already known (findPerson), who gains the spelling if it is new,
// or someone new. A person counts one more booking for each booking that
// newly names them: once however many of its names are theirs, and not
// again for one that named them before (as findPerson finds them), which still teaches
// its new spellings (someone not yet known is new, and counted, either way:
// a booking filed before people were kept), so a whole first name learned for an initial keeps two
// people apart from then on. `direct` says the email came straight to the
// user, not forwarded. Returns only the people it changed or added, each
// once.
export function notePeople<P extends Person & { bookings: number; direct: number; aliases: string[]; createdAt: string; updatedAt: string }>(
  people: readonly P[],
  bookings: readonly NamedBooking[],
  options: { direct: boolean; timestamp: string; newId: () => string },
): P[] {
  const known = [...people];
  const changed = new Map<string, P>();
  const put = (before: P | undefined, next: P) => {
    changed.set(next.id, next);
    if (before) known[known.indexOf(before)] = next;
    else known.push(next);
  };
  for (const booking of bookings) {
    // Whom it named before, as people (findPerson), so an initial before
    // doesn't hide someone else after.
    const before = new Set((booking.before ?? []).flatMap((b) => findPerson(known, b)?.id ?? []));
    const counted = new Set<string>();
    for (const raw of booking.travelers) {
      const name = canonicalName(raw);
      if (!name) continue;
      const found = findPerson(known, name);
      if (!found) {
        const person = { id: options.newId(), name, aliases: [], bookings: 1, direct: options.direct ? 1 : 0, createdAt: options.timestamp, updatedAt: options.timestamp } as unknown as P;
        put(undefined, person);
        counted.add(person.id);
        continue;
      }
      const spellings = [found.name, ...found.aliases];
      const aliases = spellings.includes(name) ? found.aliases : [...found.aliases, name].slice(-50);
      const count = !before.has(found.id) && !counted.has(found.id);
      counted.add(found.id);
      if (!count && aliases === found.aliases) continue;
      put(found, {
        ...found,
        aliases,
        bookings: found.bookings + (count ? 1 : 0),
        direct: found.direct + (count && options.direct ? 1 : 0),
        updatedAt: options.timestamp,
      });
    }
  }
  return [...changed.values()];
}

// Which of the user's people is the user: the one they said, else the
// one most often named on emails sent straight to them, then on any
// booking; none before any booking named anyone.
export function guessMe<P extends Person & { bookings: number; direct: number }>(people: readonly P[]): P | undefined {
  const said = people.find((p) => p.me);
  if (said) return said;
  const ranked = [...people].sort((a, b) => b.direct - a.direct || b.bookings - a.bookings || a.name.localeCompare(b.name));
  return ranked[0];
}
