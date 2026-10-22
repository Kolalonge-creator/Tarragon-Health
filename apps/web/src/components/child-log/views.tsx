import { childTimelineLine, t } from "@tarragon/i18n";
import {
  crisisCallHref,
  layoutGrowthChart,
  markerPath,
  type ChecklistDose,
  type ChecklistStatus,
  type ChartPointInput,
  type GrowthBand,
  type GrowthBandResult,
  type TimelineItem,
} from "@tarragon/shared";

/**
 * Presentational pieces of the daily child log on the web (S68b). No data fetching in here, so each can be tested and axe-checked on its own.
 * Every status has a SHAPE or icon character and a WORD; colour is only a third cue.
 */

const BAND_KEY: Record<GrowthBand, Parameters<typeof t>[0]> = {
  growing_well: "cdl.growth.band_growing_well",
  keep_an_eye_on: "cdl.growth.band_keep_an_eye_on",
  talk_to_care_team: "cdl.growth.band_talk_to_care_team",
};
const HELP_KEY: Record<GrowthBand, Parameters<typeof t>[0]> = {
  growing_well: "cdl.growth.help_growing_well",
  keep_an_eye_on: "cdl.growth.help_keep_an_eye_on",
  talk_to_care_team: "cdl.growth.help_talk_to_care_team",
};
const BAND_FILL: Record<GrowthBand, string> = { growing_well: "#0E7C52", keep_an_eye_on: "#B45309", talk_to_care_team: "#B91C1C" };

const lagos = (iso: string): string =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Leads with "go to the nearest clinic now" and a call link. The number is the crisis card's, passed in; nothing is typed here. */
export function CrisisLead({ emergencyNumber }: { emergencyNumber: string }) {
  const href = crisisCallHref(emergencyNumber);
  return (
    <section aria-labelledby="cdl-crisis" className="rounded-2xl border-2 border-red-700 p-4">
      <h2 id="cdl-crisis" className="text-xl font-extrabold">{t("cdl.crisis.lead")}</h2>
      {href && (
        <a href={href} className="mt-3 inline-block rounded-xl bg-red-700 px-5 py-4 text-lg font-extrabold text-white">
          {t("crisis.call", "en", { number: emergencyNumber })}
        </a>
      )}
      <p className="mt-2 text-sm">{t("crisis.call_note")}</p>
      <p className="mt-1 text-sm">{t("cdl.crisis.then")}</p>
    </section>
  );
}

export interface OneTapAction {
  id: string;
  label: string;
  glyph: string;
}

export function OneTapButtons({ actions, disabled, status, onTap }: { actions: readonly OneTapAction[]; disabled: boolean; status: string | null; onTap: (id: string) => void }) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        {actions.map((a) => (
          <button
            key={a.id}
            type="button"
            disabled={disabled}
            onClick={() => onTap(a.id)}
            className="flex min-h-[84px] flex-col items-center justify-center gap-1 rounded-xl border-2 border-brand-green px-3 py-3 text-lg font-bold disabled:opacity-60"
          >
            <span aria-hidden="true" className="text-3xl">{a.glyph}</span>
            <span>{a.label}</span>
          </button>
        ))}
      </div>
      <p role="status" aria-live="polite" className="mt-2 min-h-[1.5rem] text-sm font-semibold">{status}</p>
    </div>
  );
}

