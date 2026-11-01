import { SenderPatterns, paths } from "@travelmo/core";
import { doc, runTransaction, type Firestore } from "firebase/firestore";

// Reads the domain out of a From header or accepts a bare domain.
export function domainOf(from: string): string | undefined {
  const trimmed = from.trim().toLowerCase();
  const match = /<?[^\s<>@]+@([^\s<>]+?)>?\s*$/.exec(trimmed);
  const domain = match?.[1] ?? (trimmed.includes("@") ? undefined : trimmed);
  return domain && domain.includes(".") ? domain : undefined;
}

// Adds a domain to one list and takes it off the other, so a sender is never
// both always and never imported.
export async function learnSender(db: Firestore, uid: string, domain: string, list: "allow" | "deny"): Promise<void> {
  const ref = doc(db, paths.senderPatterns(uid));
  await runTransaction(db, async (t) => {
    const snap = await t.get(ref);
    const current = SenderPatterns.parse(snap.data() ?? {});
    const other = list === "allow" ? "deny" : "allow";
    t.set(ref, {
      ...current,
      [list]: [...new Set([...current[list], domain])],
      [other]: current[other].filter((d) => d !== domain),
    });
  });
}

export function isListed(patterns: SenderPatterns | undefined, domain: string, list: "allow" | "deny"): boolean {
  return patterns?.[list].some((p) => domain === p || domain.endsWith(`.${p}`)) ?? false;
}
