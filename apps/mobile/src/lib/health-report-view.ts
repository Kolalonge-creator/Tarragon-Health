import { t, type MessageKey } from "@tarragon/i18n";
import { isReportAudioExcludedCode } from "@tarragon/audio";

/**
 * The yearly Tarragon Health Report on the phone (S46d): read only, and only ever a report a named clinician has SIGNED.
 *
 * This file is the pure half: what counts as a signed report, how a stored copy is trusted, and the plain view model. Nothing here reads the network or the
 * phone's storage (those are injected in health-report.ts), so every rule below is covered by a unit test.
 *
 * Rules, each pinned by a test:
 *  - nothing is shown or kept before `signed_at` exists, with a status of 'signed' and a named signer; a draft row (which the database would not return
 *    anyway) is dropped here as well, so a bad server answer can never put an unsigned report on a phone;
 *  - a saved copy is trusted only if it passes the same check again, so a damaged or tampered copy shows nothing;
 *  - HIV, hepatitis and other blood-borne test codes are dropped from items, trends and screening whatever the snapshot holds (INV-04);
 *  - states are words plus a symbol, never colour alone; the fixed statement, the emergency signs and the "some results are only shared in a conversation"
 *    note are always present.
 */

export interface ComposedItem {
  id: string;
  kind: "bp" | "lab" | "screening";
  code: string;
  state: "on_target" | "needs_attention" | "not_checked" | "not_measured" | "no_target";
  value: number | null;
  value2: number | null;
  unit: string | null;
  retestWeeks?: number | null;
}

export interface ComposedPriority {
  id: string;
  action: string;
  why: string;
  whoHelps: string;
  when: string;
  params?: Record<string, string | number>;
}

export interface ComposedSnapshot {
  items: ComposedItem[];
  priorities: ComposedPriority[];
  trends?: { code: string; points: { at: string; value: number; unit: string | null }[] }[];
  midYearRetestMonths?: number | null;
  statementKey: string;
}

export interface SignedReportRow {
  id: string;
  year: number;
  version: number;
  status: string;
  summary_text: string;
  signer_name: string;
  signer_registration: string;
  signed_at: string;
  correction_note: string | null;
  composed: ComposedSnapshot;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

/**
 * A row becomes a SignedReportRow only if a clinician signed it: status 'signed', a signature time that parses, a named signer with a registration number and
 * the paragraph they signed. Anything else is null and is neither shown nor saved.
 */
export function asSignedReport(raw: unknown): SignedReportRow | null {
  if (!isObj(raw)) return null;
  if (raw.status !== "signed") return null;
  if (!nonEmpty(raw.signed_at) || Number.isNaN(new Date(raw.signed_at).getTime())) return null;
  if (!nonEmpty(raw.signer_name) || !nonEmpty(raw.signer_registration) || !nonEmpty(raw.summary_text)) return null;
  if (!nonEmpty(raw.id) || typeof raw.year !== "number" || typeof raw.version !== "number") return null;
  const c = raw.composed;
  if (!isObj(c) || !Array.isArray(c.items) || !Array.isArray(c.priorities) || !nonEmpty(c.statementKey)) return null;
  return {
    id: raw.id,
    year: raw.year,
    version: raw.version,
    status: "signed",
    summary_text: raw.summary_text,
    signer_name: raw.signer_name,
    signer_registration: raw.signer_registration,
    signed_at: raw.signed_at,
    correction_note: typeof raw.correction_note === "string" ? raw.correction_note : null,
    composed: c as unknown as ComposedSnapshot,
  };
}

/** Newest first: year, then version. */
export function signedReports(rows: unknown): SignedReportRow[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map(asSignedReport)
    .filter((r): r is SignedReportRow => r !== null)
    .sort((a, b) => b.year - a.year || b.version - a.version);
}

const SYMBOL = { on_target: "[ok]", needs_attention: "[!]", not_checked: "[?]", not_measured: "[-]", no_target: "[.]" } as const;
const STATE_KEY: Record<ComposedItem["state"], MessageKey> = {
  on_target: "report.state.on_target",
  needs_attention: "report.state.needs_attention",
  not_checked: "report.state.not_checked",
  not_measured: "report.state.not_measured",
  no_target: "report.state.no_target",
};

export interface MobileReportView {
  title: string;
  yearLine: string;
  signedLine: string;
  correctionLine: string | null;
  summary: string;
  priorities: { n: number; action: string; why: string; who: string; when: string }[];
  items: { label: string; value: string; symbol: string; stateWord: string; retest: string | null }[];
  trends: { label: string; line: string }[];
  midYear: string | null;
  statement: string;
  emergency: string;
  heldNote: string;
}

const pretty = (code: string) => code.replace(/^lab:/, "").replace(/_/g, " ");
const fmt = (n: number | null) => (n === null ? "" : String(Math.round(n * 10) / 10));
const day = (iso: string) => new Date(iso).toISOString().slice(0, 10);

export function buildMobileReportView(r: SignedReportRow): MobileReportView {
  const c = r.composed;
  return {
    title: t("report.title", "en"),
    yearLine: t("report.year", "en", { year: r.year }),
    signedLine: t("report.signed_by", "en", { name: r.signer_name, registration: r.signer_registration, date: day(r.signed_at) }),
    correctionLine: r.correction_note ? t("report.correction", "en", { note: r.correction_note }) : null,
    summary: r.summary_text,
    priorities: c.priorities.filter((p) => !isReportAudioExcludedCode(p.id.replace(/^(lab|screening):/, ""))).slice(0, 3).map((p, i) => ({
      n: i + 1,
      action: t(p.action as MessageKey, "en", p.params),
      why: t(p.why as MessageKey, "en", p.params),
      who: t(p.whoHelps as MessageKey, "en"),
      when: p.when,
    })),
    items: c.items
      .filter((i) => i.kind !== "screening" && !isReportAudioExcludedCode(i.code))
      .map((i) => ({
        label: i.kind === "bp" ? t("report.section.bp", "en") : pretty(i.code),
        value: i.kind === "bp" ? (i.value !== null ? `${fmt(i.value)}/${fmt(i.value2)} mmHg` : "") : i.value !== null ? `${fmt(i.value)} ${i.unit ?? ""}`.trim() : "",
        symbol: SYMBOL[i.state],
        stateWord: t(STATE_KEY[i.state], "en"),
        retest: i.retestWeeks ? t("report.retest.item", "en", { weeks: i.retestWeeks }) : null,
      })),
    trends: (c.trends ?? [])
      .filter((tr) => !isReportAudioExcludedCode(tr.code) && tr.points.length >= 2)
      .map((tr) => ({ label: pretty(tr.code), line: tr.points.map((p) => `${day(p.at).slice(0, 7)} ${fmt(p.value)}`).join(", ") })),
    midYear: c.midYearRetestMonths && c.items.some((i) => i.state === "needs_attention" && !isReportAudioExcludedCode(i.code)) ? t("report.retest.midyear", "en", { months: c.midYearRetestMonths }) : null,
    statement: t(c.statementKey as MessageKey, "en"),
    emergency: t("report.emergency.signs", "en"),
    heldNote: t("report.held_note", "en"),
  };
}
