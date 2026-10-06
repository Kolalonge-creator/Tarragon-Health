/**
 * Titration proposals (S24, spec 6.3, safety case 10).
 *
 * A PURE evaluator: no clock (the caller passes `now`), no I/O, no randomness, no model (INV-01). It never mutates
 * its input and has no function that writes anything: the result is data, a draft for a clinician to review and sign
 * (INV-02). It holds no drug name, dose or clinical threshold: every one comes from the ProtocolDefinition the CMO
 * supplies and signs, and a proposal can only be a row of that protocol's own step table.
 */
import type {
  ProposeCareChangeArgs,
  ProtocolDefinition,
  ProtocolItem,
  ProtocolMedicineRef,
  ProtocolStep,
  ProtocolValidation,
  TitrationInput,
  TitrationInputsSnapshot,
  TitrationMedication,
  TitrationProposal,
  TitrationReading,
  TitrationResult,
  TitrationStopCode,
  TitrationStopReason,
} from "./titration-types";

const MS_PER_DAY = 86_400_000;
const STATUSES: readonly string[] = ["draft", "approved", "retired"];
const ACTIONS: readonly string[] = ["start", "change"];

/** A malformed definition is refused outright, never half applied. */
export class ProtocolDefinitionError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`protocol definition refused: ${errors.join("; ")}`);
    this.name = "ProtocolDefinitionError";
    this.errors = errors;
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isPositiveInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v) && v > 0;
const isNonNegative = (v: unknown): v is number => isNum(v) && v >= 0;

function validateParams(raw: unknown, errors: string[]): void {
  if (!isObj(raw)) {
    errors.push("params must be an object");
    return;
  }
  if (!isPositiveInt(raw.minReadings)) errors.push("params.minReadings must be a positive whole number");
  if (!isNum(raw.windowDays) || raw.windowDays <= 0) errors.push("params.windowDays must be above zero");
  if (!isNum(raw.minAdherencePercent) || raw.minAdherencePercent < 0 || raw.minAdherencePercent > 100) {
    errors.push("params.minAdherencePercent must be from 0 to 100");
  }
  if (!isNonNegative(raw.reviewWindowDays)) errors.push("params.reviewWindowDays must be zero or more");
  if (!isNum(raw.staleAfterDays) || raw.staleAfterDays <= 0) errors.push("params.staleAfterDays must be above zero");
  if (typeof raw.requireValidated !== "boolean") errors.push("params.requireValidated must be true or false");
  const v = raw.validation;
  const limitsOk =
    isObj(v) &&
    isNum(v.systolicMin) &&
    isNum(v.systolicMax) &&
    isNum(v.diastolicMin) &&
    isNum(v.diastolicMax) &&
    v.systolicMin < v.systolicMax &&
    v.diastolicMin < v.diastolicMax;
  if (!limitsOk) errors.push("params.validation needs systolicMin < systolicMax and diastolicMin < diastolicMax");
}

function validateStep(raw: unknown, index: number, seen: Set<string>, errors: string[]): void {
  const at = `steps[${index}]`;
  if (!isObj(raw)) {
    errors.push(`${at} must be an object`);
    return;
  }
  if (!isText(raw.id)) errors.push(`${at}.id is required`);
  else if (seen.has(raw.id)) errors.push(`${at}.id is a duplicate`);
  else seen.add(raw.id);

  const names: string[] = [];
  if (!Array.isArray(raw.requires)) errors.push(`${at}.requires must be a list`);
  else {
    for (const ref of raw.requires as unknown[]) {
      if (!isObj(ref) || !isText(ref.drugName) || !isText(ref.dose) || (ref.frequency !== undefined && !isText(ref.frequency))) {
        errors.push(`${at}.requires entries need a drugName and a dose`);
      } else names.push(norm(ref.drugName));
    }
  }

  const p = raw.propose;
  if (p === null) return;
  if (!isObj(p)) {
    errors.push(`${at}.propose must be an object or null`);
    return;
  }
  if (typeof p.action !== "string" || !ACTIONS.includes(p.action)) errors.push(`${at}.propose.action must be start or change`);
  if (p.action === "change" && !(isText(p.changes) && names.includes(norm(p.changes)))) {
    errors.push(`${at}.propose.changes must name one of the step's required medicines`);
  }
  const item = p.item;
  if (!isObj(item) || !isText(item.drugName) || !isText(item.dose) || !isText(item.frequency) || !isText(item.quantity) || !isPositiveInt(item.durationDays)) {
    errors.push(`${at}.propose.item needs drugName, dose, frequency, quantity and a positive durationDays`);
  }
}

