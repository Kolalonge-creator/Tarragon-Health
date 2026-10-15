# S16-S20 Stage 5: capacity, cover, surge, fatigue and fire drills

Branch `s16-s20/capacity-cover`. Plan: `docs/plans/S16-S20-review-and-build-plan.md` Stage 5 (W5.1 to W5.5), CMO decisions 12, 13, 14, 15 (remainder). Migration `20261015075032_s16_s20_capacity_cover.sql`, proof `packages/db/tests/s16_s20_capacity_cover.sql`. English only. Nothing here signs, activates or switches anything on; the migration is applied by the merge.

## Rollout: every new gate ships OFF

| Switch | Where | Default | How the CMO turns it on |
|---|---|---|---|
| Intake gate (`gate_enforce`) | `capacity_cover_config` v1 | 0 | Sign capacity configuration v2 in the sign-off hub, and switch the go-live guard `on_call_cover_ok` on |
| Hard rest rule (`hard_rest_enforce`) | same | 0 | Same signature (v2) |
| Fire drills (`drill_enabled`) | same | 0 | Same signature (v2) |
| Pilot lead cap 40 | `lead_config` v2 | inactive, unsigned (v1 stays 60) | Sign lead configuration v2 in the sign-off hub |
| Surge mode, pause | `ops_modes` | no row exists = off | The CMO starts one on `/clinician/capacity`; it expires by itself |

v2 of the capacity configuration is the same rules as v1 with the three switches at 1 (a Jest test fails if the two differ in anything else, and if either drifts from the registry key `capacity.cover_rules` / `capacity.cover_rules_v2`). Signing is the CMO's own act (`sign_capacity_cover_config`, `sign_lead_config`, both CMO-only, audited). The sign-off hub has one new line "Capacity, rest and fire drills" with an inline panel. Nothing in this branch signs or activates a configuration.

The config table has an immutability trigger (an active or signed version cannot be edited or deleted) and the superseded-version activation guard, as `quality_config` has.

## W5.1 Intake gate

New care pack sales stop when any of three signals crosses a limit, for the real (non-test) world:

1. Lead headroom: free places across eligible leads (`private.lead_headroom`, the same population and arithmetic as `lead_capacity_status`, proved equal) below `min_lead_headroom` (3, PROPOSED).
2. Rota coverage: any hour in the next 72 hours (`rota_horizon_hours`) without a primary and a working backup (`private.rota_gaps`).
3. Oldest open task: `private.queue_class_breaches()` has a breach in a class up to `oldest_task_max_class` (5).

Wiring: a `BEFORE INSERT` trigger on `orders` (`orders_intake_gate`), not a restatement of `create_order` (which several branches replace). It asks only about an order for an item with `grants_lead`, for a beneficiary with no active lead. It raises `intake_paused` (P0001), which the checkout error mapper can show; checkout itself stays dormant behind `v5_checkout` and `checkout_enabled`, and nothing here turns either on. The guard `on_call_cover_ok` is read through `go_live_open_patient`: when the gate is enforced the guard must be on, or the gate is closed (fail closed). To stop the CMO from bricking sales by signing, `sign_capacity_cover_config` REFUSES a version with `gate_enforce = 1` while the guard is off, so the turn-on order is: fill the rota for 7 days, switch the guard on, then sign v2. The guard's `enforced_in` text now says where it is enforced.

A CMO override (`cmo_set_intake_override`, reason of at least 20 characters, at most 24 hours, one at a time, audited) reopens the guard and the three signals together (it is read before the guard, so an override cannot be shut out by the guard). It never reopens a pause or a surge. Fail safe: the gate is never asked about a patient with an active lead (existing care), an order already created and in payment is never undone, an evaluation error closes only NEW sales, and test patients are never refused by the signals. A separate job `intake-gate-watch` (own schedule, so a fault there never touches the sweep or the CMO's buttons) opens one sev3 incident when an enforced gate closes by itself and one sev2 incident when the gate cannot be evaluated at all (an unevaluable enforced gate is closed; the error cannot be recorded from inside the refused order's own transaction, so the watcher finds it).

Known limit: a "new lead enrolment" that does not come through `orders` (an admin assigning a lead by hand) is not gated; assigning is a deliberate staff act. `private.intake_open(patient)` is the single function to call if such a path appears.

## W5.2 Surge mode and pause

Table `ops_modes` (mode `surge` or `pause`, state requested / active / lapsed / ended / declined, who, why, when, expiry, config version, `is_test`). Only definer functions write it.

- Surge (`cmo_start_ops_mode('surge', ...)`, CMO only, at most 12 hours): new intake closed; a routine task (class 4 or lower urgency) offered to its lead can be taken by any eligible clinician (`queue_candidates` patched from its live definition); routine warning times in `queue_class_breaches` are multiplied by 2 so an expected slowdown is not read as a breach; the current on-call backup gets an in-app notice. Red is never windowed and never touched.
- Pause (CMO, at most 24 hours): closes new sales and enrolments (the gate), NEW bookings and NEW consultation requests, and the OFFERING of routine tasks (class 6 and lower urgency, `pause_hold_min_class`; open and offered-to-lead tasks only). New bookings are closed by three intake variants (`private.go_live_open_intake`, `go_live_open_patient_intake`) patched, from their live definitions, into the only three entry points that start new work: `hold_appointment_slot`, `create_followup_offer` and the video visit request insert trigger. `go_live_guard_on` itself is NOT changed, and `accept_video_visit_request`, `select_video_visit_alternate_slot`, `confirm_appointment_booking` and `service_get_encounter_room` (care already asked for, paid for or booked) are untouched; the proof asserts both lists by reading the function definitions. A pause never touches red paging, emergency guidance, on-call, escalated tasks, critical results, or a task already claimed. The proof creates a red page and acknowledges and closes it during a pause. The patient's booking screen reads the guard, so during a pause it can still look open and the refusal ("not open yet") arrives at the hold step.
- An administrator can only `request_ops_pause`. The request waits `pause_confirm_minutes` (240); the CMO confirms or declines (`cmo_decide_ops_pause`); a late confirmation does nothing (the row is already lapsed). A CMO acting directly closes any waiting request.
- Every start, confirmation, decline, end and expiry is an `audit_log` row. Every mode ends by the clock: `ops_mode_active` reads `expires_at` itself, so a dead sweep job cannot leave a pause on.
- Test rows (`is_test`) only affect test patients and test clinicians (INV-13), and the other way round.

