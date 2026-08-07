import type { Database } from "@tarragon/shared";
import type { ResolvedProtocol } from "./protocol";

type ActionType = Database["public"]["Enums"]["case_review_action_type"];
type Authority = Database["public"]["Enums"]["case_review_authority"];

/**
 * The deterministic rule engine behind the cockpit's one-click actions.
 *
 * READ THIS BEFORE ADDING A RULE.
 *
 * Nothing in this file may consult a model, a network call, or a clock it did
 * not receive. It is a pure function from case facts + signed protocol to a
 * small set of proposals, which is what makes the whole design defensible:
 * a doctor confirming an action is confirming something a Clinical Director's
 * signed protocol already implies, and an auditor can replay exactly why it
 * was offered. case_review_actions.source carries a CHECK pinning it to
 * 'protocol_rule' precisely so this stays true at the schema level.
 *
 * FOUR INVARIANTS, each enforced by a test in propose.test.ts:
 *
 *  1. Every proposal carries a rationale naming the fact that triggered it.
 *     No rule may emit a bare "recommended" with nothing behind it.
 *  2. A proposal that claims protocol backing carries protocolVersionId. If
 *     the condition has no signed protocol, the rule either does not fire or
 *     fires with a null version and a rationale that says so.
 *  3. No rule ever proposes closing a case while a protocol red flag is
 *     unresolved. Faster review is worthless if it makes closing easier than
 *     looking.
 *  4. requiredAuthority always matches the authority the underlying write
 *     independently demands -- proposing is never a way to route around a
 *     tier gate. (The DB re-checks anyway; this keeps the UI honest.)
 */

/** Bumped whenever a rule is added, removed, or reweighted. Stored per row. */
export const PROPOSAL_ENGINE_VERSION = 1;

export type ProposedPayload =
  | { kind: "log_review_note"; note: string }
  | { kind: "schedule_follow_up"; nextFollowUpAt: string; note: string }
  | {
      kind: "confirm_medication_refill";
      medicationId: string;
      medicationName: string;
      refillDate: string;
    }
  | {
      kind: "order_investigation";
      panelBundleId: string;
      panelName: string;
      screeningScheduleId: string | null;
    }
  | {
      kind: "resolve_case";
      escalationId: string;
      resolutionNote: string;
      /**
       * Protocol criteria no dataset can evaluate. The UI requires the doctor
       * to tick each one before confirming, and the ticked list is written to
       * confirmed_payload — so "no red flags" becomes an attested statement
       * with a name against it, not an inference the software made.
       */
      judgementChecklist: string[];
    };

export interface ProposedAction {
  actionType: ActionType;
  payload: ProposedPayload;
  /** Deterministic, human-readable, and always names the triggering fact. */
  rationale: string;
  requiredAuthority: Authority;
  /** Null when no signed protocol backs this proposal — never defaulted. */
  protocolVersionId: string | null;
  /** Short label for the confirm button. */
  label: string;
}

export interface CaseFacts {
  alert: {
    title: string;
    level: Database["public"]["Enums"]["alert_level"];
    overrideLevel: Database["public"]["Enums"]["alert_level"] | null;
    detail: string | null;
  };
  /** Present only once the case has been escalated to a doctor. */
  escalation: { id: string; status: string } | null;
  /** Active, clinician-prescribed medications with their refill dates. */
  medications: {
    id: string;
    name: string;
    refillDate: string | null;
  }[];
  /** Screening schedules already due or overdue for this patient. */
  dueScreenings: {
    id: string;
    screenName: string;
    panelBundleId: string | null;
    dueDate: string;
  }[];
  /** Months between routine reviews for the patient's programme, when enrolled. */
  reviewCadenceMonths: number | null;
  /** Output of matchRedFlags — what the data decided, and what it could not. */
  redFlags: RedFlagAssessment;
  protocol: ResolvedProtocol | null;
}

/**
 * Whether closing this case engages the Tier 2+ emergency gate. Mirrors
 * private.can_handle_emergency_escalation's trigger predicate exactly -- the
 * "level OR override_level" form, deliberately not coalesce, so a Tier 1 who
 * downgrades an emergency cannot thereby propose themselves a resolvable case.
 * Same reasoning as requiresEmergencyAuthority in lib/worklist/priority.ts.
 */
function resolutionAuthority(alert: CaseFacts["alert"]): Authority {
  return alert.level === "emergency" || alert.overrideLevel === "emergency"
    ? "emergency_resolution"
    : "any_clinical_tier";
}

function addMonths(from: Date, months: number): string {
  const next = new Date(from);
  next.setMonth(next.getMonth() + months);
  return next.toISOString();
}

function isDue(dateIso: string | null, now: Date): boolean {
  if (!dateIso) return false;
  return new Date(dateIso).getTime() <= now.getTime();
}

/**
 * Emits the proposals for one case. Pure: `now` is injected, nothing is read
 * from the environment, and the same facts always produce the same list in
 * the same order.
 *
 * Order matters and is deliberate -- it is the order a doctor works a case:
 * record what you found, act on what is due, then decide whether it closes.
 * `resolve_case` is always last and is the only rule that can be suppressed
 * by a red flag.
 */
