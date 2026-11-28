import {
  compareInstants,
  findTripForBooking,
  opensTrip,
  homeTimeline,
  homeBookings,
  type PersonDoc,
  homesWithAirports,
  isCancelled,
  liveSegments,
  outingRuns,
  bookedDateRange,
  segmentDateRange,
  segmentSources,
  type ChosenHomeAirports,
  type NotHomeStay,
  type HomePeriod,
  type Segment,
  type Trip,
} from "@travelmo/core";
import { placedFromTables } from "./placeBookings";
import { importGaveTitle, settlingTripDates, sourceTripPrefix, tripTitle, type ImportDeps, type TripTx } from "./importer";

// Rebuilding a user's trips from their bookings with the grouping imports
// use now (findTripForBooking, tripTitle), for trips filed before it knew
// where home was. Bookings are never deleted or changed, only moved between
// trips; a trip a source keeps its own grouping for (a TripIt trip) is left
// as it is. Running it twice changes nothing the second time.

// One booking as it was imported: the segments one email (or one item of
// any source) gave, which stay together, as they came in together, within
// trips shared with the same people (`share`).
type Unit = { key: string; share: string; segments: Segment[] };

// A trip as regrouping leaves it.
export type PlannedTrip = {
  // An existing trip kept for this group, or a new id.
  id: string;
  existing?: Trip;
  title: string;
  start: string;
  end: string;
  // Who it is shared with: always that of the trips its bookings came from.
  sharedWith: string[];
  segments: Segment[];
  // Whether its bookings differ from the trip it keeps.
  changed: boolean;
};

export type RegroupPlan = { trips: PlannedTrip[]; deleted: string[] };

// The items a booking came from (segmentSources: for one imported before
// bookings recorded their sources, its email).
const sourceKeys = (segment: Segment) => segmentSources(segment).map((ref) => `${ref.kind}:${ref.id}`);

const segmentKey = (segment: Pick<Segment, "tripId" | "id">) => `${segment.tripId}/${segment.id}`;

// Who a trip is shared with, as one key: the same people in any order and
// case are the same, and a private trip's is empty.
const shareKey = (trip: Pick<Trip, "sharedWith">) => [...new Set(trip.sharedWith.map((e) => e.trim().toLowerCase()))].sort().join(",");

