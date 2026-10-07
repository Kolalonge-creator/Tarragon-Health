// S85: the D.7.2 event map as data (spec lines 2257-2304), one row per event, plus the expected-gap registry.
//
// A row is CONFORMANT when four things are all true in the repository, found by reading the real migrations and the
// real process-events handler registry (see event-map-check.ts):
//   1. event_type   the event type is inserted into public.event_types by a migration
//   2. emitter      some migration calls private.emit_domain_event('<type>', ...)
//   3. subscriber   a migration registers a public.event_subscribers row for the type, AND its handler_key is
//                   registered in supabase/functions/process-events/handlers.ts (a subscriber with no handler goes
//                   straight to the dead letter, so it counts as missing)
//   4. effect       the handler's port calls a named RPC that a migration defines (the downstream effect)
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

export interface EventMapRow {
  readonly id: string;
  /** The D.7.2 row this belongs to, or "spine" for the red path the journeys depend on. */
  readonly spec: string;
  readonly eventType: string;
  /** The RPC the handler calls as its downstream effect. Absent where no effect exists yet. */
  readonly effectRpc?: string;
  readonly gap?: ExpectedGap;
  readonly note?: string;
}

export const EVENT_MAP: readonly EventMapRow[] = [
  {
    id: "bp-reading-logged",
    spec: "D.7.2 blood pressure or glucose reading logged (blood pressure half)",
    eventType: "observation.recorded",
    effectRpc: "record_triage_result",
    note: "emitted by the vitals_readings trigger for a blood pressure row; the triage handler grades it and writes triage_events",
  },
  {
    id: "glucose-reading-logged",
    spec: "D.7.2 blood pressure or glucose reading logged (glucose half)",
    eventType: "glucose_observation.recorded",
    gap: {
      missing: ["event_type", "emitter", "subscriber", "effect"],
      owner: "S61, S62",
      note: "observation.recorded is emitted only for blood pressure rows (private.emit_bp_observation_recorded); glucose is graded by the older live trigger, not by the bus. S61/S62 add the diabetes pathway and its rules.",
    },
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
      missing: ["event_type", "emitter", "subscriber", "effect"],
      owner: "S59, S60",
      note: "no symptom checker module exists. Only a red-flag symptom row re-emits observation.recorded for a nearby blood pressure reading (private.emit_symptom_regrade), which is a precursor, not this event.",
    },
  },
  {
    id: "consultation-completed",
    spec: "D.7.2 consultation completed",
    eventType: "encounter.completed",
    gap: {
      missing: ["subscriber", "effect"],
      owner: "S64",
      note: "S21 emits encounter.completed but nothing subscribes: follow-up tasks, the medicine schedule and programme offers are not driven from it. Consultation directory and follow-up booking are S64.",
    },
  },
  {
    id: "lab-result-received",
    spec: "D.7.2 lab result received from a partner (received half)",
    eventType: "lab_result.received",
    gap: {
      missing: ["subscriber", "effect"],
      owner: "S46",
      note: "S27 emits it and holds abnormal results in its own release state machine, but no bus subscriber marks the screening calendar or updates trends. Screening calendar and Health Report are S45/S46.",
    },
  },
  {
    id: "lab-result-released",
    spec: "D.7.2 lab result received from a partner (released half)",
    eventType: "lab_result.released",
    gap: {
      missing: ["subscriber", "effect"],
      owner: "S46",
      note: "emitted on release; no subscriber generates the plain-language explanation or updates biomarker trends",
    },
  },
  {
    id: "wearable-synced",
    spec: "D.7.2 wearable or device data synced",
    eventType: "wearable.synced",
    gap: {
      missing: ["event_type", "emitter", "subscriber", "effect"],
      owner: "S70",
      note: "device and wearable ingestion exists in apps/web and apps/mobile but publishes no bus event",
    },
  },
  {
    id: "mood-or-phq9-logged",
    spec: "D.7.2 mood or PHQ-9 score logged",
    eventType: "phq9.scored",
    gap: {
      missing: ["event_type", "emitter", "subscriber", "effect"],
      owner: "S56, S57",
      note: "no mental wellbeing module; the crisis pathway on a risk answer is S56",
    },
  },
  {
    id: "pregnancy-recorded",
    spec: "D.7.2 pregnancy recorded",
    eventType: "pregnancy.recorded",
    gap: {
      missing: ["event_type", "emitter", "subscriber", "effect"],
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
    gap: {
      missing: ["emitter", "subscriber", "effect"],
      owner: "S26",
      note: "the type is seeded and the engine has a silence rule, but no job emits silence.detected and nothing subscribes (assistant re-engagement and the clinician call are not driven from the bus). S26 or an S10 follow-up.",
    },
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
