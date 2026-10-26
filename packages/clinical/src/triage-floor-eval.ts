/**
 * Clinician-style emergency test set for the assistant triage floor (INV-01).
 *
 * Why this exists: a 2026 study of a consumer health chatbot found it under-triaged more than half of true emergencies (for example
 * diabetic ketoacidosis and impending respiratory failure) while its own explanation showed it recognised the danger, and over-triaged
 * most non-urgent cases. Both directions are failures, so this set measures both:
 *
 *   - EMERGENCY vignettes must be caught by the deterministic screen (`screenAssistantMessage`, the shared source) with no model call.
 *     The under-triage rate is the share missed. The accepted target is zero.
 *   - NON-URGENT vignettes must not trip it. The over-triage rate is the share that did. Over-triggering is the accepted failure
 *     (CLAUDE.md), so this rate has a PROPOSED ceiling held in versioned configuration (`assistant.triage_floor_eval`), never here.
 *
 * Every vignette is written by an engineer and carries `clinician_signed: false`. Nothing in this file can set it to true: a clinician
 * signs the set outside the code, and until then a passing run is evidence about the wording only, never a clinical approval.
 *
 * Pure and deterministic. No model, no network, no database.
 */
import { screenAssistantMessage, type AssistantDangerScreen } from "./assistant-danger-screen";

export type VignetteKind = "emergency" | "non_urgent";

export interface Vignette {
  readonly id: string;
  readonly kind: VignetteKind;
  readonly category: string;
  readonly text: string;
  /** Always false in a set an agent or engineer wrote. Only a clinician's own review may change it, and never in this repository by script. */
  readonly clinician_signed: boolean;
}

export interface VignetteSet {
  readonly format: "tarragon.triage_floor_vignettes";
  readonly format_version: 1;
  readonly set_version: number;
  readonly status: string;
  readonly clinician_review: { readonly required: boolean; readonly reviewed_by: string | null; readonly reviewed_at: string | null };
  readonly languages: string;
  readonly vignettes: readonly Vignette[];
}

export interface TriageFloorLimits {
  readonly max_under_triage_rate: number;
  readonly max_over_triage_rate: number;
  readonly min_emergency_vignettes: number;
  readonly min_non_urgent_vignettes: number;
}

export interface CategoryResult {
  readonly category: string;
  readonly total: number;
  readonly wrong: number;
}

export interface TriageFloorReport {
  readonly setVersion: number;
  readonly emergencyTotal: number;
  readonly missed: readonly { readonly id: string; readonly category: string; readonly text: string }[];
  readonly underTriageRate: number;
  readonly nonUrgentTotal: number;
  readonly falseAlarms: readonly { readonly id: string; readonly category: string; readonly text: string; readonly matched: readonly string[] }[];
  readonly overTriageRate: number;
  readonly byCategory: readonly CategoryResult[];
  readonly unsignedCount: number;
}

