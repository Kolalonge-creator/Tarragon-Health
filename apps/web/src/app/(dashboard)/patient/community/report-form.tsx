"use client";

import { useId, useState } from "react";
import { t, type Locale, type MessageKey } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { REPORT_REASONS, reportReasonKey, type ReportReason } from "@/lib/community/model";
import { MUTED, TOUCH } from "./styles";
import { reportPost } from "./community-actions";

/** Report a post: one reason (required) and an optional note. The answer is always a calm thank-you or a plain "already reported". */
export function ReportForm({ postId, locale }: { postId: string; locale: Locale }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [detail, setDetail] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<MessageKey | null>(null);
  const [done, setDone] = useState(false);
  const uid = useId();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason || pending) return;
    setPending(true);
    setMessage(null);
    try {
      const result = await reportPost({ postId, reason, detail });
      setMessage(result.key);
      if (result.ok) setDone(true);
    } catch {
      setMessage("community.compose.refused.other");
    }
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} aria-label={t("community.report.title", locale)} className="space-y-3 rounded-lg border border-dashed p-4">
      <fieldset className="space-y-1" disabled={done}>
        <legend className="text-sm font-medium">{t("community.report.title", locale)}</legend>
        {REPORT_REASONS.map((r) => (
          <div key={r} className={`flex items-center gap-3 ${TOUCH}`}>
            <input
              id={`${uid}-${r}`}
              type="radio"
              name={`${uid}-reason`}
              className="h-5 w-5"
              checked={reason === r}
              onChange={() => setReason(r)}
              required
            />
            <Label htmlFor={`${uid}-${r}`} className="font-normal leading-snug">
              {t(reportReasonKey(r), locale)}
            </Label>
          </div>
        ))}
      </fieldset>
      <div className="space-y-1">
        <Label htmlFor={`${uid}-detail`} className={`font-normal ${MUTED}`}>
          {t("community.report.detail", locale)}
        </Label>
        <Textarea id={`${uid}-detail`} rows={2} value={detail} onChange={(e) => setDetail(e.target.value)} disabled={done} />
      </div>
      <Button type="submit" className={TOUCH} disabled={!reason || pending || done}>
        {t("community.report.submit", locale)}
      </Button>
      <p role="status" aria-live="polite" className="text-sm">
        {message ? t(message, locale) : ""}
      </p>
    </form>
  );
}
