# S16 to S20: review, competitor comparison, CMO decisions and build plan

Date: 2026-10-07. Scope: S16 (clinical tasks), S17 (Next task), S18 (lead, availability, rota), S19 (red event paging), S20 (quality and safety).
Evidence: the five session prompts, BUILD-SPEC-v5 7.1 to 7.9, design and research notes S16 to S20, three read-only code audits of `origin/main-dev` (commit 6fef31181; the working branch is 172 commits behind), two web research passes. **Nothing was run. No database was queried.** "Applied live" statements come from BUILD-PROGRESS and must be re-checked.
Evidence labels: **[V]** vendor claim, **[I]** independent or regulator source, **[U]** could not verify, **[verify]** guideline reference from background knowledge that the CMO must check before signing.

Full audit tables: scratchpad `audit-s16-s17.md`, `audit-s18-s19.md` (S20 table is in section 3 below). Full research notes: scratchpad `research-queue-assignment.md`, `research-paging-quality.md`.

---

## 1. Headline

1. **The database logic for S16 to S20 is largely sound and well tested** (state machine, atomic claim with a real 50-session race proof and a lock-free control, page timers and idempotency, audit immutability, speak-up RLS, expiry removal with a sabotage test). The weak layer is **delivery, wiring and human process around it**.
2. **The red-event pager is probably not delivering what the proofs say.** By code reading: page email never delivers (sender needs `to_email`, page notices send only a page id); page push waits for a 5-minute cron (same length as the backup timer); a failed push can climb to an SMS through the older alert engine, contradicting "no SMS for paging"; older paths still page every clinician in parallel; and only blood-pressure events ever create a `pages` row (SpO2, pulse, temperature, glucose and symptom red flags do not). INV-05 holds for BP only.
3. **Three task defects are live in the schema:** the offer window equals the due time for three task types (they skip the pool and escalate), nothing listens to `clinical_task.escalated`, and cancelling a claimed task can lock the clinician out of the queue.
4. **The audit cannot detect a wrong clinical decision.** The reviewer sees only task metadata, never the clinical record, and can sign a score without opening anything.
5. **"Concerns cannot be seen by ops" holds only for unnamed admins.** The backup reader can be an admin-role login; no reader screen exists; a concern about the CMO has no working route.
6. **Much of what is "built" runs on unsigned numbers** (`queue.*`, `paging.rules`, `lead.rules`, `quality.audit` are all `proposed`) and key guards are not wired (`on_call_cover_ok` gates nothing; `clinical_operations_enabled` does not pause the queue).
7. **Compared with the market, Tarragon's design is stronger than most on safety structure** (no browsable pool, atomic claim, closed-loop red paging, protected speak-up) and **weaker on the operational layer** that PagerDuty-class tools and hospital paging take as table stakes: delivery receipts, heartbeats, an "expired" alarm, fire drills, capacity gating, structured audit with a second reviewer.

---

## 2. Function status (condensed)

| Area | Status | Main gap |
|---|---|---|
| S16 nine task types, classes, state machine, red never windowed (INV-05), class-3 promotion | Built | Producers missing for `titration_signoff` and `symptom_review`; all values `proposed`; `adherence_follow_up` unconfirmed |
| S16 lead window | Built, wrong defaults | Window equals due for 3 types (D1) |
| S16 escalation | Partial | Silent (D2); no "nobody online" trigger; `escalated` never returns to open |
| S16 cancel by clinical lead | Built, unsafe | Claimed-task lockout (D3) |
| S17 atomic claim, 50-session race, hand-back, timeouts, reliability | Built | Edge functions unused and untested; no Playwright queue flow; unit model is a parallel copy of SQL |
| S17 completion | Weak | Any non-empty note closes and pays any type (D4) |
| S17 clinician screen | Partial | Closed-queue reason, offered tasks, escalated work, cooling-off feedback not shown |
| S18 availability, rota, swaps, gaps, fatigue | Built | Fatigue numbers unreviewed; readiness is self-attested; docs claim auto-confirm that does not exist |
| S18 lead assignment, reassignment, `order.paid` producer | Built | Async only (nightly reconcile is the backstop); conflicts only if declared |
| S18 capacity and cover gates | Exposed, wired nowhere | `on_call_cover_ok` enforced nowhere |
| S19 page lifecycle, ack, 5/10-minute timers, level 2, INV-12 at ack | Built | Delivery layer (section 3) |
| S19 in-console alarm | Built, web only | No clinician mobile surface; tone needs a click; tab must be visible |
| S20 audit sampling, scoring, immutability, first-20, hand-back review | Built (DB) | No clinical content in audit; predictable draw; unused RPCs have no UI; follow-up note overwritable; hand-back review has no retry |
| S20 speak-up | Built (DB) | Admin-role reader allowed; no reader screen; CMO route missing |
| S20 expiry removal | Built | ~6 hour window; rota-only clinicians outside the nightly net; missing date means eligible forever |
| Group indemnity, clinician self-view of audits and reliability, workload dashboard, published response times | Missing or partial | Not built |

