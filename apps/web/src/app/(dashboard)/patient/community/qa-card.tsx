"use client";

import { useId, useRef, useState } from "react";
import { t, type Locale, type MessageKey } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { formatPatientDateTime } from "@/lib/format-date";
import type { GroupView as GroupViewData } from "@/lib/community/model";
import { MUTED, TOUCH } from "./styles";
import { askQuestion } from "./community-actions";

type Qa = NonNullable<Extract<GroupViewData, { found: true }>["qa"]>;

function newRequestId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(3)}-${hex(12)}`;
}

/**
 * A doctor question session: what it is, when, who answers, the not-advice sentence, and (only while it is open and the member may
 * post and has questions left) a box to ask. Answers appear under each question in the feed, read-only. Text only.
 */
export function QaCard({
  qa,
  groupId,
  locale,
  canAsk,
  onSafety,
  onAsked,
}: {
  qa: Qa;
  groupId: string;
  locale: Locale;
  canAsk: boolean;
  onSafety: (kind: "emergency" | "self_harm") => void;
  onAsked: () => void;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<MessageKey | null>(null);
  const requestId = useRef<string | null>(null);

  const remaining = Math.max(0, qa.question_limit - qa.my_questions);
  const showForm = qa.status === "open" && canAsk && remaining > 0;

  const statusLine =
    qa.status === "upcoming"
      ? t("community.qa.upcoming", locale, { time: formatPatientDateTime(qa.opens_at) })
      : qa.status === "open"
        ? t("community.qa.open", locale, { time: formatPatientDateTime(qa.closes_at) })
        : t("community.qa.closed", locale);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || text.trim().length === 0) return;
    setPending(true);
    setMessage(null);
    requestId.current ??= newRequestId();
    const result = await askQuestion({ groupId, sessionId: qa.session_id, body: text, clientRequestId: requestId.current }).catch(() => null);
    setPending(false);
    if (!result) {
      // Could not reach the server: keep the text and the same request id so sending again cannot ask twice.
      setMessage("community.compose.refused.other");
      return;
    }
    if (!result.ok) {
      setMessage(result.key);
      return;
    }
    requestId.current = null;
    const outcome = result.outcome;
    if (outcome.kind === "safety") {
      setText("");
      setMessage(null);
      onSafety(outcome.safety);
      return;
    }
    setMessage(outcome.message);
    if (outcome.kind === "published" || outcome.kind === "held") {
      setText("");
      onAsked();
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3 rounded-xl border p-4">
      <h3 id={`${id}-title`} className="font-medium">
        {t("community.qa.title", locale)}
      </h3>
      <p className="font-medium">{qa.title}</p>
      {qa.intro ? <p className="whitespace-pre-line text-sm leading-relaxed">{qa.intro}</p> : null}
      <p className="text-sm">{statusLine}</p>
      {qa.doctors.length > 0 ? <p className="text-sm">{t("community.qa.doctors", locale, { names: qa.doctors.join(", ") })}</p> : null}
      <p className="rounded-lg border-l-4 border-brand-green bg-soft-sage p-3 text-sm dark:bg-brand-green/20">{t("community.qa.not_advice", locale)}</p>

      {showForm ? (
        <form onSubmit={onSubmit} className="space-y-2">
          <Label htmlFor={`${id}-q`}>{t("community.qa.ask", locale)}</Label>
          <Textarea
            id={`${id}-q`}
            value={text}
            rows={3}
            placeholder={t("community.qa.ask_placeholder", locale)}
            onChange={(e) => setText(e.target.value)}
            aria-describedby={`${id}-left`}
            className="min-h-24"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p id={`${id}-left`} className={`text-sm ${MUTED}`}>
              {t("community.qa.remaining", locale, { count: remaining })}
            </p>
            <Button type="submit" className={TOUCH} disabled={pending || text.trim().length === 0}>
              {pending ? t("community.post.posting", locale) : t("community.qa.send", locale)}
            </Button>
          </div>
        </form>
      ) : null}
      <p role="status" aria-live="polite" className="text-sm">
        {message ? t(message, locale) : ""}
      </p>
    </section>
  );
}
