"use client";

import { useActionState, useState } from "react";
import { t } from "@tarragon/i18n";
import { addToAnonymousConcern, answerAnonymousCheckin, lookupAnonymousConcern, type AnonymousLookupState, type AnonymousStep } from "@/lib/concerns/anonymous-actions";

const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";
const btn = "rounded-lg border border-charcoal-ink/20 px-3 py-1.5 text-sm font-semibold text-charcoal-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
const lagos = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-");

/**
 * Follow an anonymous concern with its one-time code. The code is typed here and posted in the request body; it is never put in an address
 * and is kept only in this component's state while the page is open. Nothing here knows who raised the concern.
 */
export function AnonymousFollowUp() {
  const [lookup, lookupAction, looking] = useActionState<AnonymousLookupState, FormData>(lookupAnonymousConcern, undefined);
  const [add, addAction, adding] = useActionState<AnonymousStep, FormData>(addToAnonymousConcern, undefined);
  const [answer, answerAction, answering] = useActionState<AnonymousStep, FormData>(answerAnonymousCheckin, undefined);
  const [code, setCode] = useState("");
  const status = lookup?.status;

  return (
    <section aria-labelledby="anon" className="space-y-3 rounded-xl border border-charcoal-ink/10 bg-white p-4 text-sm dark:bg-night-card">
      <div>
        <h2 id="anon" className="font-heading text-lg font-semibold text-charcoal-ink">{t("speakup.anon.title", "en")}</h2>
        <p className="mt-1 text-xs text-charcoal-ink/70">{t("speakup.anon.intro", "en")}</p>
      </div>
      <form action={lookupAction} className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-charcoal-ink">
          {t("speakup.anon.code_label", "en")}
          <input name="code" value={code} onChange={(e) => setCode(e.target.value)} required minLength={8} maxLength={40} autoComplete="off" spellCheck={false} className={field} />
        </label>
        <button type="submit" disabled={looking} className={btn}>{t("speakup.anon.lookup", "en")}</button>
      </form>
      {lookup?.error === "not_found" && <p role="alert" className="text-sm text-red-700">{t("speakup.anon.not_found", "en")}</p>}
      {lookup?.error === "failed" && <p role="alert" className="text-sm text-red-700">{t("speakup.load_error", "en")}</p>}
      {status && (
        <div className="space-y-3">
          <p className="font-medium text-charcoal-ink">
            <span className="rounded-full bg-charcoal-ink/10 px-2 py-0.5 text-xs font-semibold">{t(`speakup.state.${status.state}`, "en")}</span>
            <span className="ml-2 text-xs font-normal text-charcoal-ink/60">{t("speakup.raised_on", "en")} {lagos(status.created_at)}</span>
          </p>
          {status.messages.filter((m) => m.body).length > 0 && (
            <ul className="space-y-1">
              {status.messages.filter((m) => m.body).map((m, i) => (
                <li key={i} className="text-charcoal-ink/80">
                  <span className="font-medium">{m.mine ? t("speakup.mine.you", "en") : t("speakup.mine.lead", "en")}</span> · {lagos(m.created_at)}
                  <p className="whitespace-pre-wrap">{m.body}</p>
                </li>
              ))}
            </ul>
          )}
          {status.state !== "closed" && (
            <form action={addAction} className="space-y-2">
              <input type="hidden" name="code" value={code} />
              <label className="block text-xs text-charcoal-ink">
                {t("speakup.mine.add", "en")}
                <textarea name="body" required minLength={5} maxLength={4000} rows={2} className={field} />
              </label>
              <button type="submit" disabled={adding} className={btn}>{t("speakup.mine.add_submit", "en")}</button>
              {add?.done && <span role="status" className="ml-2 text-xs text-emerald-800">{t("speakup.notice.added", "en")}</span>}
              {add?.error && <span role="alert" className="ml-2 text-xs text-red-700">{t("speakup.notice.failed", "en")}</span>}
            </form>
          )}
          {status.checkins.filter((k) => k.answered_at === null).map((k) => (
            <form key={k.id} action={answerAction} className="space-y-2 rounded-lg bg-charcoal-ink/5 p-3">
              <input type="hidden" name="code" value={code} />
              <input type="hidden" name="checkin" value={k.id} />
              <p className="text-charcoal-ink">{t("speakup.checkin.question", "en")}</p>
              <label className="block text-xs text-charcoal-ink">
                {t("speakup.checkin.note", "en")}
                <textarea name="note" maxLength={2000} rows={2} className={field} />
              </label>
              <div className="flex gap-2">
                <button type="submit" name="answer" value="fine" disabled={answering} className={btn}>{t("speakup.checkin.fine", "en")}</button>
                <button type="submit" name="answer" value="problem" disabled={answering} className={btn}>{t("speakup.checkin.problem", "en")}</button>
              </div>
              {answer?.done && <p role="status" className="text-xs text-emerald-800">{t("speakup.notice.checkin_answered", "en")}</p>}
              {answer?.error && <p role="alert" className="text-xs text-red-700">{t("speakup.notice.failed", "en")}</p>}
            </form>
          ))}
        </div>
      )}
    </section>
  );
}
