"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { HubLine, HubSection } from "./hub-sections";

function matches(line: HubLine, query: string): boolean {
  if (!query) return true;
  return `${line.title} ${line.detail} ${line.chip.label}`.toLowerCase().includes(query);
}

/**
 * One line of the overview: a native <details> whose summary is a single row (name and status), so the whole hub fits on a phone
 * screen. The signing panel only mounts the first time the line is opened, so a collapsed line does no client work, and it stays
 * mounted afterwards so a half-filled form survives closing and reopening. Opening from a link (`#item-...`, the S06 to S10 banner,
 * the move to the next line after a signing) sets `open` on the element, which fires `toggle`, so those paths mount it too.
 */
function HubLineRow({ line, hidden }: { line: HubLine; hidden: boolean }) {
  const [mounted, setMounted] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  // A tap before the page's scripts loaded opens the element without a toggle we heard: mount the panel on hydration then.
  useEffect(() => {
    if (detailsRef.current?.open) setMounted(true);
  }, []);
  const bodyId = `${line.id}-body`;

  return (
    <li hidden={hidden}>
      <details
        ref={detailsRef}
        id={line.id}
        data-hub-line={line.key}
        onToggle={(e) => {
          if (e.currentTarget.open) setMounted(true);
        }}
        className="group scroll-mt-20 border-b border-charcoal-ink/10 last:border-b-0 open:bg-brand-green/5"
      >
        <summary
          aria-controls={bodyId}
          className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm hover:bg-charcoal-ink/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-green [&::-webkit-details-marker]:hidden"
        >
          <ChevronDown className="h-4 w-4 shrink-0 text-charcoal-ink/50 transition-transform group-open:rotate-180" aria-hidden />
          <span className="min-w-0 flex-1 font-medium leading-snug text-charcoal-ink">
            {line.title}
            {line.count && line.count > 1 ? <span className="font-normal text-charcoal-ink/60"> ({line.count})</span> : null}
          </span>
          <Badge variant={line.chip.variant} className="shrink-0 whitespace-nowrap">
            {line.chip.label}
          </Badge>
        </summary>
        <div id={bodyId} className="space-y-3 border-t border-charcoal-ink/10 px-3 pb-4 pt-3 text-sm">
          {line.detail && <p className="text-charcoal-ink/70">{line.detail}</p>}
          {line.panel ? (
            mounted ? (
              <div data-hub-panel>{line.panel}</div>
            ) : null
          ) : (
            <Link href={line.href} className="inline-block font-medium text-brand-green underline underline-offset-4">
              Open its page
            </Link>
          )}
        </div>
      </details>
    </li>
  );
}

/**
 * The sign-off hub at a glance: every line in every section visible at once, one row each, grouped with counts, and a search box
 * over the names. Each row opens in place to the same panel and Sign button the page always had.
 */
export function HubOverview({ sections }: { sections: HubSection[] }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const total = sections.reduce((n, s) => n + s.lines.length, 0);

  return (
    <div className="space-y-4">
      <nav aria-label="Sections" className="flex flex-wrap gap-2 text-xs">
        {sections.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="rounded-full border border-charcoal-ink/15 px-3 py-1 font-medium text-charcoal-ink/80 hover:border-brand-green/50 hover:text-brand-green"
          >
            {s.heading} <span className="text-charcoal-ink/60">{s.lines.length}</span>
          </a>
        ))}
      </nav>

      {total > 0 && (
        <div>
          <label htmlFor="hub-search" className="sr-only">
            Find an item by name
          </label>
          <input
            id="hub-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find an item by name"
            autoComplete="off"
            className="h-11 w-full rounded-xl border border-charcoal-ink/20 bg-white px-3 text-sm text-charcoal-ink placeholder:text-charcoal-ink/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
          />
        </div>
      )}

      {sections.map((s) => {
        const shown = s.lines.filter((l) => matches(l, q)).length;
        const headingId = `${s.id}-heading`;
        return (
          <section key={s.id} id={s.id} aria-labelledby={headingId} className="scroll-mt-20 space-y-2">
            <div>
              <h2 id={headingId} className="text-base font-semibold text-charcoal-ink">
                {s.heading}{" "}
                <span data-testid={`${s.id}-count`} className="font-normal text-charcoal-ink/60">
                  ({q ? `${shown} of ${s.lines.length}` : s.lines.length})
                </span>
              </h2>
              <p className="text-xs text-charcoal-ink/60">{s.hint}</p>
            </div>
            {s.lines.length === 0 ? (
              s.emptyText ? <p className="rounded-xl border border-charcoal-ink/10 px-3 py-3 text-sm text-charcoal-ink/60">{s.emptyText}</p> : null
            ) : (
              <>
                <ul className="overflow-hidden rounded-xl border border-charcoal-ink/10 bg-white">
                  {s.lines.map((line) => (
                    <HubLineRow key={line.key} line={line} hidden={!matches(line, q)} />
                  ))}
                </ul>
                {q && shown === 0 && <p className="text-xs text-charcoal-ink/60">Nothing here matches &ldquo;{query.trim()}&rdquo;.</p>}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
