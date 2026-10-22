import Link from "next/link";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
import { summaryConfig } from "@/lib/doctor-summary-pdf/model";
import { isPassportOpen } from "@/lib/doctor-summary-pdf/passport-guard";
import { t, type MessageKey } from "@tarragon/i18n";

/**
 * Result passport (item 10). A calm page over machinery that already exists: the patient-built PDF (`/api/patient/doctor-summary/pdf`, now
 * with blood sugar and lab sections) and the share links (S09/S09x: time limited, PIN, view cap, revoke, access log shown to the patient).
 * Patient-initiated only: nothing here runs until the person submits the form. Dormant behind `result_passport_enabled`; closed, the page
 * says so and builds nothing. The form is a plain POST so it works without JavaScript and a link preview can never build a document.
 */
const SECTIONS = ["allergies_conditions", "medicines", "bp", "bp_chart", "glucose", "lab_results"] as const;
const DEFAULT_ON: readonly (typeof SECTIONS)[number][] = ["allergies_conditions", "medicines", "bp", "glucose", "lab_results"];
const LABEL: Record<(typeof SECTIONS)[number], MessageKey> = {
  allergies_conditions: "visitsummary.section.allergies_conditions",
  medicines: "visitsummary.section.medicines",
  bp: "visitsummary.section.bp",
  bp_chart: "visitsummary.section.bp_chart",
  glucose: "resultpassport.section.glucose",
  lab_results: "resultpassport.section.lab_results",
};

export default async function ResultPassportPage() {
  const { uiLanguage, acting } = await getPatientDashboardContext();
  const open = acting ? false : await isPassportOpen(await createClient());
  const cfg = summaryConfig();
  return (
    <div className="space-y-6">
      <PageHeader
        backTo={{ href: "/patient/health-passport", label: t("passport.back", uiLanguage) }}
        title={t("resultpassport.title", uiLanguage)}
        icon={NAV_ICON.review}
        description={t("resultpassport.description", uiLanguage)}
      />
      {acting ? (
        <p className="text-base">{t("visitsummary.own_only", uiLanguage)}</p>
      ) : !open ? (
        <Card>
          <CardContent className="pt-4">
            <p role="status" className="text-base">{t("resultpassport.not_open", uiLanguage)}</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="pt-4">
              <form method="post" action="/api/patient/doctor-summary/pdf" className="space-y-5">
                <div className="space-y-1">
                  <label htmlFor="days" className="text-base font-medium">{t("visitsummary.period", uiLanguage)}</label>
                  <select id="days" name="days" defaultValue={String(cfg.defaultDays)} className="block rounded-md border border-border bg-background px-3 py-2 text-base">
                    {cfg.periodDays.map((d) => (
                      <option key={d} value={d}>{t("visitsummary.period_option", uiLanguage, { days: String(d) })}</option>
                    ))}
                  </select>
                </div>
                <fieldset className="space-y-3">
                  <legend className="text-base font-medium">{t("visitsummary.sections", uiLanguage)}</legend>
                  {SECTIONS.map((key) => (
                    <label key={key} className="flex items-center gap-3 text-base">
                      <input type="checkbox" name="section" value={key} defaultChecked={DEFAULT_ON.includes(key)} className="h-5 w-5" />
                      {t(LABEL[key], uiLanguage)}
                    </label>
                  ))}
                </fieldset>
                <button type="submit" className="rounded-md bg-brand-green px-5 py-3 text-base font-medium text-white hover:opacity-90">
                  {t("resultpassport.build", uiLanguage)}
                </button>
              </form>
              <div className="mt-5 space-y-2 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
                <p>{t("resultpassport.note_left_out", uiLanguage)}</p>
                <p>{t("resultpassport.note_generated", uiLanguage)}</p>
                <p>{t("visitsummary.note_wearable", uiLanguage)}</p>
                <p>{t("resultpassport.note_logged", uiLanguage)}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-3 pt-4">
              <h2 className="text-lg font-semibold">{t("resultpassport.share_title", uiLanguage)}</h2>
              <p className="text-base">{t("resultpassport.share_body", uiLanguage)}</p>
              <Link href="/patient/share-records" className="inline-block rounded-md border border-border px-5 py-3 text-base font-medium hover:bg-muted">
                {t("resultpassport.share_cta", uiLanguage)}
              </Link>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
