# Draft: Escalation SLA targets

Paste-ready for `/admin/settings/protocols`. **Not clinically approved.**

The live config row (`escalation_slas` v5, `is_active = true`) is **unsigned**,
and several of its own entries carry notes reading *"DRAFT, needs Clinical
Director sign-off"*. This draft is the text for that sign-off.

---

**protocol_id**

```
escalation_sla_targets
```

**Title**

```
Escalation SLA targets by alert tier and pathway
```

**Change summary**

```
v1. First signed record of the live escalation SLA table (escalation_slas v5), including the SpO2 and temperature entries whose own notes flag them as unsigned drafts.
```

**Protocol content** — paste everything between the rules:

---

## Scope

Governs how long a clinician has to respond to each class of alert, and which
channels are used to reach them. SLA targets are held as **data**
(`public.escalation_slas`), not code, so they can be revised without a
deployment — which is exactly why they need a signed clinical record.

Four tiers, in descending urgency: `emergency`, `urgent_escalation`,
`clinician_review`, `routine`.

## Emergency tier

| Pathway | Target | Channels |
|---|---|---|
| Lifestyle-engine safety rule, severity emergency | **15 min** | push, WhatsApp, SMS |
| Positive eating-disorder / mental-health screen **with self-harm risk** | **15 min** | push, WhatsApp, SMS |
| Danger-symptom report, hypertensive-crisis BP, other emergency event | **120 min** | push, WhatsApp, SMS, next-of-kin call if unacknowledged |
| Critical screening result | **120 min** | push, WhatsApp, SMS |

**For review — the most important line in this document.** The Category 2→1
abnormal-screening pathway is the platform's stated highest-priority business
event, and `CLAUDE.md` describes it as a **4-hour** doctor contact SLA. The live
config says **120 minutes**. The live value is stricter than the documented one,
so nobody is under-served — but the two disagree and signing this fixes 2 hours
as the real commitment. If 4 hours is the intended promise, change the config
before signing rather than signing this text.

Note also the escalating channel sequence on emergency events: unacknowledged
alerts reach the patient's next of kin by phone. That is the only pathway that
contacts someone other than the patient and clinician.

## Urgent escalation tier

| Pathway | Target | Channels |
|---|---|---|
| Red-range SpO2 (90–92%) | **30 min** | push, WhatsApp nudge |
| Red-range home BP | **60 min** | push, WhatsApp nudge |
| Red-range fever (≥ 39.0 °C) | **60 min** | push, WhatsApp nudge |
| Lifestyle-engine safety rule, severity red | **60 min** | push, WhatsApp nudge |
| Positive ED / mental-health screen, no self-harm risk | **60 min** | push, WhatsApp nudge |
| Patient-reported foot problem (diabetic foot self-check) | **240 min** | push, WhatsApp nudge |
| High-severity patient-logged symptom (≥ 8, or ≥ 6 for a low-threshold type) | **240 min** | push, WhatsApp nudge |
| Abnormal but non-critical screening result | **1440 min (24 h)** | push, WhatsApp nudge |

**For review:** SpO2 red is given a tighter target (30 min) than every other red
vital, on the reasoning that hypoxia deteriorates faster. That is a Tarragon
judgement, and its config entry says so. Confirm or change it.

## Clinician review tier

All at **4320 min (72 h)**, batched push only: BP above target (amber),
amber-range SpO2 (93–94%), amber-range fever (≥ 38.0 °C), lifestyle-engine
amber rules, moderate-severity symptoms (5–7), the "silence is not assumed
safe" checks (no recent glucose log, overdue BP despite reminders), and the
contact SLA on an unresolved priority-1 missed care task.

**For review:** moderate-severity symptoms (5–7) previously had **no SLA at
all** and were untriaged. 72 h was chosen to match the other entries in this
tier rather than from clinical reasoning. It is a floor, not a considered
target.

## Routine tier

| Pathway | Target |
|---|---|
| Grace period before a missed **priority-1** care task escalates to an alert | 2880 min (48 h) |
| Reserved general routine tier | 10080 min (7 days) — no trigger currently emits it |

Priority 2 and 3 missed tasks never escalate to a clinician at all: a missed
routine weigh-in does not need a doctor.

## Cross-cutting rules

- **WhatsApp/SMS carry notification only.** No SLA depends on a WhatsApp send
  succeeding; in-app notification is the working channel and the fallback.
- SLA targets are **acknowledgement** targets, not resolution targets.
- Changing any value here is an admin action against `escalation_slas`, which
  requires an active Clinical Director and stamps `approved_by`.

## Review triggers

Re-review if: the abnormal-screening SLA is reconciled with the documented 4-hour
figure; any tier target changes; a new pathway is added; or the next-of-kin call
escalation is extended beyond emergency events.

---

## Provenance (not part of the pasted content)

Live row: `public.escalation_slas` where `is_active`, currently **version 5**,
`approved_by IS NULL`. Config is a JSON array of
`{tier, pathway, sla_minutes, source_function, channel_sequence, note}`.

Entries whose `note` currently contains "DRAFT, needs Clinical Director
sign-off": both SpO2 rows and both temperature rows.

The documented-vs-live SLA discrepancy is recorded in
`project_preventative_screening_audit_20260902` (memory) as "4h SLA claim wrong
(live: 2h/24h)".
