import { t, type MessageKey } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DASHBOARD_PATHS, type DashboardViewer } from "@/lib/outcomes/dashboard-paths";
import { runDashboardAction } from "@/lib/outcomes/dashboard-actions";
import { parseDashboard, type DashboardRow } from "@/lib/outcomes/dashboard-report";
import { ComparisonPanel, EngagementPanel, OutcomesPanel } from "./outcomes-panels";

const field = "mt-1 block w-full rounded-lg border border-charcoal-ink/20 px-3 py-2 text-sm";
const OUTCOME: Record<string, { ok: boolean; key: MessageKey }> = {
  run_done: { ok: true, key: "outcomes.dash.run.done" },
  run_error: { ok: false, key: "outcomes.dash.run.error" },
};
const tt = (key: MessageKey, params?: Record<string, string | number>) => t(key, "en", params);

/**
 * The honest outcomes dashboard, for the founder / super admin and for the Chief Medical Officer (whose account role cannot open /admin, so the
 * same page is mounted under /clinician). Engagement and clinical outcomes are separate panels and are never combined into a score. The page
 * says in plain words, at the top and always, that it is internal and that a difference between people who take part more and less is an
 * association, not proof. Everything shown has already passed the database's small-group rules; a held-back figure is said to be held back and is
 * never drawn as a zero. Reads go through read_outcomes_dashboard, which refuses everyone else and writes each read to the audit log.
 */
export async function OutcomesDashboardPage({ viewer, outcome }: { viewer: DashboardViewer; outcome?: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("read_outcomes_dashboard", { p_limit: 12 });
  const rows: DashboardRow[] | null = error ? null : parseDashboard(data);
  const latest = rows?.[0];
  const flash = outcome ? OUTCOME[outcome] : undefined;
  const base = DASHBOARD_PATHS[viewer];
  const today = new Date().toISOString().slice(0, 7);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <header className="space-y-1">
        <h1 className="font-heading text-xl font-semibold text-charcoal-ink">{tt("outcomes.dash.title")}</h1>
        <p className="text-sm text-charcoal-ink/70">{tt("outcomes.dash.intro")}</p>
      </header>

      <div role="note" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        <p className="font-semibold">{tt("outcomes.dash.internal")}</p>
        <p>{tt("outcomes.dash.caveat.selection")}</p>
        <p>{tt("outcomes.dash.caveat.trial")}</p>
        <p>{tt("outcomes.dash.caveat.association")}</p>
      </div>

      {flash && (
        <p role={flash.ok ? "status" : "alert"} className={`rounded-lg px-3 py-2 text-sm ${flash.ok ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}>
          {tt(flash.key)}
        </p>
      )}

      {!rows && <p role="alert" className="text-sm">{tt("outcomes.dash.load_error")}</p>}
      {rows && rows.length === 0 && <p className="text-sm">{tt("outcomes.dash.none")}</p>}

      {latest && (
        <>
          <p className="text-sm text-charcoal-ink/70">
            {latest.period_start.slice(0, 7)} · {tt("outcomes.dash.cut_at", { date: latest.data_cutoff })}
            {latest.is_baseline ? ` · ${tt("outcomes.dash.baseline")}` : ""}
          </p>
          {latest.held_back && <p className="rounded-lg bg-charcoal-ink/5 p-3 text-sm">{tt("outcomes.dash.held_back")}</p>}

          <EngagementPanel rows={rows ?? []} latest={latest} />
          <OutcomesPanel outcomes={latest.report.panels.outcomes} />
          <ComparisonPanel comparison={latest.report.panels.comparison} />
        </>
      )}

      {viewer === "admin" && (
        <p className="text-sm"><a className="underline" href={`${base}/founder`}>{tt("outcomes.dash.founder.link")}</a></p>
      )}

      <Card>
        <CardHeader><CardTitle>{tt("outcomes.dash.definitions.title")}</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>{tt("outcomes.dash.definitions.body")}</p>
          <p>{tt("outcomes.dash.caveat.bp_excluded")}</p>
          <p>{tt("outcomes.dash.caveat.measured")}</p>
          <p>{tt("outcomes.dash.outcomes.not_measured")}</p>
        </CardContent>
      </Card>

      <section className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{tt("outcomes.dash.run.title")}</CardTitle></CardHeader>
          <CardContent>
            <form action={runDashboardAction} className="space-y-2">
              <input type="hidden" name="viewer" value={viewer} />
              <label className="block text-sm">
                {tt("outcomes.dash.run.month")}
                <input name="month" type="month" required max={today} className={field} />
              </label>
              <button type="submit" className="min-h-11 rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white">{tt("outcomes.dash.run.submit")}</button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{tt("outcomes.dash.export.title")}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm">{tt("outcomes.dash.export.body")}</p>
            <form method="post" action={`${base}/export`}>
              <button type="submit" className="min-h-11 rounded-lg border border-charcoal-ink/30 px-4 py-2 text-sm font-semibold">{tt("outcomes.dash.export.submit")}</button>
            </form>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

