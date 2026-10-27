"use client";

import { useState } from "react";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AiLabel } from "@/components/ai/ai-label";
import { editTelemetryFromPairs, type EditTelemetry } from "@/lib/ai-text/ai-spans";
import { splitEntities } from "@/lib/scribe/entity-highlight";
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
  /** The third argument is the browser-side edit-rate figure for this review (S89): computed from what the clinician changed, never sent by this panel. */
  onUse: (draft: DraftSection, patientSummary: string, telemetry: EditTelemetry) => void;
  /** S89: the clinician must tick "I reviewed this draft against the record" before using the draft. Default true. */
  requireAttestation?: boolean;
  onDiscard: () => void;
}

/**
 * The AI draft, held in the browser only. "Use in note" hands it to the note form, which is where the clinician edits,
 * saves and signs it. Nothing is written to the patient record from here (INV-11).
 */
export function DraftReviewPanel({ draft, patientSummary, warnings = [], onUse, onDiscard, requireAttestation = true }: DraftReviewPanelProps) {
  const [fields, setFields] = useState({ ...draft, patientSummary });
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
          <Badge variant="amber">Draft</Badge>
          <AiLabel reviewed={remaining === 0} />
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
      <CardContent className="space-y-4">
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
            {isEmptySection(fields[key]) && (
              <p className="mt-1 text-xs text-amber-700">{t(key === "patientSummary" ? "scribe.review.empty_summary" : "scribe.review.empty_flag", "en")}</p>
            )}
            {edited[key] && !confirmed[key] && (
              <p className="mt-1 text-xs text-amber-700">{t("scribe.review.edited", "en")}</p>
            )}
            <label className="mt-1 flex items-center gap-2 text-xs text-charcoal-ink">
              <input
                type="checkbox"
                checked={Boolean(confirmed[key])}
                onChange={(e) => {
                  setConfirmedState((prev) => setConfirmed(prev, key, e.target.checked));
                  if (e.target.checked) setEdited((prev) => ({ ...prev, [key]: false }));
                }}
              />
              {isEmptySection(fields[key]) ? t("scribe.review.confirm_empty", "en") : t("scribe.review.confirm_read", "en")}
            </label>
          </div>
        ))}

        <p className="text-xs text-charcoal-ink/50">{t("scribe.draft.use_help", "en")}</p>
        <p className="text-xs text-charcoal-ink/50">{t("scribe.draft.summary_note", "en")}</p>

        <p role="status" className="text-xs text-charcoal-ink/70">
          {remaining === 0 ? t("scribe.review.all_done", "en") : t("scribe.review.remaining", "en", { count: remaining })}
        </p>
        {requireAttestation && (
          <label className="flex items-center gap-2 text-xs text-charcoal-ink">
            <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
            I reviewed this draft against the record
          </label>
        )}
        <div className="flex gap-3">
          <Button
            size="sm"
            disabled={!canUseDraft(confirmed) || (requireAttestation && !attested)}
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