/** Checks a protocol definition. A definition that fails is refused whole (`ok: false`), never partly used. */
export function validateProtocolDefinition(def: unknown): ProtocolValidation {
  const errors: string[] = [];
  if (!isObj(def)) return { ok: false, errors: ["definition must be an object"] };
  if (!isText(def.code)) errors.push("code is required");
  if (!isPositiveInt(def.version)) errors.push("version must be a positive whole number");
  if (typeof def.status !== "string" || !STATUSES.includes(def.status)) errors.push("status must be draft, approved or retired");
  validateParams(def.params, errors);
  if (!Array.isArray(def.steps) || def.steps.length === 0) errors.push("steps must be a non-empty list");
  else {
    const seen = new Set<string>();
    (def.steps as unknown[]).forEach((s, i) => validateStep(s, i, seen, errors));
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, definition: def as unknown as ProtocolDefinition };
}

function norm(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

const refMatches = (ref: ProtocolMedicineRef, med: TitrationMedication): boolean =>
  med.clinicianIssued &&
  norm(ref.drugName) === norm(med.drugName) &&
  norm(ref.dose) === norm(med.dose) &&
  (ref.frequency === undefined || norm(ref.frequency) === norm(med.frequency));

/**
 * The step that fits the patient's current medicines: the most specific one that matches. A step names clinician-issued
 * medicines only; an empty `requires` fits only a patient on no medicine at all, so a self-reported one blocks a start.
 */
function matchStep(steps: ProtocolStep[], meds: TitrationMedication[]): { step: ProtocolStep; ids: Record<string, string> } | undefined {
  let best: { step: ProtocolStep; ids: Record<string, string> } | undefined;
  for (const step of steps) {
    const ids: Record<string, string> = {};
    const found = step.requires.map((ref) => meds.find((m) => refMatches(ref, m)));
    const fits = step.requires.length === 0 ? meds.length === 0 : found.every((m) => m !== undefined);
    if (!fits) continue;
    step.requires.forEach((ref, i) => {
      ids[norm(ref.drugName)] = (found[i] as TitrationMedication).id;
    });
    if (best === undefined || step.requires.length > best.step.requires.length) best = { step, ids };
  }
  return best;
}

const round = (n: number): number => Math.round(n * 100) / 100;
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Proposes the next step from the protocol's own step table, or says plainly why not.
 * Throws ProtocolDefinitionError on a malformed definition and RangeError on an unreadable `now`.
 */
export function proposeTitration(input: TitrationInput, protocol: ProtocolDefinition): TitrationResult {
  const checked = validateProtocolDefinition(protocol);
  if (!checked.ok) throw new ProtocolDefinitionError(checked.errors);
  const nowMs = Date.parse(input.now);
  if (Number.isNaN(nowMs)) throw new RangeError("now must be an ISO timestamp");

  const p = protocol.params;
  const lim = p.validation;
  const reasons: TitrationStopReason[] = [];
  const stop = (code: TitrationStopCode, detail?: string): void => {
    reasons.push({ code, detail });
  };

  if (protocol.status !== "approved" && !(protocol.status === "draft" && input.isTest)) {
    stop("protocol_not_approved_for_real_patient", `protocol ${protocol.code} version ${protocol.version} is ${protocol.status}`);
  }
  if (input.patient.pregnancy !== "no") stop("pregnancy_or_unknown", `pregnancy status: ${input.patient.pregnancy}`);
  if (input.openTriage === "red") stop("open_red_triage");
  if (input.openTriage === "amber") stop("open_amber_triage");

  // Readings: time first, then reliability, then count, then freshness.
  const timed = input.readings.map((r) => ({ r, t: Date.parse(r.takenAt) }));
  const badTime = timed.filter((x) => Number.isNaN(x.t) || x.t > nowMs).length;
  const windowStart = nowMs - p.windowDays * MS_PER_DAY;
  const inWindow = timed.filter((x) => x.t > windowStart && x.t <= nowMs).map((x) => x.r);
  const reliable = (r: TitrationReading): boolean =>
    r.systolic >= lim.systolicMin &&
    r.systolic <= lim.systolicMax &&
    r.diastolic >= lim.diastolicMin &&
    r.diastolic <= lim.diastolicMax &&
    (!p.requireValidated || r.validated);
  const usable = inWindow.filter(reliable);
  const unreliable = badTime > 0 || usable.length < inWindow.length;
  const tooFew = usable.length < p.minReadings;
  if (tooFew) stop("too_few_readings", `${usable.length} usable readings, ${p.minReadings} needed`);
  if (unreliable) stop("unreliable_readings", `${badTime + inWindow.length - usable.length} readings could not be relied on`);
  const finiteTimes = timed.filter((x) => x.t <= nowMs).map((x) => x.t);
  if (finiteTimes.length > 0 && nowMs - Math.max(...finiteTimes) > p.staleAfterDays * MS_PER_DAY) {
    stop("readings_stale", `newest reading is older than ${p.staleAfterDays} days`);
  }

  if (input.adherencePercent === null) stop("adherence_unknown");
  else if (input.adherencePercent < p.minAdherencePercent) stop("low_adherence", `adherence ${input.adherencePercent} percent`);

  // A change inside the review window: the last recorded change, or any current medicine started inside it.
  const changeTimes = [...(input.lastChangeAt === null ? [] : [input.lastChangeAt]), ...input.currentMedications.map((m) => m.startedAt)];
  const insideReview = changeTimes.some((iso) => {
    const t = Date.parse(iso);
    return Number.isNaN(t) || nowMs - t < p.reviewWindowDays * MS_PER_DAY;
  });
  if (insideReview) stop("change_inside_review_window", `a change was made inside the last ${p.reviewWindowDays} days`);

  if (input.sideEffectsReported) stop("side_effects_reported");

  const matched = matchStep(protocol.steps, input.currentMedications);
  if (matched === undefined) stop("no_matching_step");
  else if (matched.step.propose === null) stop("final_step_reached", `step ${matched.step.id}`);

  const avgSys = usable.length > 0 ? mean(usable.map((r) => r.systolic)) : 0;
  const avgDia = usable.length > 0 ? mean(usable.map((r) => r.diastolic)) : 0;
  if (!tooFew && !unreliable && avgSys <= input.target.systolic && avgDia <= input.target.diastolic) {
    stop("already_at_target", `average ${round(avgSys)}/${round(avgDia)}`);
  }

  if (reasons.length > 0 || matched === undefined || matched.step.propose === null) return { kind: "no_proposal", reasons };

  const { step, ids } = matched;
  const prop = step.propose as NonNullable<ProtocolStep["propose"]>;
  const item: ProtocolItem = { ...prop.item };
  const inputs: TitrationInputsSnapshot = {
    now: input.now,
    isTest: input.isTest,
    protocol: { code: protocol.code, version: protocol.version, status: protocol.status },
    params: JSON.parse(JSON.stringify(p)) as TitrationInputsSnapshot["params"],
    patient: { ...input.patient },
    target: { ...input.target },
    readings: usable.map((r) => ({ ...r })),
    readingCount: usable.length,
    averageSystolic: round(avgSys),
    averageDiastolic: round(avgDia),
    currentMedications: input.currentMedications.map((m) => ({ ...m })),
    adherencePercent: input.adherencePercent,
    openTriage: input.openTriage,
    sideEffectsReported: input.sideEffectsReported,
    lastChangeAt: input.lastChangeAt,
    stepId: step.id,
  };
  const rationale =
    `Average of ${usable.length} home readings over ${p.windowDays} days is ${round(avgSys)}/${round(avgDia)}, ` +
    `above the target ${input.target.systolic}/${input.target.diastolic}. ` +
    `Protocol ${protocol.code} version ${protocol.version}, step ${step.id}` +
    `${step.label === undefined ? "" : ` (${step.label})`}: ${prop.action} ${item.drugName} ${item.dose}.` +
    `${step.rationale === undefined ? "" : ` ${step.rationale}`}`;
  const result: TitrationProposal = { kind: "proposal", stepId: step.id, action: prop.action, item, rationale, inputs };
  if (prop.action === "change") result.medicationId = ids[norm(prop.changes as string)];
  return result;
}

/** Maps a proposal to the exact arguments of public.propose_care_plan_change (the only write path, a definer function). */
export function proposalToChangeArgs(
  result: Extract<TitrationResult, { kind: "proposal" }>,
  patientId: string,
  protocolId: string,
): ProposeCareChangeArgs {
  const i = result.item;
  return {
    p_patient: patientId,
    p_kind: "medication",
    p_proposal: {
      action: result.action,
      ...(result.medicationId === undefined ? {} : { medication_id: result.medicationId }),
      item: {
        drug_name: i.drugName,
        dose: i.dose,
        frequency: i.frequency,
        ...(i.route === undefined ? {} : { route: i.route }),
        duration_days: i.durationDays,
        quantity: i.quantity,
        ...(i.repeatsAllowed === undefined ? {} : { repeats_allowed: i.repeatsAllowed }),
        ...(i.indication === undefined ? {} : { indication: i.indication }),
        ...(i.instructions === undefined ? {} : { instructions: i.instructions }),
      },
    },
    p_rationale: result.rationale,
    p_proposed_by: "engine",
    p_protocol_id: protocolId,
    p_engine_inputs: result.inputs,
  };
}
