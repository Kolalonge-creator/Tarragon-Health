"use client";

import { useEffect, useId, useRef, useState } from "react";
import { t, type Locale, type MessageKey } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { MUTED, TOUCH } from "./styles";
import { composeOutcome, submitResultSchema } from "@/lib/community/model";
import type { SubmitActionResult } from "./community-actions";

/** The picture types the screen checks before sending anything; the size limit comes from the group (versioned configuration), never from here. The server checks again from the file's own bytes. */
const IMAGE_TYPES = ["image/jpeg", "image/png"];

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
  picture,
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
  /** Present only when the group allows pictures and the member can post: turns on the "Add a picture" control. */
  picture?: { groupId: string; parentId: string | null; maxBytes: number };
}) {
  const [text, setText] = useState(initialText);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<MessageKey | null>(null);
  const requestId = useRef<string | null>(null);
  const id = useId();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState(0);

  const previewRef = useRef<string | null>(null);
  const revoke = () => {
    if (previewRef.current && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
  };
  // Release the preview if the box goes away with a picture still chosen.
  useEffect(() => revoke, []);

  function clearPicture() {
    revoke();
    setPreviewUrl(null);
    setFile(null);
    setInputKey((k) => k + 1);
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    if (!picked) return;
    if (!IMAGE_TYPES.includes(picked.type) || picked.size > (picture?.maxBytes ?? 0) || picked.size === 0) {
      clearPicture();
      setMessage("community.compose.refused.bad_image");
      return;
    }
    setMessage(null);
    revoke();
    const url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(picked) : null;
    previewRef.current = url;
    setPreviewUrl(url);
    setFile(picked);
  }

  /** Sends the post and its picture as one multipart request. Returns the same shape as the server action. */
  async function uploadWithPicture(body: string, clientRequestId: string, image: File, target: { groupId: string; parentId: string | null }): Promise<SubmitActionResult> {
    const form = new FormData();
    form.set("group_id", target.groupId);
    if (target.parentId) form.set("parent_id", target.parentId);
    form.set("body", body);
    form.set("client_request_id", clientRequestId);
    form.set("image", image);
    const response = await fetch("/api/community/images", { method: "POST", body: form, credentials: "same-origin" });
    const json: unknown = await response.json().catch(() => null);
    const parsed = submitResultSchema.safeParse(json);
    if (!parsed.success) return { ok: false, key: "community.compose.refused.other" };
    return { ok: true, outcome: composeOutcome(parsed.data) };
  }

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
      result = file && picture ? await uploadWithPicture(text, requestId.current, file, picture) : await submit(text, requestId.current);
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
      clearPicture();
      setMessage(null);
      onSafety(outcome.safety);
      return;
    }
    setMessage(outcome.message);
    if (outcome.kind === "published" || outcome.kind === "held") {
      setText("");
      clearPicture();
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
      {picture ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor={`${id}-image`} className={`inline-flex ${TOUCH} cursor-pointer items-center rounded-md border px-4 text-sm font-medium focus-within:ring-2 focus-within:ring-brand-green`}>
              {t("community.image.add", locale)}
            </Label>
            <input
              key={inputKey}
              id={`${id}-image`}
              type="file"
              accept="image/jpeg,image/png"
              className="sr-only"
              aria-describedby={`${id}-image-help`}
              disabled={pending}
              onChange={onPick}
            />
            {file ? (
              <Button type="button" variant="ghost" className={TOUCH} onClick={clearPicture} disabled={pending}>
                {t("community.image.remove", locale)}
              </Button>
            ) : null}
          </div>
          <p id={`${id}-image-help`} className={`text-sm ${MUTED}`}>
            {t("community.image.help", locale)}
          </p>
          {file && previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a local object URL preview; next/image cannot optimise it
            <img src={previewUrl} alt={t("community.image.alt", locale)} className="max-h-48 max-w-full rounded-md object-contain" />
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p id={`${id}-count`} className={`text-sm ${tooLong ? "font-semibold" : MUTED}`}>
          {t("community.post.counter", locale, { used, max: maxChars })}
          {tooLong ? ` - ${t("community.compose.refused.too_long", locale)}` : ""}
        </p>
        <Button type="submit" className={TOUCH} disabled={pending || empty || tooLong}>
          {pending ? t(file ? "community.image.uploading" : "community.post.posting", locale) : t(submitLabel, locale)}
        </Button>
      </div>
      <p role="status" aria-live="polite" className="text-sm">
        {message ? t(message, locale) : ""}
      </p>
    </form>
  );
}
