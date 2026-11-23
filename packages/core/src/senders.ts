import type { SenderPatterns } from "./schema";

// The user's sender rules (`users/{uid}/settings/patterns`) as Import review
// on the web and Android reads and teaches them; the parser's prefilter.ts
// follows the same rules.

// Reads the domain out of a From header or accepts a bare domain.
export function domainOf(from: string): string | undefined {
  const trimmed = from.trim().toLowerCase();
  const match = /<?[^\s<>@]+@([^\s<>]+?)>?\s*$/.exec(trimmed);
  const domain = match?.[1] ?? (trimmed.includes("@") ? undefined : trimmed);
  return domain && domain.includes(".") ? domain : undefined;
}

// The parser's rule: a pattern covers its own domain and every subdomain.
export function covers(pattern: string, domain: string): boolean {
  return domain === pattern || domain.endsWith(`.${pattern}`);
}

export function isListed(patterns: SenderPatterns | undefined, domain: string, list: "allow" | "deny"): boolean {
  return patterns?.[list].some((pattern) => covers(pattern, domain)) ?? false;
}

// What the parser will do with mail from this domain: denials win, as in
// prefilter.ts, so a child-domain denial beats a parent-domain allowance.
export function effectiveDecision(patterns: SenderPatterns | undefined, domain: string): "allow" | "deny" | undefined {
  if (isListed(patterns, domain, "deny")) return "deny";
  if (isListed(patterns, domain, "allow")) return "allow";
  return undefined;
}

// The rules with a domain added to one list and every pattern that covers
// it taken off the other, so the decision just made is the one the parser
// follows: a parent-domain denial would otherwise keep winning, since the
// parser checks denials first.
export function withLearned(current: SenderPatterns, domain: string, list: "allow" | "deny"): SenderPatterns {
  const other = list === "allow" ? "deny" : "allow";
  return {
    ...current,
    [list]: [...new Set([...current[list], domain])],
    [other]: current[other].filter((pattern) => !covers(pattern, domain)),
  } as SenderPatterns;
}
