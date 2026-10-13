/**
 * The guideline basis for each rule of glucose_care_triage v1, shown to the Chief Medical Officer beside the rule on the sign-off hub (plan item R2).
 * Words only, no logic: the rule set itself is the governed object; this is what the CMO reads to judge it. The evidence tags follow the S11 to S15
 * plan: [G] guideline, [P] peer reviewed, [CMO] the Chief Medical Officer's own recorded decision of 2026-10-07, [NV] not verified.
 *
 * A test (glucose-triage-basis.test.ts) fails when a rule in the bundled rule set has no entry here, or an entry here names no rule, so the CMO is
 * never shown a rule without its basis.
 */
export type Citation = { id: string; label: string; tag: "G" | "P" | "NV" };

export const GLUCOSE_CITATIONS: readonly Citation[] = [
  { id: "ada-2026-s6", label: "ADA Standards of Care in Diabetes 2026, section 6 (glycemic goals and hypoglycemia): level 1 under 3.9 and at least 3.0 mmol/L; level 2 under 3.0 mmol/L; level 3 is a severe event with altered mental or physical state needing help from another person, at any glucose value", tag: "G" },
  { id: "ada-easd-2024", label: "ADA/EASD consensus report on hyperglycemic crises in adults with diabetes, 2024 (DKA: ketones, with beta-hydroxybutyrate 3.0 mmol/L or more preferred; HHS typically 33.3 mmol/L or more)", tag: "P" },
  { id: "ispad-2022", label: "ISPAD Clinical Practice Consensus Guidelines 2022 (hypoglycemia values 3.9 and 3.0 mmol/L for children; sick-day ketone guidance)", tag: "G" },
  { id: "jbds", label: "UK JBDS guidance on diabetic ketoacidosis and sick-day rules (intermediate ketone band 1.5 to 2.9 mmol/L: urgent same-day advice)", tag: "G" },
  { id: "ng-dm", label: "Nigerian FMoH National Guidelines on the Prevention, Control and Management of Diabetes Mellitus (NG-DM): only the 24 August 2020 DRAFT (with reviewers' comments) could be opened; the final 2021 text could NOT be. The draft calls a glucose under 4 mmol/L low, treats with fast sugar (half a glass of a sweet drink, or 3 to 4 teaspoons of sugar or honey), retests after 10 to 15 minutes, sends severe lows to specialist care, and tells people to refer when glucose is 13.3 mmol/L or more with illness or urine ketones. Check the final text before signing", tag: "NV" },
  { id: "cmo-q", label: "Chief Medical Officer decisions Q6 to Q9, recorded 2026-10-07 (docs/DECISIONS.md)", tag: "G" },
];

export type RuleBasis = { basis: string; citations: readonly string[]; judgement?: string };

