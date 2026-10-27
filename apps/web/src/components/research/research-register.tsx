import { t } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { FlashClean } from "@/components/go-live/flash-clean";
import type { Loaded } from "@/lib/research/load";
import { RECIPIENT_TYPES, RESEARCH_FIELDS, type AdminChallenge, type Notice, type ProtocolRow, type RequestRow } from "@/lib/research/model";
import {
  answerResearchChallengeAction, approveResearchProtocolAction, authoriseResearchExportAction, confirmResearchProtocolDpoAction,
  createResearchProtocolAction, requestResearchExportAction,
} from "@/lib/research/actions";

const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";

/** S81: the protocol register, shared by the clinical lead's page and the data protection officer's page. Permissions come from the database row. */
export function ResearchRegister({ loaded, requests, challenges, notice, showCreate }: {
  loaded: Loaded<ProtocolRow[]>; requests: Loaded<RequestRow[]>; challenges?: Loaded<AdminChallenge[]>; notice: Notice | null; showCreate: boolean;
}) {
  const locale = DEFAULT_UI_LANGUAGE;
  const open = requests.ok ? requests.data.filter((r) => !r.expired) : [];
  const openFor = (protocolId: string) => open.find((r) => r.protocol_id === protocolId);
  const bad = notice === "failed" || notice === "denied" || notice === "needs_authorisation" || notice === "held_back";
  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">{t("res.title", locale)}</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("res.intro", locale)}</p>
      </div>
      {notice && <FlashClean />}
      {notice && (
        <p role={bad ? "alert" : "status"} className={`rounded-xl border p-3 text-sm ${bad ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
          {t(`res.notice.${notice}`, locale)}
        </p>
      )}
      {!loaded.ok ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("res.load_error", locale)}</p>
      ) : loaded.data.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70">{t("res.empty", locale)}</p>
      ) : (
        <ul className="grid gap-3">
          {loaded.data.map((p) => (
            <li key={p.id} className="space-y-2 rounded-xl border border-charcoal-ink/10 bg-white p-3 text-sm dark:border-night-ink/15 dark:bg-night-card">
              <p className="font-medium text-charcoal-ink">{p.title} <span className="ml-1 text-xs font-normal text-charcoal-ink/60">{t(`res.status.${p.status}`, locale)} · {p.recipient_name}</span></p>
              <p className="text-xs text-charcoal-ink/70">
                {p.cmo_approved ? t("res.cmo_ok", locale) : t("res.cmo_wait", locale)} · {p.dpo_confirmed ? t("res.dpo_ok", locale) : t("res.dpo_wait", locale)} · {t("res.exports", locale)}: {p.export_count}
              </p>
              <div className="flex flex-wrap gap-2">
                {p.can_approve && (
                  <form action={approveResearchProtocolAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className={`${btn} bg-brand-green text-white`}>{t("res.approve", locale)}</button>
                  </form>
                )}
                {p.can_confirm_dpo && (
                  <form action={confirmResearchProtocolDpoAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <button type="submit" className={`${btn} bg-brand-green text-white`}>{t("res.confirm_dpo", locale)}</button>
                  </form>
                )}
                {p.status === "approved" && showCreate && !p.can_export && (
                  <span className="text-xs text-charcoal-ink/60">{t("res.export_off", locale)}</span>
                )}
                {p.status === "approved" && showCreate && p.can_export && (() => {
                  const r = openFor(p.id);
                  if (r?.authorised) return <a href={`/api/research/export/${p.id}`} className={`${btn} border border-charcoal-ink/20 text-charcoal-ink`}>{t("res.export", locale)}</a>;
                  if (r) return <span className="text-xs text-charcoal-ink/60">{t("res.req.waiting", locale)}</span>;
                  return (
                    <form action={requestResearchExportAction} className="flex w-full flex-col gap-2 sm:flex-row sm:items-end">
                      <input type="hidden" name="protocol_id" value={p.id} />
                      <label className="block flex-1 text-xs text-charcoal-ink">{t("res.req.note", locale)}<input name="note" required minLength={10} maxLength={1000} className={field} /></label>
                      <button type="submit" className={`${btn} border border-charcoal-ink/20 text-charcoal-ink`}>{t("res.req.submit", locale)}</button>
                    </form>
                  );
                })()}
              </div>
            </li>
          ))}
        </ul>
      )}
      <section aria-labelledby="res-req" className="space-y-2">
        <h2 id="res-req" className="text-sm font-semibold text-charcoal-ink">{t("res.req.heading", locale)}</h2>
        {!requests.ok ? (
          <p role="alert" className="text-sm text-amber-900">{t("res.req.load_error", locale)}</p>
        ) : requests.data.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70">{t("res.req.none", locale)}</p>
        ) : (
          <ul className="grid gap-2">
            {requests.data.map((r) => (
              <li key={r.id} className="space-y-1 rounded-xl border border-charcoal-ink/10 bg-white p-3 text-sm dark:border-night-ink/15 dark:bg-night-card">
                <p className="font-medium text-charcoal-ink">{r.protocol_title}</p>
                <p className="text-xs text-charcoal-ink/70">{r.note}</p>
                <p className="text-xs text-charcoal-ink/60">{r.expired ? t("res.req.expired", locale) : r.authorised ? t("res.req.authorised", locale) : t("res.req.waiting", locale)}</p>
                {!r.expired && !r.authorised && r.is_mine && <p className="text-xs text-charcoal-ink/60">{t("res.req.own", locale)}</p>}
                {!r.expired && !r.authorised && r.can_authorise && (
                  <form action={authoriseResearchExportAction}>
                    <input type="hidden" name="id" value={r.id} />
                    <button type="submit" className={`${btn} bg-brand-green text-white`}>{t("res.req.authorise", locale)}</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {challenges && (
        <section aria-labelledby="res-q" className="space-y-2">
          <h2 id="res-q" className="text-sm font-semibold text-charcoal-ink">{t("res.q.heading", locale)}</h2>
          {!challenges.ok ? (
            <p role="alert" className="text-sm text-amber-900">{t("res.q.load_error", locale)}</p>
          ) : challenges.data.length === 0 ? (
            <p className="text-sm text-charcoal-ink/70">{t("res.q.none", locale)}</p>
          ) : (
            <ul className="grid gap-2">
              {challenges.data.map((c) => (
                <li key={c.id} className="space-y-2 rounded-xl border border-charcoal-ink/10 bg-white p-3 text-sm dark:border-night-ink/15 dark:bg-night-card">
                  {c.protocol_title && <p className="text-xs text-charcoal-ink/60">{c.protocol_title}</p>}
                  <p className="text-charcoal-ink">{c.message}</p>
                  <p className="text-xs text-charcoal-ink/60">{c.status === "open" ? t("res.q.open", locale) : t("res.q.answered", locale)}</p>
                  {c.status === "open" && (
                    <form action={answerResearchChallengeAction} className="space-y-2">
                      <input type="hidden" name="id" value={c.id} />
                      <label className="block text-xs text-charcoal-ink">{t("res.q.answer", locale)}<textarea name="answer" required minLength={10} maxLength={4000} rows={3} className={field} /></label>
                      <button type="submit" className={`${btn} bg-brand-green text-white`}>{t("res.q.answer_submit", locale)}</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {showCreate && (
        <details className="rounded-xl border border-charcoal-ink/10 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-brand-green">{t("res.create", locale)}</summary>
          <form action={createResearchProtocolAction} className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-charcoal-ink sm:col-span-2">{t("res.f.title", locale)}<input name="title" required minLength={5} maxLength={200} className={field} /></label>
            <label className="block text-xs text-charcoal-ink sm:col-span-2">{t("res.f.question", locale)}<textarea name="question" required minLength={20} maxLength={1000} rows={2} className={field} /></label>
            <label className="block text-xs text-charcoal-ink sm:col-span-2">{t("res.f.method", locale)}<textarea name="method" required minLength={20} maxLength={1000} rows={2} className={field} /></label>
            <label className="block text-xs text-charcoal-ink">{t("res.f.recipient", locale)}<input name="recipient" required minLength={3} maxLength={200} className={field} /></label>
            <label className="block text-xs text-charcoal-ink">{t("res.f.recipient_type", locale)}
              <select name="recipient_type" required defaultValue="" className={field}>
                <option value="" disabled></option>
                {RECIPIENT_TYPES.map((r) => (<option key={r} value={r}>{t(`res.rt.${r}`, locale)}</option>))}
              </select>
            </label>
            <label className="block text-xs text-charcoal-ink">{t("res.f.ethics_ref", locale)}<input name="ethics_ref" maxLength={100} className={field} /></label>
            <label className="block text-xs text-charcoal-ink">{t("res.f.ethics_body", locale)}<input name="ethics_body" maxLength={200} className={field} /></label>
            <label className="block text-xs text-charcoal-ink">{t("res.f.ethics_date", locale)}<input name="ethics_date" type="date" className={field} /></label>
            <label className="block text-xs text-charcoal-ink">{t("res.f.agreement", locale)}<input name="agreement" maxLength={100} className={field} /></label>
            <fieldset className="sm:col-span-2">
              <legend className="text-xs text-charcoal-ink">{t("res.f.fields", locale)}</legend>
              <div className="mt-1 flex flex-wrap gap-3">
                {RESEARCH_FIELDS.map((f) => (
                  <label key={f} className="flex items-center gap-1 text-xs text-charcoal-ink"><input type="checkbox" name="fields" value={f} />{f}</label>
                ))}
              </div>
            </fieldset>
            <div><button type="submit" className={`${btn} bg-brand-green text-white`}>{t("res.submit", locale)}</button></div>
          </form>
        </details>
      )}
    </div>
  );
}
