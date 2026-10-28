import type { MessageKey } from "./en";

/**
 * The three kinds of output the platform shows (spec D.4): automated information, clinician-reviewed guidance, and a clinician's
 * decision. Until this file, each screen that showed AI output invented its own badge ("AI-drafted", "AI-generated", "Automated
 * summary", "Not a medical opinion"), so a person could not learn what a label meant, and a clinician-reviewed item could look
 * the same as a machine draft. One definition, three words, used everywhere (audit G-02b).
 *
 * The rule for choosing a kind is deterministic and lives here, not in each screen:
 *   - nothing a person on the team has checked: automated_information;
 *   - checked and approved text that applies to many people (a reviewed lesson, a reviewed summary): clinician_reviewed_guidance;
 *   - a decision made and signed by a named clinician about this person (a signed prescription, a signed care-plan change):
 *     clinician_decision.
 * A screen must never show a stronger kind than its record supports. `outputKindFor` takes the facts, so the kind is derived from
 * `reviewed_by` / `signed_by` being present, never typed in by hand at the call site (CLAUDE.md: the "Reviewed by" pattern is
 * null-gated).
 */
export const OUTPUT_KINDS = ["automated_information", "clinician_reviewed_guidance", "clinician_decision"] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];

/** Who is reading. A patient is told about "your" record and care team; a member of staff reading a patient's chart is not. */
export type OutputAudience = "patient" | "staff";

export const OUTPUT_KIND_KEYS: Record<OutputKind, { label: MessageKey; hint: MessageKey; staffHint: MessageKey }> = {
  automated_information: { label: "output.kind.automated.label", hint: "output.kind.automated.hint", staffHint: "output.kind.automated.staff_hint" },
  clinician_reviewed_guidance: { label: "output.kind.reviewed.label", hint: "output.kind.reviewed.hint", staffHint: "output.kind.reviewed.staff_hint" },
  clinician_decision: { label: "output.kind.decision.label", hint: "output.kind.decision.hint", staffHint: "output.kind.decision.staff_hint" },
};

/** The explanation key for the audience. Staff screens must not say "your record" about a patient's chart. */
export function outputKindHintKey(kind: OutputKind, audience: OutputAudience = "patient"): MessageKey {
  return audience === "staff" ? OUTPUT_KIND_KEYS[kind].staffHint : OUTPUT_KIND_KEYS[kind].hint;
}

export interface OutputKindFacts {
  /** A named clinician signed a decision about this person (a prescription, a care-plan change). */
  readonly signedByClinician?: boolean | null;
  /** A clinician reviewed and approved this text (reviewed_by / reviewed_at present). */
  readonly reviewedByClinician?: boolean | null;
}

/** The strongest kind the facts support. With no facts at all the answer is the weakest, never the strongest. */
export function outputKindFor(facts: OutputKindFacts = {}): OutputKind {
  if (facts.signedByClinician === true) return "clinician_decision";
  if (facts.reviewedByClinician === true) return "clinician_reviewed_guidance";
  return "automated_information";
}
