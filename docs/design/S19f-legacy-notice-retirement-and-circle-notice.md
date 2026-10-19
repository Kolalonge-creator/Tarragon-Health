# S19f: confirmed retirement of the legacy clinician broadcast, and the Care Circle notice for unified pages (all OFF)

Continues `docs/design/S16-S20-unified-red-paging.md` sections C and D (rows 2 and 6, the confirmation path, `suppress_legacy_emergency_notice`). Migration `20261016192040_s19f_legacy_notice_retirement_and_circle_page_notice.sql`. Proof `packages/db/tests/s19f_legacy_notice_retirement.sql`. CMO test pack `docs/plans/S19f-legacy-notice-retirement-test-pack.md`.

**Nothing is switched on or signed.** Four config versions ship inactive and unsigned. With no signed live version every new function reads OFF and the two patched legacy handlers run the code path they ran before (the only edit to either is one extra boolean that is false). Only the Chief Medical Officer can sign, on the sign-off hub, after the test pack.

## 1. The problem

A blood pressure red event today produces two things: the legacy broadcast (a synchronous trigger, `private.handle_bp_reading_red_flag`, pathway `bp_vitals_red_flag`, one critical notification to every `role = 'clinician'` profile in the organisation, no owner, no acknowledgement) and the triage-engine page (asynchronous: `process-events` grades the reading, `record_triage_result` makes the page to the rota primary). A glucose emergency (`emergency_events` source `glucose_red_flag`, raised by `raise_glucose_backstop_emergency`) will do the same once the CMO signs `glucose_care_triage`. A blood pressure crisis does it through `emergency_events` source `bp_reading`. The clinicians get two notices for one event.

The S19d design left this as a follow-up because the page does not exist yet when the trigger runs, so the trigger cannot simply skip. Skipping on a guess is the dangerous direction: a red event must never end with no clinician told.

## 2. The confirmation path (rows 2 and 6)

When a signed version retires a pathway's broadcast, the trigger no longer sends it directly. `private.legacy_notice_deferred(...)` is called instead and returns true only when the broadcast has been taken over.

**At the moment of the event (hold or send).** It holds the broadcast (a `legacy_notice_holds` row, status `held`, deadline = `hold_seconds`) only when a page is really expected. Otherwise it records a `fired` row with the reason and returns false, and the trigger sends exactly as before:

| Pre-check | If it fails, the broadcast fires at once with reason |
|---|---|
| the patient may be paged (not Free) | `free_patient` (in practice a Free patient never reaches the hook: no alert, no broadcast) |
| the event carries the id of its reading (so its page can be matched) | `no_reading_id` |
| the pathway's rule set (`bp_care_triage`, `glucose_care_triage`) is approved | `rule_set_not_approved` (glucose today: the v1 rule set is a draft, so glucose never holds until it is signed) |
| `process-events` has a heartbeat inside `engine_heartbeat_stale_seconds` | `engine_stale` |
| `page_recipient` names a primary | `no_cover` |
| that primary is eligible and reachable (active push subscription OR verified email) | `primary_unreachable` |

If an open, unacknowledged page family for the patient is already ringing a reachable primary (the same family a repeat event would merge into) the notice is recorded as `suppressed` at once, reason `family_already_paged`.

**After the event (confirm or release).** `private.sweep_legacy_notice_holds()` runs from two independent drivers: every 15 seconds from `sweep_pages`, and every minute from `sweep_paging_health` (so a failing sweep cannot strand a held notice). For each held row it finds the page of THAT event: the red, non-shadow triage event of the same reading and pathway (`trigger_id` = the reading id, `rule_set_code` = the pathway), then its root page or the open family it merged into. A page for any other reading does not count. Then:

* page found, not `no_cover`, and the named primary is reachable (or has already acknowledged): the broadcast is **suppressed** for good (`page_confirmed`);
* a page exists but cannot be confirmed (no cover, or its primary can no longer be reached), the deadline passed with no page, or the config no longer holds that kind: **released** at once (`page_no_cover`, `primary_unreachable`, `no_page_in_time`, `switched_off`). A page that exists but cannot reach anyone never makes the older notice wait for the deadline. Release builds the same notification the handler would have sent (same template, pathway, alert level, payload keys, one per clinician profile), so a released notice is indistinguishable from the old one except that it is late. The patient's name is looked up at release; no name is stored in the hold table.

**Never silent.** A hold that stays `held` more than 120 seconds past its deadline opens the ops incident `legacy_notice_hold_overdue` from the health job. A hook error (caught in a sub-block, its rows rolled back) sends the broadcast as before and audits `legacy_notice.error` with an ops incident. A sweep error on one row is audited and retried on the next pass.

**Emergency events.** `bp_reading` and `glucose_red_flag` emergency events keep their broadcast unless the SEPARATE key `suppress_legacy_emergency_notice` is also 1 (and the pathway key). Under a version with the pathway key 1 and the emergency key 0 the emergency kinds stay in observe mode (both fire, measured). The amber BP review notice, every other emergency source, the unified-paging allow-list and the abnormal screening pipeline (Category 2 to 1) are not touched. The patient-side emergency record, the acknowledge-gated guidance, the emergency-contact notice and the `clinician_alerts` row all still happen.

