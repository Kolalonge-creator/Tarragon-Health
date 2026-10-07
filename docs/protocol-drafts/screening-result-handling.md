# Draft: Screening result handling (all patients)

Paste-ready for `/admin/settings/protocols`. **Not clinically approved.**

Three clinical rules fire for **every patient on the platform** when a
screening result arrives, and until now there was no protocol describing them.
Because the only signed protocols were five condition-specific ones, all three
were signed on 2026-09-16 against whichever was in the list — the
critical-screening referral rule ended up recorded as deriving from
*"Menstrual cycle bleeding-pattern flags"*. This draft is the text that lets
those links be corrected to something true.

---

**protocol_id**

```
screening_result_handling
```

**Title**

```
Screening result handling (all patients)
```

**Change summary**

```
v1. First protocol covering the three all-patient screening rules already running in the clinical rules engine, so each can name a protocol that actually describes it.
```

**Applicable population**

```
All patients on the platform. Population predicate on all three rules is {"op":"true"} — no condition, programme, age or plan restriction.
```

**Evidence basis**

```
Transcription of live platform behaviour as at 2026-09-16, not an external guideline. No external evidence base is claimed for the routing logic itself.
```

**Content**

---

## Scope

Governs what happens when a screening result arrives, for **every patient on
the platform**, regardless of condition, programme or plan. Three rules in the
clinical rules engine implement it, all triggered by the
`screening_result_received` event with population `{"op":"true"}`.

This protocol is about the **routing** of a result, not about how any
individual screen is interpreted. The clinical meaning of a given screen
belongs to that screen's own programme.

## Rules this protocol governs

| Result status | Rule | What the platform does |
|---|---|---|
| `abnormal` or `critical` | `diagnostic_abnormal_screening_result_review` | Flags the result for clinical review |
| `critical` | `referral_critical_screening_specialist_review` | Additionally recommends a specialist referral for a clinician to review and assign urgency |
| `normal` | `preventive_next_screening_after_normal_result` | Schedules the next screening at the programme's cadence |

A `critical` result therefore matches two rules and produces both
consequences. That is intended.

## What this protocol does NOT govern

**The live abnormal-result escalation pipeline is a separate, authoritative
path and is untouched by these rules.** `private.handle_abnormal_screening_result`
writing to `clinician_alerts` is what actually escalates an abnormal result,
and it runs whether or not these rules exist. The
`diagnostic_abnormal_screening_result_review` rule carries an explicit note in
its own definition saying it is an observational parallel only.

This matters because the platform's standing rule is that an abnormal
screening result is never deprioritised or silently swallowed. That guarantee
comes from the escalation pipeline, not from this protocol.

## Clinician oversight

Both the review flag and the specialist-referral recommendation are marked
`requires_clinician_oversight: true`. Neither creates a referral. A referral is
only ever created by a clinician acting on the recommendation.

The next-screening scheduling is also marked as requiring oversight.

**For review:** scheduling the next screening after a normal result is
arguably routine enough not to need a clinician in the loop. It is currently
gated as if it does. Confirm whether that is the intent or a conservative
default worth relaxing.

**For review:** these rules act on the `result_status` classification
(`normal` / `abnormal` / `critical`) as it arrives. This protocol does not
define how that classification is made — confirm that the upstream
classification for every screen type in use is one you stand behind, because
these rules inherit it wholesale.

## Review triggers

Re-review if: a new `result_status` value is introduced; the specialist
referral recommendation is changed into an automatic referral; the
observational rule is ever made authoritative alongside the escalation
pipeline; or the next-screening cadence becomes rule-driven rather than
programme-driven.

---

## Provenance (not part of the pasted content)

Every statement above is read from the live `public.clinical_rules` rows as at
2026-09-16 — their `population`, `conditions`, `actions` and
`explanation_template` columns — not from an external source. The three rules
are `diagnostic_abnormal_screening_result_review`,
`referral_critical_screening_specialist_review` and
`preventive_next_screening_after_normal_result`, each `version = 1`,
`population = {"op":"true"}`.

The "observational parallel only" wording is quoted from the first rule's own
`actions[0].payload.note`.
