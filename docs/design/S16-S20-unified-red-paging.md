# S19d: unified red-event paging (behind a flag, OFF)

Branch `s16-s20/unified-red-paging`. Plan: `docs/plans/S16-S20-review-and-build-plan.md` Stage 3 (W3.1 to W3.3), defects P5, CMO decision 11 part 3. Migration `20261015080431_s19d_unified_red_event_paging_flag_off.sql`. Proof `packages/db/tests/s19d_unified_red_paging.sql`. CMO test pack `docs/plans/S16-S20-unified-red-paging-test-pack.md`.

**Default behaviour is unchanged.** The flag ships OFF and unsigned. With it off, every legacy handler runs the same code path it ran before (the only edit to a handler is an extra boolean that is false). Nothing was signed, activated or switched on.

## A. Inventory: every path that notifies clinicians of a red, emergency or critical event today

Definitions were read from this repo and from the live project (`koiplnmbgnqnbywhpjlf`, SELECT only, 2026-10-15, head `20261015013620`). The md5 of every function named below equals the md5 of its definition on a fresh replay of this repo, so there is no drift to carry.

"Legacy broadcast" means `private.enqueue_critical_notification(...)` to every `profiles` row with `role = 'clinician'` in the organisation: one critical notification each, first hop from `escalation_slas` for the pathway (push, then email, then sms by the older escalation engine), no named owner, no acknowledgement, no backup, no timers. "Free" is the two-tier rule: `private.patient_may_page_doctor` false.

