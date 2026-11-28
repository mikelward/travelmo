"use client";

import { accessBadge, allLoyalty, findFoundLoyalty, findPerson, guessMe, loyaltyByPerson, loyaltySummary, type FoundLoyalty, type PersonDoc, type ProfileEntry, type TravelProfile } from "@travelmo/core";
import type { User } from "firebase/auth";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Dialog } from "@/components/BookingMenu";
import { SectionHub, type HubGroup } from "@/components/SectionHub";
import { SignInGate } from "@/components/SignInGate";
import { useAuth } from "@/lib/auth";
import { airportCodes, homeTownKey, correctionText, failedReadsText, homeLine, logged, longStayText, parseAirportCodes, parseCorrection, saveCorrections, saveHomeAirports, saveNotHome, useHomes, type Homes } from "@/lib/home";
import { api } from "@/lib/api";
import { firestore } from "@/lib/firebase";
import { useSaveForOffline } from "@/lib/offline";
import { mergePeople, sayWhoIs, setMe, usePeople } from "@/lib/people";
import { useProfile } from "@/lib/trips";
import { maxTrusted, removeFoundLoyalty, saveTrusted, setLoyaltyPerson, useSharedProfiles, useTravelProfile } from "@/lib/travelProfile";

type Section = "documents" | "loyalty" | "people" | "home" | "sharing";

const buttonClass =
  "rounded-lg border border-zinc-300 px-3 py-2 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

const countLabel = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;