---

## 3. Defect register

### S16/S17 (queue)
| ID | Sev | Defect |
|---|---|---|
| D1 | High | Offer window = due for symptom_review, async_question (1440/1440) and titration_signoff (2880/2880). Offer escalates instead of returning to the pool; escalated work claimable only by on-call staff |
| D2 | High | `clinical_task.escalated` has no subscriber. Nobody is told |
| D3 | High | `cancel_clinical_task` on a claimed task leaves the claim row live; `queue_next` keeps returning the cancelled task; expiry sweep rolls back and raises a sev1 each run. Clinician with cap 1 is stuck until SQL fixes it. Untested |
| D4 | Med | `queue_complete` has no per-type gate. Critical result, titration, red unacknowledged and pharmacy flag can close and pay with no outcome |
| D5 | Med | Dead-lettered non-red `triage.graded` raises no incident (amber task can vanish) |
| D6 | Med | pg_cron is a single dependency; no heartbeat for `sweep-clinical-tasks` or `expire-task-claims` |
| D7 | Med | `needs_information` and `technical_problem` hand-backs can be re-offered to the same clinician; single eligible clinician leaves tasks stuck |
| D8 | Low | `queue_next(p_types)` lets a clinician choose task types, contrary to spec 7.6 item 4 |
| D9 | Low | Duplicate merge tightens `due_at` but not the offer window |
| D10 | Low | `queue_complete` does not check claim expiry |

### S18/S19 (rota and paging)
| ID | Sev | Defect |
|---|---|---|
| P1 | Critical | Page email never delivers (also S18 patient notices and S15 credential notices) |
| P2 | Critical | Page push not sent promptly; 5-minute sender cron equals the backup timer; first bus hop is non-urgent |
| P3 | Critical | Older critical-alert engine picks up page rows; failed push to failed email to SMS; re-notifies after ack |
| P4 | High | Relative or conflicted clinician can be paged, ack and gain chart access (INV-12). `page_recipient` has no conflict check |
| P5 | High | Older paths page every `role=clinician` in parallel; only BP creates a page |
| P6 | Med | No per-patient merge of repeat pages |
| P7 | Med | `acknowledge_page` does not check the acker is still eligible |
| P8 | High | Two async hops, retry ceiling about 31 minutes, `PROCESS_EVENTS_SECRET` unset returns 503. No reconciler for red triage events with no page |
| P9 | Low | Readiness is self-attested; push and email existence not checked |

### S20 (quality and safety)
| ID | Sev | Defect |
|---|---|---|
| Q1 | High | Audit case file has no clinical content; submit does not require opening it |
| Q2 | High | Backup safety-concern reader can be an admin-role account; no reader UI; no CMO-concern route |
| Q3 | Med | Audit draw is a public deterministic hash; no stratification; floor depends on a first-week sweep with no catch-up |
| Q4 | Med | `quality_config` has no immutability trigger; in-place edit would silently rescore open audits; not covered by the governed-config activation guard |
| Q5 | Med | `clinical_operations_enabled` does not gate queue, claims or paging |
| Q6 | Med | Rota-only clinicians outside S20's nightly selector; about 6 hours of exposure on the expiry day; missing licence date means eligible |
| Q7 | Low | `close_audit_followup` overwritable; hand-back review has no retry; no UI for `request`, `reassign`, `extend_tier1_audits`, `tier1_audit_progress`; clinician cannot see own audit results or reliability |

Tests not covering these: message delivery, SMS interplay, conflicted or relative clinicians, `process-events` end to end, regrade double page, suspended acker, cancel with live claim, window equal to due, 06:00 Lagos window, concern leaks via views or exports, Playwright queue flow.

