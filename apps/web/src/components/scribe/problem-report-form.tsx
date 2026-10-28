"use client";

import { useState } from "react";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DRAFT_SECTION_KEYS, type DraftSectionKey } from "@/lib/scribe/draft-review";
import { MAX_PROBLEM_COMMENT, PROBLEM_CATEGORIES, PROBLEM_LABEL_KEYS, isSafetyCategory, type ProblemCategory } from "@/lib/scribe/problem-report";

export interface ProblemReportInput {
  category: ProblemCategory;
  section: DraftSectionKey | null;
  comment: string;
}

interface Props {
  /** Returns true when the report was recorded. */
  onSubmit: (report: ProblemReportInput) => Promise<boolean>;
  /** Hide the section picker for draft kinds that have no sections. */
  withSection?: boolean;
}

/** "Report a problem with this draft": one category from a fixed list, an optional section and a short comment. */
export function ProblemReportForm({ onSubmit, withSection = true }: Props) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<ProblemCategory | null>(null);
  const [section, setSection] = useState<DraftSectionKey | "">("");
  const [comment, setComment] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  if (!open) {
    return (
      <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(true)}>
        {t("scribeui.problem.button", "en")}
      </Button>
    );
  }

  return (
    <fieldset className="space-y-2 rounded-md border border-charcoal-ink/15 p-3" data-testid="problem-report">
      <legend className="px-1 text-sm font-medium">{t("scribeui.problem.heading", "en")}</legend>
      {PROBLEM_CATEGORIES.map((c) => (
        <label key={c} className="flex items-center gap-2 text-sm">
          <input type="radio" name="scribe-problem" checked={category === c} onChange={() => setCategory(c)} />
          {t(PROBLEM_LABEL_KEYS[c] as Parameters<typeof t>[0], "en")}
        </label>
      ))}
      {withSection && (
        <label className="block text-xs">
          {t("scribeui.problem.section", "en")}
          <select className="ml-2 rounded border border-charcoal-ink/20 p-1" value={section} onChange={(e) => setSection(e.target.value as DraftSectionKey | "")}>
            <option value="" />
            {DRAFT_SECTION_KEYS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="block text-xs">
        {t("scribeui.problem.comment", "en")}
        <Textarea value={comment} rows={2} onChange={(e) => setComment(e.target.value.slice(0, MAX_PROBLEM_COMMENT))} />
      </label>
      {category && isSafetyCategory(category) && <p role="alert" className="text-sm font-medium text-red-700">{t("scribeui.problem.safety", "en")}</p>}
      {state === "sent" && <p role="status" className="text-sm text-tarragon-green">{t("scribeui.problem.sent", "en")}</p>}
      {state === "failed" && <p role="alert" className="text-sm text-red-600">{t("scribeui.problem.failed", "en")}</p>}
      <Button
        size="sm"
        type="button"
        disabled={!category || state === "sending" || state === "sent"}
        onClick={async () => {
          if (!category) return;
          setState("sending");
          const ok = await onSubmit({ category, section: section || null, comment: comment.trim() });
          setState(ok ? "sent" : "failed");
        }}
      >
        {t("scribeui.problem.submit", "en")}
      </Button>
    </fieldset>
  );
}
