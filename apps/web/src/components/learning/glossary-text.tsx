"use client";

import { useMemo, useState } from "react";
import { t } from "@tarragon/i18n";
import { splitByGlossary, type GlossaryTerm } from "@tarragon/shared";
import { useLearningGlossary } from "@/lib/queries/learning-quality";

/**
 * Lesson text with tap-to-define words. The glossary comes only from learning_glossary(), which returns terms that are published, in date
 * and named to a reviewer; an unreviewed term is never in the list, so it is never underlined. With no terms (or while loading, or if the
 * request fails) this renders the plain text, so a lesson is never blocked by its glossary.
 */
export function GlossaryText({ text, className }: { text: string; className?: string }) {
  const { data } = useLearningGlossary();
  const terms: GlossaryTerm[] = useMemo(() => (data ?? []).map((g) => ({ term: g.term, definition: g.definition, aliases: g.aliases })), [data]);
  const segments = useMemo(() => splitByGlossary(text, terms), [text, terms]);
  const [open, setOpen] = useState<GlossaryTerm | null>(null);
  const hasTerms = segments.some((s) => s.term);

  if (!hasTerms) return <div className={className}>{text}</div>;
  return (
    <div className="space-y-2">
      <div className={className}>
        {segments.map((s, i) =>
          s.term ? (
            <button
              key={i}
              type="button"
              aria-expanded={open === s.term}
              onClick={() => setOpen(open === s.term ? null : (s.term ?? null))}
              className="inline cursor-help font-medium text-brand-green underline decoration-dotted underline-offset-4 dark:text-brand-green-bright"
            >
              {s.text}
            </button>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
      </div>
      {open ? (
        <p role="note" className="flex items-start justify-between gap-3 rounded-lg bg-brand-green/5 p-2 text-sm dark:bg-brand-green/10" data-testid="glossary-definition">
          <span>
            <span className="font-semibold">{open.term}: </span>
            {open.definition}
          </span>
          <button type="button" onClick={() => setOpen(null)} className="shrink-0 text-xs underline">
            {t("learn.glossary.close")}
          </button>
        </p>
      ) : (
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/65">{t("learn.glossary.hint")}</p>
      )}
    </div>
  );
}