---

## 4. Competitor and guideline comparison

Public detail on queues, panel caps and rotas is thin almost everywhere. Weak points are marked.

| Capability | Leaders | Tarragon now | Class |
|---|---|---|---|
| Pull "next task", no browsing, skills routing, per-agent capacity | Zendesk-style routing [V]; Epic pool inbox allows cherry-picking [I] (avoid) | Built | Table stakes, met |
| Claim lease with timeout and auto-return | Common | Built | Met |
| Structured hand-back with reason | Common | Built | Met |
| Lead or primary clinician with panel cap | Omada (coach + clinician), Virta team leads [V]; continuity linked to lower mortality (BMJ Open 2018, 18 of 22 studies) [I] | Built, cap 60 PROPOSED | Met; cap unproven [U] |
| Intake gated by clinician capacity | Babylon / GP at Hand lesson: growth outran capped revenue, lost money [I] | Exposed, wired nowhere | **Gap** |
| Surge mode (OPEL-style) | NHS 111 [I] | Missing | **Gap** |
| Separate urgent lane | Livongo 3-minute outreach [V]; Jacaranda 7% urgent straight to nurse queue [I] | Red is a page, not a task | Met by design |
| Acknowledge timeout, repeat, backup, "expired" state | PagerDuty, Opsgenie, incident.io [V] | Timers built; no "expired" alarm | **Gap** |
| Per-channel delivered receipt with early advance | Hospital platforms [V]; PagerDuty lacks it | Missing | **Gap** (FCM gives no receipt [I]) |
| Heartbeat for engine and devices | Opsgenie, others [V] | Missing | **Gap** |
| Phone-call fallback when app fails | TigerConnect, Spok, Vocera, Epic sites [V/I] | In-console alarm only; SMS barred | Adapt: human ops call |
| DND bypass | PagerDuty Android setting; iOS Critical Alerts needs medical entitlement [V] | Missing | **Gap** |
| Fire drills with measured ack time | Common practice, rarely public | Missing | Differentiator |
| Time standards | Manchester Triage 0/10/60/120/240 min; NEWS2 5+ urgent, 7+ emergency; NHS Cat 1 mean 7 min; NHS 111 callback 20 min [I] | 5/10 min page timers | Within benchmarks |
| Closed-loop critical result | Joint Commission NPSG.02.03.01 (organisation sets timeframe, measures it) [I] | Page ack exists; result-contact SLA separate | Met in design, completion not gated (D4) |
| Alarm fatigue control | Joint Commission NPSG.06.01.01 [I] | Tiered alert chosen | Met by decision |
| Peer review sample | Teladoc 10% [V]; Amwell peer review and scorecards [V] | 10% + all red + all titration | Met |
| Structured audit form | NHS Structured Judgement Review (phases, score, avoidability) [I] | Form built, no clinical content | **Gap** |
| First-N audits | Joint Commission OPPE/FPPE [I] | First 20 built | Met |
| Just Culture before scoring | NHS Just Culture, PSIRF [I] | Score is tie-break only | Met in design |
| AI scribe note audit | One study 31% hallucination vs 20% human, yardstick disputed [I] | Missing | **Gap** (set at 20%) |
| Protected speak-up with detriment follow-up | NHS Freedom to Speak Up [I]; Babylon lesson [I]; Nigeria has no comprehensive whistleblower law [I] | RLS built; admin reader possible | **Gap** |
| Continuous licence monitoring and auto-removal | Medallion, Verifiable, Nursys [V] | Daily sweep + removal | Met; no Nigerian primary-source feed [U] |
| RPM alert funnel metrics | Cadence: ~5,000 alert encounters per 10,000 patients per month, under 200 to physician, ~40 to ED [V] | `queue_health` only | Differentiator to add |
| Nurse tier under doctors | Babyl (44% of consults by triage nurses) [I] | Not allowed (F-05) | Avoid |
| Per-task pay with no timing guard | Hims & Hers async case claims 89 seconds of clinician time per visit [V] | S30 fee ledger inert | Add timing and second-review guard |
| WhatsApp or SMS creating tasks, paging by SMS | Common elsewhere | Barred (F-02, now policy) | Avoid |

Nigeria specifics: Tecno and Infinix handsets can block push with screen off unless battery settings are changed [I/U]; FCM high-priority has a quota [I]; grid collapses in January 2026 [I]; MDCN annual licence assumed to run to 31 December [I, snippet only]; no Nigerian telemedicine statute, NDPA 2023 applies [I].