export const GLUCOSE_RULE_BASIS: Readonly<Record<string, RuleBasis>> = {
  "GL-R1": { basis: "ADA level 2 hypoglycaemia (under 3.0 mmol/L) is clinically significant at any age and in any state, so it is red for everyone.", citations: ["ada-2026-s6", "ispad-2022", "cmo-q"] },
  "GL-R2": { basis: "ADA level 3: a severe event with confusion, seizure, loss of consciousness or inability to swallow needs help from another person. With a low reading it gets the low-sugar guidance.", citations: ["ada-2026-s6", "cmo-q"] },
  "GL-R3": { basis: "The same level 3 signs at any glucose value (CMO Q6): the signs, not the number, make it an emergency. The wording is the general get-help one because the cause may not be a low.", citations: ["ada-2026-s6", "cmo-q"] },
  "GL-R4": { basis: "Suspected DKA: glucose 11.0 or more (the 200 mg/dL line) with blood ketones 3.0 or more, or urine ketones moderate or large. Kept as it was before (CMO Q7); applies to everyone.", citations: ["ada-easd-2024", "cmo-q"], judgement: "Urine moderate or large is treated as equal to blood ketones of 3.0 or more. That mapping is the platform's earlier rule, not a published equivalence." },
  "GL-R5": { basis: "Raised ketones (1.5 or more) with vomiting, abdominal pain, fast breathing or drowsiness are the warning signs of ketoacidosis, so red even when glucose is only slightly high, which also catches euglycaemic DKA (CMO Q7).", citations: ["ada-easd-2024", "jbds", "ispad-2022", "cmo-q"], judgement: "Two readings beyond the decision text: urine moderate or large counts as raised ketones, and ketones of 3.0 or more with these signs are red even when glucose is under 11.0. Both are the safer reading; confirm or strike." },
  "GL-R6": { basis: "Glucose 33.3 mmol/L (600 mg/dL) or more is the hyperosmolar range, red whatever else is known (CMO Q8).", citations: ["ada-easd-2024", "cmo-q"] },
  "GL-R7": { basis: "Glucose 20.0 or more with vomiting, drowsiness, confusion, or very thirsty and not keeping fluids down means dehydration or a crisis: red (CMO Q8).", citations: ["ada-easd-2024", "cmo-q"] },
  "GL-A1P": { basis: "The same level 1 low for a pregnant patient, someone under 18, or a patient with gestational or other diabetes: the treat-now message is still shown (a low is a low), and the patient is also routed to a clinician because their targets differ (CMO Q9). For GL-A2 and GL-A3 the urgent same-day review is itself the route to a clinician for these patients.", citations: ["ada-2026-s6", "ispad-2022", "cmo-q"] },
  "GL-A1": { basis: "ADA level 1 (3.0 to 3.8 mmol/L): the alert value that needs treatment. Shown the fast-sugar message; it opens no clinician task, because recurrent level 1 as a pattern was not chosen (CMO Q6 option c).", citations: ["ada-2026-s6", "ispad-2022", "ng-dm", "cmo-q"], judgement: "The treatment wording (15 grams of fast sugar, recheck in 15 minutes) is a clinical message awaiting your signature and a check against the final NG-DM text." },
  "GL-A2": { basis: "Raised ketones without the warning signs: urgent same-day review (CMO Q7). The due time of 480 minutes is a PROPOSED value.", citations: ["jbds", "ada-easd-2024", "cmo-q"], judgement: "480 minutes is proposed, not decided. On the Free plan this opens no doctor task: the patient gets the in-app guidance only." },
  "GL-A3": { basis: "Glucose 20.0 or more without the warning signs: urgent same-day review (CMO Q8). Due time 480 minutes, PROPOSED.", citations: ["ada-easd-2024", "cmo-q"], judgement: "480 minutes is proposed, not decided." },
  "GL-P1": { basis: "Pregnancy targets are tighter than adult ones and gestational diabetes has its own targets, so a pregnant patient is not graded on adult bands; routed to a clinician (CMO Q9). The severe low and suspected DKA reds above still apply.", citations: ["cmo-q", "ng-dm"] },
  "GL-P2": { basis: "Children and adolescents have their own targets and ketone rules, so under 18 is routed to a clinician (CMO Q9). The severe low and suspected DKA reds above still apply.", citations: ["ispad-2022", "cmo-q"] },
  "GL-P3": { basis: "Gestational and other diabetes types are not graded on the type 1 and type 2 bands (CMO Q9).", citations: ["cmo-q"], judgement: "A patient with NO diabetes type recorded is graded as an adult on these bands (a prevention user checking a reading would otherwise be routed every time). Confirm that choice." },
  "GL-G1": { basis: "Glucose 3.9 or more with nothing above matched: reading saved, no action. There is no amber line between 3.9 and 20.0 in this version; the platform's earlier persistent-high pattern band (14.0) is a trend rule that stays on the older pipeline.", citations: ["cmo-q"], judgement: "No single-reading line between 11.0 and 20.0 without ketones. Confirm." },
};

/** What signing means, in plain words, for the hub panel. */
export const GLUCOSE_OPEN_POINTS: readonly string[] = [
  "The signs a patient ticks on the phone (seizure, not awake, cannot swallow, vomiting, stomach pain) are graded on the phone but are NOT yet stored on the server: the server's symptom log has no entry for them. Until they are, the server cannot page for GL-R2, GL-R3 and part of GL-R5 and GL-R7 from the phone's entries, although the phone still shows the emergency guidance. Ketones typed with the glucose are stored. Decide whether to sign before the signs are stored.",
  "Readings that arrive late from a continuous monitor or a wearable are graded when they arrive, with no freshness limit. Once signed, an old low in a bulk sync could page. Decide whether late readings should page.",
  "The older glucose alerts keep running beside this rule set until the two are shown to agree (the glucose divergence report). Once this is signed a severe low is paged by BOTH.",
];

export const GLUCOSE_SIGNING_NOTE =
  "Signing is the Chief Medical Officer's own clinical act and is never done for you by the system. Until you sign, glucose readings are graded in shadow only: nothing new is paged and no task is opened from them, and the older glucose alerts keep running unchanged. After you sign, the older alerts keep running beside this rule set until the two are shown to agree.";
