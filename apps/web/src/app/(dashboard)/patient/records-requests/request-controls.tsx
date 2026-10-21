"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { t, type Locale } from "@tarragon/i18n";
import {
  markRecordsRequestReceivedAction,
  markRecordsRequestSentAction,
  setRecordsRequestNoteAction,
  withdrawRecordsRequestAction,
  type RecordsRequestActionResult,
} from "./actions";

/** The buttons for one request, by state. Each says plainly when it could not save; none of them contacts the facility. */
export function RequestControls({ id, state, note, locale }: { id: string; state: string; note: string | null; locale: Locale }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [text, setText] = useState(note ?? "");

  const run = (fn: () => Promise<RecordsRequestActionResult>, okMessage: string | null = null): void => {
    start(async () => {
      try {
        const r = await fn();
        setMessage(r.ok ? okMessage : r.error === "not_open" ? t("records_request.not_open", locale) : t("records_request.failed", locale));
      } catch {
        setMessage(t("records_request.failed", locale));
      }
    });
  };

  const open = state === "prepared" || state === "sent";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        {state === "prepared" ? (
          <Button type="button" disabled={pending} onClick={() => run(() => markRecordsRequestSentAction(id))}>{t("records_request.mark_sent", locale)}</Button>
        ) : null}
        {open ? (
          <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => markRecordsRequestReceivedAction(id))}>{t("records_request.mark_received", locale)}</Button>
        ) : null}
        {open ? (
          <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => withdrawRecordsRequestAction(id))}>{t("records_request.withdraw", locale)}</Button>
        ) : null}
      </div>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => setRecordsRequestNoteAction({ id, note: text }), t("records_request.note_saved", locale));
        }}
      >
        <label className="block text-sm font-medium">
          {t("records_request.note_label", locale)}
          <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={500} rows={2} className="mt-1 block w-full rounded-md border border-charcoal-ink/20 bg-transparent px-3 py-2 text-base dark:border-night-ink/30" />
        </label>
        <Button type="submit" variant="outline" disabled={pending}>{t("records_request.note_save", locale)}</Button>
      </form>
      {message ? <p role="status" className="text-sm">{message}</p> : null}
    </div>
  );
}
