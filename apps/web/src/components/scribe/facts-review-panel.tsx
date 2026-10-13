"use client";

import { useMemo, useState } from "react";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FACT_TYPES, type FactType, type ScribeFact } from "@/lib/scribe/facts";
import {
  EMPTY_REVIEW,
  addFact,
  canWriteDraft,
  confirmedFacts,
  decide,
  editText,
  orderedForReview,
  removeAdded,
  undecided,
  type FactsReviewState,
} from "@/lib/scribe/facts-review";

interface Props {
  facts: readonly ScribeFact[];
  dropped: number;
  onWrite: (confirmed: ScribeFact[]) => void;
  onBack: () => void;
}

/**
 * Stage one's output for the clinician to decide on. No "confirm all" (it would turn this into a skim); negations, allergies
 * and safety items are listed first; a fact the model missed can be added. Held in the browser only: nothing here is stored.
 */
export function FactsReviewPanel({ facts, dropped, onWrite, onBack }: Props) {
  const [review, setReview] = useState<FactsReviewState>(EMPTY_REVIEW);
  const [addType, setAddType] = useState<FactType>("symptom");
  const [addText, setAddText] = useState("");
  const ordered = useMemo(() => orderedForReview(facts), [facts]);
  const remaining = undecided(facts, review).length;

  return (
    <Card className="border-amber-300/40">
      <CardHeader>
        <CardTitle className="text-base">{t("scribe.facts.heading", "en")}</CardTitle>
        <p className="text-xs text-charcoal-ink/60">{t("scribe.facts.intro", "en")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {dropped > 0 && <p role="status" className="text-xs text-amber-700">{t("scribe.facts.dropped", "en", { count: dropped })}</p>}
        {facts.length === 0 && <p role="status" className="text-sm text-charcoal-ink">{t("scribe.facts.none_found", "en")}</p>}

        <ul className="space-y-3">
          {ordered.map((f) => {
            const decision = review.decisions[f.id];
            return (
              <li key={f.id} className="space-y-1 rounded-md border border-charcoal-ink/10 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={f.type === "negated_symptom" || f.type === "red_flag" || f.type === "allergy" ? "red" : "blue"}>
                    {t(`scribe.fact_type.${f.type}`, "en")}
                  </Badge>
                  {decision && <Badge variant={decision === "confirmed" ? "green" : "grey"}>{t(decision === "confirmed" ? "scribe.facts.confirmed" : "scribe.facts.rejected", "en")}</Badge>}
                </div>
                <Label htmlFor={`fact-${f.id}`} className="sr-only">{t("scribe.facts.correct_label", "en")}</Label>
                <Textarea
                  id={`fact-${f.id}`}
                  rows={2}
                  value={review.edits[f.id] ?? f.text}
                  onChange={(e) => setReview((r) => editText(r, f.id, e.target.value))}
                />
                <p className="text-xs text-charcoal-ink/60">
                  {t("scribe.facts.from_notes", "en")} <q>{f.quote}</q>
                </p>
                <div className="flex gap-2">
                  {decision ? (
                    <Button size="sm" variant="ghost" onClick={() => setReview((r) => decide(r, f.id, null))}>{t("scribe.facts.change", "en")}</Button>
                  ) : (
                    <>
                      <Button size="sm" onClick={() => setReview((r) => decide(r, f.id, "confirmed"))}>{t("scribe.facts.confirm", "en")}</Button>
                      <Button size="sm" variant="outline" onClick={() => setReview((r) => decide(r, f.id, "rejected"))}>{t("scribe.facts.reject", "en")}</Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
          {review.added.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 rounded-md border border-brand-green/30 p-2 text-sm">
              <Badge variant="green">{t("scribe.facts.added_by_you", "en")}</Badge>
              <Badge variant="blue">{t(`scribe.fact_type.${f.type}`, "en")}</Badge>
              <span>{f.text}</span>
              <Button size="sm" variant="ghost" onClick={() => setReview((r) => removeAdded(r, f.id))}>{t("scribe.facts.remove", "en")}</Button>
            </li>
          ))}
        </ul>

        <div className="space-y-2 rounded-md bg-charcoal-ink/5 p-2">
          <p className="text-sm font-medium">{t("scribe.facts.add_heading", "en")}</p>
          <div>
            <Label htmlFor="add-fact-type">{t("scribe.facts.add_type", "en")}</Label>
            <Select id="add-fact-type" value={addType} onChange={(e) => setAddType(e.target.value as FactType)}>
              {FACT_TYPES.map((ft) => (
                <option key={ft} value={ft}>{t(`scribe.fact_type.${ft}`, "en")}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="add-fact-text">{t("scribe.facts.add_text", "en")}</Label>
            <Textarea id="add-fact-text" rows={2} value={addText} maxLength={300} onChange={(e) => setAddText(e.target.value)} />
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={addText.trim() === ""}
            onClick={() => {
              setReview((r) => addFact(r, addType, addText));
              setAddText("");
            }}
          >
            {t("scribe.facts.add_button", "en")}
          </Button>
        </div>

        <p role="status" className="text-xs text-charcoal-ink/70">
          {remaining === 0 ? t("scribe.facts.all_decided", "en") : t("scribe.facts.remaining", "en", { count: remaining })}
        </p>
        <div className="flex gap-3">
          <Button size="sm" disabled={!canWriteDraft(facts, review)} onClick={() => onWrite(confirmedFacts(facts, review))}>
            {t("scribe.facts.write_draft", "en")}
          </Button>
          <Button size="sm" variant="ghost" onClick={onBack}>{t("scribe.facts.back", "en")}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
