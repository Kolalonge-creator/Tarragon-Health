"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { recordCaseBriefFeedback } from "@/lib/case-briefs/feedback-actions";
import { t } from "@tarragon/i18n";
import { BRIEF_FEEDBACK_LABEL_KEY, BRIEF_FEEDBACK_VALUES, type BriefFeedback } from "@/lib/clinician/override-reasons";

/**
 * W-02: three buttons under a case brief the assistant wrote (useful, not safe, missing something). Not mounted yet: it is added to the brief card
 * once the open PR that edits that card has merged, so the two changes do not collide.
 */
export function CaseBriefFeedback({ briefId }: { briefId: string }) {
  const [sent, setSent] = useState<BriefFeedback | null>(null);
  const [failed, setFailed] = useState(false);

  async function send(feedback: BriefFeedback) {
    setFailed(false);
    const res = await recordCaseBriefFeedback({ briefId, feedback, code: null }).catch(() => ({ ok: false }));
    if (res.ok) setSent(feedback);
    else setFailed(true);
  }

  if (sent) return <p role="status" className="text-xs text-charcoal-ink/60">{t("override.brief.thanks", "en")}</p>;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="case-brief-feedback">
      <span className="text-xs text-charcoal-ink/60">{t("override.brief.prompt", "en")}</span>
      {BRIEF_FEEDBACK_VALUES.map((v) => (
        <Button key={v} type="button" size="sm" variant="outline" onClick={() => send(v)}>
          {t(BRIEF_FEEDBACK_LABEL_KEY[v], "en")}
        </Button>
      ))}
      {failed && <span role="alert" className="text-xs text-red-600">{t("override.brief.failed", "en")}</span>}
    </div>
  );
}
