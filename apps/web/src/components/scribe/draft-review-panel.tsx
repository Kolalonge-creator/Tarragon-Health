"use client";

import { AiLabel } from "@/components/ai/ai-label";
import { useMemo, useState } from "react";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { editTelemetryFromPairs, type EditTelemetry } from "@/lib/ai-text/ai-spans";
import { splitEntities } from "@/lib/scribe/entity-highlight";
import { matchSentences, sentenceKey, visitLines, type SentenceSupport } from "@/lib/scribe/support-match";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import type { ScribeFact } from "@/lib/scribe/facts";
import { blocksUse, defaultSectionFor, findOmissions, unresolvedOmissions, type NoteSection } from "@/lib/scribe/omissions";
import { ProblemReportForm, type ProblemReportInput } from "./problem-report-form";
import { afterEdit, canUseDraft, isEmptySection, setConfirmed, unconfirmed, type Confirmations, type DraftSectionKey } from "@/lib/scribe/draft-review";

const WARNING_KEYS = {
  uncited_text: "scribe.warning.uncited_text",
  unknown_fact_id: "scribe.warning.unknown_fact_id",
  number_not_in_facts: "scribe.warning.number_not_in_facts",
  empty_but_cited: "scribe.warning.empty_but_cited",
} as const;

function warningText(w: { section: string; kind: string; detail?: string }): string {
  const key = WARNING_KEYS[w.kind as keyof typeof WARNING_KEYS];
  return key ? t(key, "en", { section: w.section, detail: w.detail ?? "" }) : `${w.section}: ${w.kind}`;
}

export interface DraftSection {
  history: string;
  examination: string;
  assessment: string;
  plan: string;
  followUp: string;
}

interface DraftReviewPanelProps {
  draft: DraftSection;
  patientSummary: string;
  /** Deterministic checks the server ran on a draft written from confirmed facts (uncited text, unknown ids, invented numbers). */
  warnings?: readonly { section: string; kind: string; detail?: string }[];
  /** What the clinician typed about the visit. When given, the screen is split: the visit text on the left, the draft on the right, and any draft sentence with no support in the visit text is marked. */
  sourceText?: string;
  /** The facts the clinician confirmed. When given, any confirmed fact the draft does not say is listed, and a missing safety item (negation, allergy, red flag) blocks "Use in note" until it is added or left out on purpose. */
  confirmedFacts?: readonly ScribeFact[];
  /** Records a "report a problem" submission; returns true when it was recorded. */
  onReport?: (report: ProblemReportInput) => Promise<boolean>;
  /** The third argument is the browser-side edit-rate figure for this review (S89): computed from what the clinician changed, never sent by this panel. */
  onUse: (draft: DraftSection, patientSummary: string, telemetry: EditTelemetry) => void;
  /** S89: the clinician must tick "I reviewed this draft against the record" before using the draft. Default true. */
  requireAttestation?: boolean;
  onDiscard: () => void;
}

