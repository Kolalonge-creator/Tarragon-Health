import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
import { createClient } from "@/lib/supabase/server";
import { t, type MessageKey } from "@tarragon/i18n";

interface JournalRow {
  symptom_id: string;
  reported_at: string;
  symptom_type: string;
  free_text: string | null;
  severity: number | null;
  source: string;
  assessment_id: string | null;
  triage_grade: string | null;
}

function fmt(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Lagos" });
}

/**
 * The symptom journal (S43, spec 2.4): what the person noted, newest first, each
 * linked to the symptom check it came from (if any) and to the same entry on the
 * timeline. Entries are logged offline-first by the app (a client id makes a retry
 * safe); this page only reads. It shows the person's own entries only.
 */
export default async function SymptomJournalPage() {
  const { uiLanguage } = await getPatientDashboardContext();
  const supabase = await createClient();
  const { data } = await supabase.rpc("patient_symptom_journal", { p_limit: 100 });
  const rows = (data ?? []) as unknown as JournalRow[];

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={{ href: "/patient", label: t("passport.back", uiLanguage) }}
        title={t("journal.title", uiLanguage)}
        icon={NAV_ICON.review}
        description={t("journal.description", uiLanguage)}
      />
      {rows.length === 0 ? (
        <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("journal.none", uiLanguage)}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.symptom_id}>
              <Card>
                <CardContent className="space-y-1 pt-4 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-medium capitalize">{r.symptom_type.replace(/_/g, " ")}</p>
                    <p className="text-xs text-charcoal-ink/60">{fmt(r.reported_at)}</p>
                  </div>
                  {r.free_text && <p className="text-charcoal-ink/80">{r.free_text}</p>}
                  {r.severity !== null && <p className="text-xs text-charcoal-ink/60">{t("journal.severity", uiLanguage, { value: String(r.severity) })}</p>}
                  {r.assessment_id && <p className="text-xs text-charcoal-ink/60">{t("journal.from_check", uiLanguage)}</p>}
                  {r.triage_grade && (r.triage_grade === "red" || r.triage_grade === "amber" || r.triage_grade === "green") && (
                    <p className="text-xs text-charcoal-ink/60">{t(`journal.grade.${r.triage_grade}` as MessageKey, uiLanguage)}</p>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
