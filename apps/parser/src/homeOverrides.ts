import { ChosenHomeAirports, HomeCorrection, homeCorrections, maxHomeCorrections, paths, type HomePeriod } from "@travelmo/core";
import type { Firestore } from "firebase-admin/firestore";
import { z } from "zod";

const Stored = z.array(HomeCorrection).max(maxHomeCorrections);

// The corrections a user made to where home was (Profile), as periods that
// win over the home worked out from journeys. A list that does not parse is
// logged and ignored: imports go on with the worked-out home.
export async function loadHomeOverrides(
  db: Firestore,
  uid: string,
  log: (event: string, fields: Record<string, unknown>) => void,
): Promise<HomePeriod[]> {
  const snap = await db.doc(paths.user(uid)).get();
  const homes: unknown = snap.get("homes");
  if (homes === undefined) return [];
  const parsed = Stored.safeParse(homes);
  if (!parsed.success) {
    log("home_overrides_malformed", { uid, issues: parsed.error.issues.length });
    return [];
  }
  return homeCorrections(parsed.data);
}

const StoredAirports = z.array(ChosenHomeAirports).max(maxHomeCorrections);

// The airports a user chose for their homes (Profile). A list that does not
// parse is logged and ignored: grouping goes on with the worked-out ones.
export async function loadChosenHomeAirports(
  db: Firestore,
  uid: string,
  log: (event: string, fields: Record<string, unknown>) => void,
): Promise<ChosenHomeAirports[]> {
  const chosen: unknown = (await db.doc(paths.user(uid)).get()).get("homeAirports");
  if (chosen === undefined) return [];
  const parsed = StoredAirports.safeParse(chosen);
  if (!parsed.success) {
    log("home_airports_malformed", { uid, issues: parsed.error.issues.length });
    return [];
  }
  return parsed.data;
}