---

## 5. CMO decisions recorded (2026-10-07)

These are the selections made in the decision popups. **None has been signed in the system.** Signing is the CMO's own act in `/clinician/clinical-signoff`. The agent has not signed, changed live config, applied a migration or edited a protocol.

| # | Decision | Selected | Guideline or evidence basis |
|---|---|---|---|
| 1 | Offer window (D1) | Cap at 50% of due; lapsed offer returns to pool; escalated non-red tasks claimable by any eligible clinician; red unchanged | Joint Commission NPSG.02.03.01; Manchester Triage / NHS 111 time-to-first-contact; BMJ Open 2018 continuity (lead still gets first refusal) |
| 2 | Escalation alert (D2) | Tiered: classes 1 to 2 alert CMO by in-app, push, email at once; classes 3 to 9 in-app plus daily digest | NPSG.02.03.01 closed loop; NPSG.06.01.01 alarm fatigue; NEWS2 |
| 3 | Completion (D4) | Structured outcome per type, system-checked | NPSG.02.03.01; NICE NG136 [verify]; WHO 2021 hypertension guideline [verify]; S20 audit needs recorded decisions |
| 4 | `queue.claims` | Sign with 2 changes: exclude conflict_of_interest and technical_problem from the 3-in-7-days flag; score visible to the clinician, tie-break only, never pay or removal without CMO review | NHS Just Culture / PSIRF; Joint Commission OPPE/FPPE |
| 5 | Audit review (Q1) | Reviewer reads record through audited read; must open before submit; second independent reviewer on any critical miss or unsafe score; clinician can reply | Joint Commission OPPE/FPPE; NHS SJR pattern; Teladoc and Amwell peer review [V] |
| 6 | Sampling (Q3) | Secret server-side seed, stratified by clinician, floor kept; 100% red and titration; first 20 per new clinician; AI-scribe notes 20% scored for omission and invented content | OPPE; published AI-note study [I]; Teladoc 10% [V] |
| 7 | Speak-up (Q2) | No admin-role readers; named clinician or external independent person; CMO concerns go only to the independent reader; reader screen; optional anonymous intake; detriment check-ins at 30 and 90 days; aggregate-only board report | NHS Freedom to Speak Up; Babylon lesson; Nigeria no whistleblower law [I] |
| 8 | Licences (Q6) | Notices at 90/30/7/0 days; proof-of-renewal deadline 15 December; rota excludes anyone whose licence ends before shift start; missing date ineligible after onboarding; grace 1 to 14 days, CMO only, logged; record evidence source, checker, time | MDCN annual licence [I, verify register and date rules with MDCN]; continuous-monitoring practice [I] |
| 9 | Page delivery (P1, P2) | Release blocker: immediate push; email address resolved and delivery proven by test; per-channel delivered-ack, advance early after 60 to 90 seconds; heartbeats for engine and each on-call device; "expired" alarm to CMO and an ops person. Timers stay 5 and 10 minutes | NPSG.02.03.01; Manchester Triage orange 10 min; NEWS2; incident.io and Opsgenie design [V]; FCM no receipt [I] |
| 10 | SMS (P3) | No SMS for pages. Block the SMS rung. Final fallback is in-console alarm plus a named ops person phoning on-call and CMO. Request iOS Critical Alerts (medical use) and build an Android reliability kit (alarm channel, full-screen alarm, Tecno/Infinix battery onboarding, weekly self-test) | SMS filtering in Nigeria [I]; hospital phone fallback [V/I]; NPSG.06.01.01 |
| 11 | Red pathway (P4, P5, P8) | Fix in order: (1) reconciler within 60 seconds for any red triage event with no page; (2) conflict and self exclusion for paging and chart access, fall to backup; (3) retire parallel older paging, extend pages to SpO2, pulse, temperature, glucose and symptom red flags. Step 3 behind a flag with CMO-signed test and rollback | NEWS2 and Manchester Triage (any red physiological trigger, not BP only); NPSG.02.03.01; NPSG.06.01.01 |
| 12 | Capacity (S18) | Intake gate tied to lead headroom, rota coverage (primary and backup every hour) and oldest-task age; CMO override with reason; lead cap starts at **40** for the pilot (a conservative guess, panel evidence is [U]); CMO surge mode (pause intake, widen eligibility, lengthen routine times, page backup), expiring and recorded; wire `on_call_cover_ok` into checkout | Babylon / GP at Hand [I]; NHS 111 OPEL [I] |
| 13 | Pause guard (Q5) | Pause stops new enrolments, sales, bookings, non-urgent offers; never red paging, emergency guidance, on-call or claimed work; CMO pauses alone; admin can only request and CMO must confirm in time or it lapses; logged and expiring | INV-05, INV-06; Joint Commission; NHS OPEL |
| 14 | Fatigue (OQ-128) | Hard 11-hour rest in 24 hours for on-call and queue after overnight-page shifts; cover offer after 2 or more overnight pages with fitness confirmation; only CMO overrides with written reason | EU Working Time Directive, NHS junior doctor rest rules [I]; Nigerian hours rules [U], confirm MDCN/NARD [verify] |
| 15 | Readiness and drills (P9) | On-call schedulable only with valid licence and indemnity, working push token, verified email, test page acknowledged in last 7 days, battery check done; monthly unannounced fire drill; report p50 and p95 acknowledge time by clinician, hour, device against target (proposed: 90% within 5 minutes) | PagerDuty/Opsgenie testing practice [V]; Nigeria device reliability [I]; NPSG measurement duty |
| 16 | Config sign-off | Agent drafts unsigned v2 of `queue.claims`, `queue.task_types`, `queue.rules`, `queue.sla_warning`, `paging.rules`, `lead.rules`, `quality.audit` plus a one-page pack; **CMO signs in the console**. New version, never an edit; add immutability trigger to `quality_config` | CMO sign-off rule; NPSG.02.03.01 (organisation defines timeframes) |

