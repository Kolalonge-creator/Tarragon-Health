"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { APP_ICON, NAV_ICON } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { searchFeatures, PATIENT_FEATURES, type PatientFeature } from "@/lib/patient/feature-registry";

/**
 * "Type what you want" for the patient app.
 *
 * The 2026-09-02 discovery audit found the app had no search of any kind, so
 * a patient who knew exactly what she wanted ("period tracking") had no way
 * to say so — the sidebar was the only map, and cycle tracking was not on it.
 * This is the cheapest fix for that and the one that makes burial depth stop
 * mattering: however deep a card sits, naming it gets you there.
 *
 * It searches the registry (lib/patient/feature-registry.ts), not the
 * patient's data. Nothing here reads a record, so there is no PHI in this
 * component and no query to leak — a deliberate line, because a search box
 * that also searched results would need a very different privacy story.
 *
 * Results land on the card itself via the registry's #anchors, which
 * FeatureAnchor then flashes so the eye finds it.
 */
export function FeatureSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // With nothing typed, show a handful of the things people most often go
  // looking for rather than an empty box. An empty state that suggests
  // nothing teaches the patient the search knows nothing.
  const suggestions = useMemo(
    () =>
      [
        "cycle-tracking",
        "check-my-pack",
        "result-documents",
        "screening-calendar",
        "data-rights",
        "emergency-card",
      ]
        .map((id) => PATIENT_FEATURES.find((f) => f.id === id))
        .filter((f): f is PatientFeature => f !== undefined),
    [],
  );

  const results = query.trim().length >= 2 ? searchFeatures(query) : suggestions;

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setHighlighted(0);
  }, []);

  const go = useCallback(
    (feature: PatientFeature) => {
      close();
      router.push(feature.href);
    },
    [close, router],
  );

  // Cmd/Ctrl-K from anywhere, Escape to leave. Deliberately not bound to "/"
  // alone: a patient typing a symptom into a form should never have the
  // keystroke stolen out from under them.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && results[highlighted]) {
      e.preventDefault();
      go(results[highlighted]);
    }
  }

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${highlighted}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlighted]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search everything you can do here"
        className="flex items-center gap-2 rounded-lg border border-charcoal-ink/15 px-2.5 py-1.5 text-sm text-charcoal-ink/50 transition-colors hover:border-charcoal-ink/30 hover:text-charcoal-ink/70 sm:min-w-[200px]"
      >
        <NAV_ICON.search className="h-4 w-4 shrink-0" strokeWidth={2} />
        <span className="hidden sm:inline">Search</span>
        <kbd className="ml-auto hidden rounded border border-charcoal-ink/15 px-1.5 py-0.5 font-sans text-[11px] text-charcoal-ink/40 lg:inline">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] print:hidden" role="dialog" aria-modal="true" aria-label="Search">
          <button
            aria-label="Close search"
            className="absolute inset-0 bg-charcoal-ink/40"
            onClick={close}
          />
          <div className="absolute inset-x-4 top-16 mx-auto max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl sm:inset-x-0">
            <div className="flex items-center gap-3 border-b border-charcoal-ink/10 px-4">
              <NAV_ICON.search className="h-4.5 w-4.5 shrink-0 text-charcoal-ink/40" strokeWidth={2} />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  // Reset the highlight here rather than in an effect on
                  // `query`: the result list changes as a direct consequence
                  // of this keystroke, so keeping the two in one event avoids
                  // the cascading render an effect would cause.
                  setHighlighted(0);
                }}
                onKeyDown={onInputKeyDown}
                type="text"
                placeholder="What are you looking for?"
                aria-label="What are you looking for?"
                autoComplete="off"
                className="w-full bg-transparent py-4 text-base text-charcoal-ink outline-none placeholder:text-charcoal-ink/35"
              />
              <button
                type="button"
                onClick={close}
                aria-label="Close search"
                className="shrink-0 rounded-lg p-1.5 text-charcoal-ink/40 hover:bg-charcoal-ink/5 hover:text-charcoal-ink"
              >
                <NAV_ICON.close className="h-4.5 w-4.5" strokeWidth={2} />
              </button>
            </div>

            {query.trim().length < 2 && (
              <p className="px-4 pt-3 text-[11px] font-semibold uppercase tracking-wider text-charcoal-ink/40">
                Things people look for
              </p>
            )}

            {results.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-charcoal-ink/60">
                  Nothing here matches “{query.trim()}”.
                </p>
                <p className="mt-1 text-sm text-charcoal-ink/50">
                  Your care team can help with anything the app does not cover.
                </p>
              </div>
            ) : (
              <ul ref={listRef} className="max-h-[55vh] overflow-y-auto p-2">
                {results.map((feature, index) => {
                  const Icon = APP_ICON[feature.icon];
                  return (
                    <li key={feature.id}>
                      <button
                        type="button"
                        data-index={index}
                        onClick={() => go(feature)}
                        onMouseEnter={() => setHighlighted(index)}
                        className={cn(
                          "flex w-full items-start gap-3 rounded-xl p-3 text-left transition-colors",
                          index === highlighted ? "bg-soft-sage" : "hover:bg-charcoal-ink/[0.03]",
                        )}
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white">
                          <Icon className="h-4 w-4 text-deep-forest" strokeWidth={2} />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-charcoal-ink">
                            {feature.label}
                          </span>
                          <span className="mt-0.5 block text-sm leading-snug text-charcoal-ink/60">
                            {feature.blurb}
                          </span>
                        </span>
                        <span className="ml-auto hidden shrink-0 self-center text-[11px] text-charcoal-ink/35 sm:block">
                          {feature.group}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
