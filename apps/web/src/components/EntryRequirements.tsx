import { entryLine, needsAction, type VisaTable } from "@travelmo/core";
import type { PersonEntry } from "@/lib/visas";

const monthYear = (date: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));

// What each traveler needs to enter the trip's countries, from the
// Passport Index data: lines needing action stand out; the rest are muted.
export function EntryRequirements({ entries, fetched }: { entries: readonly PersonEntry[]; fetched: VisaTable["fetched"] }) {
  if (!entries.length) return null;
  return (
    <section className="mt-4 rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800" aria-label="Entry requirements">
      <h2 className="font-medium">Entry requirements</h2>
      {entries.map(({ person, entry }) => (
        <ul key={person.uid} className="mt-2 space-y-1">
          {entry.needs.map((need) => {
            const action = needsAction(need.best.rule.kind) && !need.visa;
            return (
              <li
                key={need.country}
                className={action ? "text-amber-800 dark:text-amber-300" : "text-zinc-600 dark:text-zinc-400"}
                data-country={need.country}
                data-kind={need.best.rule.kind}
              >
                {entryLine(person, need)}
              </li>
            );
          })}
        </ul>
      ))}
      <p className="mt-2 text-xs text-zinc-500">
        From Passport Index data as of {monthYear(fetched)}. Rules change and depend on the purpose and length of the stay: check with the embassy
        before you travel.
      </p>
    </section>
  );
}
