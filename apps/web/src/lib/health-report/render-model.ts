import { bandActionText } from "@/lib/cv-risk/band-actions";
import { t, type MessageKey } from "@tarragon/i18n";
import { shareableView, type ComposedReport, type HealthReportConfig, type ReportItem, type ReportPriority, type ReportState } from "@tarragon/clinical";
import { isSensitiveResultCode } from "@/lib/lab-results/guidance";
import { chartGeometry, displayCode, groupByUnit, labRangeLabel, positionInLabRange, type TrendPoint } from "@/lib/biomarkers/trend";

/**
 * One plain, text-first model of a signed report that both the web page and the A4 black-and-white PDF render (S46, principles 3, 10, 11, 12).
 * Every state is a word plus a symbol (never colour alone). Nothing here reads the database: it takes the signed row's frozen `composed` snapshot, so a
 * later change to the underlying data can never alter what the clinician signed.
 */

export interface ReportRow {
  readonly year: number;
  readonly version: number;
  readonly composed: ComposedReport & { templateSummary?: string };
  readonly summary_text: string;
  readonly signer_name: string;
  readonly signer_registration: string;
  readonly signed_at: string;
  readonly correction_note: string | null;
}

/** Pure geometry for one small line chart (S43 chartGeometry, reused). The band is the laboratory's own range, drawn only when every point shares one. */
export interface ChartGeo {
  readonly width: number;
  readonly height: number;
  readonly path: string;
  readonly dots: readonly { x: number; y: number }[];
  readonly band: { y: number; height: number } | null;
}

/** A position bar (percent along a 0 to 100 track): the shaded span is the range or target, the marker is the person's value. Always paired with a sentence. */
export interface GaugeGeo {
  readonly bandFrom: number;
  readonly bandTo: number;
  readonly marker: number;
  readonly caption: string;
}

export type Block =
  | { kind: "p"; text: string }
  | { kind: "item"; label: string; value: string; state: ReportState; stateWord: string; symbol: string; notes: string[]; gauge?: GaugeGeo }
  | { kind: "chart"; title: string; alt: string; geo: ChartGeo; caption: string; notes: string[] }
  | { kind: "priority"; n: number; action: string; why: string; who: string; when: string }
  | { kind: "line"; text: string };

export interface RenderSection {
  readonly id: string;
  readonly heading: string;
  readonly blocks: readonly Block[];
}

export interface RenderModel {
  readonly title: string;
  readonly yearLine: string;
  readonly signedLine: string;
  readonly versionLine: string;
  readonly correctionLine: string | null;
  readonly variant: "self" | "shared";
  readonly sections: readonly RenderSection[];
}

const SYMBOL: Record<ReportState, string> = { on_target: "[ok]", needs_attention: "[!]", not_checked: "[?]", not_measured: "[-]", no_target: "[.]" };
const STATE_KEY: Record<ReportState, MessageKey> = {
  on_target: "report.state.on_target",
  needs_attention: "report.state.needs_attention",
  not_checked: "report.state.not_checked",
  not_measured: "report.state.not_measured",
  no_target: "report.state.no_target",
};
const CHANGE_KEY = {
  improved: "report.change.improved",
  same: "report.change.same",
  worse: "report.change.worse",
  no_comparison: "report.change.no_comparison",
} as const satisfies Record<string, MessageKey>;
const TIER_KEY: Record<string, MessageKey> = {
  low: "report.risk.tier.low",
  low_moderate: "report.risk.tier.low_moderate",
  moderate: "report.risk.tier.moderate",
  high: "report.risk.tier.high",
  very_high: "report.risk.tier.very_high",
};

/**
 * Mirror of public.report_excluded_code (the database list): a code that is, or merely looks like, a blood-borne or sexual-health test never appears in
 * any report text, chart, recheck line, shared copy or audio hook (INV-04). The database already keeps these out of the collected facts; this is the
 * second lock on the rendering side. A test pins the two lists together.
 */
export const REPORT_EXCLUDED_CODE_PATTERN = /(^|[^a-z])(hiv|hbsag|hbs_ag|hcv|hbv|hep_b|hep_c|hepatitis|syphilis|chlamydia|gonorrh|anti_hbs)/;
export function isReportExcludedCode(code: string): boolean {
  return isSensitiveResultCode(code) || REPORT_EXCLUDED_CODE_PATTERN.test(code.toLowerCase());
}

