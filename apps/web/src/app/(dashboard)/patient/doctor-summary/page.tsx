import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
import { SECTION_KEYS, summaryConfig, type SectionKey } from "@/lib/doctor-summary-pdf/model";
import { t, type MessageKey } from "@tarragon/i18n";

/**
 * Build a summary for a visit (spec 2.9). A plain form that POSTs to the PDF route: it works without JavaScript and a page view
 * never builds (or audits) anything. Not offered while acting for someone else: the summary is the signed-in person's own.
 */
const DEFAULT_ON: readonly SectionKey[] = ["bp", "bp_chart", "medicines", "adherence"];

export default async function DoctorSummaryPage() {
  const { uiLanguage, acting } = await getPatientDashboardContext();
  const cfg = summaryConfig();
  return (
    <div className="space-y-6">
      <PageHeader
        backTo={{ href: "/patient/health-passport", label: t("passport.back", uiLanguage) }}
        title={t("visitsummary.title", uiLanguage)}
        icon={NAV_ICON.review}
        description={t("visitsummary.description", uiLanguage)}
      />
      {acting ? (
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("visitsummary.own_only", uiLanguage)}</p>
      ) : (
        <Card>
          <CardContent className="pt-4">
            <form method="post" action="/api/patient/doctor-summary/pdf" className="space-y-5">
              <div className="space-y-1">
                <label htmlFor="days" className="text-sm font-medium">
                  {t("visitsummary.period", uiLanguage)}
                </label>
                <select id="days" name="days" defaultValue={String(cfg.defaultDays)} className="block rounded-md border border-border bg-background px-3 py-2 text-sm">
                  {cfg.periodDays.map((d) => (
                    <option key={d} value={d}>
                      {t("visitsummary.period_option", uiLanguage, { days: String(d) })}
                    </option>
                  ))}
                </select>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">{t("visitsummary.sections", uiLanguage)}</legend>
                {SECTION_KEYS.map((key) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="section" value={key} defaultChecked={DEFAULT_ON.includes(key)} className="h-4 w-4" />
                    {t(`visitsummary.section.${key}` as MessageKey, uiLanguage)}
                  </label>
                ))}
              </fieldset>
              <button type="submit" className="rounded-md bg-brand-green px-4 py-2 text-sm font-medium text-white hover:opacity-90">
                {t("visitsummary.build", uiLanguage)}
              </button>
            </form>
            <div className="mt-5 space-y-2 text-xs text-charcoal-ink/70 dark:text-night-ink/70">
              <p>{t("visitsummary.note_wearable", uiLanguage)}</p>
              <p>{t("visitsummary.note_private", uiLanguage)}</p>
              <p>{t("visitsummary.note_logged", uiLanguage)}</p>
              <p>{t("visitsummary.note_online", uiLanguage)}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