Items needing outside confirmation before signing: MDCN licence cycle and register lookup (mdcn.gov.ng blocked during research), Nigerian doctors' hours rules, NICE NG136 and WHO 2021 clause references, Federal Ministry of Health hypertension protocol alignment, Apple Critical Alerts entitlement, who the independent guardian is.

---

## 6. Build plan

Principles: fix delivery and safety before features; ship code before schema changes that remove things; every fix gets a failing-first proof registered in `ci.manifest` with a sabotage step; every change touching RLS or red paths gets `/code-review high` and the paths named; values are PROPOSED config, never hard-coded; no migration applied without a live `list_migrations` check and a real timestamp.

### Stage 0 (days, no decisions needed)
| Id | Work | Done when |
|---|---|---|
| W0.1 | Fix D3: `cancel_clinical_task` ends the live claim; `queue_next` ignores non-claimed tasks; recovery for already-stuck clinicians | Failing-first proof for cancel with a live claim; clinician with cap 1 is not stuck |
| W0.2 | Check production state: is a `bp_care_triage` rule set approved; is `PROCESS_EVENTS_SECRET` set; are cron jobs running; was the S31 migration applied | Written verification, with the queries used |
| W0.3 | Correct stale docs: auto-confirm claim, `order.paid` producer, race scripts "not run", duplicate S20 progress entries and OQ numbers | Docs match code |

### Stage 1: the pager (P0, release blocker)
| Id | Work | Acceptance |
|---|---|---|
| W1.1 | Email address resolution for page, patient-notice and credential email (P1) | Test sends and asserts delivery, not row counts |
| W1.2 | Immediate page push; urgent first hop for `observation.recorded` (P2) | Median page-to-push under 5 seconds in test |
| W1.3 | Block SMS rung for page notices; stop re-notify after ack (P3) | Proof that no SMS row is created for a page |
| W1.4 | Per-channel delivered-ack from app; early advance at 60 to 90 seconds; "expired" state with alarm to CMO and ops | Race and timer tests; sabotage removes the early advance and must fail |
| W1.5 | Heartbeats: paging engine and each on-call device; alert when nobody reachable is on rota | Dead-man test |
| W1.6 | Reconciler for red triage events with no page, 60 seconds (P8) | Kill `process-events`, a red BP still gets a page |
| W1.7 | Conflict and self exclusion for paging and chart access; acker eligibility; per-patient merge (P4, P6, P7) | Relative on call is skipped; suspended acker refused |

