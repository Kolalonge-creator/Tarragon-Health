import { bandActionText } from "@/lib/cv-risk/band-actions";
import { t, type MessageKey } from "@tarragon/i18n";
import { shareableView, type ComposedReport, type HealthReportConfig, type ReportItem, type ReportPriority, type ReportState } from "@tarragon/clinical";

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

export type Block =
  | { kind: "p"; text: string }
  | { kind: "item"; label: string; value: string; state: ReportState; stateWord: string; symbol: string; notes: string[] }
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

function itemBlock(i: ReportItem, c: ComposedReport): Block {
  const notes: string[] = [];
  let value = "";
  if (i.kind === "bp") {
    if (i.state === "not_measured") {
      notes.push(i.tooFewReadings ? t("report.bp.too_few", "en", { min: c.minBpReadings, minDays: c.minBpDays, count: i.readingCount, days: i.readingDays ?? 0 }) : t("report.bp.none", "en"));
    } else {
      value = `${fmt(i.value)}/${fmt(i.value2)} mmHg`;
      notes.push(t("report.bp.readings", "en", { count: i.readingCount, days: i.readingDays ?? 0, from: day(i.dateFrom), to: day(i.dateTo) }));
      if (i.target?.high && i.target.high2) notes.push(t(i.target.source === "higher_risk" ? "report.bp.target_higher_risk" : "report.bp.target", "en", { sys: i.target.high, dia: i.target.high2 }));
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
  return { kind: "item", label: i.kind === "bp" ? t("report.section.bp", "en") : pretty(i.code), value, state: i.state, stateWord: t(STATE_KEY[i.state], "en"), symbol: SYMBOL[i.state], notes };
}

/** What a caregiver's grant did not cover (S46c): the section ids to leave out, and whether the doctor's free-text summary is withheld with them. */
export interface CaregiverView {
  readonly withheld: readonly string[];
  readonly summaryWithheld: boolean;
}

export function buildRenderModel(
  row: ReportRow,
  config: HealthReportConfig,
  variant: "self" | "shared" = "self",
  include: readonly string[] = [],
  caregiver?: CaregiverView,
): RenderModel {
  const c = variant === "shared" ? shareableView(row.composed, config, include) : row.composed;
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
  if (bp) sections.push({ id: "bp", heading: t("report.section.bp", "en"), blocks: [itemBlock(bp, c)] });

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
      blocks: c.trends.flatMap((tr): Block[] => [
        { kind: "line", text: `${pretty(tr.code)}: ${tr.points.map((pt) => `${day(pt.at).slice(0, 7)} ${fmt(pt.value)}`).join(", ")}${tr.points[0]?.unit ? ` ${tr.points[0].unit}` : ""}` },
        ...(tr.unitMixed ? [p(t("report.trend.unit_mixed", "en"))] : []),
      ]),
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