## 3. Versions, parallel run, switch-off

`legacy_notice_retirement_config` (versioned, PROPOSED, mirrored as `paging.legacy_notice_retirement_rules`; same CHECK-validated, rules-never-edited, live-needs-signature shape as `unified_red_paging_config`). A missing, unsigned, malformed or unreadable row reads OFF.

| Version | What it does |
|---|---|
| 1 | **Parallel run.** `observe = 1`, nothing retired. Both notices fire exactly as today. Every red BP event, BP crisis and glucose emergency records a row, and the sweep fills in the page of that event: whether it arrived, how many seconds after the older notice, whether its primary was reachable. This is the "how often the page arrived first" measurement. |
| 2 | Retire the RED-level broadcast for blood pressure and glucose (hold and confirm). Emergency kinds stay in observe mode. |
| 3 | As 2, and also retire the EMERGENCY broadcast (BP crisis, glucose emergency). |
| 4 | Care Circle notice for unified pages only (section 5). Nothing retired. |

`public.sign_legacy_notice_retirement_config(version, test_pack_run)`: CMO only, refuses without the test-pack confirmation, and **refuses a version that retires any broadcast until an observe-only version (nothing retired) has been switched on at some time**. `public.switch_off_legacy_notice_retirement()`: CMO or an admin; it switches the config off and releases at once every held notice that has no confirmed page. `public.legacy_notice_measurement(days, include_test)` (CMO or admin) returns the evidence per pathway: events, page seen, page first (lag <= 0), page in time with a reachable primary, primary not reachable, suppressed, released, median and 95th percentile lag. The sign-off hub panel shows that table next to each version and a switch-off while one is live.

## 4. What this does not decide

* `hold_seconds = 60` is PROPOSED. It is the worst-case extra delay for the older notice when no page comes (plus up to 15 seconds for the sweep to notice). A shorter hold means more late-but-unneeded sends; a longer one means a slower fallback. CMO decision, from the parallel-run lag distribution.
* No version should be switched on until the CMO has the parallel-run numbers from real traffic. Real-patient proof cannot exist yet: every red BP event so far came from test patients and the glucose rule set is unsigned.
* The legacy engine can still climb to SMS for an UNCOVERED event (released notices are ordinary legacy notices again, so the old ladder applies to them); for a suppressed event that rung no longer exists, as for the S19d red levels.

## 5. Care Circle notice for a unified page

S19d made a unified page not tell the Care Circle. Reading the S29 code for this change found that the notifier was only one of three readers of `public.pages`: `circle_open_alerts()` and `circle_ack_alert()` list and acknowledge open root pages directly, so with unified paging on a supporter's "open requests" list would have shown a unified page the notifier had skipped. All three now call one predicate, `private.page_circle_may_know(page)`:

* a page that is not a unified page (the blood pressure engine page, a backup or escalation child): **true**, the behaviour it always had;
* a unified page: only when the signed config says `circle_notice_unified_page = 1` (version 4), and then:
  * vitals-origin events (oxygen, pulse, temperature, including their emergency events): true. They carry no reproductive content;
  * the origin has to be known at page time. A unified page is made inside the BEFORE INSERT trigger of the symptom or emergency event that caused it, when that row cannot be read yet (found by the proof: the first version looked the row up and silently withheld every symptom page). The two callers therefore note the origin (`private.note_page_origin`, keyed by the row id so a stale note can never be picked up) and the unified page stores it in its context as a short label (the emergency source, or `symptom:` plus the symptom type, still ids and labels only, never a value). `handle_symptom_red_flag`, `handle_emergency_event` and `unified_red_page_covers` are patched in place for this;
  * symptom-origin events (red-flag symptom, symptom log, symptom triage, danger-symptom checklist): false for a patient with a pregnancy footprint (`profiles.is_pregnant`, `patient_pregnancy.is_pregnant`, or a `reproductive_health_profiles` row whose life stage is not `not_applicable`) and false for a reproductive symptom type (`testicular_pain`, `testicular_lump`);
  * anything else, any unknown source, and any error: false.

The notice itself is the existing neutral `circle_check_in` (no condition, reading, name or result, INV-07), sent by the existing notifier, so every S29 rule still applies and is reused, not copied: the member must hold `red_alerts`, be active and unexpired, the patient must not have paused check-in requests, and `is_test` must match. A Free patient never has a unified page. The Care Circle is a separate consent model from the clinical access categories by S29 design (a circle member is deliberately not a `profile_access` grantee), so no reproductive data is read for the member and none is sent; the only thing disclosed is that a check-in request exists, and the predicate withholds even that where it could imply a reproductive event.

Open question for the CMO and DPO: a vitals page for a pregnant patient still tells her circle (the notice is content-free and the event is not reproductive). If that is not wanted, the footprint test can move in front of the vitals branch.
