# S11 to S15, package P1 (chain canary, chain health, measurement, parity): competitor and standards research

Date: 2026-10-13. Evidence tags: [V] vendor claim, [P] peer reviewed, [G] guideline or regulator, [NV] not verified. Method: three standard web searches, search snippets and result summaries only, no vendor page was opened in full, so every [V] below is a secondary description and "not found" means "not surfaced", not "absent". This is thinner than the brief asked for; it is stated here rather than dressed up.

## 1. Synthetic checks and heartbeats (what the canary copies)
- A heartbeat or dead man's switch expects a periodic ping from the job and alerts when it is missing past a grace period; an ordinary uptime probe cannot see a cron job or a queue that quietly stopped. [V] (cron monitoring tools such as Healthchecks.io style services, secondary summaries). Opsgenie describes heartbeats this way; Atlassian staff note Opsgenie raises alerts, it does not do the checking itself. [V]
- Sentry and Datadog offer cron monitors and synthetic tests; the Sentry page found was an old forum request, so current product behaviour is [NV].
- ADOPTED, adapted: a missing or late stage fails the run and the failure names the stage (not just "red"). A grace period exists as `minEvalAgeSeconds`; a canary that stops reporting is itself an incident (`chain_canary:stale`), which is the dead man's switch applied to the check. Where: `private.chain_canary_tick`, `chain_canary_config.rules`.
- ADOPTED: the check exercises the real production path (a real insert, the real bus, the real RPCs), not a mock, because the failure mode that matters is the silent one between stages. It then proves it can fail: the proof stops the processor and expects a named failure.
- UNSUITABLE here: an external pinger. Opsgenie-style heartbeats need an outside system to call; this platform's own scheduler is the only thing available and the existing `stale_cron` rule already watches it. A true external heartbeat (an outside monitor that alerts when the canary row stops moving) is a follow-up for the founder.

## 2. Clinical alert reliability, published figures
- No published alert-latency, delivery or escalation figures were found for Omada or Hello Heart. [NV] (searched; not surfaced). This supports R9: Tarragon measuring and later publishing its own figures is a gap in the market, not a copy.
- Remote monitoring studies measure alert transmission success and time from event to clinical decision (an implanted-device alert transmission analysis; a 2013 home monitoring reliability study reporting component reliability between 73 and 92 percent). [P] (abstract level). ADOPTED: reliability is reported per stage, not as one number (reading to graded, graded to task, graded to page, page to acknowledgement), because the studies found the per-component measures located the errors.
- A 2025 preprint on NHS remote monitoring reports that streams full of non-actionable alerts slow responses to genuine ones. [P/NV, preprint]. ADOPTED: the parity page separates "both urgent" from the two concerns so the CMO reads exceptions, not volume; the canary uses two fixtures only.

## 3. NHS DCB0129 and DCB0160 (clinical risk management)
- DCB0129 (manufacturers) and DCB0160 (deployers) require continuous clinical risk management through the operation phase, including post-deployment monitoring, incident management and change control, and a hazard log with owners. [G] (read through a vendor summary of the standard, not the NHS text, so the specifics are [NV]).
- ADOPTED: the canary and chain health page are the monitoring control for the hazard "a reading is never graded, tasked or paged"; an incident is raised with the stage and a run id; thresholds are versioned configuration (INV-16) the CMO confirms. The hazard-log entry itself is the CMO's document (`docs/CLINICAL_FEATURE_CHECKLIST.md`); listed as a follow-up in the closeout.
- Nigeria: no equivalent mandatory standard was identified. [NV]

## 4. What is unsafe or unsuitable here
- Using a real patient or a real clinician as the fixture. The live legacy BP and symptom triggers do not look at `is_test` and notify every clinician profile in the patient's organisation, so a fixture in the real organisation would page real doctors. The canary therefore has its own synthetic organisation (see the design note).
- Letting a canary notification fail instead of being suppressed: `escalate_unconfirmed_critical_notifications` hops a failed critical notice and ends by alerting every real admin.
- Publishing the canary's latencies as a patient-safety claim: they measure the synthetic path, with generous budgets; real figures need real readings (sample minimum applies).