| # | Source (function, trigger) | Fires on | Who is notified, channel | `pages` row? | Free excluded? | Shadow-safe? | This change |
|---|---|---|---|---|---|---|---|
| 1 | Triage engine page: `emit_bp_observation_recorded` on `vitals_readings` (BP only), `process-events` `triage.grade_observation`, `record_triage_result`, paging handler, `public.create_red_page(triage_event)` | A red grade from `bp_care_triage` (v3 approved, 36 events live) | Rota primary, then backup at 5 min, lead at 10 min (`on_call_page`, push, in-app, email; no SMS). Delivered-ack early advance, merge window, conflict exclusion, expiry, reconciler (`reconcile_red_pages`) | Yes | Yes (`record_free_red_event`: guidance record, no page) | Yes (`shadow` events and drafts never page) | The ladder everything else is moved onto. Not edited |
| 2 | BP legacy: `handle_bp_reading_red_flag` on `vitals_readings` (`vitals_readings_bp_red_flag`) | BP red, or crisis range to `emergency_events(bp_reading)` | Legacy broadcast, pathway `bp_vitals_red_flag` | No | Yes (paid-plan gate; Free gets a self-care suggestion) | n/a | Not touched. Blood pressure already has the page (row 1). Suppressing its broadcast would need the async triage page to be confirmed first: left for a later step |
| 3 | `handle_spo2_reading_red_flag` (`vitals_readings_spo2_red_flag`) | `classify_spo2_level`: red (90 to 92), amber (93 to 94), emergency (89 and below, via `emergency_events`) | Legacy broadcast, pathway `spo2_vitals_red_flag`, only when a new alert opens or rises. Amber too | No | Yes | n/a | **Red unified** behind the flag. Amber unchanged. Emergency goes through row 9 |
| 4 | `handle_temperature_reading_red_flag` (`vitals_readings_temperature_red_flag`) | red 39.0 to 39.9, amber 38.0 to 38.9, emergency 40 and above or below 35 | Same as row 3, pathway `temperature_vitals_red_flag` | No | Yes | n/a | **Red unified**. Amber unchanged. Emergency via row 9 |
| 5 | `handle_pulse_reading_red_flag` (`vitals_readings_pulse_red_flag`) | red 36 to 39 or 121 to 149, amber 40 to 49 or 101 to 120, emergency 35 and below or 150 and above | Same as row 3, pathway `pulse_vitals_red_flag` | No | Yes | n/a | **Red unified**. Amber unchanged. Emergency via row 9 |
| 6 | Glucose. (a) r2 triage wiring: `emit_glucose_observation_recorded` and `emit_glucose_ketone_regrade`, `triage.grade_observation`, `record_glucose_triage_result`. (b) `handle_glucose_emergency_backstop` to `raise_glucose_backstop_emergency` | (a) a red grade from `glucose_care_triage` (v1 is a draft: every event is shadow today). (b) glucose under 3.0, or suspected DKA | (a) once the CMO signs the rule set, the same ladder as row 1, with no change here. (b) an `emergency_events` row (row 9) | (a) yes, once approved | (a) yes | (a) yes | Nothing to add for (a): it is already on the ladder. (b) `glucose_red_flag` is deliberately left on its own path (see row 9) so one reading never rings twice once the glucose rule set is signed |
| 7 | `handle_symptom_red_flag` (`symptoms_red_flag_check`, BEFORE INSERT on `symptoms`) | severity 8 and above, or 6 and above for the low-threshold types, or the paediatric types; severity 5 to 7 is a review (amber) | Legacy broadcast, pathway `symptom_red_flag`, for both red and review | No | Yes | n/a | **Red-flag branch unified**. The severity 5 review is unchanged |
| 8 | `handle_symptom_triage_assessment` (`symptom_triage_assessments_escalate`) | `emergency` to an `emergency_events(symptom_triage)` row; `urgent` to a `clinician_alerts` row | emergency: row 9. urgent: alert only, no broadcast | No | Yes | n/a | Emergency covered by row 9. Urgent has no broadcast to retire |
| 9 | `handle_emergency_event` (`emergency_events_raise_alert`, BEFORE INSERT on `emergency_events`) | Any emergency event: bp_reading, spo2/temperature/pulse/glucose red flag, symptom_log, symptom_triage, danger_symptom_checklist, ai_coach, exposure_report, support_ticket_intake, pregnancy checklist, mental_health_screen, intake_screen, and the Free record (`triage_red`) | Alert (level emergency, escalation 4) plus legacy broadcast, template `emergency_event_clinician_alert`. Patient side: the acknowledge-gated guidance, emergency-contact notice, `red_alert_watch` | No | Yes (no alert, no broadcast; guidance and self-care suggestion) | n/a | **Unified for an allow-list of sources only:** `spo2_red_flag`, `temperature_red_flag`, `pulse_red_flag`, `symptom_log`, `symptom_triage`, `danger_symptom_checklist`. Left on the old path: `bp_reading` and `glucose_red_flag` (engine page, now or once signed: a second page would ring twice), `triage_red` (Free record), `mental_health_screen`, `intake_screen` (row 10), and `pregnancy_symptom_checklist`, `exposure_report`, `support_ticket_intake`, `ai_coach`, `symptom_to_test_checker` (reproductive, exposure and free-text sources: a page also reaches the Care Circle and widens who learns of it, a CMO and DPO decision). A new source is old-path until someone adds it on purpose |
| 10 | Mental health crisis: `handle_mental_health_crisis`, `raise_crisis_follow_up` | A crisis answer on the mental health screen | Its own pager: `on_call_page` through `crisis_notify` to the rota primary, `on_call_escalation` to leadership, a priority task, an incident when nobody is on cover. And the `emergency_events` broadcast (row 9) | No (its own notice) | Yes (no task, no page on Free) | n/a | **Not unified.** It already has a governed pager and task; a `pages` row would ring the primary twice. A crisis is not touched at all |
| 11 | Heart-failure weight gain: `handle_heart_failure_weight_gain_red_flag` | More than 2 kg in 3 days for an enrolled patient | A `clinician_alerts` row (urgent, 4 hour SLA). No notification at all | No | Yes (Free notice) | n/a | **Not unified**: not an immediate red event, no broadcast to retire. Flagged in the plan; revisit if the CMO wants it paged |
| 12 | Lifestyle red flag: `handle_lpe_red_flag` | Weight-loss programme safety rules | A `clinician_alerts` row. No notification | No | n/a | n/a | Not touched |
| 13 | **Abnormal screening result, Category 2 to 1** (`abnormal_screening_result_upgrade`) | An abnormal screening result | Alert on the governed ladder, immediate | No | n/a | n/a | **MUST NOT be touched (CLAUDE.md). Not touched.** The migration has a Jest check that it never names it |
| 14 | `red_alert_watch` (`red_watch_emergency_trigger`, `red_watch_triage_trigger`) | An emergency event or a non-shadow red triage event | Tells the patient, then opens a call-the-patient outreach task if unconfirmed | No | Yes | Yes | Independent of paging. The only edit: the watch trigger skips the new unified triage rows, so the patient is not told twice (the emergency event opens its own watch) |
| 15 | `pages_notify_circle` on `pages` | A root page row | Care Circle members who hold the `red_alerts` permission get an in-app and push check-in notice | n/a | n/a | n/a | **Patched so a unified page does NOT tell the Care Circle** (a blood pressure page still does). Widening that reach is for the CMO and DPO; the code review found it would otherwise disclose reproductive and exposure events |

