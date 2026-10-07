import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
import { createClient } from "@/lib/supabase/server";
import { t } from "@tarragon/i18n";
import { ConsentForm, WithdrawButton } from "./consent-form";

function fmt(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });
}

/**
 * Records from other places (S44, spec 2.10 and 2.11). The person downloads a FHIR copy of their record, says which named outside systems may
 * send records to them (or receive theirs), sees what was received and what each copy was, and can stop allowing a system at any time. Nothing
 * received here is part of the record: a care team member reviews each item before it joins. Consent wording is a placeholder until counsel
 * approves it. Only the person themselves sees this page, so it is not shown while acting for someone else.
 */
export default async function DataExchangePage() {
  const { subjectId, profile, uiLanguage } = await getPatientDashboardContext();
  const isOwn = subjectId === profile.id;
  const supabase = await createClient();

  const [consents, received, copies] = isOwn
    ? await Promise.all([
        supabase.rpc("my_external_exchange_consents"),
        supabase.rpc("my_external_records", { p_limit: 50 }),
        supabase.from("fhir_export_log").select("id, requester_kind, sections, created_at").eq("patient_id", subjectId).order("created_at", { ascending: false }).limit(20),
      ])
    : [null, null, null];

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={{ href: "/patient/health-passport", label: t("passport.back", uiLanguage) }}
        title={t("exchange.title", uiLanguage)}
        icon={NAV_ICON.upload}
        description={t("exchange.description", uiLanguage)}
      />
      {!isOwn ? (
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("exchange.own_only", uiLanguage)}</p>
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle>{t("exchange.download_title", uiLanguage)}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">{t("exchange.download_body", uiLanguage)}</p>
              <a href="/api/patient/fhir-export" download className="inline-block rounded-md bg-brand-green px-4 py-2 text-sm font-medium text-white">
                {t("exchange.download_button", uiLanguage)}
              </a>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{t("exchange.consents_title", uiLanguage)}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {(consents?.data ?? []).length === 0 ? (
                <p className="text-sm">{t("exchange.consents_none", uiLanguage)}</p>
              ) : (
                <ul className="space-y-2">
                  {(consents?.data ?? []).map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span>
                        <strong>{c.source_system}</strong>, {t(`exchange.direction.${c.direction as "import" | "export" | "both"}`, uiLanguage)}.{" "}
                        {c.withdrawn_at
                          ? t("exchange.withdrawn_on", uiLanguage, { date: fmt(c.withdrawn_at) })
                          : t("exchange.granted_on", uiLanguage, { date: fmt(c.granted_at) })}
                      </span>
                      {c.withdrawn_at ? null : <WithdrawButton id={c.id} locale={uiLanguage} />}
                    </li>
                  ))}
                </ul>
              )}
              <ConsentForm locale={uiLanguage} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{t("exchange.received_title", uiLanguage)}</CardTitle></CardHeader>
            <CardContent>
              {(received?.data ?? []).length === 0 ? (
                <p className="text-sm">{t("exchange.received_none", uiLanguage)}</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {(received?.data ?? []).map((r) => (
                    <li key={r.id}>
                      {fmt(r.imported_at)}: {r.fhir_resource_type} from <strong>{r.source_system}</strong>.{" "}
                      {r.superseded_at ? t("exchange.received.replaced", uiLanguage) : t(`exchange.received.${r.disposition as "proposed" | "stored_only"}`, uiLanguage)}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{t("exchange.copies_title", uiLanguage)}</CardTitle></CardHeader>
            <CardContent>
              {(copies?.data ?? []).length === 0 ? (
                <p className="text-sm">{t("exchange.copies_none", uiLanguage)}</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {(copies?.data ?? []).map((c) => (
                    <li key={c.id}>
                      {fmt(c.created_at)}: {t(`exchange.copy.${c.requester_kind as "self" | "supporter" | "staff"}`, uiLanguage)}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
