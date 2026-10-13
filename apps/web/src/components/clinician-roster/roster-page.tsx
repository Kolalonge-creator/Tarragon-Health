import { t, type Locale } from "@tarragon/i18n";
import { loadCompetencies, loadRoster } from "@/lib/clinician-roster/load";
import {
  asNotice, grantableCompetencies, isFailure, sortRoster, type CompetencyRow, type RosterRow,
} from "@/lib/clinician-roster/model";
import {
  leadDecideAction, leadGrantAction, leadReinstateAction, leadRevokeAction, leadSuspendAction, opsRequestAction, opsSuspendAction,
} from "@/lib/clinician-roster/actions";
import { FlashClean } from "@/components/go-live/flash-clean";

const btn = "rounded-lg px-3 py-1.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";
const STATUS_STYLE = { active: "bg-emerald-100 text-emerald-900", suspended: "bg-red-100 text-red-900", offboarded: "bg-gray-100 text-gray-800" } as const;
const day = (iso: string | null, fallback: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" }) : fallback);

/**
 * S36d: one roster, two doors (the S37 pattern). `door="ops"` shows suspend and the request form; `door="lead"` (the CMO) shows suspend,
 * reinstate, competency grant and end, and the decision on each waiting request. The database refuses whatever a screen shows.
 */
export async function RosterPage({ door, locale, noticeParam }: { door: "ops" | "lead"; locale: Locale; noticeParam: string | undefined }) {
  const notice = asNotice(noticeParam);
  const [roster, competencies] = await Promise.all([loadRoster(), loadCompetencies()]);
  const comps: CompetencyRow[] = competencies.ok ? competencies.data : [];
  const rows = roster.ok ? sortRoster(roster.data) : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">{t("clinroster.title", locale)}</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t(door === "ops" ? "clinroster.intro.ops" : "clinroster.intro.lead", locale)}</p>
      </div>
      {notice && <FlashClean />}
      {notice && (
        <p role={isFailure(notice) ? "alert" : "status"} className={`rounded-xl border p-3 text-sm ${isFailure(notice) ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
          {t(`clinroster.notice.${notice}`, locale)}
        </p>
      )}
      {!roster.ok ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("clinroster.load_error", locale)}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70">{t("clinroster.none", locale)}</p>
      ) : (
        <ul className="grid gap-3">
          {rows.map((r) => <RosterCard key={r.id} row={r} door={door} comps={comps} locale={locale} />)}
        </ul>
      )}
    </div>
  );
}

function RosterCard({ row: r, door, comps, locale }: { row: RosterRow; door: "ops" | "lead"; comps: CompetencyRow[]; locale: Locale }) {
  const grantable = grantableCompetencies(comps, r);
  const nr = t("clinroster.not_recorded", locale);
  return (
    <li className="space-y-3 rounded-xl border border-charcoal-ink/10 bg-white p-4 text-sm dark:border-night-ink/15 dark:bg-night-card">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium text-charcoal-ink">{r.full_name ?? "-"}{r.is_self ? ` (${t("clinroster.you", locale)})` : ""}</p>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[r.status]}`}>{t(`clinroster.status.${r.status}`, locale)}</span>
        <span className="text-charcoal-ink/60">{t("clinroster.col.eligible", locale)}: {t(r.eligible ? "clinroster.eligible.yes" : "clinroster.eligible.no", locale)}</span>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-charcoal-ink/80 sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-xs text-charcoal-ink/60">{t("clinroster.col.level", locale)}</dt><dd>{r.level ?? nr}</dd></div>
        <div><dt className="text-xs text-charcoal-ink/60">{t("clinroster.col.licence", locale)}</dt><dd>{day(r.license_expires_at, nr)}</dd></div>
        <div><dt className="text-xs text-charcoal-ink/60">{t("clinroster.col.indemnity", locale)}</dt><dd>{r.indemnity_required ? day(r.indemnity_expires_at, nr) : t("clinroster.not_required", locale)}</dd></div>
        <div><dt className="text-xs text-charcoal-ink/60">{t("clinroster.col.competencies", locale)}</dt><dd>{r.competencies.length ? r.competencies.join(", ") : t("clinroster.none_held", locale)}</dd></div>
      </dl>
      {r.status === "suspended" && r.suspended_reason && <p className="text-charcoal-ink/70">{t("clinroster.suspended_because", locale)}: {r.suspended_reason}</p>}

      {r.pending_requests.length > 0 && (
        <div className="space-y-2 rounded-lg bg-amber-50 p-3">
          <p className="text-xs font-semibold text-amber-900">{t("clinroster.pending.title", locale)}</p>
          {r.pending_requests.map((p) => (
            <div key={p.id} className="space-y-2">
              <p className="text-amber-950">
                {t(`clinroster.request.kind.${p.kind}`, locale)}{p.competency_code ? `: ${p.competency_code}` : ""} · {t("clinroster.pending.by", locale)} {p.requested_by_name ?? "-"} · {p.reason}
              </p>
              {door === "lead" && !p.requested_by_me && (
                <form action={leadDecideAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="request" value={p.id} />
                  <label className="block text-xs text-charcoal-ink">{t("clinroster.decide.note", locale)}<input name="note" maxLength={1000} className={field} /></label>
                  <button type="submit" name="decision" value="approve" className={`${btn} bg-brand-green text-white`}>{t("clinroster.decide.approve", locale)}</button>
                  <button type="submit" name="decision" value="decline" className={`${btn} border border-charcoal-ink/20 text-charcoal-ink`}>{t("clinroster.decide.decline", locale)}</button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}

      {!r.is_self && (
        <div className="grid gap-3 lg:grid-cols-2">
          {r.status === "active" && (
            <form action={door === "ops" ? opsSuspendAction : leadSuspendAction} className="space-y-2">
              <input type="hidden" name="staff" value={r.id} />
              <label className="block text-xs text-charcoal-ink">{t("clinroster.suspend.reason", locale)}<input name="reason" required minLength={10} maxLength={500} className={field} /></label>
              <button type="submit" className={`${btn} border border-red-300 text-red-900`}>{t("clinroster.suspend.submit", locale)}</button>
            </form>
          )}
          {door === "lead" && r.status === "suspended" && (
            <form action={leadReinstateAction} className="space-y-2">
              <input type="hidden" name="staff" value={r.id} />
              <label className="block text-xs text-charcoal-ink">{t("clinroster.lead.reinstate.reason", locale)}<input name="reason" required minLength={10} maxLength={500} className={field} /></label>
              <button type="submit" className={`${btn} bg-brand-green text-white`}>{t("clinroster.lead.reinstate.submit", locale)}</button>
            </form>
          )}
          {door === "lead" && r.status !== "offboarded" && grantable.length > 0 && (
            <form action={leadGrantAction} className="space-y-2">
              <input type="hidden" name="staff" value={r.id} />
              <label className="block text-xs text-charcoal-ink">{t("clinroster.lead.grant.title", locale)}
                <select name="competency" required defaultValue="" className={field}>
                  <option value="" disabled>{t("clinroster.request.choose", locale)}</option>
                  {grantable.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
              </label>
              <button type="submit" className={`${btn} bg-brand-green text-white`}>{t("clinroster.lead.grant.submit", locale)}</button>
            </form>
          )}
          {door === "lead" && r.competencies.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {r.competencies.map((code) => (
                <form key={code} action={leadRevokeAction}>
                  <input type="hidden" name="staff" value={r.id} /><input type="hidden" name="competency" value={code} />
                  <button type="submit" className={`${btn} border border-charcoal-ink/20 text-charcoal-ink`}>{t("clinroster.lead.revoke", locale)} {code}</button>
                </form>
              ))}
            </div>
          )}
          {door === "ops" && r.status !== "offboarded" && (
            <form action={opsRequestAction} className="space-y-2">
              <input type="hidden" name="staff" value={r.id} />
              <p className="text-xs font-semibold text-charcoal-ink">{t("clinroster.request.title", locale)}</p>
              <label className="block text-xs text-charcoal-ink">{t("clinroster.request.kind", locale)}
                <select name="kind" required defaultValue={r.status === "suspended" ? "reinstatement" : "competency_grant"} className={field}>
                  <option value="competency_grant">{t("clinroster.request.kind.competency_grant", locale)}</option>
                  {r.status === "suspended" && <option value="reinstatement">{t("clinroster.request.kind.reinstatement", locale)}</option>}
                </select>
              </label>
              <label className="block text-xs text-charcoal-ink">{t("clinroster.request.competency", locale)}
                <select name="competency" defaultValue="" className={field}>
                  <option value="">{t("clinroster.request.choose", locale)}</option>
                  {grantable.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
              </label>
              <label className="block text-xs text-charcoal-ink">{t("clinroster.request.reason", locale)}<input name="reason" required minLength={10} maxLength={500} className={field} /></label>
              <button type="submit" className={`${btn} bg-brand-green text-white`}>{t("clinroster.request.submit", locale)}</button>
            </form>
          )}
        </div>
      )}
    </li>
  );
}
