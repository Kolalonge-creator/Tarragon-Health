"use client";

import { useState } from "react";
import Link from "next/link";
import { t } from "@tarragon/i18n";
import { buildNextStep, buildTrustLine } from "@tarragon/shared";
import { Button } from "@/components/ui/button";
import { useHealthEducationItemTrust, useSaveLessonForConsultation } from "@/lib/queries/learning-centre";
import { absoluteUrl } from "@/lib/marketing/site";
import { MembersOnlyPrompt } from "./members-only-prompt";
import { ShareLessonButtons } from "./share-lesson-buttons";

/**
 * The fixed template under every learning item (spec 9.4, 9.6, 9.8): who reviewed it and when, the sources, the required
 * "What can I do next?" block, and the "when to get urgent help" box. Only the self-care step is authored with the content;
 * everything else here is fixed copy that no creator or editor can change or leave out.
 */
export function LearningItemFooter({
  code,
  title,
  showNextStep = true,
}: {
  code: string;
  title: string;
  showNextStep?: boolean;
}) {
  const { data: trust } = useHealthEducationItemTrust(code);
  const save = useSaveLessonForConsultation();
  const [saved, setSaved] = useState<"idle" | "done" | "failed">("idle");

  const line = buildTrustLine({
    reviewedByName: trust?.reviewed_by_name,
    reviewedAt: trust?.reviewed_at,
    nextReviewDue: trust?.next_review_due,
    sourceReference: trust?.source_reference,
    evidenceSource: trust?.evidence_source,
    clinicalAuthorName: trust?.clinical_author_name,
    creatorName: trust?.creator_name,
  });
  const actions = buildNextStep(trust?.self_care_action);
  // The server says whether the public link would actually open (article, shareable, reviewed, dated, in date): never offer a link that 404s.
  const canShare = trust?.is_shareable === true;

  async function ask() {
    try {
      setSaved((await save.mutateAsync(code)) ? "done" : "failed");
    } catch {
      setSaved("failed");
    }
  }

  return (
    <div className="space-y-4 border-t border-charcoal-ink/10 pt-4 dark:border-night-ink/15">
      <div className="space-y-0.5 text-xs text-charcoal-ink/60 dark:text-night-ink/65" data-testid="trust-line">
        {line.author && <p>{t("learn.trust.author", "en", { name: line.author })}</p>}
        {line.reviewedBy && <p>{t("learn.trust.reviewed_by", "en", { name: line.reviewedBy })}</p>}
        {line.reviewedOn && <p>{t("learn.trust.reviewed_on", "en", { date: line.reviewedOn })}</p>}
        {line.nextReview && <p>{t("learn.trust.next_review", "en", { date: line.nextReview })}</p>}
        {line.sources && <p>{t("learn.trust.sources", "en", { sources: line.sources })}</p>}
        {line.incomplete && <p>{t("learn.trust.pending")}</p>}
      </div>

      {trust?.members_only === true && <MembersOnlyPrompt creatorName={trust.creator_name} />}

      {showNextStep && (
        <section aria-labelledby={`next-${code}`} className="space-y-2 rounded-xl bg-brand-green/5 p-3 dark:bg-brand-green/10">
          <h3 id={`next-${code}`} className="text-sm font-semibold text-charcoal-ink dark:text-night-ink">
            {t("learn.next.title")}
          </h3>
          <ul className="space-y-2 text-sm text-charcoal-ink/90 dark:text-night-ink/90">
            {actions.map((a) => {
              if (a.kind === "self_care")
                return (
                  <li key={a.kind}>
                    <span className="font-medium">{t("learn.next.self_care")}: </span>
                    {a.text}
                  </li>
                );
              if (a.kind === "ask_care_team")
                return (
                  <li key={a.kind} className="space-y-1">
                    <Button size="sm" variant="outline" onClick={ask} disabled={save.isPending || saved === "done"}>
                      {t("learn.next.ask")}
                    </Button>
                    {saved === "done" && <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{t("learn.next.ask_done")}</p>}
                    {saved === "failed" && <p className="text-xs text-red-700 dark:text-red-300">{t("learn.next.ask_failed")}</p>}
                  </li>
                );
              if (a.kind === "book")
                return (
                  <li key={a.kind}>
                    <Link href="/patient/appointments" className="font-medium text-brand-green underline dark:text-brand-green-bright">
                      {t("learn.next.book")}
                    </Link>
                  </li>
                );
              return null;
            })}
          </ul>
        </section>
      )}

      <aside
        role="note"
        aria-label={t("learn.urgent.title")}
        className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
        data-testid="urgent-help-box"
      >
        <p className="font-semibold">{t("learn.urgent.title")}</p>
        <p className="mt-1">{t("learn.urgent.body")}</p>
      </aside>

      {canShare && <ShareLessonButtons title={title} url={absoluteUrl(`/learn/${code}`)} />}
    </div>
  );
}
