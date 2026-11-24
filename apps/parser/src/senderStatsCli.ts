// Prints the sender domains most worth a look (senderStats.ts's
// senderReport), read with the Application Default Credentials of whoever
// runs it (gcloud auth application-default login) from the project in
// GOOGLE_CLOUD_PROJECT. Counts only: no user or email is stored to print.
// That it started, how it ended and any error go to
// ~/.local/state/travelmo/sender-stats.log as well, to outlast the
// terminal; the report goes to stdout alone.
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { senderReport, type SenderStats } from "./senderStats";

const logDir = join(process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "travelmo");
const logFile = join(logDir, "sender-stats.log");
function log(line: string): void {
  try {
    mkdirSync(logDir, { recursive: true });
    appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
  } catch (error) {
    // The report still prints; the terminal shows why the log couldn't be kept.
    console.error(`Couldn't write ${logFile}: ${(error as Error).message}`);
  }
}

// The Firestore client can fail outside the awaited call (no credentials).
function failed(error: unknown): void {
  log(`sender-stats failed: ${(error as Error).message}`);
  console.error(`Reading the sender counts failed: ${(error as Error).message}`);
  process.exit(1);
}
process.on("uncaughtException", failed);
process.on("unhandledRejection", failed);

log(`sender-stats started for project ${process.env.GOOGLE_CLOUD_PROJECT ?? "(from credentials)"}`);
try {
  const app = getApps()[0] ?? initializeApp();
  const snap = await getFirestore(app).collection("senderStats").get();
  const stats: SenderStats[] = snap.docs.map((d) => ({ domain: d.id, ...(d.data() as Omit<SenderStats, "domain">) }));
  console.log(`${stats.length} sender domains counted`);
  for (const line of senderReport(stats, Number(process.argv[2] ?? 50))) console.log(line);
  log(`sender-stats ended: ${stats.length} domains read`);
} catch (error) {
  failed(error);
}
