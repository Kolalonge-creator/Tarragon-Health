import Link from "next/link";
import { redirect } from "next/navigation";
import { t, type MessageKey } from "@tarragon/i18n";
import { DEFAULT_UI_LANGUAGE } from "@tarragon/shared";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { flagKey, licenceTone, orderForReview, parseScorecard, type ScorecardRow } from "@/lib/pharmacy-collection/scorecard-model";

export const metadata = { title: "Pharmacy scorecard" };
export const dynamic = "force-dynamic";

const lagos = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" }) : "");
const TONE_BADGE = { red: "red", amber: "amber", green: "green", grey: "grey" } as const;

function Licence({ row }: { row: ScorecardRow }) {
  const locale = DEFAULT_UI_LANGUAGE;
  const tone = licenceTone(row);
  const text =
    tone === "red" ? t("pharmscore.licence_expired", locale)
    : row.licence_days_left === null ? t("pharmscore.licence_none", locale)
    : t("pharmscore.licence_days", locale, { days: row.licence_days_left });
  return (
    <p className="text-sm">
      <span className="text-charcoal-ink/70">{t("pharmscore.licence", locale)}: </span>
      <Badge variant={TONE_BADGE[tone]}>{text}</Badge>
      {row.licence_expires_at && <span className="ml-2 text-xs text-charcoal-ink/60">{lagos(row.licence_expires_at)}</span>}
    </p>
  );
}

/**
 * Pharmacy scorecard (S28e, spec 21.7): turnaround to supply, flags raised, complaints and licence expiry for every partner pharmacy. Figures come from
 * the nightly partner quality check. A flag is a suggestion for staff to review: the rule never removes a pharmacy by itself. To act, use the partner
 * quality page (record a complaint, or pause the pharmacy from new work with a written reason). Admin only; the database refuses anyone else.
 */
export default async function AdminPharmacyScorecardPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  const locale = DEFAULT_UI_LANGUAGE;
  const { data, error } = await loose(await createClient()).rpc("pharmacy_scorecard", {});
  const parsed = error ? null : parseScorecard(data);
  const rows = parsed ? orderForReview(parsed) : null;

  return (
    <div className="space-y-6">
      <PageHeader title={t("pharmscore.title", locale)} description={t("pharmscore.intro", locale)} />
      <p className="max-w-3xl text-xs text-charcoal-ink/60">{t("pharmscore.turnaround_note", locale)}</p>
      {!rows ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">{t("pharmscore.load_failed", locale)}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-charcoal-ink/60">{t("pharmscore.none", locale)}</p>
      ) : (
        rows.map((r) => (
          <Card key={r.partner_id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-baseline justify-between gap-2">
                <span>{r.partner_name}{r.is_active ? "" : " (not active)"}</span>
                <span className="flex items-center gap-2 text-sm font-normal">
                  {r.score !== null && <span className="font-semibold">{t("pharmscore.score", locale)} {r.score.toFixed(1)}</span>}
                  {r.work_state === "suspended" && <Badge variant="red">{t("pharmscore.suspended", locale)}</Badge>}
                  <Badge variant={r.review_suggested ? "amber" : "green"}>{r.review_suggested ? t("pharmscore.review", locale) : t("pharmscore.fine", locale)}</Badge>
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {r.review_suggested && (
                <ul className="list-disc space-y-1 pl-5 text-amber-900">
                  {r.suggestions.map((code) => <li key={code}>{t(flagKey(code) as MessageKey, locale)}</li>)}
                </ul>
              )}
              <Licence row={r} />
              {!r.computed_at ? (
                <p className="text-charcoal-ink/60">{t("pharmscore.no_figures", locale)}</p>
              ) : (
                <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-charcoal-ink/70">{t("pharmscore.turnaround", locale)}</dt>
                    <dd>
                      {r.dispense_median_hours !== null && r.pct_within_target !== null && r.dispense_target_hours !== null
                        ? t("pharmscore.turnaround_value", locale, { median: r.dispense_median_hours, percent: r.pct_within_target, target: r.dispense_target_hours, count: r.dispenses_measured })
                        : t("pharmscore.turnaround_few", locale, { count: r.dispenses_measured })}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-charcoal-ink/70">{t("pharmscore.flags", locale)}</dt>
                    <dd>{t("pharmscore.flags_value", locale, { flags: r.flags_raised, stock: r.out_of_stock_flags, sent: r.sent_measured })}</dd>
                  </div>
                  <div>
                    <dt className="text-charcoal-ink/70">{t("pharmscore.complaints", locale)}</dt>
                    <dd>{t("pharmscore.complaints_value", locale, { upheld: r.complaints_upheld, open: r.complaints_open })}</dd>
                  </div>
                  <div>
                    <dt className="text-charcoal-ink/70">&nbsp;</dt>
                    <dd className="text-xs text-charcoal-ink/60">{t("pharmscore.computed", locale, { date: lagos(r.computed_at) })}</dd>
                  </div>
                </dl>
              )}
            </CardContent>
          </Card>
        ))
      )}
      <p className="text-xs text-charcoal-ink/60">
        {t("pharmscore.next", locale)}{" "}
        <Link href="/admin/partner-quality" className="font-semibold text-brand-green underline">Partner quality</Link>
      </p>
    </div>
  );
}