// What regrouping would do, without doing it. Bookings are filed again one
// import at a time, in the order they happen, as an import would file them;
// each resulting group keeps the existing trip holding most of its bookings
// (with its id, sharing and dates), and keeps that trip's title too while it
// still holds every booking the trip had, so a trip only added to keeps a
// name the user gave it (one still named as an import named it is named
// afresh). Bookings never move between trips shared with
// different people (a private trip's being no one): each group is filed
// among, and keeps, only trips with its own sharing, so nobody gains or loses
// sight of a booking. A trip left with none of its bookings is deleted;
// one that had none before regrouping began (`keptEmpty`, planned by hand)
// is left alone.
export function planRegroup(
  trips: readonly Trip[],
  segmentsByTrip: ReadonlyMap<string, readonly Segment[]>,
  newId: () => string,
  overrides: readonly HomePeriod[] = [],
  keptEmpty: ReadonlySet<string> = new Set(trips.filter((trip) => (segmentsByTrip.get(trip.id) ?? []).length === 0).map((trip) => trip.id)),
  chosen: readonly ChosenHomeAirports[] = [],
  // The people the user's bookings name: trips they're only watching say
  // nothing of where home is (homeBookings).
  people: readonly PersonDoc[] = [],
  // The long stays the user said were not home.
  notHome: readonly NotHomeStay[] = [],
): RegroupPlan {
  const live = trips.filter((trip) => !trip.deleting);
  const known = homeBookings(live.map((trip) => ({ removedTravelers: trip.removedTravelers, segments: segmentsByTrip.get(trip.id) ?? [] })), people);
  // Home as worked out and as corrected, each with its airports: those its
  // round trips leave from, unless the person chose them.
  const homes = homesWithAirports(known, overrides, chosen, notHome);
  const periods = homes.periods;
  overrides = homes.overrides;
  // A trip the owner cancelled keeps its bookings as they are, as one a
  // source groups itself does.
  const eligible = live.filter((trip) => !trip.id.startsWith(sourceTripPrefix) && trip.cancelledAt === undefined);

  // Segments that share any source are one booking, however they are
  // linked: an outbound from one email and its return filed beside it from a
  // later email carrying both legs stay together. Never across sharing.
  const parent = new Map<string, string>();
  const root = (node: string): string => {
    let r = node;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(node, r);
    return r;
  };
  const join = (a: string, b: string) => {
    for (const n of [a, b]) if (!parent.has(n)) parent.set(n, n);
    const [ra, rb] = [root(a), root(b)];
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };
  const placed: { segment: Segment; share: string; node: string }[] = [];
  for (const trip of eligible) {
    const share = shareKey(trip);
    for (const segment of segmentsByTrip.get(trip.id) ?? []) {
      const node = `${share}|segment:${segment.tripId}/${segment.id}`;
      join(node, node);
      for (const key of sourceKeys(segment)) join(node, `${share}|source:${key}`);
      placed.push({ segment, share, node });
    }
  }
  const units = new Map<string, Unit>();
  for (const { segment, share, node } of placed) {
    const key = root(node);
    const unit = units.get(key) ?? { key, share, segments: [] };
    unit.segments.push(segment);
    units.set(key, unit);
  }
  const first = (unit: Unit) => unit.segments.reduce((a, b) => (compareInstants(b.start, a.start) < 0 ? b : a)).start;
  // Outings one email booked on days apart (a weekly class for a term) are
  // filed run by run, as an import files them (outingRuns); a calendar
  // event's stay together, as its record names one trip.
  const fromCalendar = (unit: Unit) => unit.segments.some((s) => segmentSources(s).some((ref) => ref.kind === "ics"));
  const ordered = [...units.values()]
    .flatMap((unit) => (fromCalendar(unit) ? [unit.segments] : outingRuns(unit.segments)).map((segments, i) => ({ ...unit, key: i === 0 ? unit.key : `${unit.key}#${i}`, segments })))
    .map((unit) => ({ ...unit, segments: unit.segments.slice().sort((a, b) => compareInstants(a.start, b.start)) }))
    .sort((a, b) => compareInstants(first(a), first(b)) || a.key.localeCompare(b.key));

  // File the bookings into trips that exist only here.
  type Group = { trip: Trip; share: string; sharedWith: string[]; segments: Segment[]; units: Segment[][] };
  const groups: Group[] = [];
  const shareOf = new Map(eligible.map((trip) => [trip.id, trip.sharedWith]));
  for (const unit of ordered) {
    // A cancelled booking still belongs somewhere: it is filed by its own
    // dates, but only live ones widen the trip it joins. A unit that is all
    // cancelled has no live range, so it goes by its dates as booked.
    // Live first, as an import files it: what it still books chooses the
    // trip, and its cancelled parts only when nothing in it is live.
    const asBooked = unit.segments.map((s) => (isCancelled(s) ? { ...s, cancelledAt: undefined } : s));
    const stillBooked = liveSegments(unit.segments);
    const live = segmentDateRange(unit.segments);
    const range = live ?? segmentDateRange(asBooked)!;
    const groupSegments = (id: string) => {
      const all = groups.find((g) => g.trip.id === id)?.segments ?? [];
      const booked = liveSegments(all);
      return booked.length > 0 ? booked : all;
    };
    const target = findTripForBooking(
      groups.filter((g) => g.share === unit.share).map((g) => g.trip),
      groupSegments,
      stillBooked.length > 0 ? stillBooked : asBooked,
      periods,
      overrides,
    );
    const group = groups.find((g) => g.trip.id === target?.id);
    if (group) {
      group.segments.push(...unit.segments);
      group.units.push(unit.segments);
      // Its bounds are its live bookings' span once it has any: a cancelled
      // stay that seeded it by its booked dates no longer stretches it to
      // catch what's live weeks later. Booked dates only while all cancelled.
      // While it is all cancelled, each unit's booked dates widen it, as
      // they set it when a unit started it.
      const span = segmentDateRange(group.segments);
      group.trip = span
        ? { ...group.trip, start: span.start, end: span.end }
        : { ...group.trip, start: min(group.trip.start, range.start), end: max(group.trip.end, range.end) };
    } else {
      groups.push({
        trip: { id: `group-${groups.length}`, title: "", start: range.start, end: range.end, ownerUid: "", sharedWith: [], createdAt: "", updatedAt: "" },
        share: unit.share,
        sharedWith: [...(shareOf.get(unit.segments[0]!.tripId) ?? [])],
        segments: [...unit.segments],
        units: [unit.segments],
      });
    }
  }

  // A booking of nothing but journeys that ends a trip by landing where the
  // next trip's first journey leaves from opens that trip instead
  // (opensTrip): Zagreb to New York goes with the week in New York that
  // ends in the flight home from Newark, not with the Zagreb trip before it.
  const journey = (s: Segment) => ["flight", "train", "bus", "ferry"].includes(s.type);
  const earliest = (segments: readonly Segment[]) => segments.reduce((a, b) => (compareInstants(b.start, a.start) < 0 ? b : a));
  const latest = (segments: readonly Segment[]) => segments.reduce((a, b) => (compareInstants(b.start, a.start) > 0 ? b : a));
  for (const share of new Set(groups.map((g) => g.share))) {
    const mine = groups.filter((g) => g.share === share && g.segments.length > 0).sort((a, b) => compareInstants(earliest(a.segments).start, earliest(b.segments).start));
    for (let i = 0; i + 1 < mine.length; i++) {
      const [before, after] = [mine[i]!, mine[i + 1]!];
      const last = before.units.reduce((a, b) => (compareInstants(earliest(b).start, earliest(a).start) > 0 ? b : a));
      if (!last.every(journey)) continue;
      // Where it still goes and where the next trip still leaves from: a
      // cancelled leg to New York takes nobody there.
      const [going, next] = [liveSegments(last), liveSegments(after.segments)];
      if (going.length === 0 || next.length === 0) continue;
      const landing = latest(going);
      // Nothing else in the trip starts after it leaves.
      if (before.segments.some((s) => !last.includes(s) && compareInstants(s.start, earliest(last).start) > 0)) continue;
      if (!opensTrip(landing, earliest(next), periods, overrides)) continue;
      before.segments = before.segments.filter((s) => !last.includes(s));
      before.units = before.units.filter((u) => u !== last);
      after.segments.push(...last);
      after.units.push(last);
      for (const group of [before, after]) {
        const span = segmentDateRange(group.segments);
        if (span) group.trip = { ...group.trip, start: span.start, end: span.end };
      }
    }
  }
  // A trip that was nothing but that booking has joined the next.
  for (let k = groups.length - 1; k >= 0; k--) if (groups[k]!.segments.length === 0) groups.splice(k, 1);

  // Each group keeps the existing trip holding most of its bookings, the
  // largest shares first; ties go to the older trip, then the earlier group.
  const holding = (group: Group, trip: Trip) => group.segments.filter((s) => s.tripId === trip.id).length;
  const pairs = groups
    .flatMap((group, g) => eligible.filter((trip) => shareKey(trip) === group.share).map((trip) => ({ g, trip, count: holding(group, trip) })))
    .filter((p) => p.count > 0)
    .sort((a, b) => b.count - a.count || a.trip.createdAt.localeCompare(b.trip.createdAt) || a.g - b.g || a.trip.id.localeCompare(b.trip.id));
  const keeps = new Map<number, Trip>();
  const kept = new Set<string>();
  for (const { g, trip } of pairs) {
    if (keeps.has(g) || kept.has(trip.id)) continue;
    keeps.set(g, trip);
    kept.add(trip.id);
  }

  const planned = groups.map((group, g): PlannedTrip => {
    const existing = keeps.get(g);
    // Its own dates cover every booking in it, cancelled ones too, so an
    // import finds each again by date; when the person now travels on it is
    // settled after the pass (settlingTripDates). Grouping above went by
    // what is still booked.
    const range = bookedDateRange(group.segments) ?? { start: group.trip.start, end: group.trip.end };
    const segments = group.segments;
    // Named for what it still books, as an import names it.
    const naming = liveSegments(group.segments).length > 0 ? liveSegments(group.segments) : group.segments;
    if (!existing) return { id: newId(), title: tripTitle(naming, periods, overrides), start: range.start, end: range.end, sharedWith: group.sharedWith, segments, changed: true };
    const before = new Set((segmentsByTrip.get(existing.id) ?? []).map(segmentKey));
    const after = new Set(segments.map(segmentKey));
    const holdsAll = [...before].every((key) => after.has(key));
    // A trip still named as an import named it (importGaveTitle) takes the
    // name its bookings give it now: a course named for its venue
    // ("Weston Park School" for "Debutots Camp - 11th Aug 2025" and the
    // rest), or a trip a stay with no town started, named for the stay
    // ("Designer Collingwood Terrace" for a week in Melbourne). One the user
    // renamed keeps its name.
    const title = importGaveTitle(existing.title, segmentsByTrip.get(existing.id) ?? [], periods, overrides) ? tripTitle(segments, periods, overrides) : existing.title;
    const changed = !holdsAll || after.size !== before.size || title !== existing.title;
    return holdsAll
      ? { id: existing.id, existing, title, start: min(existing.start, range.start), end: max(existing.end, range.end), sharedWith: existing.sharedWith, segments, changed }
      : { id: existing.id, existing, title: tripTitle(group.segments, periods, overrides), start: range.start, end: range.end, sharedWith: existing.sharedWith, segments, changed };
  });
  const deleted = eligible.filter((trip) => !keptEmpty.has(trip.id) && !kept.has(trip.id)).map((trip) => trip.id);
  return { trips: planned, deleted };
}

