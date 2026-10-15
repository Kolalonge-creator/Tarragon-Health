import { t } from "@tarragon/i18n";
import type { UiLanguage } from "@tarragon/shared";
import type { BoardReport } from "@/lib/concerns/model";
import { Alert } from "./concern-card";

type Loaded = { ok: true; data: BoardReport } | { ok: false; denied: boolean };

/**
 * The aggregate-only board report: counts by state and age, and what is overdue. Nothing in it is text from a concern, a category, a name or an id.
 * A failed read says so; it is never shown as zero.
 */
export function BoardReportCard({ report, locale }: { report: Loaded; locale: UiLanguage }) {
  if (!report.ok) return <Alert>{t("speakup.load_error", locale)}</Alert>;
  const r = report.data;
  const cell = (label: string, n: number) => (
    <div className="rounded-lg bg-charcoal-ink/5 px-3 py-2 text-center">
      <p className="text-xl font-semibold text-charcoal-ink" data-testid={`board-${label}`}>{n}</p>
      <p className="text-xs text-charcoal-ink/70">{label}</p>
    </div>
  );
  return (
    <section aria-labelledby="board" className="space-y-3">
      <div>
        <h2 id="board" className="font-heading text-xl font-semibold text-charcoal-ink">{t("speakup.board.title", locale)}</h2>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">{t("speakup.board.intro", locale)}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {cell(t("speakup.board.total", locale), r.total)}
        {cell(t("speakup.state.new", locale), r.by_state.new)}
        {cell(t("speakup.state.acknowledged", locale), r.by_state.acknowledged)}
        {cell(t("speakup.state.responded", locale), r.by_state.responded)}
        {cell(t("speakup.state.closed", locale), r.by_state.closed)}
      </div>
      <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">{t("speakup.board.open_by_age", locale)}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {cell(t("speakup.board.age.up_to_7", locale), r.open_by_age_days.up_to_7)}
        {cell(t("speakup.board.age.from_8_to_14", locale), r.open_by_age_days.from_8_to_14)}
        {cell(t("speakup.board.age.from_15_to_30", locale), r.open_by_age_days.from_15_to_30)}
        {cell(t("speakup.board.age.from_31_to_90", locale), r.open_by_age_days.from_31_to_90)}
        {cell(t("speakup.board.age.over_90", locale), r.open_by_age_days.over_90)}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {cell(t("speakup.board.ack_overdue", locale), r.acknowledge_overdue)}
        {cell(t("speakup.board.resp_overdue", locale), r.response_overdue)}
        {cell(t("speakup.board.retaliation_open", locale), r.open_retaliation_reviews)}
      </div>
    </section>
  );
}
