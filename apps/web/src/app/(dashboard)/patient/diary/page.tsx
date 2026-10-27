import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { NAV_ICON } from "@/lib/icons";
import { createClient } from "@/lib/supabase/server";
import { readProvenanceGuards } from "@/lib/diary/guards";
import { t } from "@tarragon/i18n";
import { DiarySheet } from "./diary-sheet";

/**
 * Readings copied from the person's own paper diary (S07y). Works with no model: a multi-row sheet the person types into. When the reading assistant is
 * switched on (it is not), a photo of a page can suggest rows, which the person checks one by one. Nothing is saved until the person confirms it, and what is
 * saved goes through the ordinary reading path with the label "From your paper diary".
 *
 * Closed (an honest "not switched on yet" page, nothing else) until the paper_diary_entry guard is open for this person (INV-14).
 */
export default async function DiaryPage() {
  const { uiLanguage } = await getPatientDashboardContext();
  const guards = await readProvenanceGuards(await createClient());

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={{ href: "/patient/vitals", label: t("diary.back", uiLanguage) }}
        title={t("diary.title", uiLanguage)}
        icon={NAV_ICON.upload}
        description={t("diary.intro", uiLanguage)}
      />
      {guards.diaryEntryOpen ? (
        <DiarySheet readerOpen={guards.diaryReaderOpen} />
      ) : (
        <Card>
          <CardContent className="space-y-1 pt-6" data-testid="diary-not-open">
            <p className="font-medium text-charcoal-ink dark:text-night-ink">{t("diary.not_open.title", uiLanguage)}</p>
            <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("diary.not_open.body", uiLanguage)}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
