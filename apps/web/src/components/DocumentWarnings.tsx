import type { PersonWarning } from "@travelmo/core";
import { warningText } from "@/lib/documents";

export function DocumentWarnings({ warnings, today, compact }: { warnings: readonly PersonWarning[]; today: string; compact?: boolean }) {
  if (!warnings.length) return null;
  return (
    <ul
      className={compact ? "mt-2 space-y-1 text-sm" : "mt-4 space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950"}
      aria-label="Document warnings"
    >
      {warnings.map((w, i) => (
        <li key={i} className={w.warning.when === "before" ? "text-red-700 dark:text-red-400" : "text-amber-800 dark:text-amber-300"}>
          {warningText(w, today)}
        </li>
      ))}
    </ul>
  );
}
