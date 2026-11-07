"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import type { NavSection } from "@/lib/navigation";

/**
 * The governance index (DW-02): every governance, quality, rules and operations page in one place, grouped, so the doctor's
 * sidebar can hold daily clinical work. A filter box narrows the ~90 links as you type (CMO command centre, 2026-11-07).
 * Nothing here is gated by this page; each destination keeps its own access check.
 */
export function GovernanceIndex({ sections }: { sections: readonly NavSection[] }) {
  const [query, setQuery] = useState("");
  const inputId = useId();
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      sections
        .map((s) => ({
          ...s,
          items: q ? s.items.filter((i) => i.label.toLowerCase().includes(q) || (s.label ?? "").toLowerCase().includes(q)) : s.items,
        }))
        .filter((s) => s.items.length > 0),
    [sections, q]
  );
  const total = filtered.reduce((n, s) => n + s.items.length, 0);

  return (
    <div className="space-y-4">
      <div className="max-w-md">
        <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-charcoal-ink">
          Find a governance page
        </label>
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="For example: incidents, triage, AI, rota"
          className="min-h-11 w-full rounded-xl border border-charcoal-ink/15 bg-white px-3 text-sm focus-visible:outline-2 focus-visible:outline-brand-green"
        />
        <p className="mt-1 text-xs text-charcoal-ink/55" aria-live="polite">
          {q ? `${total} page${total === 1 ? "" : "s"} match.` : `${total} pages.`}
        </p>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-2xl bg-white p-5 text-sm text-charcoal-ink/70">
          No governance page matches &ldquo;{query}&rdquo;. Try a shorter word, or use the search at the top of the page.
        </p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {filtered.map((section, index) => {
            const headingId = `gov-${index}`;
            return (
              <section key={section.label ?? index} aria-labelledby={headingId} className="rounded-2xl bg-white p-5">
                <h2 id={headingId} className="font-heading text-lg font-semibold text-charcoal-ink">
                  {section.label}
                </h2>
                <ul className="mt-3 divide-y divide-charcoal-ink/10">
                  {section.items.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="flex min-h-11 items-center text-sm text-charcoal-ink hover:text-brand-green hover:underline focus-visible:outline-2 focus-visible:outline-brand-green"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