/** A priority's id is "bp", "risk", "lab:<code>" or "screening:<code>"; the code part is what the exclusion list is checked against. */
const priorityCode = (p: ReportPriority) => p.id.replace(/^(lab|screening):/, "");

const pretty = (code: string) => code.replace(/^lab:/, "").replace(/_/g, " ");
const day = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : "");
const fmt = (n: number | null) => (n === null ? "" : String(Math.round(n * 10) / 10));

function priorityBlock(p: ReportPriority, n: number): Block {
  return {
    kind: "priority",
    n,
    action: t(p.action as MessageKey, "en", p.params),
    why: t(p.why as MessageKey, "en", p.params),
    who: t(p.whoHelps as MessageKey, "en"),
    when: p.when,
  };
}

const POSITION_KEY = {
  within: "report.chart.position.within",
  above: "report.chart.position.above",
  below: "report.chart.position.below",
  unknown: "report.chart.position.unknown",
} as const satisfies Record<string, MessageKey>;

function labGauge(i: ReportItem): GaugeGeo | undefined {
  if (i.kind !== "lab" || i.value === null || !i.target || (i.target.low === null && i.target.high === null)) return undefined;
  const v = i.value;
  const { low, high } = i.target;
  const lo = Math.min(v, low ?? v, high ?? v);
  const hi = Math.max(v, low ?? v, high ?? v);
  const pad = (hi - lo || Math.abs(v) || 1) * 0.25;
  const dmin = lo - pad;
  const dmax = hi + pad;
  const pct = (x: number) => Math.max(0, Math.min(100, ((x - dmin) / (dmax - dmin)) * 100));
  const position = positionInLabRange({ value: v, refLow: low, refHigh: high });
  return { bandFrom: pct(low ?? dmin), bandTo: pct(high ?? dmax), marker: pct(v), caption: t("report.gauge.lab", "en", { position: t(POSITION_KEY[position], "en") }) };
}

function bpGauge(i: ReportItem): GaugeGeo | undefined {
  if (i.kind !== "bp" || i.value === null || !i.target?.high) return undefined;
  const v = i.value;
  const high = i.target.high;
  const dmin = Math.min(v, high) * 0.7;
  const dmax = Math.max(v, high) * 1.15;
  const pct = (x: number) => Math.max(0, Math.min(100, ((x - dmin) / (dmax - dmin)) * 100));
  const position = v < high ? "report.gauge.position.target_within" : "report.gauge.position.target_above";
  return { bandFrom: 0, bandTo: pct(high), marker: pct(v), caption: t("report.gauge.bp", "en", { sys: high, position: t(position, "en") }) };
}

/** One small chart per unit group with at least two results. Values come only from the signed snapshot; units are never converted or joined. */
function trendCharts(c: ComposedReport): Block[] {
  const out: Block[] = [];
  for (const tr of c.trends) {
    if (isReportExcludedCode(tr.code)) continue;
    const pts: TrendPoint[] = tr.points.map((p) => ({ takenAt: p.at, value: p.value, unit: p.unit, refLow: p.refLow, refHigh: p.refHigh, refText: null, flag: null, source: "lab_result", laboratory: null }));
    for (const g of groupByUnit(pts)) {
      if (g.points.length < 2) continue;
      const geo = chartGeometry(g.points, null, 320, 110);
      if (!geo) continue;
      const first = g.points[0] as TrendPoint;
      const last = g.points[g.points.length - 1] as TrendPoint;
      const name = displayCode(tr.code);
      const caption = t("report.chart.caption", "en", {
        name,
        count: g.points.length,
        from: day(first.takenAt).slice(0, 4),
        to: day(last.takenAt).slice(0, 4),
        value: fmt(last.value),
        unit: g.unit ?? "",
        position: t(POSITION_KEY[positionInLabRange(last)], "en"),
      });
      const range = geo.band ? labRangeLabel(first) : null;
      out.push({
        kind: "chart",
        title: name,
        alt: t("report.chart.alt", "en", { name }),
        geo: {
          width: geo.width,
          height: geo.height,
          path: geo.path,
          dots: geo.dots.map((d) => ({ x: d.x, y: d.y })),
          band: geo.band ? { y: Math.min(geo.band.y1, geo.band.y2), height: Math.abs(geo.band.y2 - geo.band.y1) } : null,
        },
        caption,
        notes: [range ? t("report.chart.range", "en", { range }) : t("report.chart.no_band", "en")],
      });
    }
  }
  return out;
}

