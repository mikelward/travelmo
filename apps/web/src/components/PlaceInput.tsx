"use client";

import { useEffect, useId, useRef, useState } from "react";
import { autocomplete, placeDetails, placesKey, type PickedPlace, type Suggestion } from "@/lib/placesApi";

// A place name field that offers places as the user types (the start of an
// address, a UK postcode, a US ZIP) when a Places API key is configured, and
// is a plain input otherwise. Picking a suggestion hands the caller the
// place's name, city, country and address.
export function PlaceInput({
  value,
  onChange,
  onPick,
  onPending,
  label,
  placeholder,
  className,
}: {
  value: string;
  onChange: (name: string) => void;
  onPick: (place: PickedPlace) => void;
  // Told when a pick's details are on their way and when they have landed
  // (or been superseded), so a form can hold its submit until then.
  onPending?: (pending: boolean) => void;
  // Its accessible name: the wrapping label also holds other controls.
  label: string;
  placeholder?: string;
  className?: string;
}) {
  const key = placesKey();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState<string>();
  // One billing session per lookup: from the first keystroke to the pick.
  const session = useRef<string>(undefined);
  const typed = useRef(false);
  const pending = useRef<AbortController>(undefined);
  // Counts edits and picks: a details answer applies only while the pick it
  // belongs to is still the latest thing the user did.
  const generation = useRef(0);
  // The details fetch of the current pick, dropped when the field goes away
  // (a type change swaps the fields), so its answer cannot land on a
  // different field's state.
  const detailsPending = useRef<AbortController>(undefined);
  const mounted = useRef(true);
  const listId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      detailsPending.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!key || !typed.current) return;
    const input = value.trim();
    // Fewer than three characters match too much; the change handler has
    // already cleared the list.
    if (input.length < 3) return;
    const timer = setTimeout(async () => {
      pending.current?.abort();
      const controller = new AbortController();
      pending.current = controller;
      session.current ??= crypto.randomUUID();
      try {
        const found = await autocomplete(input, session.current, key, fetch, controller.signal);
        if (controller.signal.aborted) return;
        setSuggestions(found);
        setOpen(found.length > 0);
        setActive(-1);
        setError(undefined);
      } catch (e) {
        if (controller.signal.aborted) return;
        setSuggestions([]);
        setOpen(false);
        setError((e as Error).message);
      }
    }, 300);
    // A newer value, or an unmount, makes the request in flight stale too:
    // its answer must not reopen the list for text that is gone.
    return () => {
      clearTimeout(timer);
      pending.current?.abort();
    };
  }, [value, key]);

  const pick = async (suggestion: Suggestion) => {
    pending.current?.abort();
    setOpen(false);
    setSuggestions([]);
    typed.current = false;
    const mine = ++generation.current;
    const token = session.current ?? crypto.randomUUID();
    session.current = undefined;
    if (!key) return;
    // The name shows at once; the rest follows when the details arrive.
    onChange(suggestion.mainText);
    onPending?.(true);
    detailsPending.current?.abort();
    const controller = new AbortController();
    detailsPending.current = controller;
    let details: Omit<PickedPlace, "name"> = {};
    try {
      details = await placeDetails(suggestion.placeId, token, key, fetch, controller.signal);
    } catch (e) {
      // The name is still worth keeping; the rest can be typed.
      if (mounted.current && generation.current === mine && !controller.signal.aborted) setError((e as Error).message);
    } finally {
      onPending?.(false);
    }
    // Typed over, picked again, or the field itself gone, while the details
    // were on their way.
    if (!mounted.current || controller.signal.aborted || generation.current !== mine) return;
    onPick({ name: suggestion.mainText, ...details });
  };

  if (!key) return <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={className} />;

  return (
    <div className="relative min-w-0 flex-1">
      <input
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        value={value}
        placeholder={placeholder}
        className={className}
        onChange={(e) => {
          typed.current = true;
          generation.current += 1;
          // Typing over a pick ends its lookup too, so a slow answer neither
          // lands nor keeps the form's submit held.
          detailsPending.current?.abort();
          // The list answered the old text; until the new answer comes, there
          // is nothing to pick (and nothing for Enter to pick by mistake).
          setSuggestions([]);
          setOpen(false);
          setActive(-1);
          onChange(e.target.value);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, suggestions.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            void pick(suggestions[active]!);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 z-10 mt-1 max-h-64 overflow-auto rounded-lg border border-zinc-300 bg-white text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-950"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.placeId}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // Mouse down, not click: a click would blur the input first and close the list.
              onMouseDown={(e) => {
                e.preventDefault();
                void pick(s);
              }}
              className={`cursor-pointer px-3 py-2 ${i === active ? "bg-zinc-100 dark:bg-zinc-900" : ""}`}
            >
              <span className="block">{s.mainText}</span>
              {s.secondaryText && <span className="block text-xs text-zinc-500">{s.secondaryText}</span>}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