/** Removes the first occurrence of a sentence from a section's text and tidies the whitespace left behind. */
function removeSentence(text: string, sentence: string): string {
  return text.replace(sentence, "").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * The AI draft, held in the browser only. "Use in note" hands it to the note form, which is where the clinician edits,
 * saves and signs it. Nothing is written to the patient record from here (INV-11).
 */
export function DraftReviewPanel({ draft, patientSummary, warnings = [], sourceText, confirmedFacts, onReport, onUse, onDiscard, requireAttestation = true }: DraftReviewPanelProps) {
  const [fields, setFields] = useState({ ...draft, patientSummary });
  // Confirmed facts the draft text does not say. Recomputed from the live text, so typing the fact in by hand resolves it too.
  const [leftOut, setLeftOut] = useState<Record<string, true>>({});
  const [addTo, setAddTo] = useState<Record<string, NoteSection>>({});
  const noteText = [fields.history, fields.examination, fields.assessment, fields.plan, fields.followUp].join("\n");
  const omissions = useMemo(() => findOmissions(confirmedFacts ?? [], noteText), [confirmedFacts, noteText]);
  const openOmissions = unresolvedOmissions(omissions, leftOut);
  const omissionBlocksUse = blocksUse(omissions, leftOut);
  const openSafetyOmissions = openOmissions.filter((o) => o.safety).length;
  const [confirmed, setConfirmedState] = useState<Confirmations>({});
  const [edited, setEdited] = useState<Partial<Record<DraftSectionKey, boolean>>>({});
  const [attested, setAttested] = useState(false);
  const remaining = unconfirmed(confirmed).length;
  const original = { ...draft, patientSummary };

  /** Not reviewed: still exactly the model's text and not confirmed. Edited: changed from the model's text. Confirmed: ticked as read. */
  function sectionState(key: keyof typeof fields): "not_reviewed" | "edited" | "confirmed" | "empty" {
    if (isEmptySection(fields[key]) && !confirmed[key]) return "empty";
    if (confirmed[key]) return "confirmed";
    return fields[key] === original[key] ? "not_reviewed" : "edited";
  }
  // Sentences the clinician decided to keep on purpose, keyed by section and sentence text. Editing a sentence changes its key, so a kept
  // decision never carries over to different words.
  const [kept, setKept] = useState<Record<string, true>>({});
  const [focusLine, setFocusLine] = useState<number | null>(null);
  const hasSource = typeof sourceText === "string" && sourceText.trim() !== "";
  const lines = useMemo(() => (hasSource ? visitLines(sourceText as string) : []), [hasSource, sourceText]);
  const flaggedBySection = useMemo(() => {
    const out: Partial<Record<DraftSectionKey, SentenceSupport[]>> = {};
    if (!hasSource) return out;
    for (const key of Object.keys(fields) as DraftSectionKey[]) {
      const f = matchSentences(fields[key], sourceText as string).filter((x) => x.support === "unsupported");
      if (f.length) out[key] = f;
    }
    return out;
  }, [fields, hasSource, sourceText]);
  const unresolvedIn = (key: DraftSectionKey) => (flaggedBySection[key] ?? []).filter((x) => !kept[`${key}|${sentenceKey(x.text)}`]).length;
  const unresolvedTotal = (Object.keys(flaggedBySection) as DraftSectionKey[]).reduce((n, k) => n + unresolvedIn(k), 0);

  const sections: Array<{ key: keyof typeof fields; label: string }> = [
    { key: "history", label: t("scribe.draft.history", "en") },
    { key: "examination", label: t("scribe.draft.examination", "en") },
    { key: "assessment", label: t("scribe.draft.assessment", "en") },
    { key: "plan", label: t("scribe.draft.plan", "en") },
    { key: "followUp", label: t("scribe.draft.follow_up", "en") },
    { key: "patientSummary", label: t("scribe.draft.patient_summary", "en") },
  ];

  return (
    <Card className="border-amber-300/40">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">{t("scribe.draft.heading", "en")}</CardTitle>
          <AiLabel variant={remaining === 0 ? "drafted" : "unreviewed"} tone="amber" />
        </div>
        <p className="text-xs text-charcoal-ink/50">{t("scribe.draft.disclaimer", "en")}</p>
        <p className="rounded-md bg-amber-50 p-2 text-xs text-charcoal-ink">{t("scribe.review.look_for", "en")}</p>
        {warnings.length > 0 && (
          <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-charcoal-ink">
            <p className="font-medium">{t("scribe.warning.heading", "en")}</p>
            <ul className="list-disc pl-4">
              {warnings.map((w, i) => (
                <li key={`${w.section}-${w.kind}-${i}`}>{warningText(w)}</li>
              ))}
            </ul>
          </div>
        )}
      </CardHeader>
      <CardContent className={hasSource ? "grid gap-4 md:grid-cols-2" : "space-y-4"}>
        {hasSource && (
          <aside className="space-y-1 rounded-md border border-charcoal-ink/15 p-2 text-xs md:sticky md:top-2 md:max-h-[70vh] md:self-start md:overflow-y-auto" data-testid="visit-text">
            <p className="font-medium">{t("scribeui.support.heading", "en")}</p>
            {lines.map((l, i) => (
              <p key={i} data-line={i} data-focused={focusLine === i ? "true" : "false"} className={focusLine === i ? "rounded bg-amber-100 p-1" : "p-1"}>
                {l}
              </p>
            ))}
          </aside>
        )}
        <div className="space-y-4">
        <p className="inline-block rounded border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-amber-800" data-testid="watermark">{t("scribeui.watermark", "en")}</p>
        {omissions.length > 0 && (
          <section aria-label={t("scribeui.omission.heading", "en")} className="space-y-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-charcoal-ink" data-testid="omissions">
            <p className="text-sm font-medium">{t("scribeui.omission.heading", "en")}</p>
            <p>{t("scribeui.omission.intro", "en")}</p>
            <ul className="space-y-2">
              {omissions.map((o) => {
                const isLeftOut = Boolean(leftOut[o.fact.id]);
                const section = addTo[o.fact.id] ?? defaultSectionFor(o.fact.type);
                return (
                  <li key={o.fact.id} className="space-y-1 rounded border border-red-200 bg-white p-2" data-testid="omission">
                    <div className="flex flex-wrap items-center gap-2">
                      {o.safety && <Badge variant="red">{t("scribeui.omission.safety_badge", "en")}</Badge>}
                      <Badge variant="blue">{t(`scribe.fact_type.${o.fact.type}`, "en")}</Badge>
                      <span className="text-sm">{o.fact.text}</span>
                    </div>
                    {isLeftOut ? (
                      <p className="font-medium">{t("scribeui.omission.left_out", "en")}</p>
                    ) : (
                      <div className="flex flex-wrap items-end gap-2">
                        <div>
                          <Label htmlFor={`omission-section-${o.fact.id}`}>{t("scribeui.omission.section_label", "en")}</Label>
                          <Select
                            id={`omission-section-${o.fact.id}`}
                            value={section}
                            onChange={(e) => setAddTo((prev) => ({ ...prev, [o.fact.id]: e.target.value as NoteSection }))}
                          >
                            {(["history", "examination", "assessment", "plan", "followUp"] as const).map((s) => (
                              <option key={s} value={s}>{t(`scribe.draft.${s === "followUp" ? "follow_up" : s}`, "en")}</option>
                            ))}
                          </Select>
                        </div>
                        <Button
                          size="sm"
                          type="button"
                          onClick={() => {
                            setFields((prev) => ({ ...prev, [section]: prev[section].trim() === "" ? o.fact.text : `${prev[section].trimEnd()}\n${o.fact.text}` }));
                            setConfirmedState((prev) => afterEdit(prev, section));
                            setAttested(false);
                          }}
                        >
                          {t("scribeui.omission.add", "en")}
                        </Button>
                        <Button size="sm" type="button" variant="outline" onClick={() => setLeftOut((prev) => ({ ...prev, [o.fact.id]: true }))}>
                          {t("scribeui.omission.leave_out", "en")}
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {sections.map(({ key, label }) => (
          <div key={key}>
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor={`scribe-section-${key}`}>{label}</Label>
              {/* The state is a word as well as a colour, so it never depends on colour to be understood. */}
              <span className="text-xs text-charcoal-ink/70" data-section-state={sectionState(key)}>
                {sectionStateWord(sectionState(key))}
              </span>
            </div>
            <Textarea
              id={`scribe-section-${key}`}
              value={fields[key]}
              onChange={(e) => {
                setFields((prev) => ({ ...prev, [key]: e.target.value }));
                if (confirmed[key]) setEdited((prev) => ({ ...prev, [key]: true }));
                setConfirmedState((prev) => afterEdit(prev, key));
                setAttested(false);
              }}
              // Text still exactly as the model wrote it and not yet confirmed: marked as AI-inserted and unreviewed.
              className={sectionState(key) === "not_reviewed" ? "ring-1 ring-amber-300 bg-amber-50/50" : undefined}
              rows={key === "patientSummary" ? 4 : 3}
            />
            <EntityCheck text={fields[key]} />
            {(flaggedBySection[key] ?? []).map((sentence) => {
              const id = `${key}|${sentenceKey(sentence.text)}`;
              const isKept = Boolean(kept[id]);
              return (
                <div key={id} className="mt-1 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-charcoal-ink" data-testid="unsupported-sentence" onMouseEnter={() => setFocusLine(sentence.sourceLine)}>
                  <p>
                    <span className="mr-2 rounded bg-red-600 px-1 py-0.5 font-semibold text-white">{t("scribeui.support.badge", "en")}</span>
                    {sentence.text}
                  </p>
                  <p className="mt-1 text-charcoal-ink/70">
                    {sentence.sourceLine === null ? t("scribeui.support.no_evidence", "en") : `${t("scribeui.support.evidence", "en")} ${lines[sentence.sourceLine]}`}
                  </p>
                  {isKept ? (
                    <p className="mt-1 font-medium">{t("scribeui.support.kept", "en")}</p>
                  ) : (
                    <>
                      <p className="mt-1">{t("scribeui.support.explain", "en")}</p>
                      <div className="mt-1 flex gap-2">
                        <Button size="sm" variant="outline" type="button" onClick={() => setKept((prev) => ({ ...prev, [id]: true }))}>
                          {t("scribeui.support.keep", "en")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          type="button"
                          onClick={() => {
                            setFields((prev) => ({ ...prev, [key]: removeSentence(prev[key], sentence.text) }));
                            setConfirmedState((prev) => afterEdit(prev, key));
                          }}
                        >
                          {t("scribeui.support.remove", "en")}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
            {isEmptySection(fields[key]) && (
              <p className="mt-1 text-xs text-amber-700">{t(key === "patientSummary" ? "scribe.review.empty_summary" : "scribe.review.empty_flag", "en")}</p>
            )}
            {edited[key] && !confirmed[key] && (
              <p className="mt-1 text-xs text-amber-700">{t("scribe.review.edited", "en")}</p>
            )}
            <label className="mt-1 flex items-center gap-2 text-xs text-charcoal-ink">
              <input
                type="checkbox"
                disabled={unresolvedIn(key) > 0}
                checked={Boolean(confirmed[key])}
                onChange={(e) => {
                  setConfirmedState((prev) => setConfirmed(prev, key, e.target.checked));
                  if (e.target.checked) setEdited((prev) => ({ ...prev, [key]: false }));
                }}
              />
              {isEmptySection(fields[key]) ? t("scribe.review.confirm_empty", "en") : t("scribe.review.confirm_read", "en")}
            </label>
            {!isEmptySection(fields[key]) && (
              <button
                type="button"
                className="mt-1 text-xs text-red-700 underline"
                onClick={() => {
                  setFields((prev) => ({ ...prev, [key]: "" }));
                  setConfirmedState((prev) => setConfirmed(prev, key, true));
                  setEdited((prev) => ({ ...prev, [key]: false }));
                }}
              >
                {t("scribeui.section.reject", "en")}
              </button>
            )}
          </div>
        ))}

        <p className="text-xs text-charcoal-ink/50">{t("scribe.draft.use_help", "en")}</p>
        <p className="text-xs text-charcoal-ink/50">{t("scribe.draft.summary_note", "en")}</p>

        <p role="status" className="text-xs text-charcoal-ink/70">
          {remaining === 0 ? t("scribe.review.all_done", "en") : t("scribe.review.remaining", "en", { count: remaining })}
        </p>
        {unresolvedTotal > 0 && (
          <p role="status" className="text-xs font-medium text-red-700">
            {t("scribeui.support.unresolved", "en", { count: unresolvedTotal })}
          </p>
        )}
        {openSafetyOmissions > 0 && (
          <p role="status" className="text-xs font-medium text-red-700">
            {t("scribeui.omission.unresolved", "en", { count: openSafetyOmissions })}
          </p>
        )}
        {requireAttestation && (
          <label className="flex items-center gap-2 text-xs text-charcoal-ink">
            <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
            I reviewed this draft against the record
          </label>
        )}
        <div className="flex gap-3">
          <Button
            size="sm"
            disabled={!canUseDraft(confirmed) || unresolvedTotal > 0 || omissionBlocksUse || (requireAttestation && !attested)}
            onClick={() =>
              onUse(
                {
                  history: fields.history,
                  examination: fields.examination,
                  assessment: fields.assessment,
                  plan: fields.plan,
                  followUp: fields.followUp,
                },
                fields.patientSummary,
                editTelemetryFromPairs((Object.keys(original) as (keyof typeof original)[]).map((k) => ({ original: original[k], final: fields[k] }))),
              )
            }
          >
            {t("scribe.draft.use", "en")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDiscard}>
            {t("scribe.draft.discard", "en")}
          </Button>
        </div>
        {onReport && <ProblemReportForm onSubmit={onReport} />}
        </div>
      </CardContent>
    </Card>
  );
}

function sectionStateWord(state: "not_reviewed" | "edited" | "confirmed" | "empty"): string {
  return { not_reviewed: "AI text, not reviewed", edited: "Edited, not yet confirmed", confirmed: "Confirmed", empty: "Empty, not yet confirmed" }[state];
}

/**
 * S11-S15 Q19: every drug name and number in the section, marked, so the signing clinician checks them one by one against what was
 * said. A read-only copy of the text sits under the box (the box itself cannot colour words). It shows only when the section has any.
 */
function EntityCheck({ text }: { text: string }) {
  const parts = splitEntities(text);
  if (!parts.some((p) => p.kind)) return null;
  return (
    <div className="mt-1 rounded-md border border-amber-200 bg-amber-50/60 p-2 text-xs text-charcoal-ink" data-testid="entity-check">
      <p className="mb-1 font-medium">{t("scribe.review.check_these", "en")}</p>
      <p className="whitespace-pre-wrap">
        {parts.map((p, i) =>
          p.kind ? (
            <mark key={i} data-kind={p.kind} className={p.kind === "drug" ? "rounded bg-amber-200 px-0.5 font-semibold" : "rounded bg-sky-200 px-0.5 font-semibold"}>
              {p.text}
            </mark>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </p>
    </div>
  );
}
