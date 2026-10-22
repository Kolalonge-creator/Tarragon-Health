import Link from "next/link";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { formatPatientDate } from "@/lib/format-date";
import { NAV_ICON } from "@/lib/icons";
import { createClient } from "@/lib/supabase/server";
import { t } from "@tarragon/i18n";
import { RequestControls } from "../request-controls";

/** One request: the letter to download, what to do next, the dates, and the way to add the documents once they arrive. */
export default async function RecordsRequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { subjectId, profile, uiLanguage } = await getPatientDashboardContext();
  const isOwn = subjectId === profile.id;
  const supabase = await createClient();
  const { data: rows, error: listError } = isOwn ? await supabase.rpc("my_records_requests") : { data: null, error: null };
  const r = (rows ?? []).find((x) => x.id === id);

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={{ href: "/patient/records-requests", label: t("records_request.back", uiLanguage) }}
        title={r?.facility_name ?? t("records_request.title", uiLanguage)}
        icon={NAV_ICON.upload}
        description={r ? t(`records_request.state.${r.state as "prepared" | "sent" | "received" | "withdrawn"}`, uiLanguage) : undefined}
      />
      {!isOwn ? (
        <p className="text-sm">{t("records_request.own_only", uiLanguage)}</p>
      ) : listError ? (
        <p role="alert" className="text-sm">{t("records_request.load_failed", uiLanguage)}</p>
      ) : !r ? (
        <p role="alert" className="text-sm">{t("records_request.not_found", uiLanguage)}</p>
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle>{t("records_request.asks_for", uiLanguage)}</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <ul className="list-disc pl-5">
                {r.scope_codes.map((c) => (
                  <li key={c}>{t(`records_request.scope.${c as "discharge_summary" | "lab_results" | "imaging_report" | "whole_record"}`, uiLanguage)}</li>
                ))}
              </ul>
              {r.requested_at ? <p>{t("records_request.asked_on", uiLanguage, { date: formatPatientDate(r.requested_at) })}</p> : null}
              {r.state === "sent" && r.due_at ? (
                <p>{r.is_overdue ? t("records_request.overdue", uiLanguage, { date: formatPatientDate(r.due_at) }) : t("records_request.due_on", uiLanguage, { date: formatPatientDate(r.due_at) })}</p>
              ) : null}
              {r.received_at ? <p>{t("records_request.received_on", uiLanguage, { date: formatPatientDate(r.received_at) })}</p> : null}
              {r.state === "sent" ? <p className="text-charcoal-ink/70 dark:text-night-ink/70">{t("records_request.reply_date_note", uiLanguage)}</p> : null}
            </CardContent>
          </Card>

          {r.state === "prepared" || r.state === "sent" ? (
            <Card>
              <CardHeader><CardTitle>{t("records_request.how_title", uiLanguage)}</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>{t("records_request.how_body", uiLanguage)}</p>
                <a href={`/api/patient/records-requests/${r.id}/letter`} download className="inline-block min-h-11 rounded-md bg-brand-green px-4 py-3 text-sm font-medium text-white">
                  {t("records_request.download_letter", uiLanguage)}
                </a>
              </CardContent>
            </Card>
          ) : null}

          {r.state === "received" ? (
            <Card>
              <CardContent className="space-y-3 pt-4 text-sm">
                <p>{t("records_request.received_next", uiLanguage)}</p>
                <Link href="/patient/documents" className="inline-flex min-h-11 items-center rounded-md bg-brand-green px-4 text-sm font-medium text-white">
                  {t("records_request.add_documents", uiLanguage)}
                </Link>
              </CardContent>
            </Card>
          ) : null}

          <RequestControls id={r.id} state={r.state} note={r.note} locale={uiLanguage} />
        </>
      )}
    </div>
  );
}
