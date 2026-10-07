import Link from "next/link";
import { t, type Locale } from "@tarragon/i18n";
import { loadDashboard } from "@/lib/reliability/load";
import { ackPercent, bandCounts, dashboardSettings, handbackRate, secondsLabel, waitLabel, type Dashboard } from "@/lib/reliability/model";

const card = "rounded-xl border border-charcoal-ink/10 bg-white p-4 text-sm dark:border-night-ink/15 dark:bg-night-card";
const h2 = "font-heading text-xl font-semibold text-charcoal-ink";
const lagos = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function bandLabel(locale: Locale, i: number, bands: { min: number }[]): string {
  const b = bands[i];
  const higher = bands[i - 1];
  if (i === 0 || !higher) return t("slarel.dist.band", locale, { from: b?.min ?? 0 });
  if (i === bands.length - 1) return t("slarel.dist.band_low", locale, { to: higher.min });
  return t("slarel.dist.band_mid", locale, { from: b?.min ?? 0, to: higher.min - 1 });
}

/**
 * The reliability and SLA dashboard (S36e, spec 9.5 and 9.4). One component for two doors: /clinician/reliability for the Chief Medical
 * Officer (named list, on-call names) and /admin/ops/reliability for operations (aggregate only). What each viewer may see is decided
 * by the database function, not here: the ops answer simply carries no names, so the screen has nothing to leak. A failed read shows a
 * load failure, never zeros. Reliability is advisory: nothing is ranked, no button suspends or pays.
 */
export async function ReliabilityPage({ viewer, locale }: { viewer: "lead" | "ops"; locale: Locale }) {
  const result = await loadDashboard();
  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">{t("slarel.title", locale)}</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t(viewer === "lead" ? "slarel.intro.lead" : "slarel.intro.ops", locale)}</p>
      </div>
      {!result.ok ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{t("slarel.load_error", locale)}</p>
      ) : (
        <Body d={result.data} viewer={viewer} locale={locale} />
      )}
    </div>
  );
}

