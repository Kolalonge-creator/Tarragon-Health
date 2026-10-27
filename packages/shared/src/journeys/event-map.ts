// S85: the D.7.2 event map as data (spec lines 2257-2304), one row per event, plus the expected-gap registry.
//
// A row is CONFORMANT when four things are all true in the repository, found by reading the real migrations and the
// real process-events handler registry (see event-map-check.ts):
//   1. event_type   the event type is inserted into public.event_types by a migration
//   2. emitter      some migration calls private.emit_domain_event('<type>', ...). A row for one KIND of a shared type (glucose) must also name its own
//                   emitter function, defined by a migration with that kind in its payload and attached by a trigger, so another kind's emitter cannot satisfy it
//   3. subscriber   a migration registers a public.event_subscribers row for the type, AND its handler_key is
//                   registered in supabase/functions/process-events/handlers.ts (a subscriber with no handler goes
//                   straight to the dead letter, so it counts as missing)
//   4. effect       the handler's port calls a named RPC that a migration defines (the downstream effect); a kind row also needs the handler to route that kind
//
// A row that is not conformant today MUST carry a `gap` naming exactly which components are missing and the session that
// owns closing it. The registry may only shrink: if a gap starts passing the test fails until the gap entry is removed
// (and if it gets worse the test fails too). So the list below is a promise about what the platform does not do yet.

export type Component = "event_type" | "emitter" | "subscriber" | "effect";

export interface ExpectedGap {
  /** Exactly the components that are missing today. */
  readonly missing: readonly Component[];
  /** The session that closes the gap. */
  readonly owner: string;
  readonly note: string;
}

/**
 * Evidence that must be specific to ONE kind of an event type that several things share (observation.recorded carries blood pressure, glucose and the
 * lifestyle kinds). Without it a row passes on another kind's evidence: the glucose row used to pass because blood pressure emits the same event type.
 */
export interface KindEvidence {
  /** The payload `kind` the event carries, for example "glucose". */
  readonly kind: string;
  /** A private function a migration defines whose body emits the event type with this kind, AND a trigger a migration creates that executes it. */
  readonly emitterFunction: string;
  /** The handler routes this kind (the source reads `payload["kind"] === "<kind>"`), so the subscriber's handler does something different for it. */
  readonly handlerRoutesKind: boolean;
}

export interface EventMapRow {
  readonly id: string;
  /** The D.7.2 row this belongs to, or "spine" for the red path the journeys depend on. */
  readonly spec: string;
  readonly eventType: string;
  /** The RPC the handler calls as its downstream effect. Absent where no effect exists yet. */
  readonly effectRpc?: string;
  /** Evidence for a row that is one kind of a shared event type. When present the emitter and effect must pass it as well. */
  readonly kindEvidence?: KindEvidence;
  readonly gap?: ExpectedGap;
  readonly note?: string;
}

