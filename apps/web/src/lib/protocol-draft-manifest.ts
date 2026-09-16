/**
 * Protocol content that exists as reviewed, paste-ready markdown but has no
 * row anywhere in `protocol_drafts` or `protocol_versions` yet. Shared
 * between the sign-off queue (apps/web/src/lib/queries/signoff-queue.ts,
 * which only needs to know an entry is still outstanding) and the protocol
 * drafts UI (protocol-drafts-manager.tsx, which needs the actual text to
 * offer a one-click "load into the draft form" convenience instead of
 * making a Director copy-paste from the source markdown file by hand).
 *
 * Each entry's `content` is copied verbatim from its `sourceHint` file
 * (everything between the "paste everything between the rules" markers,
 * excluding that file's own "Provenance" footer, which is explicitly not
 * part of the pasted content). Remove an entry the moment its protocol_id
 * gets a real, signed `protocol_versions` row — this manifest existing
 * alongside a signed version would be a stale duplicate, not a second
 * source of truth.
 */
export type KnownUnpromotedProtocolDraft = {
  protocolId: string;
  title: string;
  changeSummary: string;
  content: string;
  sourceHint: string;
};

export const KNOWN_UNPROMOTED_PROTOCOL_DRAFTS: KnownUnpromotedProtocolDraft[] = [
  {
    protocolId: "screening_result_handling",
    title: "Screening result handling (all patients)",
    changeSummary:
      "v1. First protocol covering the three all-patient screening rules already running in the clinical rules engine, so each can name a protocol that actually describes it.",
    sourceHint: "Draft text ready in docs/protocol-drafts/screening-result-handling.md",
    content: `## Scope

Governs what happens when a screening result arrives, for **every patient on
the platform**, regardless of condition, programme or plan. Three rules in the
clinical rules engine implement it, all triggered by the
\`screening_result_received\` event with population \`{"op":"true"}\`.

This protocol is about the **routing** of a result, not about how any
individual screen is interpreted. The clinical meaning of a given screen
belongs to that screen's own programme.

## Rules this protocol governs

| Result status | Rule | What the platform does |
|---|---|---|
| \`abnormal\` or \`critical\` | \`diagnostic_abnormal_screening_result_review\` | Flags the result for clinical review |
| \`critical\` | \`referral_critical_screening_specialist_review\` | Additionally recommends a specialist referral for a clinician to review and assign urgency |
| \`normal\` | \`preventive_next_screening_after_normal_result\` | Schedules the next screening at the programme's cadence |

A \`critical\` result therefore matches two rules and produces both
consequences. That is intended.

## What this protocol does NOT govern

**The live abnormal-result escalation pipeline is a separate, authoritative
path and is untouched by these rules.** \`private.handle_abnormal_screening_result\`
writing to \`clinician_alerts\` is what actually escalates an abnormal result,
and it runs whether or not these rules exist. The
\`diagnostic_abnormal_screening_result_review\` rule carries an explicit note in
its own definition saying it is an observational parallel only.

This matters because the platform's standing rule is that an abnormal
screening result is never deprioritised or silently swallowed. That guarantee
comes from the escalation pipeline, not from this protocol.

## Clinician oversight

Both the review flag and the specialist-referral recommendation are marked
\`requires_clinician_oversight: true\`. Neither creates a referral. A referral is
only ever created by a clinician acting on the recommendation.

The next-screening scheduling is also marked as requiring oversight.

**For review:** scheduling the next screening after a normal result is
arguably routine enough not to need a clinician in the loop. It is currently
gated as if it does. Confirm whether that is the intent or a conservative
default worth relaxing.

**For review:** these rules act on the \`result_status\` classification
(\`normal\` / \`abnormal\` / \`critical\`) as it arrives. This protocol does not
define how that classification is made — confirm that the upstream
classification for every screen type in use is one you stand behind, because
these rules inherit it wholesale.

## Review triggers

Re-review if: a new \`result_status\` value is introduced; the specialist
referral recommendation is changed into an automatic referral; the
observational rule is ever made authoritative alongside the escalation
pipeline; or the next-screening cadence becomes rule-driven rather than
programme-driven.`,
  },
  {
    protocolId: "appointment_engagement",
    title: "Missed appointments: rebooking and disengagement (all patients)",
    changeSummary:
      "v1. First protocol covering the two all-patient missed-appointment rules already running in the clinical rules engine.",
    sourceHint: "Draft text ready in docs/protocol-drafts/appointment-engagement.md",
    content: `## Scope

Governs what happens when a patient misses an appointment, for **every patient
on the platform**. Two rules implement it, both triggered by the
\`appointment_missed\` event with population \`{"op":"true"}\`.

These are care-coordination rules, not clinical ones. Nothing here interprets
a symptom, changes a medication, or makes a clinical judgement.

## Rules this protocol governs

| Trigger | Rule | What the platform does |
|---|---|---|
| Any missed appointment | \`operational_missed_appointment_rebooking\` | Recommends offering a rebooking within 7 days |
| 2 or more missed in 180 days | \`engagement_repeated_missed_appointments\` | Raises a task: "Patient disengaging — outreach needed" |

A single miss produces the rebooking prompt only. The second miss inside the
180-day window produces both.

## Clinician oversight

- The rebooking recommendation is the **only rule in the engine marked
  \`requires_clinician_oversight: false\`**. It is logistics: offering an earlier
  slot needs no clinical judgement, and it is the kind of task a Care
  Coordinator handles.
- The disengagement task **does** require clinician oversight, because
  deciding what to do about a disengaging patient is a clinical judgement
  about risk, not a scheduling action.

**For review:** the thresholds are 2 misses in 180 days, and rebooking within
7 days. Both are platform defaults with no external guideline behind them.
They set how often a patient is chased, which is a real experience decision as
well as a clinical one — confirm both numbers.

**For review:** the disengagement rule counts missed appointments only. It
does not weight them by what was missed, so two missed lifestyle check-ins
count the same as two missed post-abnormal-result consultations. Confirm
whether that is acceptable, or whether high-stakes appointments should count
differently.

## Review triggers

Re-review if: either threshold moves; the rebooking recommendation is ever
made automatic rather than offered; or missed appointments start feeding a
risk score or a plan/billing consequence.`,
  },
  {
    protocolId: "medication_monitoring_after_prescribing",
    title: "Monitoring required after a new prescription",
    changeSummary:
      "v1. First protocol covering the CKD renal-monitoring rule already running in the clinical rules engine, and the named home for any further post-prescribing monitoring rules.",
    sourceHint: "Draft text ready in docs/protocol-drafts/medication-monitoring-after-prescribing.md",
    content: `## Scope

Governs monitoring that must be scheduled after a medication is newly
prescribed, where the patient has a condition that makes the new medication a
monitoring trigger.

Today exactly one rule implements this. The protocol is written to hold
further post-prescribing monitoring rules as they are added, so each does not
need a protocol of its own.

## Rules this protocol governs

| Population | Rule | What the platform does |
|---|---|---|
| Active CKD | \`medication_new_prescription_ckd_renal_monitoring\` | On any \`medication_prescribed\` event, schedules a renal-function (U&E/eGFR) recheck |

The rule's condition predicate is \`{"op":"true"}\` — that is, it fires for
**any** newly prescribed medication for a patient with active CKD, not only
for renally-cleared drugs. The population gate (\`has_condition_ckd\`) is what
narrows it.

**For review:** that is deliberately broad. A patient with CKD starting a
topical or a short antibiotic course triggers the same recheck prompt as one
starting an ACE inhibitor. The trade is a false-positive-tolerant design that
cannot miss a nephrotoxic start. Confirm this is the intended trade, or
narrow the rule to a drug class list.

**For review:** the rule schedules monitoring but does not specify an
interval. Confirm the interval a renal recheck should be scheduled at after a
new prescription, or confirm that leaving it to the reviewing clinician is
intended.

## Clinician oversight

Marked \`requires_clinician_oversight: true\`. The rule creates a monitoring
prompt, never an order. No test is ordered and no result is interpreted
without a clinician.

## Review triggers

Re-review if: a second post-prescribing monitoring rule is added; the CKD rule
is narrowed to a drug class; a monitoring interval is fixed in the rule rather
than left to the clinician; or the rule is ever allowed to order a test
directly.`,
  },
];
