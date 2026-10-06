import Link from "next/link";
import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { resolveUiLanguage } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { getPidginEnabled } from "@/lib/language/pidgin-switch";
import { loadGrantsHistory } from "@/lib/clinician-roster/load";

export const metadata = { title: "Who holds which access" };
export const dynamic = "force-dynamic";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-");
const th = "px-2 py-1 text-left text-xs font-semibold text-charcoal-ink/70";
const td = "px-2 py-1 align-top text-charcoal-ink/90";

/**
 * S36d: read-only role-grants history (spec roles table: admin owns role grants). Admin or a users.permissions.grant holder; the
 * function behind it refuses anyone else. Grants have no expiry column today (OQ-221), so every row says so.
 */
export default async function GrantsHistoryPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!(await hasPermission("users.permissions.grant"))) redirect("/admin/settings");
  const locale = resolveUiLanguage(profile.language, await getPidginEnabled());
  const res = await loadGrantsHistory();

  return (
    <div className="space-y-8">
      <div>
        <Link href="/admin/settings/access" className="text-sm text-brand-green underline">{t("grantshist.back", locale)}</Link>
        <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">{t("grantshist.title", locale)}</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("grantshist.intro", locale)}</p>
      </div>
      {!res.ok ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("grantshist.load_error", locale)}</p>
      ) : (
        <>
          <section aria-labelledby="current" className="space-y-2">
            <h2 id="current" className="font-heading text-xl font-semibold text-charcoal-ink">{t("grantshist.current.title", locale)}</h2>
            {res.data.current.length === 0 ? <p className="text-sm text-charcoal-ink/70">{t("grantshist.current.none", locale)}</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[40rem] text-sm">
                  <thead><tr><th className={th}>{t("grantshist.col.key", locale)}</th><th className={th}>{t("grantshist.col.holder", locale)}</th><th className={th}>{t("grantshist.col.how", locale)}</th><th className={th}>{t("grantshist.col.granted", locale)}</th><th className={th}>{t("grantshist.col.expires", locale)}</th></tr></thead>
                  <tbody>
                    {res.data.current.map((g, i) => (
                      <tr key={`${g.permission_key}-${g.holder_id}-${g.source}-${i}`} className="border-t border-charcoal-ink/10">
                        <td className={td}><span className="font-medium">{g.permission_label ?? g.permission_key}</span><br /><span className="text-xs text-charcoal-ink/60">{g.permission_key}</span></td>
                        <td className={td}>{g.holder_name ?? "-"}{g.holder_active === false ? ` (${t("grantshist.inactive", locale)})` : ""}</td>
                        <td className={td}>{g.source === "direct" ? t("grantshist.source.direct", locale) : t("grantshist.source.role", locale, { role: g.source.replace(/^role:/, "") })}</td>
                        <td className={td}>{when(g.granted_at)}{g.granted_by_name ? ` · ${g.granted_by_name}` : ""}</td>
                        <td className={td}>{g.expires_at ? when(g.expires_at) : t("grantshist.no_expiry", locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section aria-labelledby="history" className="space-y-2">
            <h2 id="history" className="font-heading text-xl font-semibold text-charcoal-ink">{t("grantshist.history.title", locale)}</h2>
            {res.data.history.length === 0 ? <p className="text-sm text-charcoal-ink/70">{t("grantshist.history.none", locale)}</p> : (
              <ul className="grid gap-1 text-sm text-charcoal-ink/90">
                {res.data.history.map((h) => (
                  <li key={h.id}>
                    <span className="font-medium">{h.permission_key}</span> · {h.holder_name ?? "-"} · {t("grantshist.history.granted", locale)} {when(h.granted_at)}{h.granted_by_name ? ` (${h.granted_by_name})` : ""}
                    {h.revoked_at ? ` · ${t("grantshist.history.revoked", locale)} ${when(h.revoked_at)}${h.revoked_by_name ? ` (${h.revoked_by_name})` : ""}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="audit" className="space-y-2">
            <h2 id="audit" className="font-heading text-xl font-semibold text-charcoal-ink">{t("grantshist.audit.title", locale)}</h2>
            {res.data.audit.length === 0 ? <p className="text-sm text-charcoal-ink/70">{t("grantshist.audit.none", locale)}</p> : (
              <ul className="grid gap-1 text-sm text-charcoal-ink/90">
                {res.data.audit.map((a) => (
                  <li key={a.id}>{when(a.created_at)} · {a.action} · {a.actor_name ?? "-"}{a.subject_name ? ` ${t("grantshist.audit.about", locale)} ${a.subject_name}` : ""}{a.permission_key ? ` · ${a.permission_key}` : ""}</li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
