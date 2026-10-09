"use client";

import { useId, useState } from "react";
import { t, type Locale, type MessageKey } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MUTED, TOUCH } from "./styles";
import type { SubmitActionResult } from "./community-actions";

/** A fresh id for one attempt. A retry of the SAME attempt reuses it, so the database can tell it is not a second post. */
function newRequestId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(3)}-${hex(12)}`;
}

/**
 * The box for a post, a reply or an edit. The length limit comes from the group (`maxChars`), never from this file.
 *
 *   published  -> cleared, "Posted."
 *   held       -> cleared (the post exists, a moderator will look), reason shown
 *   blocked    -> text KEPT so it can be fixed, reason shown
 *   refused    -> text KEPT, reason shown
 *   safety     -> text CLEARED and not kept anywhere; the parent shows the safety card
 */
export function Composer({
  locale,
  maxChars,
  submit,
  onPublished,
  onSafety,
  label,
  submitLabel,
  placeholder,
  initialText = "",
  onClose,
}: {
  locale: Locale;
  maxChars: number;
  submit: (body: string, clientRequestId: string) => Promise<SubmitActionResult>;
  onPublished: () => void;
  onSafety: (kind: "emergency" | "self_harm") => void;
  label: MessageKey;
  submitLabel: MessageKey;
  placeholder?: MessageKey;
  initialText?: string;
  /** Called after a successful edit so the editor can close. */
  onClose?: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<MessageKey | null>(null);
  const requestId = useRef<string | null>(null);
  const id = useId();

  const used = text.length;
  const tooLong = used > maxChars;
  const empty = text.trim().length === 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || empty || tooLong) return;
    setPending(true);
    setMessage(null);
    requestId.current ??= newRequestId();
    let result: SubmitActionResult;
    try {
      result = await submit(text, requestId.current);
    } catch {
      // Could not reach the server: keep the text and the same request id so pressing Post again cannot double-post.
      setPending(false);
      setMessage("community.compose.refused.other");
      return;
    }
    setPending(false);
    if (!result.ok) {
      setMessage(result.key);
      return;
    }
    // The database gave a definite answer, so the next attempt is a new one.
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
      onPublished();
      onClose?.();
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <Label htmlFor={id} className="sr-only">
        {t(label, locale)}
      </Label>
      <Textarea
        id={id}
        value={text}
        rows={3}
        placeholder={placeholder ? t(placeholder, locale) : undefined}
        onChange={(e) => setText(e.target.value)}
        aria-describedby={`${id}-count`}
        aria-invalid={tooLong}
        className="min-h-24"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p id={`${id}-count`} className={`text-sm ${tooLong ? "font-semibold" : MUTED}`}>
          {t("community.post.counter", locale, { used, max: maxChars })}
          {tooLong ? ` - ${t("community.compose.refused.too_long", locale)}` : ""}
        </p>
        <Button type="submit" className={TOUCH} disabled={pending || empty || tooLong}>
          {pending ? t("community.post.posting", locale) : t(submitLabel, locale)}
        </Button>
      </div>
      <p role="status" aria-live="polite" className="text-sm">
        {message ? t(message, locale) : ""}
      </p>
    </form>
  );
}