Counts before this change (live): 0 unified events. Pages that exist are the BP ones only.

### What was wrong (P5)

Rows 3, 4, 5, 7 and 9 never created a page. They broadcast to every clinician in the organisation at once: no one owns the event, there is no acknowledgement, no backup, no expiry alarm, no conflict exclusion (a relative can be among the recipients), no delivered receipt, and the older engine can still climb to SMS for them (S19c only closed that for page notices). Only blood pressure had INV-05 (a red event never waits).

## B. Design

One governed ladder: `public.create_red_page` (S19, hardened by S19c). A page needs a `triage_events` row (`pages.triage_event_id` is not null and the whole ladder is keyed on it), so each non-BP source records one **unified triage event** and calls `create_red_page` on it. That reuses, unchanged: the Free-patient rule, the 30 minute merge window (one family per patient), conflict and self exclusion, the no-cover path (leadership, task, incident), the 5 and 10 minute timers, the delivered-ack early advance, expiry, the reconciler, chart access only after acknowledging (INV-12), no SMS for pages.

The unified event:

- `rule_set_code = 'unified_red_paging'`, no rule set row, `rule_set_status = 'approved'`, `shadow = false`, `grade = 'red'`, `actions = page_on_call`, `trigger_type` observation / symptom_report / result, `trigger_id` = the reading, symptom or emergency event id, `basis` = the source. "Approved" here means the deterministic threshold function already in force (`classify_*`), not a rule set. A check constraint allows exactly this shape and nothing else without a rule set (non-shadow, that code, approved, red). A unique index makes it once per source event.
- `context` carries ids only (source, table, id). No reading value (INV-07: the page notice is a fixed neutral template; the clinician reaches the facts after acknowledging).
- No `triage.graded` event is emitted, so no clinical task is created by the task subscriber. The only task is the existing class 1 task for an unacknowledged page.

The entry point `private.unified_red_page_covers(source, org, patient, trigger_type, ref_table, ref_id)` returns true only when the legacy broadcast for that event may be skipped:

1. The flag for that source is on (`unified_red_paging_config`, active and signed row; a missing, unsigned or unreadable row means OFF).
2. The patient may be paged (not Free). A Free patient returns false and the legacy handler does what it did: guidance, self-care suggestion, no alert.
3. A page was created or joined (`create_red_page` returned a page), and that page is not `no_cover`, and `suppress_legacy_clinician_notice` is 1.

Any error is caught inside a sub-block (its work rolls back), audited as `unified_red_page.error` with an ops incident, and the function returns false, so the legacy broadcast runs. A no-cover page returns false too: leadership is alerted by the ladder and the old broadcast still reaches clinicians, because a red event must never end with no clinician told.

Where the hook sits (each handler is PATCHED IN PLACE from its current definition with an asserted, counted anchor; none is rewritten):

- SpO2, pulse, temperature: `if v_should_page and not (v_level = 'red' and covers(...)) then <legacy loop>`. It runs only when an alert was created or raised (paid plan) and only for the red level.
- Symptom: the same, with `v_is_red_flag`.
- Emergency event: one declared boolean, set right after the alert row exists (`source` in the allow-list above), and the broadcast loop gains `and not v_unified_paged`.