export class VignetteSetFormatError extends Error {
  constructor(message: string) {
    super(`Triage floor vignette set: ${message}`);
    this.name = "VignetteSetFormatError";
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads and checks the file format. Throws on anything malformed so a broken set can never pass by being empty. */
export function parseVignetteSet(raw: unknown): VignetteSet {
  if (!isRecord(raw)) throw new VignetteSetFormatError("the file is not an object");
  if (raw.format !== "tarragon.triage_floor_vignettes") throw new VignetteSetFormatError("unknown format");
  if (raw.format_version !== 1) throw new VignetteSetFormatError("unsupported format_version");
  if (typeof raw.set_version !== "number" || !Number.isInteger(raw.set_version) || raw.set_version < 1) throw new VignetteSetFormatError("set_version must be a positive integer");
  if (typeof raw.status !== "string" || raw.status.trim().length === 0) throw new VignetteSetFormatError("status is required");
  if (typeof raw.languages !== "string") throw new VignetteSetFormatError("languages is required");
  const review = raw.clinician_review;
  if (!isRecord(review) || typeof review.required !== "boolean") throw new VignetteSetFormatError("clinician_review.required is required");
  if (!Array.isArray(raw.vignettes)) throw new VignetteSetFormatError("vignettes must be a list");
  const seen = new Set<string>();
  const vignettes: Vignette[] = raw.vignettes.map((v, i) => {
    if (!isRecord(v)) throw new VignetteSetFormatError(`vignette ${i} is not an object`);
    const { id, kind, category, text, clinician_signed } = v;
    if (typeof id !== "string" || id.length === 0) throw new VignetteSetFormatError(`vignette ${i} has no id`);
    if (seen.has(id)) throw new VignetteSetFormatError(`duplicate id ${id}`);
    seen.add(id);
    if (kind !== "emergency" && kind !== "non_urgent") throw new VignetteSetFormatError(`${id}: kind must be emergency or non_urgent`);
    if (typeof category !== "string" || category.length === 0) throw new VignetteSetFormatError(`${id}: category is required`);
    if (typeof text !== "string" || text.trim().length === 0) throw new VignetteSetFormatError(`${id}: text is required`);
    if (typeof clinician_signed !== "boolean") throw new VignetteSetFormatError(`${id}: clinician_signed must be true or false`);
    return { id, kind, category, text, clinician_signed };
  });
  return {
    format: "tarragon.triage_floor_vignettes",
    format_version: 1,
    set_version: raw.set_version,
    status: raw.status,
    clinician_review: {
      required: review.required,
      reviewed_by: typeof review.reviewed_by === "string" ? review.reviewed_by : null,
      reviewed_at: typeof review.reviewed_at === "string" ? review.reviewed_at : null,
    },
    languages: raw.languages,
    vignettes,
  };
}

const rate = (n: number, d: number): number => (d === 0 ? 0 : n / d);

/** Runs every vignette through the screen. `screen` is injectable only so a test can prove the runner would notice a broken screen. */
export function runTriageFloor(set: VignetteSet, screen: (text: string) => AssistantDangerScreen = screenAssistantMessage): TriageFloorReport {
  const emergencies = set.vignettes.filter((v) => v.kind === "emergency");
  const nonUrgent = set.vignettes.filter((v) => v.kind === "non_urgent");
  const missed = emergencies.filter((v) => !screen(v.text).redFlag).map(({ id, category, text }) => ({ id, category, text }));
  const falseAlarms = nonUrgent.flatMap((v) => {
    const s = screen(v.text);
    return s.redFlag ? [{ id: v.id, category: v.category, text: v.text, matched: s.matched }] : [];
  });
  const cats = new Map<string, { total: number; wrong: number }>();
  for (const v of set.vignettes) {
    const row = cats.get(`${v.kind}:${v.category}`) ?? { total: 0, wrong: 0 };
    row.total += 1;
    cats.set(`${v.kind}:${v.category}`, row);
  }
  for (const m of missed) cats.get(`emergency:${m.category}`)!.wrong += 1;
  for (const f of falseAlarms) cats.get(`non_urgent:${f.category}`)!.wrong += 1;
  return {
    setVersion: set.set_version,
    emergencyTotal: emergencies.length,
    missed,
    underTriageRate: rate(missed.length, emergencies.length),
    nonUrgentTotal: nonUrgent.length,
    falseAlarms,
    overTriageRate: rate(falseAlarms.length, nonUrgent.length),
    byCategory: [...cats.entries()].map(([k, v]) => ({ category: k, total: v.total, wrong: v.wrong })),
    unsignedCount: set.vignettes.filter((v) => !v.clinician_signed).length,
  };
}

/** Reasons the run fails CI. An empty list means it passes. */
export function triageFloorFailures(report: TriageFloorReport, limits: TriageFloorLimits): string[] {
  const out: string[] = [];
  if (report.emergencyTotal < limits.min_emergency_vignettes) out.push(`only ${report.emergencyTotal} emergency vignettes, at least ${limits.min_emergency_vignettes} needed`);
  if (report.nonUrgentTotal < limits.min_non_urgent_vignettes) out.push(`only ${report.nonUrgentTotal} non-urgent vignettes, at least ${limits.min_non_urgent_vignettes} needed`);
  if (report.underTriageRate > limits.max_under_triage_rate) out.push(`under-triage rate ${pct(report.underTriageRate)} is above ${pct(limits.max_under_triage_rate)}: missed ${report.missed.map((m) => m.id).join(", ")}`);
  if (report.overTriageRate > limits.max_over_triage_rate) out.push(`over-triage rate ${pct(report.overTriageRate)} is above ${pct(limits.max_over_triage_rate)}: ${report.falseAlarms.map((m) => m.id).join(", ")}`);
  return out;
}

const pct = (r: number): string => `${(r * 100).toFixed(1)}%`;

/** A plain-text report for the CI log and for the CMO. */
export function formatTriageFloorReport(report: TriageFloorReport): string {
  const lines = [
    `Triage floor evaluation, vignette set v${report.setVersion} (${report.unsignedCount} vignettes unsigned by a clinician)`,
    `Emergency vignettes: ${report.emergencyTotal}, missed ${report.missed.length}, under-triage rate ${pct(report.underTriageRate)}`,
    `Non-urgent vignettes: ${report.nonUrgentTotal}, tripped ${report.falseAlarms.length}, over-triage rate ${pct(report.overTriageRate)}`,
  ];
  for (const m of report.missed) lines.push(`  MISSED ${m.id} [${m.category}]: ${m.text}`);
  for (const f of report.falseAlarms) lines.push(`  TRIPPED ${f.id} [${f.category}] by "${f.matched.join('", "')}": ${f.text}`);
  return lines.join("\n");
}
