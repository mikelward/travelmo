"use client";

import type { ReactNode } from "react";

export type HubItem<T extends string> = {
  id: T;
  label: string;
  meta: string;
};

export type HubGroup<T extends string> = {
  heading?: string;
  items: HubItem<T>[];
};

/**
 * Shared Hub + Sub-pages layout used by Profile and Settings:
 * - On desktop (md+): sidebar master-detail with live summaries on the left
 *   and the selected section on the right.
 * - On narrow viewports: a hub directory that drills into a focused sub-page
 *   with a back button.
 */
export function SectionHub<T extends string>({
  navLabel,
  backLabel,
  groups,
  selected,
  defaultSection,
  hideBack = false,
  onSelect,
  onBack,
  children,
}: {
  navLabel: string;
  backLabel: string;
  groups: HubGroup<T>[];
  selected: T | null;
  defaultSection: T;
  hideBack?: boolean;
  onSelect: (id: T) => void;
  onBack: () => void;
  children: ReactNode;
}) {
  const effective = selected ?? defaultSection;
  return (
    <div className="md:grid md:grid-cols-[15rem_1fr] md:items-start md:gap-6">
      <nav aria-label={navLabel} className={selected !== null ? "hidden md:block" : "block"}>
        <div className="space-y-6">
          {groups.map((group, idx) => (
            <div key={group.heading ?? idx}>
              {group.heading && <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{group.heading}</p>}
              <ul className="divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {group.items.map((item) => {
                  const active = effective === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        aria-current={active ? "page" : undefined}
                        onClick={() => onSelect(item.id)}
                        className={`flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-zinc-100 dark:hover:bg-zinc-900 ${
                          active ? "md:bg-zinc-100 dark:md:bg-zinc-900" : ""
                        }`}
                      >
                        <div className="min-w-0">
                          <div>{item.label}</div>
                          <div className="truncate text-muted">{item.meta}</div>
                        </div>
                        <span aria-hidden="true" className="text-muted md:hidden">
                          ›
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      <div className={selected === null ? "hidden md:block" : "block"}>
        {selected !== null && !hideBack && (
          <button type="button" onClick={onBack} className="mb-4 text-muted hover:underline md:hidden">
            ← {backLabel}
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