### Stage 2: task layer
| Id | Work |
|---|---|
| W2.1 | Offer window cap at 50% of due; escalated non-red tasks claimable by any eligible clinician (D1, D9) |
| W2.2 | Subscriber for `clinical_task.escalated` with tiered alert; escalated tasks visible in console (D2) |
| W2.3 | Per-type structured outcomes and checks on `queue_complete`; claim-expiry check (D4, D10) |
| W2.4 | Exclude same clinician for `needs_information` re-offer; stuck-task rule for single eligible clinician (D7); remove per-call `p_types` or bind it to declared competencies (D8) |
| W2.5 | Incident on dead-lettered non-red `triage.graded` (D5); watchdog for `sweep-clinical-tasks` and `expire-task-claims`, `queue_health` alert (D6) |
| W2.6 | Clinician queue screen: closed-queue reason, offered tasks with window end, escalated work, cooling-off feedback, own reliability and audit results |
| W2.7 | Producers for `titration_signoff` and `symptom_review`; pass `p_extra_competencies` for prescriptions |

### Stage 3: red pathway completion (behind a flag)
| Id | Work |
|---|---|
| W3.1 | Retire older parallel clinician paging paths (symptom, BP, vitals handlers) |
| W3.2 | Page creation for SpO2, pulse, temperature, glucose and symptom red flags |
| W3.3 | CMO-signed test pack and rollback; `/code-review ultra` (touches paging, `is_org_staff`-adjacent access) |

### Stage 4: quality and safety v2
| Id | Work |
|---|---|
| W4.1 | Audit with clinical content via audited read, must-open gate, second reviewer on critical miss, clinician reply (Q1) |
| W4.2 | Secret-seed stratified sampling; catch-up for the monthly floor; AI-scribe notes at 20% (Q3) |
| W4.3 | UI for request, reassign, follow-up close (append-only), tier-1 progress and extend; hand-back review retry (Q7) |
| W4.4 | `quality_config` immutability trigger; include in governed-config activation guard (Q4) |
| W4.5 | Speak-up v2: no admin readers, reader screen, anonymous intake, CMO route, 30/90-day check-ins, aggregate board report (Q2) |
| W4.6 | Licence v2: 90/30/7/0 notices, 15 December proof deadline, rota exclusion by shift start, missing date ineligible, rota-only clinicians in the nightly net (Q6) |

### Stage 5: capacity, cover and readiness
| Id | Work |
|---|---|
| W5.1 | Intake gate (lead headroom, rota coverage, oldest task age) wired to checkout through `on_call_cover_ok`; cap 40; CMO override |
| W5.2 | Surge mode; pause guard scope per decision 13 |
| W5.3 | Hard rest rule and cover offer (decision 14) |
| W5.4 | Readiness: token, verified email, 7-day test page; monthly fire drills; p50/p95 report |
| W5.5 | Android reliability kit; iOS Critical Alerts entitlement request; clinician mobile page surface (currently web only) |
| W5.6 | Operational resilience for the ops desk: backup power and second internet link (Nigeria grid events) |

### Stage 6: evidence and sign-off
| Id | Work |
|---|---|
| W6.1 | Draft unsigned v2 configs and the one-page CMO sign-off pack (decision 16) |
| W6.2 | Playwright flow for Next task, hand-back, timeout, cancel; edge-function tests or removal of unused edge functions |
| W6.3 | Funnel metrics: alerts, pages, doctor reviews, emergency referrals as a ratio; continuity share (tasks by lead) with null-gated attribution |
| W6.4 | Update `docs/BUILD-PROGRESS.md`, `OPEN-QUESTIONS.md` (new OQs for each decision above), `DECISIONS.md` |

### Dependencies and order
W0 first. Stage 1 blocks any real red-event go-live. Stage 2 can run alongside Stage 1 on different files. Stage 3 waits for Stage 1. Stage 4 independent. Stage 5 needs Stage 1 heartbeats. Stage 6 last, but W6.1 can start as soon as decisions are fixed. Stage 1 migration is applied only after `list_migrations` shows no unfamiliar recent live migration.

### Not in scope
Nurse tier (F-05), WhatsApp or SMS paging (F-02), capitation (I8), a browsable shared pool, group indemnity (spec: "when available"), a Pidgin layer (D-14).

---

## 7. Sign-off

Reviewed and decisions confirmed as recorded in section 5:

CMO name: ____________________  Signature: ____________________  Date: ____________

Configs signed in the console on: ____________  (each config version listed in the v2 pack)
