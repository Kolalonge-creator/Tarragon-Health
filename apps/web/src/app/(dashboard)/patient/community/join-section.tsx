"use client";

import { useId, useState } from "react";
import { t, type Locale, type MessageKey } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MUTED, TOUCH } from "./styles";
import { joinGroup } from "./community-actions";

/**
 * Joining a group: the rules, an explanation of the made-up name, and two ticks the person must give themselves (the rules, and the
 * safety consent counsel approves). Nothing is sent until both are ticked. The group's own rules version goes with the request, so rules that
 * changed while the person was reading are caught by the database rather than silently agreed to.
 */
export function JoinSection({
  groupId,
  rulesText,
  rulesVersion,
  locale,
  onJoined,
}: {
  groupId: string;
  rulesText: string;
  rulesVersion: number;
  locale: Locale;
  onJoined: (handle: string, avatarCode: string) => void;
}) {
  const [rulesOk, setRulesOk] = useState(false);
  const [consent, setConsent] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<MessageKey | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const uid = useId();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (!rulesOk || !consent) {
      setMessage("community.join.refused.consent_needed");
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const result = await joinGroup({ groupId, rulesVersion, rulesAcknowledged: rulesOk, consent });
      if (result.ok) {
        setHandle(result.handle);
        onJoined(result.handle, result.avatarCode);
      } else {
        setMessage(result.key);
      }
    } catch {
      setMessage("community.compose.refused.other");
    }
    setPending(false);
  }

  if (handle) {
    return (
      <p role="status" className="rounded-lg bg-soft-sage p-4 font-medium dark:bg-brand-green/20">
        {t("community.group.your_name", locale, { handle })}
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} aria-labelledby={`${uid}-title`} className="space-y-4 rounded-xl border p-5">
      <h2 id={`${uid}-title`} className="font-heading text-lg font-semibold">
        {t("community.join.title", locale)}
      </h2>
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{t("community.group.rules_title", locale)}</h3>
        <p className="whitespace-pre-line text-sm leading-relaxed">{rulesText}</p>
      </div>
      <p className={`text-sm ${MUTED}`}>{t("community.join.handle_explainer", locale)}</p>
      <div className={`flex items-start gap-3 ${TOUCH}`}>
        <input id={`${uid}-rules`} type="checkbox" className="mt-1 h-5 w-5" checked={rulesOk} onChange={(e) => setRulesOk(e.target.checked)} required />
        <Label htmlFor={`${uid}-rules`} className="font-normal leading-snug">
          {t("community.join.rules_ack", locale)}
        </Label>
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">{t("community.join.consent_title", locale)}</h3>
        <p className="text-sm leading-relaxed">{t("community.join.consent", locale)}</p>
        <div className={`flex items-start gap-3 ${TOUCH}`}>
          <input id={`${uid}-consent`} type="checkbox" className="mt-1 h-5 w-5" checked={consent} onChange={(e) => setConsent(e.target.checked)} required />
          <Label htmlFor={`${uid}-consent`} className="font-normal leading-snug">
            {t("community.join.consent_ack", locale)}
          </Label>
        </div>
      </div>
      <Button type="submit" className={TOUCH} disabled={pending || !rulesOk || !consent}>
        {pending ? t("community.join.joining", locale) : t("community.join.confirm", locale)}
      </Button>
      <p role="status" aria-live="polite" className="text-sm">
        {message ? t(message, locale) : ""}
      </p>
    </form>
  );
}
