import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
import { exportIpsBundle } from "@/lib/fhir/export-service";
import { createClient } from "@/lib/supabase/server";
import { t } from "@tarragon/i18n";

/**
 * "What is inside" for the International Patient Summary download: one printable page that lists, in plain language, exactly what the file will
 * carry, built from the same database snapshot. Asking the database for the record writes an audited "copy" row, so the summary is only read
 * when the person asks to see it (`?show=1`), never on every visit or refresh. Only the person themselves sees it.
 */
export default async function IpsPreviewPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show } = await searchParams;
  const { subjectId, profile, uiLanguage } = await getPatientDashboardContext();
  const isOwn = subjectId === profile.id;
  const supabase = await createClient();
  const outcome = isOwn && show === "1" ? await exportIpsBundle(supabase, { patientId: subjectId }) : null;
  const nothing = outcome?.ok ? outcome.result.sections.every((s) => s.empty && !s.withheld) : false;

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={{ href: "/patient/data-exchange", label: t("exchange.title", uiLanguage) }}
        title={t("exchange.ips.preview_title", uiLanguage)}
        icon={NAV_ICON.upload}
        description={t("exchange.ips.preview_intro", uiLanguage)}
      />
      {!isOwn ? (
        <p className="text-sm">{t("exchange.own_only", uiLanguage)}</p>
      ) : show !== "1" ? (
        <a href="/patient/data-exchange/summary?show=1" className="inline-block min-h-11 rounded-md bg-brand-green px-4 py-3 text-sm font-medium text-white">
          {t("exchange.ips.preview_show", uiLanguage)}
        </a>
      ) : !outcome || !outcome.ok ? (
        <p role="alert" className="text-sm">{t("exchange.ips.preview_failed", uiLanguage)}</p>
      ) : nothing ? (
        <p className="text-sm">{t("exchange.ips.preview_empty", uiLanguage)}</p>
      ) : (
        <>
          {outcome.result.sections.map((s) => (
            <Card key={s.key}>
              <CardHeader><CardTitle>{s.title}</CardTitle></CardHeader>
              <CardContent>
                {s.lines.length === 0 ? (
                  <p className="text-sm">{t(s.withheld ? "exchange.ips.section_withheld" : "exchange.ips.section_empty", uiLanguage)}</p>
                ) : (
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {s.lines.map((line, i) => (
                      <li key={`${s.key}-${i}`}>{line}</li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          ))}
          <Card>
            <CardHeader><CardTitle>{t("exchange.ips.left_out_title", uiLanguage)}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>{t("exchange.ips.left_out_body", uiLanguage)}</p>
              {outcome.result.trimmed > 0 ? (
                <p>{t("exchange.ips.trimmed", uiLanguage, { count: String(outcome.result.trimmed) })}</p>
              ) : null}
              {outcome.result.skipped.length > 0 ? (
                <p>{t("exchange.ips.skipped", uiLanguage, { count: String(outcome.result.skipped.length) })}</p>
              ) : null}
              <p>{t("exchange.ips.not_validated", uiLanguage)}</p>
            </CardContent>
          </Card>
          <a href="/api/patient/ips-export" download className="inline-block min-h-11 rounded-md bg-brand-green px-4 py-3 text-sm font-medium text-white">
            {t("exchange.ips.button", uiLanguage)}
          </a>
        </>
      )}
    </div>
  );
}
