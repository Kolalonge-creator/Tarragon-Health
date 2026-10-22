/**
 * Tap-to-define glossary (S55 quality gates, item 12b).
 *
 * The server hands over only terms that are published, in date and named to a reviewer (public.learning_glossary()); an unreviewed
 * term never reaches a client, so this file has nothing to filter. It only finds where a term occurs in a lesson's text so the web
 * and the phone can render it as a tappable word.
 *
 * Rules: whole words only (so "systolic" is not found inside "antisystolic"), case-insensitive, the longest term wins where two
 * overlap, and a term is marked only the FIRST time it appears in a text so a lesson is never a wall of underlines.
 */
export interface GlossaryTerm {
  readonly term: string;
  readonly definition: string;
  /** Other ways the same word is written in lessons, for example "high blood pressure" for "hypertension". */
  readonly aliases?: readonly string[];
}

export interface GlossarySegment {
  readonly text: string;
  readonly term?: GlossaryTerm;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function splitByGlossary(text: string, terms: readonly GlossaryTerm[]): GlossarySegment[] {
  if (!text) return [];
  const forms: { form: string; term: GlossaryTerm }[] = [];
  for (const t of terms) {
    if (!t.term.trim() || !t.definition.trim()) continue;
    for (const f of [t.term, ...(t.aliases ?? [])]) if (f.trim()) forms.push({ form: f.trim(), term: t });
  }
  if (forms.length === 0) return [{ text }];
  forms.sort((a, b) => b.form.length - a.form.length);
  const byLower = new Map(forms.map((f) => [f.form.toLowerCase(), f.term]));
  let pattern: RegExp;
  try {
    pattern = new RegExp(`(?<![A-Za-z0-9])(?:${forms.map((f) => escapeRegExp(f.form)).join("|")})(?![A-Za-z0-9])`, "gi");
  } catch {
    // An engine without lookbehind (older iOS Safari) cannot build this pattern. The glossary must never block a lesson: show the plain text.
    return [{ text }];
  }

  const seen = new Set<GlossaryTerm>();
  const out: GlossarySegment[] = [];
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const term = byLower.get(m[0].toLowerCase());
    if (!term || seen.has(term)) continue;
    seen.add(term);
    const start = m.index ?? 0;
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ text: m[0], term });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
