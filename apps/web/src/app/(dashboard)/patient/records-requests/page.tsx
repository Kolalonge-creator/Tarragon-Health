import Link from "next/link";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { formatPatientDate } from "@/lib/format-date";
import { NAV_ICON } from "@/lib/icons";
import { RECORDS_REQUEST_GUARD } from "@/lib/records-request/guard";
import { loadLetterConfig } from "@/lib/records-request/letter";
import { createClient } from "@/lib/supabase/server";
import { t } from "@tarragon/i18n";
import { RequestForm } from "./request-form";

/**
 * Asking a facility for your own records (docs/design/RRL.md). TarragonHealth writes a letter; the person prints it, hands it over or sends it
 * themselves, and tracks it here. Nothing is sent by the platform and nothing here depends on a message being delivered. Own requests only.
 */
export default async function RecordsRequestsPage() {
  const { subjectId, profile, uiLanguage } = await getPatientDashboardContext();
  const isOwn = subjectId === profile.id;
  const supabase = await createClient();
  const [{ data: rows, error: listError }, { data: open, error: guardError }] = isOwn
    ? await Promise.all([supabase.rpc("my_records_requests"), supabase.rpc("go_live_guard_is_open", { p_key: RECORDS_REQUEST_GUARD })])
    : [{ data: null, error: null }, { data: null, error: null }];
  const { wordingSigned } = loadLetterConfig();

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={{ href: "/patient/health-passport", label: t("passport.back", uiLanguage) }}
        title={t("records_request.title", uiLanguage)}
        icon={NAV_ICON.upload}
        description={t("records_request.description", uiLanguage)}
      />
      {!isOwn ? (
        <p className="text-sm">{t("records_request.own_only", uiLanguage)}</p>
      ) : (
        <>
          {wordingSigned ? null : <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("records_request.wording_notice", uiLanguage)}</p>}
          <Card>
            <CardHeader><CardTitle>{t("records_request.list_title", uiLanguage)}</CardTitle></CardHeader>
            <CardContent>
              {listError ? (
                <p role="alert" className="text-sm">{t("records_request.load_failed", uiLanguage)}</p>
              ) : (rows ?? []).length === 0 ? (
                <p className="text-sm">{t("records_request.none", uiLanguage)}</p>
              ) : (
                <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
                  {(rows ?? []).map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                      <span>
                        <strong>{r.facility_name}</strong>
                        <br />
                        {r.is_overdue && r.due_at
                          ? t("records_request.overdue", uiLanguage, { date: formatPatientDate(r.due_at) })
                          : t(`records_request.state.${r.state as "prepared" | "sent" | "received" | "withdrawn"}`, uiLanguage)}
                      </span>
                      <Link href={`/patient/records-requests/${r.id}`} className="inline-flex min-h-11 items-center rounded-md border border-brand-green px-4 text-sm font-medium">
                        {t("records_request.open", uiLanguage)}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t("records_request.new_title", uiLanguage)}</CardTitle></CardHeader>
            <CardContent>
              {guardError ? (
                <p role="alert" className="text-sm">{t("records_request.load_failed", uiLanguage)}</p>
              ) : open === true ? (
                <RequestForm locale={uiLanguage} />
              ) : (
                <p className="text-sm">{t("records_request.not_open", uiLanguage)}</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
