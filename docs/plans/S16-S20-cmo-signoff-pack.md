# S16-S20 CMO sign-off pack

Prepared 2026-10-15 from a read-only look at the live project `koiplnmbgnqnbywhpjlf` (SELECT only; nothing was changed, activated or signed by the author of this pack). Sources: `docs/plans/S16-S20-review-and-build-plan.md` section 5 (the CMO's 16 selections of 2026-10-07, recorded in `docs/DECISIONS.md` as S16-S20-1 to 16), the three design notes under `docs/design/S16-S20-*.md`, and the registry `packages/shared/src/proposed-config/registry.ts`.

**Signing is the CMO's own act, in the console, as a new version. Never an edit.** A signature records a decision; for the database config tables it also decides which row is in force.

## 0. Read this first

1. Items marked **needs outside confirmation** carry a `[verify]` flag from the plan: MDCN licence cycle and register lookup, Nigerian doctors' hours rules, NICE NG136 and WHO 2021 clause references, Federal Ministry of Health hypertension protocol alignment, Apple Critical Alerts entitlement, who the independent guardian is. Confirm before signing the item that cites them.
2. Today all of these counts are near zero in production: no task has yet been claimed and no real page has been sent, so no number below has been tested against real work.
3. Two of the five database configs below have **no sign-off line on the hub** (paging delivery, task layer). See section 4.

## 1. Database configs awaiting a decision (live state, 2026-10-15)

| Config | Version | Live state | Signed |
|---|---|---|---|
| `queue_task_layer_config` | v1 | **active** | no (`approved_*` does not exist on this table; the registry entry `queue.task_layer` v1 is `proposed`, no sign-off row) |
| `paging_delivery_config` | v1 | **active**, objective readiness OFF | no |
| `paging_delivery_config` | v2 | inactive; identical to v1 except `objective_readiness_required` = 1 | no |
| `quality_config` | v1 | inactive | no |
| `quality_config` | v2 | **active** (the base from before quality v2) | no |
| `quality_config` | v3 | inactive (the quality v2 build: second review, secret seed sampling, speak-up check-ins) | no |
| `credentialing_config` | v1, v2 | inactive | no |
| `credentialing_config` | v3 | **active** | no |
| `credentialing_config` | v4 | inactive (adds the 15 December proof deadline, notices 90/30/7/0, evidence sources, **missing licence date ineligible**) | no |

Note: `docs/design/S16-S20-quality-v2.md` calls the new rows "v2" and "v3"; the live version numbers are **quality_config v3** and **credentialing_config v4**.

### 1.1 `queue_task_layer_config` v1 (decisions S16-S20-1, 2, 3)

- **What it sets**: offer window = the shorter of the task type's window and 0.5 x the task's own due time; escalated non-red tasks claimable by any eligible clinician (red keeps the on-call rule); extra hand-back reasons that bar the same clinician from the same task (`needs_information`, `technical_problem`); escalation alert (classes 1 to 2 in-app + push + email at once, 3 to 9 in-app plus a daily digest at 07:00 Lagos); the coded outcomes each task type may close with, three dated contact attempts for a critical result; job and class warning thresholds (60 to 2160 minutes).
- **Why**: Joint Commission NPSG.02.03.01, NPSG.06.01.01, Manchester Triage, NEWS2, BMJ Open 2018 continuity; NICE NG136 and WHO 2021 hypertension [verify].
- **Changed since the last signature**: this is the first signature of this table. The behaviour is already live under the unsigned v1 (the same pattern S16 and S17 used for their first seeds).
- **When signed**: a signed record exists that the CMO accepted the numbers; a later change is a new version (a new row and a new registry entry), never an edit. Nothing switches behaviour, because v1 is already active. If the CMO wants different numbers, ask for a v2 instead of signing.
- **Console path**: no hub line and no signing function exists. Recommendation (OQ-451): add a hub line and a signing function. Until then, record the decision in `docs/DECISIONS.md` (done: S16-S20-1 to 3) and the registry entry `queue.task_layer` can be confirmed as a proposed value in `/clinician/go-live` once it is listed there.

### 1.2 `paging_delivery_config` v1 active, v2 inactive (decisions S16-S20-9, 10, 11 steps 1 and 2, 15)

- **What it sets**: early advance to the backup at 90 seconds (180 for a route not confirmed), a 30 minute merge window for repeat red events, a 7 day test-page window, a 120 second stale-heartbeat limit, a reconciler that pages an unpaged red event after 60 seconds (4 hour look-back, 20 per pass), a safe blood-pressure band 100-139 / 60-89 for the urgent first hop. The 5 and 10 minute timers are `paging.rules` v1 (already signed 2026-10-07) and are unchanged.
- **v2**: same numbers, `objective_readiness_required` = 1. When v2 is made active, an on-call clinician can be added to or swapped onto the rota only with a working push subscription, a verified email, a test page acknowledged in the last 7 days, a valid licence and indemnity, and the checklist. Existing shifts are not cancelled. Swaps are never blocked.
- **When activated**: from then on rota changes need the readiness items above; a clinician who is not ready cannot be scheduled on call. Reversible by activating a later version with readiness 0.
- **Console path**: none on the hub (OQ-451). Today this is a database owner's SQL, which the pre-sign checklist below must cover. Do not activate v2 until section 3 is done.

### 1.3 `quality_config` v3 (decisions S16-S20-5, 6, 7 and the guard of 16)

- **What changes from v2**: audit form v2 (phase comments, avoidability rating, scribe items with `no_invented_content` as a critical item); stratified sampling on a secret monthly seed, with a floor catch-up (day 21) and a current-month top-up (from day 20) and a 20% rate for scribe-assisted notes (v2 had 10% random only); a second reviewer on a critical miss, with a reply limit; speak-up check-ins at 30 and 90 days, concerns about the lead routed to the independent reader, an anonymous cap of 10 a day per organisation.
- **When signed**: `sign_quality_config(3)` records the signature and makes v3 the version in force. From then a version used by an audit or signed cannot be edited or deleted. It is refused if an older version would replace a newer one.
- **Console path**: `/clinician/clinical-signoff`, line "Quality and licence rules" (key `quality_configs`), panel `quality-config-panel.tsx`, button calls `sign_quality_config` (CMO only, tick-box "understood").
- **Open points before signing**: OQ-444 (second reading final), OQ-445 (who appoints the independent reader; **needs outside confirmation**), OQ-446 (invented scribe content a critical miss), OQ-448 (check-ins after closure), OQ-450 (reviewer sees reproductive-health content). With one CMO, a critical miss waits for a second reviewer (OQ-138).

### 1.4 `credentialing_config` v4 (decision S16-S20-8)

- **What changes from v3**: notices at 90/30/7/0 days (v3: 90/30/0); a renewal cycle ending 31 December with a proof-of-renewal deadline of 15 December; a list of evidence sources (register lookup, document sighted, insurer confirmation, other); **a missing licence date makes a clinician ineligible**. Grace stays at 1 to 14 days, CMO only and logged.
- **When signed**: `sign_credentialing_config(4)` makes v4 the version in force. **It is refused while any active clinician has no licence date** (live check 2026-10-15: two active clinician records have no date, EMP-000011 (the CMO) and EMP-010492 (a test account)). After it is in force, a clinician with no date or a lapsed date cannot be rostered and is dropped from future shifts by the nightly sweep.
- **Console path**: same hub line as 1.3, panel for credentialing, button calls `sign_credentialing_config`.
- **Needs outside confirmation**: the MDCN licence cycle (annual, assumed to 31 December) and the register lookup and date rules, with MDCN.

## 2. Registry values (proposed values signed in the go-live screen)

Seven keys were named in decision S16-S20-16. Read-only state of `proposed_config_signoffs` and the registry:

| Key | Registry (code) | Signed in the database | What this pack asks |
|---|---|---|---|
| `queue.claims` | v1 proposed | v1 **confirmed 2026-10-07** | Nothing new. Decision 4's two changes (hand-backs for `conflict_of_interest` and `technical_problem` not counted) are already in v1's `exempt_reasons`. The score being visible and tie-break only is a screen rule, not a number. If the CMO wants any other number changed, ask for a v2. |
| `queue.rules` | v1 | v1 confirmed 2026-10-07 | none drafted |
| `queue.task_types` | v1, v2 | v2 confirmed 2026-10-07 | none drafted |
| `queue.sla_warning` | v1 | v1 confirmed 2026-10-07 | none drafted |
| `paging.rules` | v1 | v1 confirmed 2026-10-07 | none drafted (timers stay 5 and 10 minutes, decision 9) |
| `lead.rules` | v1 (the registry shows one entry) | **v2** confirmed 2026-10-07 | the database shows a signed version 2 while the registry file lists one entry; the mismatch should be understood before the lead cap of 40 (decision 12) is built |
| `quality.audit` | v1, v2, v3 | v1 confirmed 2026-10-07 | v2 and v3 are proposed and unsigned; v3 mirrors `quality_config` v3 (1.3) |
| `queue.task_layer` | v1 | none | the mirror of 1.1 |
| `paging.delivery_rules`, `paging.delivery_rules_v2` | v1 each | none | the mirrors of 1.2 |
| `credentialing.rules` | v1 to v4 | none | v4 mirrors 1.4 |

**The agent has not drafted new versions of the seven keys named in decision 16.** Of those, only changes needed by decisions 1 to 8 were built, inside new tables or the already-signed v1 values. Drafting v2s of `queue.rules`, `queue.sla_warning`, `lead.rules` (cap 40, fatigue) and `paging.rules` waits for the capacity, fatigue and red-pathway streams, which have not merged at the time of writing.

- **Console path**: `/clinician/go-live` (the Chief Medical Officer's go-live screen; the hub `/clinician/clinical-signoff` also confirms a proposed value when a form passes `back=hub`). A signature is a row in `proposed_config_signoffs` with the value hash.

## 3. Pre-sign checklist

Do these in order. Nothing here is done by the agent.

1. **Licence dates.** Enter the licence expiry date for every active clinician who lacks one (live: EMP-000011 and EMP-010492; the second is a test account, retire or date it). Without this `sign_credentialing_config(4)` is refused.
2. **MDCN checks.** Confirm the annual cycle, the 31 December end, the 15 December proof date and how the register is looked up (the plan could not reach mdcn.gov.ng).
3. **Deploy state.** Confirm `send-pending-notifications` and `process-events` are deployed from `main-dev` and that the sev1 incident `paging_engine_stale:process_events` (opened 2026-10-15 07:39 UTC at the merge) is closed after confirming the `process_events` heartbeat. The deployed entrypoints recorded on 2026-10-15 point at worktrees; the edge drift job should compare them with `origin/main-dev`.
4. **Named ops person.** Name the person (and a deputy) who phones the on-call clinician and the CMO when a page expires (OQ-441, decision 10). The incident currently goes to the ops incident queue and to every admin account.
5. **Test pages before readiness goes on.** Every clinician on the rota sends themselves a test page from the On call screen, sees it on their phone (push) and in the console, and acknowledges it. Keep a note of who and when. Only then activate `paging_delivery_config` v2. A clinician reachable only through the mobile app cannot pass this gate yet because the app records no delivered receipt (see the pager design note, known limits).
6. **Battery and phone settings** on each on-call phone (Tecno and Infinix handsets can block push with the screen off).
7. **A second reviewer.** With one CMO, a critical audit miss waits for a second CMO-tier reviewer. Decide who that is before signing `quality_config` v3.
8. **Independent reader.** Name the external independent person for speak-up concerns (OQ-445) before signing `quality_config` v3; the plan lists this as needing outside confirmation.
9. **Read the open questions** OQ-432 to OQ-451 (`docs/OPEN-QUESTIONS.md`) that touch what you are signing.

## 4. Which items have a hub panel

| Item | On the hub `/clinician/clinical-signoff`? | Recommendation |
|---|---|---|
| `quality_config` v3 | Yes, line "Quality and licence rules", signs through `sign_quality_config` | none |
| `credentialing_config` v4 | Yes, same line, `sign_credentialing_config` | none |
| `queue_task_layer_config` | **No** (no signing function either) | add a hub line and a signing function, then sign a v2 if numbers change (OQ-451) |
| `paging_delivery_config` v2 | **No** (activation is SQL) | add a hub line and an activation function that refuses until the test-page checklist is met (OQ-451) |
| Registry values (`queue.*`, `paging.*`, `lead.*`, `quality.audit`, `credentialing.rules`) | Confirmed in `/clinician/go-live`, not on a hub panel of their own | acceptable; the hub lists them only where a panel exists |

CLAUDE.md says anything the CMO must sign belongs on the hub. The two missing lines are therefore a standing gap, not a choice.

## 5. What each decision still needs built (so signing does not imply it)

Merged and applied: S16-S20-1, 2, 3 (task layer), 5 to 8 (quality v2), 9, 10, 11 steps 1 and 2, and the readiness gate of 15 (pager delivery). Not built, or built in a stream that had not merged on 2026-10-15: 11 step 3 (retire older paging, extend pages to SpO2, pulse, temperature, glucose and symptom red flags, behind a flag, with a CMO-signed test and rollback), 12 (intake gate, cap 40, surge mode), 13 (pause guard scope), 14 (hard rest), the fire drills and p50/p95 report of 15, the Android reliability kit and iOS Critical Alerts of 10. Signing any config above does not enable these.

## 6. Sign-off

Decisions confirmed as listed above (tick what applies, sign in the console, not here):

- [ ] `queue_task_layer_config` v1 accepted as the pilot numbers
- [ ] `paging_delivery_config` v2 activated after section 3
- [ ] `quality_config` v3 signed in the hub
- [ ] `credentialing_config` v4 signed in the hub after licence dates

CMO name: ____________________  Date: ____________
