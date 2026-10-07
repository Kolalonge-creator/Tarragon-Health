# Draft: Monitoring required after a new prescription

Paste-ready for `/admin/settings/protocols`. **Not clinically approved.**

One clinical rule schedules a renal-function recheck when a patient with
active CKD is prescribed anything new. With no protocol describing it, it was
signed on 2026-09-16 against the Hypertension WHO protocol.

---

**protocol_id**

```
medication_monitoring_after_prescribing
```

**Title**

```
Monitoring required after a new prescription
```

**Change summary**

```
v1. First protocol covering the CKD renal-monitoring rule already running in the clinical rules engine, and the named home for any further post-prescribing monitoring rules.
```

**Applicable population**

```
Patients with an active CKD care-plan condition. Population predicate: has_condition_ckd = true.
```

**Evidence basis**

```
Transcription of live platform behaviour as at 2026-09-16. The principle (recheck renal function after starting therapy in CKD) is standard practice; the specific breadth of the trigger is a Tarragon choice and is flagged for review in the content.
```

**Content**

---

## Scope

Governs monitoring that must be scheduled after a medication is newly
prescribed, where the patient has a condition that makes the new medication a
monitoring trigger.

Today exactly one rule implements this. The protocol is written to hold
further post-prescribing monitoring rules as they are added, so each does not
need a protocol of its own.

## Rules this protocol governs

| Population | Rule | What the platform does |
|---|---|---|
| Active CKD | `medication_new_prescription_ckd_renal_monitoring` | On any `medication_prescribed` event, schedules a renal-function (U&E/eGFR) recheck |

The rule's condition predicate is `{"op":"true"}` — that is, it fires for
**any** newly prescribed medication for a patient with active CKD, not only
for renally-cleared drugs. The population gate (`has_condition_ckd`) is what
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

Marked `requires_clinician_oversight: true`. The rule creates a monitoring
prompt, never an order. No test is ordered and no result is interpreted
without a clinician.

## Review triggers

Re-review if: a second post-prescribing monitoring rule is added; the CKD rule
is narrowed to a drug class; a monitoring interval is fixed in the rule rather
than left to the clinician; or the rule is ever allowed to order a test
directly.

---

## Provenance (not part of the pasted content)

Read from the live `public.clinical_rules` row
`medication_new_prescription_ckd_renal_monitoring` (version 1) as at
2026-09-16: `population = {"op":"eq","field":"has_condition_ckd","value":true}`,
`conditions.predicate = {"op":"true"}`, action type `monitoring_schedule` with
`requires_clinician_oversight: true`.

The "any newly prescribed medication" reading follows directly from the
`{"op":"true"}` condition predicate — there is no drug-class filter in the rule
as written.