/** `reveal` is false for a shared copy and for a caregiver: they see the target NUMBER, never the reason it is lower (that would tell them the person is in a higher-risk group). */
function itemBlock(i: ReportItem, c: ComposedReport, reveal = true): Block {
  const notes: string[] = [];
  let value = "";
  if (i.kind === "bp") {
    if (i.state === "not_measured") {
      notes.push(i.tooFewReadings ? t("report.bp.too_few", "en", { min: c.minBpReadings, minDays: c.minBpDays, count: i.readingCount, days: i.readingDays ?? 0 }) : t("report.bp.none", "en"));
    } else {
      value = `${fmt(i.value)}/${fmt(i.value2)} mmHg`;
      notes.push(t("report.bp.readings", "en", { count: i.readingCount, days: i.readingDays ?? 0, from: day(i.dateFrom), to: day(i.dateTo) }));
      if (i.target?.high && i.target.high2) notes.push(t(reveal && i.target.source === "higher_risk" ? "report.bp.target_higher_risk" : "report.bp.target", "en", { sys: i.target.high, dia: i.target.high2 }));
    }
  } else if (i.kind === "lab") {
    value = `${fmt(i.value)} ${i.unit ?? ""}`.trim();
    if (i.target) notes.push(t("report.lab.range", "en", { range: `${i.target.low ?? ""} to ${i.target.high ?? ""}`.replace(/^ to /, "up to ").replace(/ to $/, " and above") }));
  } else {
    notes.push(t("report.screening.due", "en", { code: pretty(i.code), date: day(i.dateTo) }));
  }
  if (i.borderline && i.recheckWeeks) notes.push(t("report.borderline", "en", { weeks: i.recheckWeeks }));
  if (i.change !== "no_comparison") {
    notes.push(t(CHANGE_KEY[i.change], "en"));
    if (i.previousValue !== null && i.kind === "lab") notes.push(t("report.lab.last_year", "en", { value: fmt(i.previousValue), unit: i.unit ?? "" }));
  }
  if (i.retestWeeks) notes.push(t("report.retest.item", "en", { weeks: i.retestWeeks }));
  const gauge = labGauge(i) ?? bpGauge(i);
  return { kind: "item", label: i.kind === "bp" ? t("report.section.bp", "en") : pretty(i.code), value, state: i.state, stateWord: t(STATE_KEY[i.state], "en"), symbol: SYMBOL[i.state], notes, ...(gauge ? { gauge } : {}) };
}

/** What a caregiver's grant did not cover (S46c): the section ids to leave out, and whether the doctor's free-text summary is withheld with them. */
export interface CaregiverView {
  readonly withheld: readonly string[];
  readonly summaryWithheld: boolean;
}

