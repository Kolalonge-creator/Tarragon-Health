import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { asLocale, t } from "@tarragon/i18n";
import { loadMonthlyReports, type MonthlyReportsLoad } from "@/lib/monthly-reports";
import { useUiLanguage } from "@/lib/ui-language";
import { space } from "@/ui/design";
import { AppText, Button, Card, EmptyState, Screen, Skeleton, SkeletonGroup } from "@/ui/kit";

/**
 * "Your month" (S38c, Module 22.5): the person's own readings for the last closed month, written once after the month ends. It shows
 * no comparison with anyone, no ranking and no risk score. With too few readings it says so instead of showing an average.
 */
export function MonthlyReportScreen({ acting = false }: { acting?: boolean }) {
  const locale = asLocale(useUiLanguage());
  const [data, setData] = useState<MonthlyReportsLoad | null>(null);

  const load = useCallback(async () => {
    setData(null);
    setData(await loadMonthlyReports(locale));
  }, [locale]);

  useEffect(() => {
    // A summary belongs to the person it is about, so nothing is read while acting for someone else.
    if (!acting) void load();
  }, [load, acting]);

  const first = data?.ok ? data.reports[0] : undefined;
  return (
    <Screen>
      <View style={{ gap: space.xs }}>
        <AppText variant="headline" heading>
          {t("progress.title", locale)}
        </AppText>
        {first ? (
          <AppText variant="body" tone="textMuted">
            {first.headline}
          </AppText>
        ) : null}
      </View>

      {acting ? (
        <EmptyState icon="heart" title={t("progress.title", locale)} body={t("progress.own_only", locale)} />
      ) : data === null ? (
        <SkeletonGroup label={t("progress.title", locale)}>
          <Skeleton width="100%" height={120} />
        </SkeletonGroup>
      ) : !data.ok ? (
        <Card style={{ gap: space.md }}>
          <AppText variant="body">{t("progress.load_error", locale)}</AppText>
          <Button title={t("history.retry", locale)} onPress={() => void load()} variant="secondary" />
        </Card>
      ) : data.reports.length === 0 ? (
        <EmptyState icon="heart" title={t("progress.title", locale)} body={t("progress.empty", locale)} />
      ) : (
        <>
          {data.reports.map((r, i) => (
            <Card key={r.month} style={{ gap: space.sm }}>
              <AppText variant="title" heading>
                {r.monthLabel}
              </AppText>
              {r.lines.map((l) => (
                <AppText key={l} variant="body">
                  {l}
                </AppText>
              ))}
              {i === 0 ? (
                <View style={{ gap: space.xs }}>
                  <AppText variant="body" heading>
                    {t("progress.weekly_title", locale)}
                  </AppText>
                  {r.weeks.map((w) => (
                    <AppText key={w} variant="body" tone="textMuted">
                      {w}
                    </AppText>
                  ))}
                </View>
              ) : null}
            </Card>
          ))}
          <AppText variant="body" tone="textMuted">
            {t("progress.footer", locale)}
          </AppText>
        </>
      )}
    </Screen>
  );
}
