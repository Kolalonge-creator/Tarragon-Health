# Draft: Missed appointments — rebooking and disengagement (all patients)

Paste-ready for `/admin/settings/protocols`. **Not clinically approved.**

Two clinical rules fire for **every patient on the platform** when an
appointment is missed. With no protocol describing them, both were signed on
2026-09-16 against the Obesity / Weight Management WHO protocol, which is not
what they are about.

---

**protocol_id**

```
appointment_engagement
```

**Title**

```
Missed appointments: rebooking and disengagement (all patients)
```

**Change summary**

```
v1. First protocol covering the two all-patient missed-appointment rules already running in the clinical rules engine.
```

**Applicable population**

```
All patients on the platform. Population predicate on both rules is {"op":"true"} — no condition, programme, age or plan restriction.
```

**Evidence basis**

```
Transcription of live platform behaviour as at 2026-09-16. Thresholds are Tarragon defaults, not drawn from an external guideline.
```

**Content**

---

## Scope

Governs what happens when a patient misses an appointment, for **every patient
on the platform**. Two rules implement it, both triggered by the
`appointment_missed` event with population `{"op":"true"}`.

These are care-coordination rules, not clinical ones. Nothing here interprets
a symptom, changes a medication, or makes a clinical judgement.

## Rules this protocol governs

| Trigger | Rule | What the platform does |
|---|---|---|
| Any missed appointment | `operational_missed_appointment_rebooking` | Recommends offering a rebooking within 7 days |
| 2 or more missed in 180 days | `engagement_repeated_missed_appointments` | Raises a task: "Patient disengaging — outreach needed" |

A single miss produces the rebooking prompt only. The second miss inside the
180-day window produces both.

## Clinician oversight

- The rebooking recommendation is the **only rule in the engine marked
  `requires_clinician_oversight: false`**. It is logistics: offering an earlier
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
risk score or a plan/billing consequence.

---

## Provenance (not part of the pasted content)

Read from the live `public.clinical_rules` rows as at 2026-09-16.
`engagement_repeated_missed_appointments` carries
`conditions.window = {days: 180, metric: "appointment_missed", threshold: 0, comparator: "gte"}`
with predicate `window.count >= 2`.
`operational_missed_appointment_rebooking` carries predicate `{"op":"true"}`
and the payload message "Missed appointment -- recommend offering a rebooking
within 7 days."

The `requires_clinician_oversight: false` claim is from that rule's own
`actions[0]`; it is the only `false` in the whole rule set, checked across all
seven rules.