export function buildRenderModel(
  row: ReportRow,
  config: Pick<HealthReportConfig, "shareExcludedSections">,
  variant: "self" | "shared" = "self",
  include: readonly string[] = [],
  caregiver?: CaregiverView,
): RenderModel {
  const shaped = variant === "shared" ? shareableView(row.composed, config, include) : row.composed;
  // second lock (INV-04): nothing that is, or looks like, a blood-borne or sexual-health test is ever drawn, whatever the stored snapshot holds
  const c: ComposedReport = {
    ...shaped,
    items: shaped.items.filter((x) => !isReportExcludedCode(x.code)),
    trends: shaped.trends.filter((x) => !isReportExcludedCode(x.code)),
    priorities: shaped.priorities.filter((x) => !isReportExcludedCode(priorityCode(x))),
    alsoWorthKnowing: shaped.alsoWorthKnowing.filter((x) => !isReportExcludedCode(priorityCode(x))),
    screening: { done: shaped.screening.done.filter((x) => !isReportExcludedCode(x.code)), due: shaped.screening.due.filter((x) => !isReportExcludedCode(x.code)) },
  };
  const sections: RenderSection[] = [];
  const p = (text: string): Block => ({ kind: "p", text });

  sections.push({
    id: "summary",
    heading: t("report.section.summary", "en"),
    blocks: [p(caregiver?.summaryWithheld ? t("report.caregiver.summary_withheld", "en") : row.summary_text)],
  });

  sections.push({
    id: "priorities",
    heading: t("report.section.priorities", "en"),
    blocks: c.priorities.length > 0 ? c.priorities.map((x, n) => priorityBlock(x, n + 1)) : [p(t("report.priorities.none", "en"))],
  });

  if (c.risk.state === "assessed") {
    const basedOn = Object.keys(c.risk.basedOn ?? {}).map((k) => k.replace(/_/g, " ")).join(", ");
    sections.push({
      id: "risk",
      heading: t("report.section.risk", "en"),
      blocks: [p(t("report.risk.assessed", "en", { band: t(TIER_KEY[c.risk.tier] ?? "report.risk.tier.moderate", "en") })), ...(bandActionText(c.risk.bandCode) ? [p(bandActionText(c.risk.bandCode) as string)] : []), ...(basedOn ? [p(t("report.risk.based_on", "en", { items: basedOn }))] : [])],
    });
  } else if (variant === "self") {
    sections.push({ id: "risk", heading: t("report.section.risk", "en"), blocks: [p(t("report.risk.not_assessed", "en"))] });
  }

  const bp = c.items.find((i) => i.kind === "bp");
  if (bp) sections.push({ id: "bp", heading: t("report.section.bp", "en"), blocks: [itemBlock(bp, c, variant === "self" && !caregiver)] });

  const labs = c.items.filter((i) => i.kind === "lab");
  if (labs.length > 0) sections.push({ id: "labs", heading: t("report.section.labs", "en"), blocks: labs.map((i) => itemBlock(i, c)) });

  const changed = c.items.filter((i) => i.change !== "no_comparison");
  sections.push({
    id: "changes",
    heading: t("report.section.changes", "en"),
    blocks: changed.length > 0 ? changed.map((i): Block => ({ kind: "line", text: `${i.kind === "bp" ? t("report.section.bp", "en") : pretty(i.code)}: ${t(CHANGE_KEY[i.change], "en")}` })) : [p(t("report.change.no_comparison", "en"))],
  });

  const on = c.items.filter((i) => i.state === "on_target");
  if (on.length > 0) sections.push({ id: "on_target", heading: t("report.section.on_target", "en"), blocks: on.map((i): Block => ({ kind: "line", text: `${SYMBOL.on_target} ${i.kind === "bp" ? t("report.section.bp", "en") : pretty(i.code)}` })) });

  const sc = c.screening;
  const scBlocks: Block[] = [
    ...sc.done.map((d): Block => ({ kind: "line", text: t("report.screening.done", "en", { code: pretty(d.code), date: day(d.on) }) })),
    ...sc.due.map((d): Block => ({ kind: "line", text: t("report.screening.due", "en", { code: pretty(d.code), date: day(d.dueOn) }) })),
  ];
  sections.push({ id: "screening", heading: t("report.section.screening", "en"), blocks: scBlocks.length > 0 ? scBlocks : [p(t("report.screening.none", "en"))] });

  if (c.trends.length > 0) {
    sections.push({
      id: "trends",
      heading: t("report.section.trends", "en"),
      blocks: [
        ...trendCharts(c),
        ...c.trends.flatMap((tr): Block[] => [
          { kind: "line", text: `${pretty(tr.code)}: ${tr.points.map((pt) => `${day(pt.at).slice(0, 7)} ${fmt(pt.value)}`).join(", ")}${tr.points[0]?.unit ? ` ${tr.points[0].unit}` : ""}` },
          ...(tr.unitMixed ? [p(t("report.trend.unit_mixed", "en"))] : []),
        ]),
      ],
    });
  }

  // S46d: suggested rechecks. Only a value that was off has one; the weeks come from the settings the report was composed with.
  const rechecks = c.items.filter((i) => (i.retestWeeks ?? 0) > 0);
  // the mid-year line stands only while an item that is shown in THIS copy needs attention, so a shared or caregiver copy cannot reveal a withheld one
  const midYear = c.items.some((i) => i.state === "needs_attention") ? c.midYearRetestMonths : null;
  if (rechecks.length > 0 || midYear) {
    sections.push({
      id: "retest",
      heading: t("report.section.retest", "en"),
      blocks: [
        ...rechecks.map((i): Block => ({ kind: "line", text: t("report.retest.line", "en", { name: i.kind === "bp" ? t("report.section.bp", "en") : pretty(i.code), weeks: i.retestWeeks ?? 0 }) })),
        ...(midYear ? [p(t("report.retest.midyear", "en", { months: midYear }))] : []),
        p(t("report.retest.note", "en")),
      ],
    });
  }

  sections.push({ id: "devices", heading: t("report.section.devices", "en"), blocks: [p(t("report.devices.line", "en", { manual: c.devices.manual, device: c.devices.device, wearable: c.devices.wearable }))] });

  if (c.alsoWorthKnowing.length > 0) sections.push({ id: "also", heading: t("report.section.also", "en"), blocks: c.alsoWorthKnowing.map((x, n) => priorityBlock(x, n + 1)) });

  sections.push({ id: "cannot_tell", heading: t("report.section.cannot_tell", "en"), blocks: [p(t(c.statementKey as MessageKey, "en")), p(t("report.held_note", "en"))] });
  sections.push({ id: "emergency", heading: t("report.section.emergency", "en"), blocks: [p(t("report.emergency.signs", "en"))] });
  sections.push({ id: "share", heading: t("report.section.share", "en"), blocks: [p(t("report.share.help", "en"))] });

  return {
    title: t("report.title", "en"),
    yearLine: t("report.year", "en", { year: row.year }),
    signedLine: t("report.signed_by", "en", { name: row.signer_name, registration: row.signer_registration, date: day(row.signed_at) }),
    versionLine: t("report.version", "en", { version: row.version }),
    correctionLine: row.correction_note ? t("report.correction", "en", { note: row.correction_note }) : null,
    variant,
    sections: caregiver ? [...sections.filter((x) => !caregiver.withheld.includes(x.id)), ...(caregiver.withheld.length > 0 || caregiver.summaryWithheld ? [{ id: "withheld_note", heading: t("report.caregiver.some_withheld", "en"), blocks: [p(t("report.caregiver.intro", "en"))] }] : [])] : sections,
  };
}

