"use client";

import { findPerson, guessMe, type PersonDoc, type ProfileEntry, type TravelProfile } from "@travelmo/core";
import type { User } from "firebase/auth";
import Link from "next/link";
import { useState } from "react";
import { Dialog } from "@/components/BookingMenu";
import { api } from "@/lib/api";
import { firestore } from "@/lib/firebase";
import {
  airportCodes,
  correctionText,
  failedReadsText,
  homeLine,
  homeTownKey,
  logged,
  longStayText,
  parseAirportCodes,
  parseCorrection,
  saveCorrections,
  saveHomeAirports,
  saveNotHome,
  type Homes,
} from "@/lib/home";
import { mergePeople, setMe } from "@/lib/people";
import { maxTrusted, saveTrusted } from "@/lib/travelProfile";
import { useProfile } from "@/lib/trips";

const buttonClass =
  "rounded-lg border border-zinc-300 px-3 py-2 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

function FoldingEntries({ entries }: { entries: ProfileEntry[] }) {
  return (
    <ul className="mt-3 space-y-2">
      {entries.map((entry, i) => (
        <li key={`${entry.title}-${i}`}>
          <details className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <summary className="cursor-pointer font-medium">{entry.title}</summary>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              {entry.fields.map((field, j) => (
                <div key={`${field.label}-${j}`} className="contents">
                  <dt className="text-muted">{field.label}</dt>
                  <dd className="break-words">{field.value}</dd>
                </div>
              ))}
            </dl>
          </details>
        </li>
      ))}
    </ul>
  );
}