const min = (a: string, b: string) => (a < b ? a : b);
const max = (a: string, b: string) => (a > b ? a : b);

// Most writes one pass makes: Firestore allows 500 in a transaction.
const writeBudget = 400;

// Applies a plan, a trip at a time, while the pass's writes fit the budget:
// the trip's title and bounds, then its bookings moved in (delete and write
// again under the new trip, unchanged otherwise). Every move is finished in
// the same pass: each trip a booking left is deleted when it has none left
// and the plan deletes it, and otherwise has its revision moved, as any
// change to its bookings must (a merge that read it before then retries
// rather than copying bookings already moved). The budget holds one write
// for each such trip. Returns the trips deleted and whether anything is
// left for another pass.
function applyPlan(tx: TripTx, uid: string, plan: RegroupPlan, timestamp: string, budget: number): { deleted: string[]; more: boolean } {
  const remaining = new Map<string, number>();
  for (const trip of plan.trips) for (const s of trip.segments) remaining.set(s.tripId, (remaining.get(s.tripId) ?? 0) + 1);
  const deletable = new Set(plan.deleted);
  const plannedById = new Map(plan.trips.map((t) => [t.id, t]));
  const updated = new Set<string>();
  const sources = new Set<string>();
  let writes = 0;
  let more = false;
  for (const trip of plan.trips.filter((t) => t.changed)) {
    const moves = trip.segments.filter((s) => s.tripId !== trip.id);
    // A kept trip already named and dated as planned, with nothing to move
    // in, needs no write: writing it anyway would spend a pass's budget on
    // nothing, again every pass, while a large move waits.
    const existing = trip.existing;
    if (existing && moves.length === 0 && existing.title === trip.title && existing.start === trip.start && existing.end === trip.end) continue;
    // As many of its moves as fit, a booking at a time: one write for the
    // trip, two per booking, and one for each trip a booking leaves that
    // the pass has not yet counted. A move too large for one pass goes in
    // parts, so every pass gets somewhere.
    let cost = 1;
    const chosen: Segment[] = [];
    const counted = new Set<string>();
    for (const segment of moves) {
      const from = segment.tripId;
      const fresh = !sources.has(from) && !updated.has(from) && !counted.has(from) && from !== trip.id;
      const step = 2 + (fresh ? 1 : 0);
      if (writes + cost + step > budget) break;
      cost += step;
      chosen.push(segment);
      counted.add(from);
    }
    if (writes + cost > budget || (moves.length > 0 && chosen.length === 0)) {
      more = true;
      break;
    }
    writes += cost;
    updated.add(trip.id);
    if (trip.existing) tx.updateTrip(trip.id, { title: trip.title, start: trip.start, end: trip.end, updatedAt: timestamp });
    else {
      tx.createTrip({
        id: trip.id,
        title: trip.title,
        start: trip.start,
        end: trip.end,
        ownerUid: uid,
        sharedWith: trip.sharedWith,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
    for (const segment of chosen) {
      tx.deleteSegment(segment.tripId, segment.id);
      tx.putSegment({ ...segment, tripId: trip.id });
      remaining.set(segment.tripId, remaining.get(segment.tripId)! - 1);
      sources.add(segment.tripId);
    }
    if (chosen.length < moves.length) {
      more = true;
      break;
    }
  }
  const deleted: string[] = [];
  for (const id of sources) {
    if (deletable.has(id) && remaining.get(id) === 0) {
      tx.deleteTrip(id);
      deleted.push(id);
    } else if (!updated.has(id)) {
      // A kept trip whose own turn has not come takes its new title and
      // dates now: once the rest of its bookings have gone, the next pass
      // finds it already holding just its own and would not write it.
      const planned = plannedById.get(id);
      if (planned?.existing && planned.changed) {
        tx.updateTrip(id, { title: planned.title, start: planned.start, end: planned.end, updatedAt: timestamp });
      } else tx.touchTrip(id, timestamp);
    }
  }
  // A trip the plan deletes with nothing to move out (only possible when it
  // had no bookings regrouping could file) goes in the last pass.
  if (!more) {
    for (const id of deletable) {
      if (!sources.has(id) && (remaining.get(id) ?? 0) === 0) {
        tx.deleteTrip(id);
        deleted.push(id);
      }
    }
  }
  return { deleted, more };
}

// `placed`: bookings the airport and city tables gave a country or a spot
// first (placeBookings).
export type RegroupResult = { changed: number; deleted: number; placed: number };

// Fills in what the airport and city tables know first, so the grouping
// and the trips' places use it, then regroups one user's trips, in the
// import's per-user transaction so no
// import runs meanwhile. A plan too large for one transaction is applied
// over several, each planning afresh from what the last left: a group
// already applied keeps its trip, so the passes settle. Trips that had no
// bookings when it began are never deleted, whatever a later pass sees.
export async function regroupTrips(
  uid: string,
  deps: Pick<ImportDeps, "store" | "now" | "log" | "homeOverrides" | "chosenHomeAirports" | "notHome">,
  budget = writeBudget,
): Promise<RegroupResult> {
  const [overrides, chosen, notHome] = await Promise.all([
    deps.homeOverrides?.(uid).then((v) => v ?? []) ?? Promise.resolve([]),
    deps.chosenHomeAirports?.(uid).then((v) => v ?? []) ?? Promise.resolve([]),
    deps.notHome?.(uid).then((v) => v ?? []) ?? Promise.resolve([]),
  ]);
  let placingDone = false;
  let placePasses = 0;
  let regroupPasses = 0;
  let placed = 0;
  let keptEmpty: Set<string> | undefined;
  let changed: number | undefined;
  let deleted = 0;
  while (placePasses < 50 && regroupPasses < 50) {
    const step = await deps.store.withUserLock(uid, async (lockTx) => {
      // Bookings moved between trips change when each trip's person now
      // travels (liveBounds), settled once the pass has written them.
      const tx = settlingTripDates(lockTx, deps.now());
      const trips = await tx.listTrips();
      const [entries, people] = await Promise.all([
        Promise.all(trips.map(async (trip) => [trip.id, await tx.listSegments(trip.id)] as const)),
        tx.listPeople(uid),
      ]);
      const segmentsByTrip = new Map(entries);
      if (!placingDone) {
        const toPlace = trips
          .filter((trip) => !trip.deleting)
          .map((trip) => ({
            trip,
            changed: (segmentsByTrip.get(trip.id) ?? []).flatMap((s) => {
              const filled = placedFromTables(s);
              return filled ? [filled] : [];
            }),
          }))
          .filter((p) => p.changed.length > 0);
        if (toPlace.length > 0) {
          let writes = 0;
          let count = 0;
          let morePlace = false;
          for (const { trip, changed: segments } of toPlace) {
            if (writes > 0 && writes + segments.length + 1 > writeBudget) {
              morePlace = true;
              break;
            }
            for (const segment of segments) lockTx.putSegment(segment);
            lockTx.touchTrip(trip.id, deps.now());
            writes += segments.length + 1;
            count += segments.length;
          }
          return { phase: "place" as const, count, morePlace };
        }
      }
      // Within the transaction, so a retried first pass reads it afresh.
      const empty = keptEmpty ?? new Set(trips.filter((trip) => (segmentsByTrip.get(trip.id) ?? []).length === 0).map((trip) => trip.id));
      const plan = planRegroup(trips, segmentsByTrip, () => deps.store.newId(), overrides, empty, chosen, people, notHome);
      const changedTrips = plan.trips.filter((t) => t.changed).length;
      const applied =
        changedTrips === 0 && plan.deleted.length === 0 ? { deleted: [], more: false } : applyPlan(tx, uid, plan, deps.now(), budget);
      tx.settle(trips, (tripId) => segmentsByTrip.get(tripId) ?? []);
      return { phase: "regroup" as const, ...applied, empty, changedTrips };
    });
    if (step.phase === "place") {
      placePasses += 1;
      placed += step.count;
      if (!step.morePlace) {
        placingDone = true;
        deps.log("bookings_placed", { uid, placed, passes: placePasses });
      }
      continue;
    }
    placingDone = true;
    regroupPasses += 1;
    keptEmpty ??= step.empty;
    changed ??= step.changedTrips;
    deleted += step.deleted.length;
    if (!step.more) {
      const result = { changed: changed ?? 0, deleted, placed };
      deps.log("regrouped", { uid, passes: regroupPasses, ...result });
      return result;
    }
  }
  throw new Error(placePasses >= 50 ? "placing bookings did not settle in 50 passes" : "regrouping did not settle in 50 passes");
}