export function proposeActions(facts: CaseFacts, now: Date = new Date()): ProposedAction[] {
  const proposals: ProposedAction[] = [];
  const protocol = facts.protocol;
  const signedVersionId = protocol?.signedVersion?.id ?? null;

  // --- 1. A note on the record. Always proposed: a reviewed case with no
  // note is an unattributable review, and this is the action every case needs
  // regardless of condition. The payload is a deterministic skeleton, NOT the
  // AI's drafted prose -- the doctor sees that separately, clearly labelled,
  // and editing it lands here as a 'modified' action.
  proposals.push({
    actionType: "log_review_note",
    payload: {
      kind: "log_review_note",
      note: protocol
        ? `Reviewed "${facts.alert.title}" against the ${protocol.condition} protocol. Findings: `
        : `Reviewed "${facts.alert.title}". Findings: `,
    },
    rationale: protocol
      ? `Every reviewed case carries a note. Skeleton references the ${protocol.condition} protocol${
          protocol.signedVersion ? ` (signed v${protocol.signedVersion.versionNumber})` : ", which has no signed version yet"
        }.`
      : "Every reviewed case carries a note. No condition protocol applies to this patient, so the skeleton is generic.",
    requiredAuthority: "any_clinical_tier",
    protocolVersionId: signedVersionId,
    label: "Log review note",
  });

  // --- 2. Follow-up at the protocol's own cadence. Only fires with a real
  // structured cadence (chronic_condition_programmes.review_cadence_months) --
  // never parsed out of the reference protocol's free-text cadence prose,
  // which would be guessing at a clinical interval.
  if (facts.reviewCadenceMonths && facts.reviewCadenceMonths > 0) {
    proposals.push({
      actionType: "schedule_follow_up",
      payload: {
        kind: "schedule_follow_up",
        nextFollowUpAt: addMonths(now, facts.reviewCadenceMonths),
        note: `Routine follow-up at the ${facts.reviewCadenceMonths}-month protocol cadence.`,
      },
      rationale: `The patient's programme sets a ${facts.reviewCadenceMonths}-month review cadence${
        protocol?.signedVersion ? `, per signed protocol v${protocol.signedVersion.versionNumber}` : ""
      }.`,
      requiredAuthority: "any_clinical_tier",
      protocolVersionId: signedVersionId,
      label: `Schedule ${facts.reviewCadenceMonths}-month follow-up`,
    });
  }

  // --- 3. Refill confirmation for a medication already at or past its refill
  // date. Confirming CONTINUES an existing prescription -- it never changes
  // drug, dose or frequency (private.enforce_medication_confirm_only restricts
  // the write to refill_date whatever the client sends), which is why this is
  // refill_confirmation authority and not prescribing.
  const dueMedication = facts.medications
    .filter((medication) => isDue(medication.refillDate, now))
    .sort((a, b) => (a.refillDate ?? "").localeCompare(b.refillDate ?? ""))[0];

  if (dueMedication) {
    proposals.push({
      actionType: "confirm_medication_refill",
      payload: {
        kind: "confirm_medication_refill",
        medicationId: dueMedication.id,
        medicationName: dueMedication.name,
        // One month forward, matching the platform's existing refill cycle.
        refillDate: addMonths(now, 1).slice(0, 10),
      },
      rationale: `${dueMedication.name} reached its refill date on ${
        dueMedication.refillDate?.slice(0, 10) ?? "an earlier date"
      } and the prescription is still active. Confirming continues it unchanged — it cannot alter drug, dose or frequency.`,
      requiredAuthority: "refill_confirmation",
      protocolVersionId: signedVersionId,
      label: `Confirm refill — ${dueMedication.name}`,
    });
  }

  // --- 4. An investigation the protocol schedules and the patient is already
  // due for. Deliberately gated on a REAL due screening_schedules row with a
  // matching catalogue bundle: proposing a test from protocol prose alone
  // would be the engine inventing an order rather than surfacing one.
  const dueScreening = facts.dueScreenings
    .filter((screening) => screening.panelBundleId !== null)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];

  if (dueScreening?.panelBundleId) {
    proposals.push({
      actionType: "order_investigation",
      payload: {
        kind: "order_investigation",
        panelBundleId: dueScreening.panelBundleId,
        panelName: dueScreening.screenName,
        screeningScheduleId: dueScreening.id,
      },
      rationale: `${dueScreening.screenName} fell due on ${dueScreening.dueDate} and has not been ordered.${
        protocol && protocol.investigations.ongoing.length > 0
          ? ` The ${protocol.condition} protocol lists it under ongoing investigations.`
          : ""
      }`,
      requiredAuthority: "prescribing",
      protocolVersionId: signedVersionId,
      label: `Order ${dueScreening.screenName}`,
    });
  }

  // --- 5. Close the case. Last, and the only rule a red flag can suppress.
  //
  // INVARIANT 3 lives here. The entire premise of the cockpit is that review
  // gets faster; if that also made CLOSING faster than LOOKING, it would be a
  // patient-safety regression dressed as an efficiency win. So when the case
  // data matches a protocol red flag, no resolve proposal is offered at all --
  // the doctor can still resolve it manually through the normal form, with
  // the red flags listed in front of them. Removing an unsafe shortcut, not
  // removing the doctor's authority.
  const { breached, requiresJudgement } = facts.redFlags;

  if (facts.escalation && facts.escalation.status !== "resolved" && breached.length === 0) {
    proposals.push({
      actionType: "resolve_case",
      payload: {
        kind: "resolve_case",
        escalationId: facts.escalation.id,
        resolutionNote: protocol
          ? `Reviewed against the ${protocol.condition} protocol; recorded thresholds not breached. Continuing current plan.`
          : "Reviewed; no escalation criteria met. Continuing current plan.",
        judgementChecklist: requiresJudgement,
      },
      rationale: protocol
        ? `The patient's recorded readings clear every measurable threshold in the ${
            protocol.condition
          } protocol${
            protocol.signedVersion ? ` (signed v${protocol.signedVersion.versionNumber})` : ""
          }.${
            requiresJudgement.length > 0
              ? ` ${requiresJudgement.length} criteri${
                  requiresJudgement.length === 1 ? "on" : "a"
                } cannot be judged from data and need your confirmation below.`
              : ""
          }`
        : "No protocol red flags apply to this case.",
      requiredAuthority: resolutionAuthority(facts.alert),
      protocolVersionId: signedVersionId,
      label: "Resolve case",
    });
  }

  return proposals;
}