export function TimelineList({ items }: { items: readonly TimelineItem[] }) {
  if (items.length === 0) return <p className="text-sm">{t("cdl.timeline.empty")}</p>;
  return (
    <ol className="divide-y divide-charcoal-ink/10">
      {items.map((item) => (
        <li key={item.id} className="py-2">
          <p className="flex items-center justify-between gap-2 text-[15px]">
            <span>{childTimelineLine(item)}</span>
            {item.pendingOnPhone && <span className="rounded-full border px-2 text-xs">{t("cdl.log.pending_badge")}</span>}
          </p>
          <p className="text-xs opacity-70">
            {lagos(item.at)}
            {item.loggedBy ? `  ${t("cdl.logged_by.by", "en", { name: item.loggedBy })}` : ""}
          </p>
          {item.reviewedAt && (
            <p className="text-xs opacity-70">
              {t("cdl.timeline.reviewed", "en", { date: new Date(item.reviewedAt).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short" }) })}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

export interface GrowthTableRow {
  id: string;
  measuredAt: string;
  weightKg: number | null;
  heightCm: number | null;
  result: GrowthBandResult;
}

function Chart({ points, label, axis }: { points: readonly ChartPointInput[]; label: string; axis: string }) {
  const layout = layoutGrowthChart(points, { width: 320, height: 200 });
  if (layout.markers.length === 0) return null;
  return (
    <figure>
      <figcaption className="text-xs opacity-70">{axis}</figcaption>
      <svg role="img" aria-label={label} viewBox="0 0 320 200" className="w-full max-w-md">
        {layout.yTicks.map((tick) => (
          <text key={`y${tick.at}`} x={2} y={tick.at + 4} fontSize={10} fill="currentColor">{tick.label}</text>
        ))}
        {layout.xTicks.map((tick) => (
          <text key={`x${tick.at}`} x={tick.at - 6} y={196} fontSize={10} fill="currentColor">{tick.label}</text>
        ))}
        {layout.polyline !== "" && <polyline points={layout.polyline} fill="none" stroke="currentColor" strokeOpacity={0.5} strokeWidth={1.5} />}
        {layout.markers.map((m) => (
          <path key={m.id} d={markerPath(m.shape, m.x, m.y, 6)} fill={m.band ? BAND_FILL[m.band] : "#FFFFFF"} stroke="currentColor" strokeWidth={1.5} />
        ))}
      </svg>
    </figure>
  );
}

/** Plain-language band for the latest measurement, the chart (kg, cm), the shape legend and the full table as the text alternative. */
export function GrowthBandsView({ rows, latest, weightPoints, heightPoints }: { rows: readonly GrowthTableRow[]; /** The headline: the latest row with the acute-nutrition class carried forward (latestBand). */ latest: GrowthBandResult | null; weightPoints: readonly ChartPointInput[]; heightPoints: readonly ChartPointInput[] }) {
  return (
    <div className="space-y-3">
      <p className="text-sm">{t("cdl.growth.intro")}</p>
      {rows.length === 0 && <p className="text-sm">{t("cdl.growth.empty")}</p>}
      {latest?.kind === "band" && (
        <div>
          <p className="text-lg font-extrabold">{t(BAND_KEY[latest.band])}</p>
          <p className="text-sm">{t(HELP_KEY[latest.band])}</p>
          {latest.recheck && <p className="text-sm">{t("mch.growth.check_measurement")}</p>}
        </div>
      )}
      {latest?.kind === "check_measurement" && <p className="text-sm">{t("mch.growth.check_measurement")}</p>}
      {latest?.kind === "no_reference" && <p className="text-sm">{t("mch.growth.reference_missing")}</p>}
      <Chart points={weightPoints} label={t("cdl.growth.chart_weight_label")} axis={t("cdl.growth.weight_axis")} />
      <Chart points={heightPoints} label={t("cdl.growth.chart_height_label")} axis={t("cdl.growth.height_axis")} />
      {rows.length > 0 && (
        <>
          <ul className="text-xs">
            <li>{t("cdl.growth.shape_circle")}</li>
            <li>{t("cdl.growth.shape_diamond")}</li>
            <li>{t("cdl.growth.shape_triangle")}</li>
          </ul>
          <table className="w-full text-sm">
            <caption className="text-left font-bold">{t("cdl.growth.table_caption")}</caption>
            <thead>
              <tr>
                <th scope="col" className="text-left">{t("cdl.growth.col_date")}</th>
                <th scope="col" className="text-left">{t("cdl.growth.col_weight")}</th>
                <th scope="col" className="text-left">{t("cdl.growth.col_height")}</th>
                <th scope="col" className="text-left">{t("cdl.growth.col_band")}</th>
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.measuredAt).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "2-digit" })}</td>
                  <td>{r.weightKg ?? ""}</td>
                  <td>{r.heightCm ?? ""}</td>
                  <td>{r.result.kind === "band" ? t(BAND_KEY[r.result.band]) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

const STATUS: Record<ChecklistStatus, { key: Parameters<typeof t>[0]; glyph: string }> = {
  done: { key: "cdl.vax.status_done", glyph: "✓" },
  due: { key: "cdl.vax.status_due", glyph: "●" },
  overdue: { key: "cdl.vax.status_overdue", glyph: "▲" },
  upcoming: { key: "cdl.vax.status_upcoming", glyph: "○" },
};
const TRUST_KEY = { verified: "cdl.vax.trust_verified", waiting: "cdl.vax.trust_waiting", self_reported: "cdl.vax.trust_self_reported", rejected: "cdl.vax.trust_self_reported" } as const;
const day = (iso: string): string => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });

export function VaccineChecklistView({ doses, counts }: { doses: readonly ChecklistDose[]; counts: { done: number; due: number; overdue: number } }) {
  if (doses.length === 0) return <p className="text-sm">{t("cdl.vax.empty")}</p>;
  return (
    <div className="space-y-2">
      <p className="text-sm">{t("cdl.vax.intro")}</p>
      <p className="font-bold">{t("cdl.vax.counts", "en", counts)}</p>
      <ul className="divide-y divide-charcoal-ink/10">
        {doses.map((d) => {
          const s = STATUS[d.status];
          return (
            <li key={`${d.code}-${d.doseNumber}`} className="flex gap-3 py-2">
              <span aria-hidden="true" className="w-6 text-center text-xl">{s.glyph}</span>
              <div>
                <p className="font-bold">{d.name}, {t("cdl.vax.dose", "en", { dose: d.doseNumber })}</p>
                <p className="text-sm">{t(s.key)}  {d.doneOn ? t("cdl.vax.given_on", "en", { date: day(d.doneOn) }) : t("cdl.vax.due_on", "en", { date: day(d.dueDate) })}</p>
                {d.trust && <p className="text-xs opacity-70">{t(TRUST_KEY[d.trust])}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
