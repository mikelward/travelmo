"use client";

import { accessBadge, allLoyalty, guessMe, loyaltyByPerson, loyaltySummary, type FoundLoyalty, type ProfileEntry, type TravelProfile } from "@travelmo/core";
import type { User } from "firebase/auth";
import Link from "next/link";
import { useState } from "react";
import { Dialog } from "@/components/BookingMenu";
import { SignInGate } from "@/components/SignInGate";
import { useAuth } from "@/lib/auth";
import { airportCodes, homeTownKey, correctionText, failedReadsText, homeLine, logged, parseAirportCodes, parseCorrection, saveCorrections, saveHomeAirports, useHomes, type Homes } from "@/lib/home";
import { firestore } from "@/lib/firebase";
import { useSaveForOffline } from "@/lib/offline";
import { setMe, usePeople } from "@/lib/people";
import { maxTrusted, removeFoundLoyalty, saveTrusted, setLoyaltyPerson, useSharedProfiles, useTravelProfile } from "@/lib/travelProfile";

const buttonClass =
  "rounded-lg border border-zinc-300 px-3 py-2  hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

// Each entry folds away; documents start folded, so a passport number is
// not on screen until asked for.
function Entries({ title, entries, open }: { title: string; entries: ProfileEntry[]; open: boolean }) {
  if (!entries.length) return null;
  return (
    <section className="mt-6">
      <h3 className="text-lg font-medium">{title}</h3>
      <ul className="mt-2 space-y-2">
        {entries.map((entry, i) => (
          <li key={`${entry.title}-${i}`}>
            <details open={open} className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
              <summary className="cursor-pointer font-medium">{entry.title}</summary>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                {entry.fields.map((field, j) => (
                  <div key={`${field.label}-${j}`} className="contents">
                    <dt className="text-zinc-600 dark:text-zinc-400">{field.label}</dt>
                    <dd className="break-words">{field.value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Who a membership belongs to: the owner, someone already named, or
// someone new.
function PersonDialog({
  program,
  number,
  people,
  onPick,
  onClose,
}: {
  program: string;
  number: string;
  people: string[];
  onPick: (person: string | undefined) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const pick = (person: string | undefined) => {
    onPick(person);
    onClose();
  };
  const option = "w-full rounded-lg px-2 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-900";
  return (
    <Dialog title={`Whose is ${program} ${number}?`} onClose={onClose}>
      <ul>
        <li>
          <button type="button" className={option} onClick={() => pick(undefined)}>
            Mine
          </button>
        </li>
        {people.map((p) => (
          <li key={p}>
            <button type="button" className={option} onClick={() => pick(p)}>
              {p}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) pick(name.trim());
        }}
      >
        <input
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          placeholder="Someone else"
          aria-label="Someone else's name"
          className="min-w-0 flex-1 rounded-lg border border-field bg-background px-3 py-2"
        />
        <button type="submit" disabled={!name.trim()} className={buttonClass}>
          Save
        </button>
      </form>
    </Dialog>
  );
}

// Every program at a glance: the number, the balance and the status, read
// from whatever labels the import gave them, the owner's first and then
// each other person's; the full entries fold below. On the owner's own
// profile each says whose it is.
function LoyaltyTable({ entries, ownUid }: { entries: ProfileEntry[]; ownUid?: string }) {
  const [editing, setEditing] = useState<{ program: string; number: string }>();
  const [error, setError] = useState<string>();
  if (!entries.length) return null;
  const groups = loyaltyByPerson(entries);
  const people = groups.flatMap((g) => (g.person ? [g.person] : []));
  const pick = async (person: string | undefined) => {
    if (!ownUid || !editing) return;
    setError(undefined);
    try {
      await setLoyaltyPerson(ownUid, editing, person);
    } catch (e) {
      console.error("Saving whose a loyalty number is failed", e);
      setError((e as Error).message);
    }
  };
  return (
    <section className="mt-6">
      <h3 className="text-lg font-medium">Loyalty programs</h3>
      {groups.map((group) => {
        const name = group.person ?? (ownUid ? "You" : "Theirs");
        // Named whenever any is someone else's.
        const named = groups.length > 1 || !!group.person;
        return (
          <div key={group.person ?? ""}>
            {named && <h4 className="mt-4 text-lg font-medium">{name}</h4>}
            <table className="mt-2 w-full" aria-label={named ? `Loyalty programs: ${name}` : "Loyalty programs"}>
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1 pr-2 font-normal">Program</th>
                  <th className="py-1 pr-2 font-normal">Account</th>
                  <th className="py-1 pr-2 text-right font-normal">Balance</th>
                  {/* Apart from Balance, which is right-aligned beside it. */}
                  <th className="py-1 pl-4 font-normal">Status</th>
                  {ownUid && <th className="w-8 py-1 font-normal"><span className="sr-only">Whose</span></th>}
                </tr>
              </thead>
              <tbody>
                {group.entries.map(loyaltySummary).map((r, i) => (
                  <tr key={`${r.title}-${i}`} className="border-t border-zinc-200 dark:border-zinc-800">
                    <td className="py-1 pr-2">{r.title}</td>
                    <td className="py-1 pr-2 break-all">{r.account ?? ""}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{r.balance ?? ""}</td>
                    <td className="py-1 pl-4">{r.nextStatus && r.status ? `${r.status} (next: ${r.nextStatus})` : (r.status ?? "")}</td>
                    {ownUid && (
                      <td className="py-1 text-right">
                        {r.account && (
                          <button
                            type="button"
                            aria-label={`Whose is ${r.title} ${r.account}?`}
                            onClick={() => setEditing({ program: r.title, number: r.account! })}
                            className="h-8 w-8 rounded-full text-lg leading-none text-muted hover:bg-zinc-100 dark:hover:bg-zinc-900"
                          >
                            ⋮
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      {error && <p className="mt-2 text-danger">{error}</p>}
      {editing && (
        <PersonDialog program={editing.program} number={editing.number} people={people} onPick={(p) => void pick(p)} onClose={() => setEditing(undefined)} />
      )}
    </section>
  );
}

// Loyalty numbers read from the owner's booking emails, each removable, as
// the extraction is sometimes wrong (SPEC "Loyalty from emails").
function FoundInEmails({ uid, found }: { uid: string; found: FoundLoyalty[] }) {
  const [error, setError] = useState<string>();
  if (!found.length) return null;
  const remove = async (f: FoundLoyalty) => {
    setError(undefined);
    try {
      await removeFoundLoyalty(uid, f);
    } catch (e) {
      console.error("Removing a loyalty number failed", e);
      setError((e as Error).message);
    }
  };
  return (
    <section className="mt-6">
      <h3 className="text-lg font-medium">Found in your emails</h3>
      <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800" aria-label="Found in your emails">
        {found.map((f) => (
          <li key={`${f.program}|${f.number}`} className="flex items-start justify-between gap-3 py-2">
            <div className="min-w-0">
              <p>
                {f.program} · <span className="break-all">{f.number}</span>
              </p>
              <p className="text-muted">From “{f.label ?? "a booking email"}”</p>
            </div>
            <button type="button" className={buttonClass} onClick={() => void remove(f)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-danger">{error}</p>}
    </section>
  );
}

// `ownUid` is set on the viewer's own profile, where what emails showed can be removed.
function ProfileSections({ profile, ownUid }: { profile: TravelProfile; ownUid?: string }) {
  const loyalty = allLoyalty(profile);
  return (
    <>
      <Entries title="Documents" entries={profile.documents} open={false} />
      <LoyaltyTable entries={loyalty} {...(ownUid ? { ownUid } : {})} />
      {ownUid && <FoundInEmails uid={ownUid} found={profile.foundLoyalty ?? []} />}
      <Entries title="Loyalty program details" entries={loyalty} open={false} />
      <Entries title="Travelers" entries={profile.travelers} open={false} />
    </>
  );
}

const hasDetails = (p: TravelProfile) => p.documents.length + p.loyalty.length + (p.foundLoyalty?.length ?? 0) + p.travelers.length > 0;

function SharingSection({ user, profile }: { user: User; profile: TravelProfile | null }) {
  const trusted = profile?.trustedEmails ?? [];
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const save = async (next: string[]) => {
    setBusy(true);
    setError(undefined);
    try {
      await saveTrusted(user, profile !== null, next, trusted);
      setEmail("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-10">
      <h2 className="text-lg font-medium">Shared with</h2>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        People you trust, such as a partner, can see everything on this page, documents included, when signed in with
        that email address. They can&apos;t change it.
      </p>
      {trusted.length > 0 && (
        <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
          {trusted.map((t) => (
            <li key={t} className="flex items-center justify-between gap-3 py-2">
              <span className="break-all">{t}</span>
              <button type="button" disabled={busy} className={buttonClass} onClick={() => save(trusted.filter((x) => x !== t))}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void save([...trusted, email]);
        }}
      >
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@example.com"
          aria-label="Email address to share with"
          className="min-w-0 flex-1 rounded-lg border border-field bg-background px-3 py-2"
        />
        <button type="submit" disabled={busy || !email.trim() || trusted.length >= maxTrusted} className={buttonClass}>
          Share
        </button>
      </form>
      {error && <p className="mt-3 text-danger">{error}</p>}
    </section>
  );
}

// Where home has been, worked out from the user's trips, with their own
// corrections: home is this town from this date.
function HomeSection({ user }: { user: User }) {
  const homes = useHomes(user);
  const [city, setCity] = useState("");
  const [country, setCountry] = useState("");
  const [from, setFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const save = async (operation: string, next: Parameters<typeof saveCorrections>[1]) => {
    setBusy(true);
    setError(undefined);
    try {
      await logged(operation, () => saveCorrections(user.uid, next));
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const add = async () => {
    const correction = parseCorrection(city, country, from);
    if (typeof correction === "string") return setError(correction);
    if (await save("adding one", [...(homes?.corrections ?? []).filter((c) => c.from !== correction.from), correction])) {
      setCity("");
      setCountry("");
      setFrom("");
    }
  };

  const line = homes && homeLine(homes.periods);
  return (
    <section className="mt-10">
      <h2 className="text-lg font-medium">Home</h2>
      {homes === undefined ? (
        <p className="mt-2 text-muted">Loading…</p>
      ) : (
        <>
          <p className="mt-2" data-testid="home-line">
            {line ?? "Not known yet."}
          </p>
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">Worked out from your trips.</p>
          {homes.failed > 0 && <p className="mt-2 text-danger">{failedReadsText(homes.failed)}</p>}
          {homes.corrections.length > 0 && (
            <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
              {homes.corrections.map((c) => (
                <li key={c.from} className="flex items-center justify-between gap-3 py-2">
                  <span>{correctionText(c)}</span>
                  <button
                    type="button"
                    disabled={busy}
                    className={buttonClass}
                    onClick={() => void save("removing one", homes.corrections.filter((x) => x.from !== c.from))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <HomeAirports user={user} homes={homes} />
          <form
            className="mt-3 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <span>Home is</span>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="City"
              aria-label="City"
              className="w-32 rounded-lg border border-field bg-background px-3 py-2"
            />
            <input
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="GB"
              aria-label="Country"
              className="w-32 rounded-lg border border-field bg-background px-3 py-2"
            />
            <span>from</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="From"
              className="rounded-lg border border-field bg-background px-3 py-2"
            />
            <button type="submit" disabled={busy || !city.trim() || !from} className={buttonClass}>
              Set
            </button>
          </form>
          {error && <p className="mt-3 text-danger">{error}</p>}
        </>
      )}
    </section>
  );
}

// Each home's airports and stations: a journey back into one ends a trip.
// Worked out from the trips that leave from them, unless chosen here.
function HomeAirports({ user, homes }: { user: User; homes: Homes }) {
  const [editing, setEditing] = useState<string>();
  const [codes, setCodes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // One row per home town, its latest period's airports.
  const towns = new Map<string, (typeof homes.periods)[number]>();
  for (const period of homes.periods) towns.set(homeTownKey(period.city, period.country), period);
  if (towns.size === 0) return null;
  const save = async (city: string, country: string | undefined) => {
    const parsed = parseAirportCodes(codes);
    if ("error" in parsed) return setError(parsed.error);
    setBusy(true);
    setError(undefined);
    try {
      const others = homes.chosen.filter((c) => homeTownKey(c.city, c.country) !== homeTownKey(city, country));
      await logged("choosing airports", () => saveHomeAirports(user.uid, [...others, { city, ...(country ? { country } : {}), airports: parsed.codes }]));
      setEditing(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3">
      <ul aria-label="Home airports" className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {[...towns].map(([key, period]) => {
          const shown = airportCodes(period);
          return (
            <li key={key} className="py-2">
              {editing === key ? (
                <form
                  className="flex flex-wrap items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save(period.city, period.country);
                  }}
                >
                  <label htmlFor="home-airports">{period.city} airports</label>
                  <input
                    id="home-airports"
                    value={codes}
                    onChange={(e) => setCodes(e.target.value)}
                    placeholder="SFO, SJC"
                    className="w-40 rounded-lg border border-field bg-background px-3 py-2"
                  />
                  <button type="submit" disabled={busy} className={buttonClass}>
                    Save
                  </button>
                  <button type="button" disabled={busy} className={buttonClass} onClick={() => setEditing(undefined)}>
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <span>
                    {period.city} airports: {shown.length > 0 ? shown.join(", ") : "none yet"}
                  </span>
                  <button
                    type="button"
                    className={buttonClass}
                    aria-label={`Edit ${period.city} airports`}
                    onClick={() => {
                      setEditing(key);
                      setCodes(shown.join(", "));
                      setError(undefined);
                    }}
                  >
                    Edit
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="mt-2 text-danger">{error}</p>}
    </div>
  );
}

function SharedWithYou({ user }: { user: User }) {
  const shared = useSharedProfiles(user)?.filter((p) => p.ownerUid !== user.uid);
  if (!shared?.length) return null;
  return (
    <section className="mt-10">
      <h2 className="text-lg font-medium">Shared with you</h2>
      {shared.map((p) => (
        <div key={p.ownerUid} className="mt-4">
          <p className="font-medium">From {p.ownerEmail ?? "someone who trusts you"}</p>
          {hasDetails(p) ? <ProfileSections profile={p} /> : <p className="mt-2 text-muted">Nothing in it yet.</p>}
        </div>
      ))}
    </section>
  );
}

// Who the user's bookings are for (SPEC "Travelers"): each person, the one
// taken to be the user marked, and "This is me" to say otherwise.
function PeopleSection({ user }: { user: User }) {
  const people = usePeople(user.uid);
  const [error, setError] = useState<string>();
  if (!people || people.length === 0) return null;
  const me = guessMe(people);
  return (
    <section className="mt-10">
      <h2 className="text-lg font-medium">People</h2>
      <p className="mt-1 text-muted">Who your bookings are for.</p>
      <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800" aria-label="People">
        {people.map((person) => (
          <li key={person.id} className="flex items-baseline justify-between gap-3 py-2">
            <span>
              {person.name}
              {person.id === me?.id && <span className="ml-2 text-xs font-medium uppercase tracking-wide text-muted">You</span>}
            </span>
            {person.id !== me?.id && (
              <button
                type="button"
                className="text-muted hover:underline"
                onClick={() =>
                  setMe(firestore(), user.uid, people, person.id).catch((e: Error) => {
                    console.error("Saving who the user is failed", e);
                    setError(e.message);
                  })
                }
              >
                This is me
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-danger">{error}</p>}
    </section>
  );
}

function ProfilePage({ user }: { user: User }) {
  const profile = useTravelProfile(user.uid);
  const { access } = useAuth();
  const email = user.email?.toLowerCase();
  const badge = access.state === "loading" ? undefined : accessBadge(access.admin, user.emailVerified ? email : undefined, access.record);
  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold">Travel profile</h1>
      {email && (
        <p className="mb-4 text-muted">
          Signed in as {email}
          {badge && <span className="ml-2 text-xs font-medium uppercase tracking-wide text-muted">{badge === "admin" ? "Admin" : "Invited"}</span>}
        </p>
      )}
      {profile === undefined && <p className="text-muted">Loading…</p>}
      {profile !== undefined && (!profile || !hasDetails(profile)) && (
        <p className="text-zinc-600 dark:text-zinc-400">
          Nothing imported yet. Upload a TripIt export in <Link href="/settings" className="underline">Settings</Link> to
          bring in your documents, loyalty programs and fellow travelers.
        </p>
      )}
      {profile && hasDetails(profile) && <ProfileSections profile={profile} ownUid={user.uid} />}
      <PeopleSection user={user} />
      <HomeSection user={user} />
      {profile !== undefined && <SharingSection user={user} profile={profile} />}
      <SharedWithYou user={user} />
    </>
  );
}

export default function Page() {
  useSaveForOffline();
  return <SignInGate>{(user) => <ProfilePage user={user} />}</SignInGate>;
}
