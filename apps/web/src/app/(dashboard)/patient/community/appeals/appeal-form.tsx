"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { t, type Locale, type MessageKey } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TOUCH } from "../styles";
import { submitAppeal } from "../community-actions";

/** "Ask for a second look": the member says in their own words what they think was wrong. A different moderator decides. */
export function AppealForm({ kind, targetId, locale }: { kind: "removal" | "sanction"; targetId: string; locale: Locale }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<MessageKey | null>(null);
  const [sent, setSent] = useState(false);
  const id = useId();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || sent || reason.trim().length === 0) return;
    setPending(true);
    setMessage(null);
    const result = await submitAppeal({ kind, targetId, reason }).catch(() => null);
    setPending(false);
    if (result && result.ok) {
      setSent(true);
      setMessage("community.appeals.sent");
      router.refresh();
    } else {
      setMessage(result ? result.key : "community.appeals.refused.other");
    }
  }

  return (
    <form onSubmit={onSubmit} aria-labelledby={`${id}-title`} className="space-y-2">
      <h3 id={`${id}-title`} className="text-sm font-medium">
        {t("community.appeals.ask", locale)}
      </h3>
      <Label htmlFor={id}>{t("community.appeals.reason_label", locale)}</Label>
      <Textarea id={id} value={reason} rows={3} maxLength={1000} disabled={sent} onChange={(e) => setReason(e.target.value)} className="min-h-24" />
      <Button type="submit" className={TOUCH} disabled={pending || sent || reason.trim().length === 0}>
        {t("community.appeals.submit", locale)}
      </Button>
      <p role="status" aria-live="polite" className="text-sm">
        {message ? t(message, locale) : ""}
      </p>
    </form>
  );
}