function Body({ d, viewer, locale }: { d: Dashboard; viewer: "lead" | "ops"; locale: Locale }) {
  const settings = dashboardSettings();
  const rate = handbackRate(d.handbacks);
  const pct = ackPercent(d.pages);
  const bands = [...settings.bands].sort((a, b) => b.min - a.min);
  const counts = d.distribution.scores ? bandCounts(d.distribution.scores, bands) : [];
  return (
    <>
      <p className="text-xs text-charcoal-ink/60">{t("slarel.updated", locale, { time: lagos(d.generated_at), days: d.window_days })}</p>

      <section aria-labelledby="slarel-tasks" className="space-y-3">
        <h2 id="slarel-tasks" className={h2}>{t("slarel.tasks.title", locale)}</h2>
        {d.tasks.waiting.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70">{t("slarel.tasks.none", locale)}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {d.tasks.waiting.map((w) => (
              <li key={w.priority_class} className={card}>
                <p className="font-medium text-charcoal-ink">{t("slarel.tasks.class", locale, { class: w.priority_class })}: {t("slarel.tasks.waiting", locale, { count: w.waiting })}</p>
                <p className="text-charcoal-ink/70">{t("slarel.tasks.oldest", locale, { wait: waitLabel(w.oldest_wait_minutes) })}</p>
                <p className={w.past_due > 0 ? "font-medium text-red-800" : "text-charcoal-ink/70"}>
                  {w.past_due > 0 ? t("slarel.tasks.past_due", locale, { count: w.past_due }) : t("slarel.tasks.on_time", locale)}
                  {w.past_due > 0 ? ` · ${t("slarel.tasks.oldest_past_due", locale, { wait: waitLabel(w.oldest_past_due_minutes) })}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="text-sm text-charcoal-ink/70">{t("slarel.tasks.claimed", locale, { count: d.tasks.claimed, late: d.tasks.claimed_past_due })}</p>
      </section>

      <section aria-labelledby="slarel-pages" className="space-y-3">
        <h2 id="slarel-pages" className={h2}>{t("slarel.pages.title", locale)}</h2>
        {d.pages.total === 0 ? (
          <p className="text-sm text-charcoal-ink/70">{t("slarel.pages.none", locale)}</p>
        ) : (
          <div className={card}>
            <p className="font-medium text-charcoal-ink">{t("slarel.pages.within", locale, { count: d.pages.acknowledged_in_window, total: d.pages.total, minutes: d.pages.window_minutes, percent: pct ?? 0 })}</p>
            <p className="text-charcoal-ink/70">{t("slarel.pages.acknowledged", locale, { count: d.pages.acknowledged })}</p>
            <p className="text-charcoal-ink/70">{t("slarel.pages.median", locale, { median: secondsLabel(d.pages.median_ack_seconds), p90: secondsLabel(d.pages.p90_ack_seconds) })}</p>
            {d.pages.no_cover > 0 && <p className="font-medium text-red-800">{t("slarel.pages.no_cover", locale, { count: d.pages.no_cover })}</p>}
          </div>
        )}
        <h3 className="text-sm font-semibold text-charcoal-ink">{t("slarel.pages.unack.title", locale)}</h3>
        {d.pages.unacknowledged.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70">{t("slarel.pages.unack.none", locale)}</p>
        ) : (
          <ul className="grid gap-2">
            {d.pages.unacknowledged.map((p) => (
              <li key={p.sent_at} className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">
                {t("slarel.pages.unack.row", locale, { wait: secondsLabel(p.seconds_waiting), level: p.level ?? 0 })}
                {p.no_cover ? ` · ${t("slarel.pages.unack.no_cover", locale)}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="slarel-cover" className="space-y-3">
        <h2 id="slarel-cover" className={h2}>{t("slarel.cover.title", locale)}</h2>
        <div className={card}>
          <p className={d.cover.covered_now ? "font-medium text-emerald-800" : "font-medium text-red-800"}>{t(d.cover.covered_now ? "slarel.cover.now_yes" : "slarel.cover.now_no", locale)}</p>
          {viewer === "lead" && d.on_call && (
            <p className="text-charcoal-ink/70">
              {t("slarel.cover.primary", locale, { name: d.on_call.primary ?? t("slarel.cover.none_named", locale) })} · {t("slarel.cover.backup", locale, { name: d.on_call.backup ?? t("slarel.cover.none_named", locale) })}
            </p>
          )}
        </div>
        <h3 className="text-sm font-semibold text-charcoal-ink">{t("slarel.cover.gaps", locale, { days: d.cover.gap_days })}</h3>
        {d.cover.gaps.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70">{t("slarel.cover.no_gaps", locale, { days: d.cover.gap_days })}</p>
        ) : (
          <ul className="grid gap-1 text-sm text-charcoal-ink/80">
            {d.cover.gaps.map((g) => (
              <li key={`${g.from}-${g.kind}`}>{lagos(g.from)} to {lagos(g.to)} · {t(`slarel.cover.kind.${g.kind}` as Parameters<typeof t>[0], locale)}</li>
            ))}
          </ul>
        )}
        {viewer === "lead" && <Link href="/clinician/team-rota" className="inline-block rounded-lg border border-charcoal-ink/20 px-3 py-1.5 text-sm font-semibold text-charcoal-ink">{t("slarel.cover.fix", locale)}</Link>}
      </section>

      <section aria-labelledby="slarel-handbacks" className="space-y-3">
        <h2 id="slarel-handbacks" className={h2}>{t("slarel.handbacks.title", locale)}</h2>
        {rate.total === 0 ? (
          <p className="text-sm text-charcoal-ink/70">{t("slarel.handbacks.none", locale)}</p>
        ) : (
          <div className={card}>
            <p className="font-medium text-charcoal-ink">{t("slarel.handbacks.rate", locale, { handed: rate.handedBack, total: rate.total, percent: rate.percent ?? 0 })}</p>
            <p className="text-charcoal-ink/70">
              {t("slarel.handbacks.counts", locale, {
                reasoned: d.handbacks.handed_back_reasoned ?? 0,
                other: d.handbacks.handed_back_other ?? 0,
                on_time: d.handbacks.completed_on_time ?? 0,
                late: d.handbacks.completed_late ?? 0,
                expired: d.handbacks.claim_expired ?? 0,
              })}
            </p>
          </div>
        )}
      </section>

      <section aria-labelledby="slarel-dist" className="space-y-3">
        <div>
          <h2 id="slarel-dist" className={h2}>{t("slarel.dist.title", locale)}</h2>
          <p className="text-sm text-charcoal-ink/70">{t("slarel.dist.note", locale)}</p>
        </div>
        {d.distribution.suppressed ? (
          <p className="text-sm text-charcoal-ink/70">{t("slarel.dist.suppressed", locale, { min: d.distribution.min_group })}</p>
        ) : d.distribution.clinicians === 0 ? (
          <p className="text-sm text-charcoal-ink/70">{t("slarel.dist.none", locale)}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-3">
            {counts.map((c, i) => (
              <li key={c.key} className={card}>
                <p className="font-medium text-charcoal-ink">{bandLabel(locale, i, bands)}</p>
                <p className="text-charcoal-ink/70">{t("slarel.dist.count", locale, { count: c.count })}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {viewer === "lead" && d.individuals && (
        <section aria-labelledby="slarel-people" className="space-y-3">
          <div>
            <h2 id="slarel-people" className={h2}>{t("slarel.people.title", locale)}</h2>
            <p className="max-w-3xl text-sm text-charcoal-ink/70">{t("slarel.people.note", locale)}</p>
          </div>
          {d.individuals.length === 0 ? (
            <p className="text-sm text-charcoal-ink/70">{t("slarel.people.none", locale)}</p>
          ) : (
            <ul className="grid gap-1 text-sm">
              {d.individuals.map((p) => (
                <li key={p.name} className="flex flex-wrap justify-between gap-2 border-b border-charcoal-ink/10 py-1">
                  <span className="font-medium text-charcoal-ink">{p.name}</span>
                  <span className="text-charcoal-ink/70">
                    {p.score === null ? t("slarel.people.no_score", locale) : t("slarel.people.row", locale, { score: Math.round(p.score), events: p.events, handbacks: p.handbacks })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