export const EVENT_MAP: readonly EventMapRow[] = [
  {
    id: "bp-reading-logged",
    spec: "D.7.2 blood pressure or glucose reading logged (blood pressure half)",
    eventType: "observation.recorded",
    effectRpc: "record_triage_result",
    note: "emitted by the vitals_readings trigger for a blood pressure row; the triage handler grades it and writes triage_events. S47a also emits it with kind water, sleep or mood for lifestyle logs; the handler returns at once for those kinds (nothing to grade)",
  },
  {
    id: "glucose-reading-logged",
    spec: "D.7.2 blood pressure or glucose reading logged (glucose half)",
    eventType: "observation.recorded",
    effectRpc: "record_glucose_triage_result",
    kindEvidence: { kind: "glucose", emitterFunction: "emit_glucose_observation_recorded", handlerRoutesKind: true },
    note: "R2 (20261014162443): a glucose reading emits observation.recorded with kind glucose (private.emit_glucose_observation_recorded) and the same triage.grade_observation subscriber grades it; process-events routes on kind to record_glucose_triage_result. Re-keyed in S85b: the row used to name a glucose_observation.recorded type that was never added and never will be. SHADOW while glucose_care_triage is a draft: the grade is stored, no task or page follows. Only manual and device sources emit; CGM and wearable glucose stay on the older pipeline.",
  },
  {
    id: "dose-recorded",
    spec: "D.7.2 dose confirmed or missed (confirmed half)",
    eventType: "dose.recorded",
    gap: {
      missing: ["emitter", "subscriber", "effect"],
      owner: "S53",
      note: "the type is seeded (S10) but no medication log insert emits it and nothing subscribes; adherence and refill countdown are S53/S54",
    },
  },
  {
    id: "dose-missed",
    spec: "D.7.2 dose confirmed or missed (missed half)",
    eventType: "dose.missed",
    gap: {
      missing: ["emitter", "subscriber", "effect"],
      owner: "S53, S54",
      note: "seeded and unused; missed doses do not yet feed the silence or adherence signals or the refill reminder",
    },
  },
  {
    id: "symptom-check-completed",
    spec: "D.7.2 symptom check completed",
    eventType: "symptom_check.completed",
    gap: {
      missing: ["subscriber", "effect"],
      owner: "S59, S60",
      note: "S60 now emits symptom_check.completed (one event per recorded assessment) but nothing subscribes yet, so no next step is driven from it. Before that, only a red-flag symptom row re-emits observation.recorded for a nearby blood pressure reading (private.emit_symptom_regrade), which is a precursor, not this event.",
    },
  },
  {
    id: "consultation-completed",
    spec: "D.7.2 consultation completed",
    eventType: "encounter.completed",
    effectRpc: "points_award",
    note: "S58: the rewards subscriber awards Health Points for this event (idempotent; the decision record is the replay guard). Follow-up tasks and programme offers are still S64.",
  },
  {
    id: "lab-result-received",
    spec: "D.7.2 lab result received from a partner (received half)",
    eventType: "lab_result.received",
    gap: {
      missing: ["subscriber", "effect"],
      owner: "S46",
      note: "S27 emits it and holds abnormal results in its own release state machine, but no bus subscriber marks the screening calendar or updates trends. S46 (results guidance and the Health Report) reads released results through lab_result.released and its own RPCs, not this event, so the gap stands.",
    },
  },
  {
    id: "lab-result-released",
    spec: "D.7.2 lab result received from a partner (released half)",
    eventType: "lab_result.released",
    effectRpc: "points_award",
    note: "S58: the rewards subscriber awards Health Points for this event (idempotent; the decision record is the replay guard). Follow-up tasks and programme offers are still S64.",
  },
  {
    id: "wearable-synced",
    spec: "D.7.2 wearable or device data synced",
    eventType: "device.synced",
    gap: {
      missing: ["subscriber", "effect"],
      owner: "S70",
      note: "S70a (20261007123856) added the type and public.report_device_synced emits it, so the type and emitter now exist. Re-keyed in S85b from wearable.synced, a name that was never added. Nothing subscribes: device alerts are raised by tasks created in the reading's own transaction (device.alert), not as a bus reaction to device.synced.",
    },
  },
  {
    id: "mood-or-phq9-logged",
    spec: "D.7.2 mood or PHQ-9 score logged",
    eventType: "questionnaire.completed",
    gap: {
      missing: ["subscriber", "effect"],
      owner: "S56",
      note: "S56 (20261007151522) emits questionnaire.completed for a saved wellbeing screen, carrying ids only (the instrument and the score are read through the audited path, so a PHQ-9 total is deliberately not in the event). Re-keyed in S85b from phq9.scored, a name that was never added. The crisis pathway on a risk answer runs inside the save transaction, not as a bus subscriber, so nothing subscribes.",
    },
  },
  {
    id: "pregnancy-recorded",
    spec: "D.7.2 pregnancy recorded",
    eventType: "pregnancy.recorded",
    gap: {
      missing: ["subscriber", "effect"],
      owner: "S67",
      note: "pregnancy tables exist from older work; nothing publishes an event or switches thresholds through the bus",
    },
  },
  {
    id: "payment-completed",
    spec: "D.7.2 payment completed",
    eventType: "order.paid",
    effectRpc: "assign_lead_for_event",
    note: "WIRED, but the only subscriber is lead assignment for a paid care pack. Entitlement, receipt and partner settlement happen in the payment transaction, not as bus subscribers. Counts as conformant because an emitter, a subscriber, a handler and an effect all exist.",
  },
  {
    id: "silence-detected",
    spec: "D.7.2 silence (no activity for a set period)",
    eventType: "silence.detected",
    effectRpc: "record_coverage_triage_result",
    note: "P6 (20261013223020): the daily coverage sweep emits silence.detected (BP-A5, the day count is read from the bp_care_triage rule set) and subscriber triage.grade_silence records the grade. WIRED in code, but the sweep is born OFF (triage_coverage_config.enabled = false, a human turns it on after the CMO confirms) and while the rule set is a draft the result is shadow, so on a fresh database nothing is emitted. Closed in S85b: the old gap said there was no emitter or subscriber, which stopped being true with P6.",
  },
  // The red path the journeys depend on. Not D.7.2 rows, but a break here breaks journey 2.
  {
    id: "spine-triage-graded-to-queue",
    spec: "spine: triage.graded creates a clinical task",
    eventType: "triage.graded",
    effectRpc: "create_tasks_from_triage_event",
    note: "subscriber queue.create_from_triage",
  },
  {
    id: "spine-triage-graded-to-page",
    spec: "spine: a red triage.graded pages the on-call clinician",
    eventType: "triage.graded",
    effectRpc: "create_red_page",
    note: "subscriber paging.on_red",
  },
];

/** Subscribers each spine row must find, so the two rows above cannot both be satisfied by the same subscriber. */
export const SPINE_SUBSCRIBERS: Readonly<Record<string, string>> = {
  "spine-triage-graded-to-queue": "queue.create_from_triage",
  "spine-triage-graded-to-page": "paging.on_red",
};