/** What `record_share_by_token` returns under `health_report` (built and filtered in the database from the latest SIGNED report only). */
export interface SharedReportBody {
  readonly year: number;
  readonly version: number;
  readonly signed_at: string;
  readonly signer_name: string;
  readonly signer_registration: string;
  readonly composed: ComposedReport;
}

const SHARED_EXCLUDED = ["screening_reproductive", "risk", "questionnaires"] as const;

/**
 * The shared-link view of a signed report. The database already removed the heart risk band, questionnaires, reproductive screening, the doctor's free
 * text and every count that could show a withheld item; the same exclusions are applied again here (idempotent) and the summary sentence is recomputed
 * from the items that remain, so it cannot reveal anything that was left out.
 */
export function buildSharedReportModel(body: SharedReportBody): RenderModel {
  const items = body.composed.items.filter((x) => !isReportExcludedCode(x.code));
  const onTarget = items.filter((i) => i.state === "on_target").length;
  const needs = items.filter((i) => i.state === "needs_attention").length;
  const notMeasured = items.filter((i) => i.state === "not_measured" || i.state === "not_checked").length;
  const sentence = onTarget + needs === 0 ? t("report.summary.nothing_measured", "en", { notMeasured }) : t("report.summary.default", "en", { onTarget, needsAttention: needs, notMeasured });
  return buildRenderModel(
    {
      year: body.year,
      version: body.version,
      composed: body.composed,
      summary_text: `${t("report.share.link_summary", "en")} ${sentence}`,
      signer_name: body.signer_name,
      signer_registration: body.signer_registration,
      signed_at: body.signed_at,
      correction_note: null,
    },
    { shareExcludedSections: [...SHARED_EXCLUDED] },
    "shared",
  );
}