export interface RedFlagAssessment {
  /**
   * Red flags with a numeric threshold that the patient's own data BREACHES.
   * These hard-suppress the resolve shortcut — the data itself says the case
   * is not routine.
   */
  breached: string[];
  /**
   * Red flags that cannot be evaluated from data at all — symptoms, examination
   * findings, "signs of target-organ damage". These do NOT suppress the
   * shortcut; they become the checklist the doctor attests to before confirming.
   */
  requiresJudgement: string[];
  /** Threshold flags the data clears. Shown so "no red flags" is evidenced, not asserted. */
  cleared: string[];
}

/**
 * Sorts a protocol's red flags into what the data can decide and what only a
 * doctor can.
 *
 * THE DESIGN PROBLEM THIS SOLVES. A first cut treated every red flag it could
 * not parse as unresolved, which is superficially the "safe" choice. It is
 * not: WHO hypertension red flags include "signs of target-organ damage
 * (heart failure, renal impairment, retinopathy)", which no vitals row can
 * ever evaluate, so the resolve shortcut would never appear for the platform's
 * single biggest condition. A safety gate that is always on is one clinicians
 * learn to route around, and it would have quietly killed the feature while
 * looking rigorous.
 *
 * So the split is by KIND of criterion:
 *
 *   * A numeric threshold is a fact about the data. If the patient's reading
 *     breaches it, no shortcut — full stop, no attestation available.
 *   * A clinical sign or symptom is a fact about the patient that lives in the
 *     doctor's examination, not the database. Pretending to evaluate it would
 *     be worse than admitting we cannot: it is surfaced verbatim and the
 *     doctor confirms they considered it, which is recorded in
 *     confirmed_payload.
 *
 * Unparseable-and-unclassifiable falls to requiresJudgement, never to cleared:
 * the failure mode is always "ask the doctor", never "assume fine".
 *
 * This gates a SHORTCUT. It is not a clinical classifier, is never shown to a
 * patient, and never itself resolves anything.
 */
export function matchRedFlags(
  protocol: ResolvedProtocol | null,
  vitals: { systolic: number | null; diastolic: number | null }[]
): RedFlagAssessment {
  const empty: RedFlagAssessment = { breached: [], requiresJudgement: [], cleared: [] };
  if (!protocol || protocol.escalation.redFlags.length === 0) return empty;

  const latest = vitals.find((vital) => vital.systolic !== null || vital.diastolic !== null);

  return protocol.escalation.redFlags.reduce<RedFlagAssessment>((acc, flag) => {
    const thresholds = flag.match(/(\d{2,3})\s*\/\s*(\d{2,3})/);

    // No threshold to test — this is a clinical-judgment criterion.
    if (!thresholds) {
      acc.requiresJudgement.push(flag);
      return acc;
    }

    // A threshold we cannot test, because there is no reading to test it
    // against. Not cleared — handed to the doctor.
    if (!latest) {
      acc.requiresJudgement.push(flag);
      return acc;
    }

    const systolicLimit = Number(thresholds[1]);
    const diastolicLimit = Number(thresholds[2]);
    const breaches =
      (latest.systolic !== null && latest.systolic >= systolicLimit) ||
      (latest.diastolic !== null && latest.diastolic >= diastolicLimit);

    if (breaches) acc.breached.push(flag);
    else acc.cleared.push(flag);
    return acc;
  }, empty);
}
