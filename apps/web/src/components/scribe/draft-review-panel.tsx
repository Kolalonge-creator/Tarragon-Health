"use client";

import { useState } from "react";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  onUse: (draft: DraftSection, patientSummary: string) => void;
  onDiscard: () => void;
}

/**
 * The AI draft, held in the browser only. "Use in note" hands it to the note form, which is where the clinician edits,
 * saves and signs it. Nothing is written to the patient record from here (INV-11).
 */
export function DraftReviewPanel({ draft, patientSummary, warnings = [], onUse, onDiscard }: DraftReviewPanelProps) {
  const [fields, setFields] = useState({ ...draft, patientSummary });
  const [confirmed, setConfirmedState] = useState<Confirmations>({});
  const [edited, setEdited] = useState<Partial<Record<DraftSectionKey, boolean>>>({});
  const remaining = unconfirmed(confirmed).length;

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
            <Label>{label}</Label>
            <Textarea
              value={fields[key]}
              onChange={(e) => {
                setFields((prev) => ({ ...prev, [key]: e.target.value }));
                if (confirmed[key]) setEdited((prev) => ({ ...prev, [key]: true }));
                setConfirmedState((prev) => afterEdit(prev, key));
              }}
              rows={key === "patientSummary" ? 4 : 3}
            />
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
        <div className="flex gap-3">
          <Button
            size="sm"
            disabled={!canUseDraft(confirmed)}
            onClick={() =>
              onUse(
                {
                  history: fields.history,
                  examination: fields.examination,
                  assessment: fields.assessment,
                  plan: fields.plan,
                  followUp: fields.followUp,
                },
                fields.patientSummary
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
