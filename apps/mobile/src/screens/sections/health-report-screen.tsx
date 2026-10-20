import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { asLocale, t } from "@tarragon/i18n";
import { loadMyHealthReports, type ReportsLoad } from "@/lib/health-report";
import { buildMobileReportView, type SignedReportRow } from "@/lib/health-report-view";
import { useUiLanguage } from "@/lib/ui-language";
import { space } from "@/ui/design";
import { AppText, Button, Card, EmptyState, Screen, Skeleton, SkeletonGroup } from "@/ui/kit";

/**
 * "Your yearly report" (S46d): the signed Tarragon Health Report, read only. A list of signed reports and a plain view of one. It works with no signal
 * from the copy saved on the phone and says so. A report that is not signed is never here (see lib/health-report-view.ts).
 */
export function HealthReportScreen({ acting = false }: { acting?: boolean }) {
  const locale = asLocale(useUiLanguage());
  const [data, setData] = useState<ReportsLoad | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setData(null);
    setData(await loadMyHealthReports());
  }, []);

  useEffect(() => {
    // A report belongs to the person it is about, so nothing is read or shown while acting for someone else.
    if (!acting) void load();
  }, [load, acting]);

  const reports: SignedReportRow[] = data && (data.kind === "fresh" || data.kind === "cached") ? data.reports : [];
  const open = reports.find((r) => r.id === openId) ?? null;

  return (
    <Screen>
      <AppText variant="headline" heading>
        {t("report.mobile.title", locale)}
      </AppText>

      {acting ? (
        <EmptyState icon="labs" title={t("report.mobile.title", locale)} body={t("progress.own_only", locale)} />
      ) : data === null ? (
        <SkeletonGroup label={t("report.mobile.title", locale)}>
          <Skeleton width="100%" height={120} />
        </SkeletonGroup>
      ) : data.kind === "error" ? (
        <Card style={{ gap: space.md }}>
          <AppText variant="body">{t("report.mobile.error", locale)}</AppText>
          <Button title={t("history.retry", locale)} onPress={() => void load()} variant="secondary" />
        </Card>
      ) : data.kind === "empty" ? (
        <EmptyState icon="labs" title={t("report.mobile.title", locale)} body={t("report.mobile.empty", locale)} />
      ) : (
        <>
          {data.kind === "cached" ? (
            <AppText variant="body" tone="textMuted">
              {t("report.mobile.stale", locale, { date: data.cachedAt.slice(0, 10) })}
            </AppText>
          ) : null}
          {open ? <ReportDetail row={open} onBack={() => setOpenId(null)} /> : (
            reports.map((r) => (
              <Card key={r.id} style={{ gap: space.sm }}>
                <AppText variant="title" heading>
                  {t("report.mobile.item", locale, { year: r.year, version: r.version })}
                </AppText>
                <AppText variant="body" tone="textMuted">
                  {t("report.signed_by", locale, { name: r.signer_name, registration: r.signer_registration, date: r.signed_at.slice(0, 10) })}
                </AppText>
                <Button title={t("report.mobile.title", locale)} onPress={() => setOpenId(r.id)} variant="secondary" />
              </Card>
            ))
          )}
        </>
      )}
    </Screen>
  );
}

function ReportDetail({ row, onBack }: { row: SignedReportRow; onBack: () => void }) {
  const v = buildMobileReportView(row);
  return (
    <View style={{ gap: space.md }}>
      <Button title="Back" onPress={onBack} variant="secondary" />
      <AppText variant="title" heading>
        {v.title}
      </AppText>
      <AppText variant="body">{v.yearLine}</AppText>
      <AppText variant="body" tone="textMuted">
        {v.signedLine}
      </AppText>
      {v.correctionLine ? <AppText variant="body">{v.correctionLine}</AppText> : null}
      <Card style={{ gap: space.sm }}>
        <AppText variant="body">{v.summary}</AppText>
      </Card>
      {v.priorities.map((p) => (
        <Card key={p.n} style={{ gap: space.xs }}>
          <AppText variant="body" heading>
            {p.n}. {p.action}
          </AppText>
          <AppText variant="body">{p.why}</AppText>
          <AppText variant="body" tone="textMuted">
            {p.who}. {p.when}.
          </AppText>
        </Card>
      ))}
      {v.items.map((i) => (
        <Card key={i.label} style={{ gap: space.xs }}>
          <AppText variant="body" heading>
            {i.label}
            {i.value ? `: ${i.value}` : ""}
          </AppText>
          <AppText variant="body">
            {i.symbol} {i.stateWord}
          </AppText>
          {i.retest ? (
            <AppText variant="body" tone="textMuted">
              {i.retest}
            </AppText>
          ) : null}
        </Card>
      ))}
      {v.trends.map((tr) => (
        <AppText key={tr.label} variant="body" tone="textMuted">
          {tr.label}: {tr.line}
        </AppText>
      ))}
      {v.midYear ? <AppText variant="body">{v.midYear}</AppText> : null}
      <AppText variant="body" tone="textMuted">
        {v.statement}
      </AppText>
      <AppText variant="body">{v.emergency}</AppText>
      <AppText variant="body" tone="textMuted">
        {v.heldNote}
      </AppText>
    </View>
  );
}
