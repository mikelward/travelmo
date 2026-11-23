import { SenderPatterns, paths, withLearned } from "@travelmo/core";
import { doc, runTransaction, type Firestore } from "firebase/firestore";

export { covers, domainOf, effectiveDecision, isListed } from "@travelmo/core";

// Teaches the parser a sender (withLearned), on the rules as stored now.
export async function learnSender(db: Firestore, uid: string, domain: string, list: "allow" | "deny"): Promise<void> {
  const ref = doc(db, paths.senderPatterns(uid));
  await runTransaction(db, async (t) => {
    const snap = await t.get(ref);
    t.set(ref, withLearned(SenderPatterns.parse(snap.data() ?? {}), domain, list));
  });
}
