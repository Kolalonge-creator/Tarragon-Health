"use client";

import { t, pointsRuleLabel, pointsTierLabel } from "@tarragon/i18n";
import { useMyPointsStatus, useRewardRules, useWellnessPointsLedger } from "@/lib/queries/wellness";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SEMANTIC_ICON } from "@/lib/icons";

/**
 * Health Points (S58, spec 11.1 to 11.3). Balance, how to earn, this year's level and a "coming soon" note for checkout
 * discounts (the redemption path is built but switched off until the founder sets the cap). Calm copy only: no counter that
 * resets, no loss wording, no comparison with anyone (leaderboards are off).
 */
export function WellnessPointsCard({ patientId }: { patientId: string }) {
  const { data: status, isLoading } = useMyPointsStatus(patientId);
  const { data: rules } = useRewardRules();
  const { data: ledger } = useWellnessPointsLedger(patientId, 8);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.points className="h-5 w-5 text-sprout-gold" strokeWidth={2} aria-hidden />
          {t("points.title")}
        </CardTitle>
        <CardDescription>{t("points.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">{t("points.loading")}</p>}
        {status && (
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-heading text-3xl font-bold text-charcoal-ink dark:text-night-ink">
              {status.balance.toLocaleString()}
            </span>
            <span className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
              {t("points.balance_unit")}
              {status.lifetime_earned > 0 ? ` · ${t("points.earned_all_time", "en", { points: status.lifetime_earned.toLocaleString() })}` : ""}
            </span>
          </div>
        )}

        {status && (
          <section aria-labelledby="points-level">
            <h3 id="points-level" className="text-sm font-semibold text-charcoal-ink dark:text-night-ink">{t("points.level.title")}</h3>
            {status.is_minor || !status.tier ? (
              <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("points.level.adults_only")}</p>
            ) : (
              <div className="space-y-1 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
                <p>{t("points.level.current", "en", { tier: pointsTierLabel(status.tier) })}</p>
                {status.tier_from === "last_year" && <p>{t("points.level.kept", "en", { tier: pointsTierLabel(status.tier) })}</p>}
                {status.next_tier && status.points_to_next != null && status.points_to_next > 0 ? (
                  <p>{t("points.level.next", "en", { points: status.points_to_next, tier: pointsTierLabel(status.next_tier) })}</p>
                ) : (
                  !status.next_tier && <p>{t("points.level.top")}</p>
                )}
                <p className="text-xs text-charcoal-ink/55 dark:text-night-ink/55">{t("points.level.resets")}</p>
              </div>
            )}
          </section>
        )}

        {rules && rules.length > 0 && (
          <section aria-labelledby="points-how">
            <h3 id="points-how" className="text-sm font-semibold text-charcoal-ink dark:text-night-ink">{t("points.how.title")}</h3>
            <p className="mb-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("points.how.intro")}</p>
            <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15 text-sm">
              {rules.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="text-charcoal-ink/80 dark:text-night-ink/80">
                    {pointsRuleLabel(r.code)}
                    {r.verified_action && (
                      <span className="ml-2 rounded bg-brand-green/10 px-1.5 py-0.5 text-[11px] text-brand-green dark:text-brand-green-bright">
                        {t("points.how.verified")}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 font-medium text-brand-green dark:text-brand-green-bright">
                    {r.points_source === "catalogue" ? t("points.how.catalogue") : t("points.how.per", "en", { points: r.points })}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-charcoal-ink/55 dark:text-night-ink/55">{t("points.how.daily_note")}</p>
          </section>
        )}

        <section aria-labelledby="points-redeem" className="rounded-md bg-charcoal-ink/5 p-3 dark:bg-night-ink/10">
          <h3 id="points-redeem" className="text-sm font-semibold text-charcoal-ink dark:text-night-ink">{t("points.redeem.title")}</h3>
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("points.redeem.coming_soon")}</p>
          <p className="mt-1 text-xs text-charcoal-ink/55 dark:text-night-ink/55">{t("points.redeem.never_cash")}</p>
        </section>

        <section aria-labelledby="points-activity">
          <h3 id="points-activity" className="mb-1 text-sm font-semibold text-charcoal-ink dark:text-night-ink">{t("points.activity.title")}</h3>
          {ledger && ledger.length > 0 ? (
            <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15 text-sm">
              {ledger.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between py-1.5">
                  <span className="text-charcoal-ink/80 dark:text-night-ink/80">{pointsRuleLabel(entry.reason)}</span>
                  <span className={entry.points > 0 ? "font-medium text-brand-green dark:text-brand-green-bright" : "font-medium text-charcoal-ink/60 dark:text-night-ink/60"}>
                    {entry.points > 0 ? "+" : ""}
                    {entry.points}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">{t("points.activity.empty")}</p>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