// Each entry folds away; documents start folded, so a passport number is
// not on screen until asked for.
function FoldingList({ entries }: { entries: ProfileEntry[] }) {
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

function EmptyImportHint() {
  return (
    <p className="mt-3 text-muted">
      Nothing imported yet. Upload a TripIt export in{" "}
      <Link href="/settings" className="underline">
        Settings
      </Link>{" "}
      to bring in your documents, loyalty programs and fellow travelers.
    </p>
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

// Which of the user's people someone is: "Who is this?" on a loyalty
// holder's name and "Same person as…" on a person both pick from it.
function PeoplePicker({
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
  // The user first, then as People lists them.
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

// Unified loyalty list: combines the at-a-glance summary, email-found removal,
// and full entry fields into one expandable row per program.
function LoyaltySection({
  entries,
  found,
  ownUid,
  travelers,
}: {
  entries: ProfileEntry[];
  found?: readonly FoundLoyalty[];
  ownUid?: string;
  travelers?: readonly PersonDoc[];
}) {
  const [editing, setEditing] = useState<{ program: string; number: string }>();
  const [naming, setNaming] = useState<string>();
  const [filter, setFilter] = useState<string>("__all__");
  const [error, setError] = useState<string>();
  const groups = useMemo(() => loyaltyByPerson(entries), [entries]);
  const people = useMemo(() => groups.flatMap((g) => (g.person ? [g.person] : [])), [groups]);

  if (!entries.length) {
    return (
      <section>
        <h2 className="text-lg font-medium">Loyalty programs</h2>
        {ownUid ? <EmptyImportHint /> : <p className="mt-3 text-muted">None yet.</p>}
      </section>
    );
  }

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

  const whoIs = async (name: string, personId: string) => {
    if (!ownUid || !travelers) return;
    setError(undefined);
    try {
      await sayWhoIs(firestore(), ownUid, travelers, name, personId);
    } catch (e) {
      console.error("Saving who a loyalty holder is failed", e);
      setError((e as Error).message);
    }
  };

  const remove = async (f: FoundLoyalty) => {
    if (!ownUid) return;
    setError(undefined);
    try {
      await removeFoundLoyalty(ownUid, f);
    } catch (e) {
      console.error("Removing a loyalty number failed", e);
      setError((e as Error).message);
    }
  };

  const showFilter = groups.length > 1;
  const activeFilter = showFilter && (filter === "__all__" || groups.some((g) => (g.person ?? "") === filter)) ? filter : "__all__";
  const visibleGroups = activeFilter === "__all__" ? groups : groups.filter((g) => (g.person ?? "") === activeFilter);

  return (
    <section>
      <h2 className="text-lg font-medium">Loyalty programs</h2>
      {showFilter && (
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Filter loyalty programs by person">
          <button
            type="button"
            aria-pressed={activeFilter === "__all__"}
            onClick={() => setFilter("__all__")}
            className={
              activeFilter === "__all__"
                ? "rounded-full border border-foreground bg-foreground px-3 py-1 text-background"
                : "rounded-full border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            }
          >
            All
          </button>
          {groups.map((g) => {
            const key = g.person ?? "";
            const label = g.person ?? (ownUid ? "You" : "Theirs");
            const active = activeFilter === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(key)}
                className={
                  active
                    ? "rounded-full border border-foreground bg-foreground px-3 py-1 text-background"
                    : "rounded-full border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                }
              >
                {label}
              </button>
            );
          })}
        </div>
      )}
      {visibleGroups.map((group) => {
        const name = group.person ?? (ownUid ? "You" : "Theirs");
        const named = groups.length > 1 || !!group.person;
        return (
          <div key={group.person ?? ""} className={named ? "mt-5" : "mt-3"}>
            {named && (
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h3 className="text-lg font-medium">{name}</h3>
                {group.person && ownUid && !!travelers?.length && (
                  <button type="button" className="text-muted hover:underline" onClick={() => setNaming(group.person)}>
                    Same person as…
                  </button>
                )}
              </div>
            )}
            <ul className="space-y-2" aria-label={named ? `Loyalty programs: ${name}` : "Loyalty programs"}>
              {group.entries.map((entry, i) => {
                const r = loyaltySummary(entry);
                const foundMatch = ownUid && found ? findFoundLoyalty(found, entry) : undefined;
                const statusText = r.nextStatus && r.status ? `${r.status} (next: ${r.nextStatus})` : r.status;
                const details = entry.fields.filter((f) => f.label !== "Person");
                return (
                  <li key={`${r.title}-${r.account ?? i}`}>
                    <details className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                      <summary className="flex cursor-pointer items-start justify-between gap-4 list-none">
                        <div className="min-w-0">
                          <div className="font-medium">{r.title}</div>
                          {r.account && <div className="break-all text-muted">{r.account}</div>}
                        </div>
                        <div className="shrink-0 text-right">
                          {r.balance && <div className="tabular-nums">{r.balance}</div>}
                          {statusText && <div className="text-muted">{statusText}</div>}
                        </div>
                      </summary>
                      <div className="mt-3 border-t border-zinc-200 pt-2 dark:border-zinc-800">
                        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                          {details.map((field, j) => (
                            <div key={`${field.label}-${j}`} className="contents">
                              <dt className="text-muted">{field.label}</dt>
                              <dd className="break-words">{field.value}</dd>
                            </div>
                          ))}
                        </dl>
                        {ownUid && (r.account || foundMatch) && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {r.account && (
                              <button
                                type="button"
                                aria-label={`Whose is ${r.title} ${r.account}?`}
                                onClick={() => setEditing({ program: r.title, number: r.account! })}
                                className={buttonClass}
                              >
                                Whose is this?
                              </button>
                            )}
                            {foundMatch && (
                              <button
                                type="button"
                                aria-label={`Remove ${foundMatch.program}`}
                                onClick={() => void remove(foundMatch)}
                                className={buttonClass}
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {error && <p className="mt-3 text-danger">{error}</p>}
      {naming && travelers && (
        <PeoplePicker title={`${naming} is the same person as`} people={travelers} onPick={(id) => void whoIs(naming, id)} onClose={() => setNaming(undefined)} />
      )}
      {editing && (
        <PersonDialog program={editing.program} number={editing.number} people={people} onPick={(p) => void pick(p)} onClose={() => setEditing(undefined)} />
      )}
    </section>
  );
}

function DocumentsSection({ documents, own }: { documents: ProfileEntry[]; own: boolean }) {
  return (
    <section>
      <h2 className="text-lg font-medium">Documents</h2>
      {documents.length > 0 ? <FoldingList entries={documents} /> : own ? <EmptyImportHint /> : <p className="mt-3 text-muted">None yet.</p>}
    </section>
  );
}

// Unified People section: combines booking travelers (with You / Change,
// Also me, and Same person as…) and imported TripIt traveler details into one list.
function PeopleSection({ user, people, imported }: { user: User; people: PersonDoc[] | undefined; imported: ProfileEntry[] }) {
  const [error, setError] = useState<string>();
  const [changingMe, setChangingMe] = useState(false);
  const [merging, setMerging] = useState<PersonDoc>();
  const list = people ?? [];
  const me = guessMe(list);
  const others = me ? list.filter((p) => p.id !== me.id) : list;

  // Match imported TripIt traveler cards to known booking people when possible.
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
          <FoldingList entries={unmatched} />
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

// Where home has been, worked out from the user's trips, with their own
// corrections: home is this town from this date.
function HomeSection({ user, homes }: { user: User; homes: Homes | undefined }) {
  // The corrections as saved, to change while home over time waits for every trip's bookings.
  const profile = useProfile(user.uid);
  // A profile that has answered with no corrections has none to show, not none yet.
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
            // Home over time waits for every trip's bookings; the corrections below don't.
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

// Four weeks or more staying in one town count as living there: listed under
// home, each with Not home for a holiday, which regroups it as a trip.
function LongStays({ user, homes }: { user: User; homes: Homes }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const stays = homes.periods.filter((p) => p.stay && (p.stayFrom ?? p.from));
  // Kept once the last row has gone, so a failed regroup still says so.
  if (stays.length === 0 && !error) return null;
  const notHome = async (stay: (typeof stays)[number]) => {
    setBusy(true);
    setError(undefined);
    // Known by its own first day, though another stay cut into it.
    const entry = { city: stay.city, ...(stay.country ? { country: stay.country } : {}), from: (stay.stayFrom ?? stay.from)! };
    try {
      await logged("marking a stay not home", () => saveNotHome(user.uid, [...homes.notHome.filter((n) => n.from !== entry.from || n.city !== entry.city), entry]));
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

// Each home's airports and stations: a journey back into one ends a trip.
// Worked out from the trips that leave from them, unless chosen here.
function HomeAirports({ user, homes }: { user: User; homes: Homes }) {
  const [editing, setEditing] = useState<string>();
  const [codes, setCodes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // One row per home town, its latest period's airports.
  const towns = new Map<string, (typeof homes.periods)[number]>();
  // A long stay takes the airports of the home it is in, else those found.
  for (const period of homes.periods) if (!period.stay) towns.set(homeTownKey(period.city, period.country), period);
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

function SharedProfileView({ profile, onBack }: { profile: TravelProfile; onBack: () => void }) {
  const loyalty = useMemo(() => allLoyalty(profile), [profile]);
  return (
    <section>
      <button type="button" onClick={onBack} className="mb-3 text-muted hover:underline">
        ← Sharing
      </button>
      <h2 className="text-lg font-medium">From {profile.ownerEmail ?? "someone who trusts you"}</h2>
      {profile.documents.length === 0 && loyalty.length === 0 && profile.travelers.length === 0 ? (
        <p className="mt-3 text-muted">Nothing in it yet.</p>
      ) : (
        <div className="mt-4 space-y-6">
          {profile.documents.length > 0 && <DocumentsSection documents={profile.documents} own={false} />}
          {loyalty.length > 0 && <LoyaltySection entries={loyalty} />}
          {profile.travelers.length > 0 && (
            <section>
              <h2 className="text-lg font-medium">Travelers</h2>
              <FoldingList entries={profile.travelers} />
            </section>
          )}
        </div>
      )}
    </section>
  );
}

function SharingSection({
  user,
  profile,
  shared,
  viewingShared,
  onOpenShared,
  onCloseShared,
}: {
  user: User;
  profile: TravelProfile | null | undefined;
  shared: TravelProfile[];
  viewingShared: TravelProfile | undefined;
  onOpenShared: (uid: string) => void;
  onCloseShared: () => void;
}) {
  const trusted = profile?.trustedEmails ?? [];
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (viewingShared) {
    return <SharedProfileView profile={viewingShared} onBack={onCloseShared} />;
  }

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
          <h2 className="text-lg font-medium">Shared with</h2>
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
          People you trust, such as a partner, can see everything here, documents included, when signed in with that email address. They can&apos;t change it.
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
          <ul className="mt-3 divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800" aria-label="Shared with you">
            {shared.map((p) => {
              const pLoyalty = allLoyalty(p);
              const parts = [
                p.documents.length > 0 ? countLabel(p.documents.length, "document", "documents") : undefined,
                pLoyalty.length > 0 ? countLabel(pLoyalty.length, "program", "programs") : undefined,
              ].filter(Boolean);
              return (
                <li key={p.ownerUid}>
                  <button
                    type="button"
                    onClick={() => onOpenShared(p.ownerUid)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-zinc-100 dark:hover:bg-zinc-900"
                  >
                    <div className="min-w-0">
                      <div className="break-all">From {p.ownerEmail ?? "someone who trusts you"}</div>
                      <div className="text-muted">{parts.length > 0 ? parts.join(" · ") : "Nothing in it yet."}</div>
                    </div>
                    <span aria-hidden="true" className="text-muted">
                      ›
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function ProfilePage({ user }: { user: User }) {
  const profile = useTravelProfile(user.uid);
  const people = usePeople(user.uid);
  const homes = useHomes(user);
  const sharedAll = useSharedProfiles(user);
  const shared = useMemo(() => (sharedAll ?? []).filter((p) => p.ownerUid !== user.uid), [sharedAll, user.uid]);
  const { access } = useAuth();
  const email = user.email?.toLowerCase();
  const badge = access.state === "loading" ? undefined : accessBadge(access.admin, user.emailVerified ? email : undefined, access.record);

  const [selected, setSelected] = useState<Section | null>(null);
  const [sharedUid, setSharedUid] = useState<string | null>(null);

  const loyalty = useMemo(() => (profile ? allLoyalty(profile, people) : []), [profile, people]);
  const loyaltyGroups = useMemo(() => loyaltyByPerson(loyalty), [loyalty]);
  const me = useMemo(() => (people ? guessMe(people) : undefined), [people]);
  const homeSummary = useMemo(() => {
    if (!homes) return "Loading…";
    if (homes.failed > 0) return "Couldn't read all trips";
    return homeLine(homes.periods) ?? "Not known yet";
  }, [homes]);

  const docsCount = profile?.documents.length ?? 0;
  const peopleCount = (people?.length ?? 0) || (profile?.travelers.length ?? 0);
  const trustedCount = profile?.trustedEmails.length ?? 0;

  const sharingMeta = [
    trustedCount > 0 ? `Shared with ${trustedCount}` : undefined,
    shared.length > 0 ? `${shared.length} shared with you` : undefined,
  ].filter(Boolean);

  const navGroups: HubGroup<Section>[] = [
    {
      items: [
        { id: "documents", label: "Documents", meta: profile === undefined ? "Loading…" : docsCount > 0 ? countLabel(docsCount, "document", "documents") : "None yet" },
        {
          id: "loyalty",
          label: "Loyalty programs",
          meta:
            profile === undefined
              ? "Loading…"
              : loyalty.length > 0
                ? loyaltyGroups.length > 1
                  ? `${countLabel(loyalty.length, "program", "programs")} · ${countLabel(loyaltyGroups.length, "person", "people")}`
                  : countLabel(loyalty.length, "program", "programs")
                : "None yet",
        },
        {
          id: "people",
          label: "People",
          meta: peopleCount > 0 ? (me ? `${countLabel(peopleCount, "person", "people")} · You: ${me.name}` : countLabel(peopleCount, "person", "people")) : "None yet",
        },
        { id: "home", label: "Home", meta: homeSummary },
        { id: "sharing", label: "Sharing", meta: sharingMeta.length > 0 ? sharingMeta.join(" · ") : "Only you" },
      ],
    },
  ];

  const effective: Section = selected ?? "documents";
  const viewingShared = sharedUid ? shared.find((p) => p.ownerUid === sharedUid) : undefined;

  const openSection = (id: Section) => {
    setSelected(id);
    if (id !== "sharing") setSharedUid(null);
  };

  return (
    <>
      <h1 className="mb-2 text-2xl font-semibold">Travel profile</h1>
      {email && (
        <p className="mb-6 text-muted">
          Signed in as {email}
          {badge && <span className="ml-2 text-xs font-medium uppercase tracking-wide text-muted">{badge === "admin" ? "Admin" : "Invited"}</span>}
        </p>
      )}
      <SectionHub
        navLabel="Profile sections"
        backLabel="Travel profile"
        groups={navGroups as HubGroup<Section>[]}
        selected={selected}
        defaultSection="documents"
        hideBack={!!viewingShared}
        onSelect={openSection}
        onBack={() => setSelected(null)}
      >
        {effective === "documents" && (profile === undefined ? <p className="text-muted">Loading…</p> : <DocumentsSection documents={profile?.documents ?? []} own />)}
        {effective === "loyalty" &&
          (profile === undefined ? (
            <p className="text-muted">Loading…</p>
          ) : (
            <LoyaltySection entries={loyalty} found={profile?.foundLoyalty ?? []} ownUid={user.uid} {...(people ? { travelers: people } : {})} />
          ))}
        {effective === "people" && <PeopleSection user={user} people={people} imported={profile?.travelers ?? []} />}
        {effective === "home" && <HomeSection user={user} homes={homes} />}
        {effective === "sharing" && (
          <SharingSection
            user={user}
            profile={profile}
            shared={shared}
            viewingShared={viewingShared}
            onOpenShared={(uid) => setSharedUid(uid)}
            onCloseShared={() => setSharedUid(null)}
          />
        )}
      </SectionHub>
    </>
  );
}

export default function Page() {
  useSaveForOffline();
  return <SignInGate>{(user) => <ProfilePage user={user} />}</SignInGate>;
}