## W5.3 Hard rest rule and cover offer

Rule (when `hard_rest_enforce = 1`): after a rota shift in which the clinician received at least `rest_min_overnight_pages` (1) pages in the overnight hours (22:00 to 07:00 Lagos, PROPOSED), they cannot start a new on-call or queue period less than `rest_hours` (11) after it ended. It holds in three doors: the rota validator core (`rota_validate_clinician_core`, so setting a shift and every swap step, wrapped, the existing body is kept as `*_base`), and a trigger on `availability_blocks` for `on_call` and `queue`. Only the CMO overrides, with `cmo_override_rest_rule` (reason of at least 20 characters, a window of at most 3 days, audited, named clinician only). The existing S18 soft warnings remain; this makes the overnight case hard. A proof check fails if a later migration replaces the validator core without calling `rest_rule_check`.

Cover offer: every 30 minutes, for a shift that has started, if the clinician (primary or backup) has `cover_offer_pages` (2) or more overnight pages in it and has another shift within the next 36 hours, one offer is created: an in-app notice to the clinician ("a busy night, your next shift can be covered, please confirm you are fit to work or ask for cover") and one to the reviewers ("a clinician may need cover"), neutral wording, no names or clinical words. The clinician answers on `/clinician/rest-and-cover`: fit (recorded) or cover requested (reviewers told). One offer per shift per clinician.

## W5.4 Fire drills

Hourly job `fire-drills` (minute 43, a schedule no other job shares). With `drill_enabled = 1`, inside 08:00 to 20:00 Lagos, it sends up to 2 unannounced test pages per run to clinicians who are on the rota in the next 30 days and have had no drill for 30 days. It skips anyone on leave and anyone holding a page opened in the last 6 hours, so a drill never competes with a real page or lands on someone who is away. The drill is a `page_tests` row of kind `drill` (so it uses the existing delivered-receipt and acknowledge flow and cannot be an SMS). An acknowledged drill and a drill unanswered for 60 minutes each add a `clinician_reliability_events` row of kind `drill_result` with WEIGHT 0: shown in the record, never moves the score, never read by pay or removal (Just Culture). The lead's `reliability_dashboard` is patched to leave `drill_result` out of its event counts, as it does `audit_result`. `fire_drill_report(days)` (admin or CMO) gives, for all drills and by clinician, hour of day (Lagos), route (first receipt channel) and device (kind from `on_call_device_seen`): drills, answered, missed, share within 300 seconds, p50 and p95. Screens: `/clinician/fire-drills` (CMO) and `/admin/fire-drills`. A pending drill is shown separately and not counted.

## W5.5 Device readiness

`/clinician/device-check`: browser notification permission and service worker status (reads the browser only), per-brand steps for Tecno, Infinix, Samsung and Xiaomi (`lib/capacity/device-guides.ts`), and a one-tap test page with the same acknowledge flow as the On call screen. Runbooks: `docs/runbooks/on-call-device-setup.md`, `ios-critical-alerts-entitlement.md`, `ops-desk-resilience.md`. `apps/mobile` native configuration was not touched.

## Console reach

Nav: clinician (Device check, Rest and cover; CMO: Capacity and cover, Fire drills), admin (Capacity and cover, Fire drills). Search keywords added for all six pages. The sign-off hub has the signing line and panel.

## Decisions I made that the lead may overrule

1. Gate wired as a trigger on `orders`, not into `create_order`. Reason: three branches replace `create_order`; a trigger survives them.
2. A pause closes the bookings guard by making `go_live_guard_on('clinical_operations_enabled')` false, not by flipping the guard. The guard row is never written by this migration.
3. `pause_hold_min_class = 6` and `surge_widen_min_class = 4` are my reading of "non-urgent" and "routine" against the task-type classes (class 4 amber BP review, 5 symptom review, 6 titration, 7 async, 8 routine results, 9 admin). The CMO confirms.
4. The hard rest rule counts pages in the rota shift just ended. Backups are counted too (they are paged). It does not look at pages outside a rota shift.
5. The hard rest rule also blocks an URGENT swap whose incoming clinician is inside their 11 hours (the swap door calls the same validator core). The only way through is the CMO's override, which is quick to record on the Capacity page. If the lead prefers that urgent cover be allowed with a recorded reason instead, the change is one line in `rota_validate_clinician_swap`.
6. Drills use the daytime window 08:00 to 20:00 so they do not wake anyone for a test; the hour-of-day table therefore has no night data. If the CMO wants night drills, change the config.

## Known limits

- The gate does not cover a lead enrolment made by a staff member by hand.
- Surge widening is for tasks offered to a lead; it does not shorten any task's own due time.
- Over-cap leads (after the cap drops to 40) are reported by the nightly check as an incident; patients are not moved automatically.
- No heartbeat covers the three new cron jobs. An external dead-man check is still needed (same gap noted in `S16-S20-task-layer.md`).
- The iOS app cannot record delivered receipts, so an iOS-only clinician cannot pass the test-page gate; see the device runbook.
