import { redirect } from "next/navigation";
import { t } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { loadGrantsHistory } from "@/lib/clinician-roster/load";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type DataTableColumn, type DataTableRow } from "@/components/ui/data-table";

export const metadata = { title: "Who holds which access" };
export const dynamic = "force-dynamic";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-");

/**
 * S36d: read-only role-grants history (spec roles table: admin owns role grants). Admin or a users.permissions.grant holder; the
 * function behind it refuses anyone else. Grants have no expiry column today (OQ-221), so every row says so.
 */
export default async function GrantsHistoryPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!(await hasPermission("users.permissions.grant"))) redirect("/admin/settings");
  const locale = DEFAULT_UI_LANGUAGE;
  const res = await loadGrantsHistory();

  const current: DataTableRow[] = res.ok
    ? res.data.current.map((g, i) => {
        const how = g.source === "direct" ? t("grantshist.source.direct", locale) : t("grantshist.source.role", locale, { role: g.source.replace(/^role:/, "") });
        return {
          key: `${g.permission_key}-${g.holder_id}-${g.source}-${i}`,
          searchText: `${g.permission_label ?? ""} ${g.permission_key} ${g.holder_name ?? ""} ${how} ${g.granted_by_name ?? ""}`,
          sort: [g.permission_label ?? g.permission_key, g.holder_name, how, g.granted_at, g.expires_at],
          cells: [
            <span key="key"><span className="font-medium">{g.permission_label ?? g.permission_key}</span><br /><span className="text-xs text-charcoal-ink/60">{g.permission_key}</span></span>,
            `${g.holder_name ?? "-"}${g.holder_active === false ? ` (${t("grantshist.inactive", locale)})` : ""}`,
            how,
            `${when(g.granted_at)}${g.granted_by_name ? ` · ${g.granted_by_name}` : ""}`,
            g.expires_at ? when(g.expires_at) : t("grantshist.no_expiry", locale),
          ],
        };
      })
    : [];
  const currentColumns: DataTableColumn[] = [
    { header: t("grantshist.col.key", locale), sortable: true, className: "min-w-48" },
    { header: t("grantshist.col.holder", locale), sortable: true },
    { header: t("grantshist.col.how", locale), sortable: true },
    { header: t("grantshist.col.granted", locale), sortable: true, defaultDir: "desc" },
    { header: t("grantshist.col.expires", locale), sortable: true },
  ];

  const history: DataTableRow[] = res.ok
    ? res.data.history.map((h) => ({
        key: h.id,
        searchText: `${h.permission_key} ${h.holder_name ?? ""} ${h.granted_by_name ?? ""} ${h.revoked_by_name ?? ""}`,
        sort: [h.permission_key, h.holder_name, h.granted_at, h.revoked_at],
        cells: [
          <span key="key" className="font-medium">{h.permission_key}</span>,
          h.holder_name ?? "-",
          `${when(h.granted_at)}${h.granted_by_name ? ` (${h.granted_by_name})` : ""}`,
          h.revoked_at ? `${when(h.revoked_at)}${h.revoked_by_name ? ` (${h.revoked_by_name})` : ""}` : "-",
        ],
      }))
    : [];
  const historyColumns: DataTableColumn[] = [
    { header: t("grantshist.col.key", locale), sortable: true },
    { header: t("grantshist.col.holder", locale), sortable: true },
    { header: t("grantshist.history.granted", locale), sortable: true, defaultDir: "desc" },
    { header: t("grantshist.history.revoked", locale), sortable: true, defaultDir: "desc" },
  ];

  const audit: DataTableRow[] = res.ok
    ? res.data.audit.map((a) => ({
        key: a.id,
        searchText: `${a.action} ${a.actor_name ?? ""} ${a.subject_name ?? ""} ${a.permission_key ?? ""}`,
        sort: [a.created_at, a.action, a.actor_name, a.subject_name, a.permission_key],
        cells: [when(a.created_at), a.action, a.actor_name ?? "-", a.subject_name ?? "-", a.permission_key ?? "-"],
      }))
    : [];
  // The audit list had no column headings of its own; these name what each part of the old one-line entry was.
  const auditColumns: DataTableColumn[] = [
    { header: "When", sortable: true, defaultDir: "desc" },
    { header: "Action", sortable: true },
    { header: "By", sortable: true },
    { header: "About", sortable: true },
    { header: t("grantshist.col.key", locale), sortable: true },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("grantshist.title", locale)}
        description={t("grantshist.intro", locale)}
        backTo={{ href: "/admin/settings/access", label: t("grantshist.back", locale) }}
      />
      {!res.ok ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("grantshist.load_error", locale)}</p>
      ) : (
        <>
          <section aria-labelledby="current" className="space-y-2">
            <h2 id="current" className="font-heading text-xl font-semibold text-charcoal-ink">{t("grantshist.current.title", locale)}</h2>
            <DataTable
              caption={t("grantshist.current.title", locale)}
              columns={currentColumns}
              rows={current}
              searchLabel="Search access"
              searchPlaceholder="Permission, person or role"
              emptyMessage={t("grantshist.current.none", locale)}
              noun={{ one: "grant", many: "grants" }}
            />
          </section>
          <section aria-labelledby="history" className="space-y-2">
            <h2 id="history" className="font-heading text-xl font-semibold text-charcoal-ink">{t("grantshist.history.title", locale)}</h2>
            <DataTable
              caption={t("grantshist.history.title", locale)}
              columns={historyColumns}
              rows={history}
              searchLabel="Search grant history"
              emptyMessage={t("grantshist.history.none", locale)}
              noun={{ one: "entry", many: "entries" }}
            />
          </section>
          <section aria-labelledby="audit" className="space-y-2">
            <h2 id="audit" className="font-heading text-xl font-semibold text-charcoal-ink">{t("grantshist.audit.title", locale)}</h2>
            <DataTable
              caption={t("grantshist.audit.title", locale)}
              columns={auditColumns}
              rows={audit}
              searchLabel="Search the audit trail"
              emptyMessage={t("grantshist.audit.none", locale)}
              noun={{ one: "entry", many: "entries" }}
            />
          </section>
        </>
      )}
    </div>
  );
}