// Which of the user's people someone is: "Who is this?" on a loyalty
// holder's name and "Same person as…" on a person both pick from it.
export function PeoplePicker({
  title,
  people,
  except,
  onPick,
  onClose,
}: {
  title: string;
  people: readonly PersonDoc[];
  except?: string;
  onPick: (personId: string) => void;
  onClose: () => void;
}) {
  const me = guessMe(people);
  const listed = [...people.filter((p) => p.id === me?.id), ...people.filter((p) => p.id !== me?.id)].filter((p) => p.id !== except);
  const option = "w-full rounded-lg px-2 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-900";
  return (
    <Dialog title={title} onClose={onClose}>
      <ul>
        {listed.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className={option}
              onClick={() => {
                onPick(p.id);
                onClose();
              }}
            >
              {p.name}
              {p.id === me?.id && <span className="ml-2 text-xs font-medium uppercase tracking-wide text-muted">You</span>}
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

export function PeopleSection({ user, people, imported }: { user: User; people: PersonDoc[] | undefined; imported: ProfileEntry[] }) {
  const [error, setError] = useState<string>();
  const [changingMe, setChangingMe] = useState(false);
  const [merging, setMerging] = useState<PersonDoc>();
  const list = people ?? [];
  const me = guessMe(list);
  const others = me ? list.filter((p) => p.id !== me.id) : list;

  const detailsByPerson = new Map<string, ProfileEntry[]>();
  const unmatched: ProfileEntry[] = [];
  for (const entry of imported) {
    const matched = list.length > 0 ? findPerson(list, entry.title) : undefined;
    if (matched) {
      detailsByPerson.set(matched.id, [...(detailsByPerson.get(matched.id) ?? []), entry]);
    } else {
      unmatched.push(entry);
    }
  }

  const renderDetails = (personId: string) => {
    const extra = detailsByPerson.get(personId) ?? [];
    if (extra.length === 0) return null;
    return (
      <div className="mt-2 space-y-2">
        {extra.map((entry, idx) => (
          <details key={`${entry.title}-${idx}`} className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <summary className="cursor-pointer font-medium text-muted">Imported details</summary>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              {entry.fields.map((field, j) => (
                <div key={`${field.label}-${j}`} className="contents">
                  <dt className="text-muted">{field.label}</dt>
                  <dd className="break-words">{field.value}</dd>
                </div>
              ))}
            </dl>
          </details>
        ))}
      </div>
    );
  };

  return (
    <section>
      <h2 className="text-lg font-medium">People</h2>
      <p className="mt-1 text-muted">Who your bookings are for.</p>
      {list.length === 0 && unmatched.length === 0 && <p className="mt-3 text-muted">No people yet.</p>}
      {me && (
        <div className="mt-3 rounded-lg border border-zinc-200 px-3 py-3 dark:border-zinc-800" aria-label="You">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted">You</span>
                <span>{me.name}</span>
              </div>
              {me.aliases.length > 0 && <p className="mt-1 text-muted">Also: {me.aliases.join(", ")}</p>}
            </div>
            {list.length > 1 && (
              <button type="button" className="shrink-0 text-muted hover:underline" onClick={() => setChangingMe(true)}>
                Change
              </button>
            )}
          </div>
          {renderDetails(me.id)}
        </div>
      )}
      {others.length > 0 && (
        <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800" aria-label="People">
          {others.map((person) => (
            <li key={person.id} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <div>{person.name}</div>
                  {person.aliases.length > 0 && <p className="mt-1 text-muted">Also: {person.aliases.join(", ")}</p>}
                </div>
                <span className="flex shrink-0 gap-4">
                  {me && (
                    <button
                      type="button"
                      className="text-muted hover:underline"
                      onClick={() =>
                        mergePeople(firestore(), user.uid, list, person.id, me.id).catch((e: Error) => {
                          console.error("Merging two people failed", e);
                          setError(e.message);
                        })
                      }
                    >
                      Also me
                    </button>
                  )}
                  {others.length > 1 && (
                    <button type="button" className="text-muted hover:underline" onClick={() => setMerging(person)}>
                      Same person as…
                    </button>
                  )}
                </span>
              </div>
              {renderDetails(person.id)}
            </li>
          ))}
        </ul>
      )}
      {unmatched.length > 0 && (
        <div className={list.length > 0 ? "mt-6" : ""}>
          {list.length > 0 && <h3 className="text-lg font-medium">From imports</h3>}
          <FoldingEntries entries={unmatched} />
        </div>
      )}
      {error && <p className="mt-2 text-danger">{error}</p>}
      {changingMe && me && (
        <PeoplePicker
          title="Who are you?"
          people={list}
          except={me.id}
          onPick={(id) =>
            void setMe(firestore(), user.uid, list, id).catch((e: Error) => {
              console.error("Saving who the user is failed", e);
              setError(e.message);
            })
          }
          onClose={() => setChangingMe(false)}
        />
      )}
      {merging && (
        <PeoplePicker
          title={`${merging.name} is the same person as`}
          people={list}
          except={merging.id}
          onPick={(id) =>
            void mergePeople(firestore(), user.uid, list, merging.id, id).catch((e: Error) => {
              console.error("Merging two people failed", e);
              setError(e.message);
            })
          }
          onClose={() => setMerging(undefined)}
        />
      )}
    </section>
  );
}

function LongStays({ user, homes }: { user: User; homes: Homes }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const stays = homes.periods.filter((p) => p.stay && (p.stayFrom ?? p.from));
  if (stays.length === 0 && !error) return null;
  const notHome = async (stay: (typeof stays)[number]) => {
    setBusy(true);
    setError(undefined);
    const entry = { city: stay.city, ...(stay.country ? { country: stay.country } : {}), from: (stay.stayFrom ?? stay.from)! };
    try {
      await logged("marking a stay not home", () =>
        saveNotHome(user.uid, [...homes.notHome.filter((n) => n.from !== entry.from || n.city !== entry.city), entry]),
      );
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      return;
    }
    try {
      await api.regroupTrips(user);
    } catch (e) {
      console.error("Regrouping after a stay said not home failed", e);
      setError("Saved, but your trips weren't regrouped. Use Regroup trips in Settings.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <ul className="mt-4 divide-y divide-zinc-200 dark:divide-zinc-800" data-testid="long-stays">
        {[...stays].reverse().map((stay) => (
          <li key={`${stay.city} ${stay.from}`} className="flex items-center justify-between gap-3 py-2">
            <span>
              {longStayText(stay)} <span className="text-muted">· from your stays</span>
            </span>
            <button type="button" disabled={busy} className={buttonClass} onClick={() => void notHome(stay)}>
              Not home
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-3 text-danger">{error}</p>}
    </>
  );
}

function HomeAirports({ user, homes }: { user: User; homes: Homes }) {
  const [editing, setEditing] = useState<string>();
  const [codes, setCodes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const towns = new Map<string, (typeof homes.periods)[number]>();
  for (const period of homes.periods) if (!period.stay) towns.set(homeTownKey(period.city, period.country), period);
  if (towns.size === 0) return null;
  const save = async (city: string, country: string | undefined) => {
    const parsed = parseAirportCodes(codes);
    if ("error" in parsed) return setError(parsed.error);
    setBusy(true);
    setError(undefined);
    try {
      const others = homes.chosen.filter((c) => homeTownKey(c.city, c.country) !== homeTownKey(city, country));
      await logged("choosing airports", () =>
        saveHomeAirports(user.uid, [...others, { city, ...(country ? { country } : {}), airports: parsed.codes }]),
      );
      setEditing(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-4">
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

export function HomeSection({ user, homes }: { user: User; homes: Homes | undefined }) {
  const profile = useProfile(user.uid);
  const corrections = homes?.corrections ?? (profile ? (profile.homes ?? []) : undefined);
  const [adding, setAdding] = useState(false);
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
    if (await save("adding one", [...(corrections ?? []).filter((c) => c.from !== correction.from), correction])) {
      setCity("");
      setCountry("");
      setFrom("");
      setAdding(false);
    }
  };

  const line = homes && homeLine(homes.periods);
  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-medium">Home</h2>
        {corrections !== undefined && (
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              setAdding((v) => !v);
              setError(undefined);
            }}
          >
            {adding ? "Cancel" : "Add home"}
          </button>
        )}
      </div>
      {corrections === undefined ? (
        <p className="mt-3 text-muted">Loading…</p>
      ) : (
        <>
          {homes === undefined ? (
            <p className="mt-3 text-muted">Loading…</p>
          ) : homes.failed > 0 ? (
            <p className="mt-3 text-danger">{failedReadsText(homes.failed)}</p>
          ) : (
            <>
              <p className="mt-3" data-testid="home-line">
                {line ?? "Not known yet."}
              </p>
              <p className="mt-1 text-muted">Worked out from your trips.</p>
            </>
          )}
          {adding && (
            <form
              className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
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
          )}
          {corrections.length > 0 && (
            <ul className="mt-4 divide-y divide-zinc-200 dark:divide-zinc-800">
              {corrections.map((c) => (
                <li key={c.from} className="flex items-center justify-between gap-3 py-2">
                  <span>{correctionText(c)}</span>
                  <button
                    type="button"
                    disabled={busy}
                    className={buttonClass}
                    onClick={() => void save("removing one", corrections.filter((x) => x.from !== c.from))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          {homes && homes.failed === 0 && <LongStays user={user} homes={homes} />}
          {homes && homes.failed === 0 && <HomeAirports user={user} homes={homes} />}
          {error && <p className="mt-3 text-danger">{error}</p>}
        </>
      )}
    </section>
  );
}

export function WalletSharingSection({
  user,
  profile,
  shared,
}: {
  user: User;
  profile: TravelProfile | null | undefined;
  shared: TravelProfile[];
}) {
  const trusted = profile?.trustedEmails ?? [];
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const save = async (next: string[]) => {
    setBusy(true);
    setError(undefined);
    try {
      await saveTrusted(user, profile !== null && profile !== undefined, next, trusted);
      setEmail("");
      setAdding(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-8">
      <div>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-medium">Wallet sharing</h2>
          {profile !== undefined && trusted.length < maxTrusted && (
            <button
              type="button"
              className={buttonClass}
              onClick={() => {
                setAdding((v) => !v);
                setError(undefined);
              }}
            >
              {adding ? "Cancel" : "Share with someone"}
            </button>
          )}
        </div>
        <p className="mt-2 text-muted">
          People you trust, such as a partner, can see your documents and loyalty programs when signed in with that email address. They can&apos;t change them.
        </p>
        {profile === undefined ? (
          <p className="mt-3 text-muted">Loading…</p>
        ) : (
          <>
            {adding && (
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
            )}
            {trusted.length === 0 ? (
              <p className="mt-3 text-muted">Only you.</p>
            ) : (
              <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
                {trusted.map((t) => (
                  <li key={t} className="flex items-center justify-between gap-3 py-2">
                    <span className="break-all">{t}</span>
                    <button type="button" disabled={busy} className={buttonClass} onClick={() => void save(trusted.filter((x) => x !== t))}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {error && <p className="mt-3 text-danger">{error}</p>}
          </>
        )}
      </div>

      {shared.length > 0 && (
        <div>
          <h2 className="text-lg font-medium">Shared with you</h2>
          <p className="mt-1 text-muted">
            View shared wallets from the person switcher in{" "}
            <Link href="/wallet" className="underline">
              Wallet
            </Link>
            .
          </p>
          <ul className="mt-3 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800" aria-label="Shared with you">
            {shared.map((p) => (
              <li key={p.ownerUid}>
                <Link
                  href={`/wallet?person=shared:${encodeURIComponent(p.ownerUid)}`}
                  className="flex w-full items-center justify-between gap-3 px-3 py-3 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  <span className="break-all">{p.ownerEmail ?? "Someone who trusts you"}</span>
                  <span aria-hidden="true" className="text-muted">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