Unified rows must not disturb anything built on `triage_events`. Found by code review and patched in place the same way, each with a counted anchor and a proof: `record_red_care_response` (the patient's "could not get care" answer picks the newest red row; it must attach to the emergency event, which has the red-alert watch, not to a unified row, which has none), `chain_timing_rows` (three places), `triage_parity_rows` and `risk_compute` (all built on the blood pressure engine and must not move for another source), `notify_circle_red_alert` (above), and `red_watch_triage_trigger`. Symptoms and emergency events use `trigger_type = 'result'` because `('symptom_report', symptom id)` is the slot of the P6 shadow bridge row written by the symptoms AFTER trigger. The config is readable by the CMO and admins only.

Kept independent of paging (INV-06): emergency-patient guidance (the `emergency_events` row, the acknowledge-gated dialog, the emergency-contact notice, the follow-up check-in, the `red_alert_watch`), and the `clinician_alerts` row (still created: it is the work queue and the SLA record). The unified event opens no second red-alert watch.

### Flag and rollback

`unified_red_paging_config` (version, `is_active`, `rules`, `approved_at/by`, `test_pack_confirmed_at`, `switched_off_at/by`). Version 1 is seeded `is_active = false`, unsigned, PROPOSED, owner CMO, mirrored in the registry as `paging.unified_red_rules` (a Jest test fails on drift). A check constraint says a live version must be signed. Rules never change (a trigger); a different setting is a new version.

- `public.sign_unified_red_paging_config(version, test_pack_run)`: CMO only (`credential_is_cmo`), refuses without the test-pack confirmation, audited. This is the only way to switch on and nothing calls it automatically; the only caller is the CMO-gated server action behind the sign-off hub panel.
- `public.switch_off_unified_red_paging()`: CMO or an admin. Pages already open are left alone and keep escalating; only new events return to the old path.
- Per source switch (`spo2_red`, `pulse_red`, `temperature_red`, `symptom_red_flag`, `emergency_event`) and `suppress_legacy_clinician_notice` (0 = run the page AND the old broadcast side by side, a staged mode; this needs a new version).

CMO sign-off hub: a line "Unified red-event paging (off)" with the switch-on panel (two ticks: test pack run, understood), and "ON (switch off here)" with a switch-off button once live.

## C. Decisions and what was not unified

- Blood pressure legacy broadcast (row 2): kept. The BP page is made later and asynchronously by the triage engine, and its broadcast cannot be suppressed from the trigger without knowing the page exists. Retiring it needs the reconciler's confirmation path, a separate step.
- Mental health crisis (row 10): its own governed pager and task already exist; adding a `pages` row doubles the page. Left whole.
- Heart-failure weight gain and lifestyle red flags (rows 11, 12): they raise alerts but do not broadcast, so there is nothing parallel to retire. Not red-class events by the current rules.
- Amber levels (SpO2 93 to 94, temperature amber, pulse amber, symptom severity 5 to 7): not red. They keep the legacy "review needed" notice.
- Glucose red from the r2 triage: already on the ladder once `glucose_care_triage` is signed; the legacy glucose emergency (`glucose_red_flag`) stays on its own path so the same reading cannot ring twice. Retiring the glucose broadcast is a later step, after that rule set is signed and its divergence report is clean.
- Reproductive, exposure, AI coach, support-ticket and symptom-checker emergency events: left on the old path (reach and disclosure).
- Abnormal screening result (Category 2 to 1): untouched, as required.

## D. Known limits and open points

1. **Repeat readings of the same vital.** A second red SpO2 reading while the first alert is still open makes no new alert, so it makes no new page (the legacy handler only notifies when the level rises). That is the same as today. A different vital, a new red-flag symptom or an emergency event after the family was acknowledged does ring again (proved).
2. **Care Circle.** A unified page does not tell the Care Circle in this version (a blood pressure page still does). If the CMO and DPO want it, it is a separate, deliberate change per source.
2b. **Red-alert watch.** An SpO2, pulse, temperature or symptom red with no emergency event has no patient-outreach watch, before and after this change (the watch exists only for emergency events and blood pressure triage events). Not added here: it would be a new patient-facing notice.
3. **Legacy SMS.** The legacy broadcast can still climb to SMS through the older escalation engine. For an event a page covers, that broadcast no longer exists, so the SMS rung is gone for it (decision 10). For an uncovered event it remains, as today.
4. **Parallel-run mode.** `suppress_legacy_clinician_notice = 0` (a new version) would let the CMO watch pages arrive beside the old broadcast before retiring it. Not shipped as a separate version to keep one decision on the hub.
5. **Native mobile.** Pages reach the web console and web push; the mobile app does not record delivered receipts yet (S19c known limit), so those clinicians stay on the 5 and 10 minute timers.
6. **Typed client.** The new table and functions are called through a loose client (like the quality config) and are not spliced into `database.types.ts`; regenerating from production would import other branches' schema (CLAUDE.md).
