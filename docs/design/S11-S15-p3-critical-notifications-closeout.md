# S11-S15 P3 closeout: critical path for red alerts (2026-10-13)

Branch `s11-s15/p3-critical-notifications`. Design: `docs/design/S11-S15-p3-critical-notifications.md`. Research: `docs/research/S11-S15-p3-critical-notifications.md`. Handset runbook: `docs/runbooks/red-alert-handset-matrix.md`.

## Built
1. **Q10 / OQ-92.** `private.patient_critical_channels` and a rewrite (from the live definitions) of `escalate_unconfirmed_critical_notifications` and `enqueue_critical_notification`: a patient's ladder is push, email, in-app; staff ladders unchanged. A pending in-app last hop now finishes with the existing "exhausted" admin alert. Sender: SMS by role (`isClinicianPageRow`), not by priority; an SMS row is left for the next pass when the profile lookup fails.
2. **Q11.** `red_alert_watch`, additive triggers on `emergency_events` and red non-shadow `triage_events`, `sweep_unconfirmed_red_alerts` (cron `sweep-unconfirmed-red-alerts`, minutes 4-59/5), class 1 task type `red_patient_outreach` (data, `needs_confirmation`), on-call alert, dedup per patient with a shared task, cancel on patient open/acknowledge/answer or clinician acknowledgement, Free skipped. PROPOSED values in `notifications.rules` v4 (registry, migration seed marker, drift test).
3. **Receipts.** A receipt error on a critical push fails the row (ladder moves on) and pulls the call forward; critical Expo tickets are checked from 2 minutes (second schedule `expo-push-receipts-critical`, minutes 3-59/5).
4. **Q12.** Fixed generic templates `red_event_guidance_waiting`, `red_event_outreach_task`, `test_alert`; real-values-in/none-out test; red push envelope fixed words.
5. **Q13.** `red_care_responses` (append only), `record_red_care_response` (idempotent by client id, own account, links to the latest alert when the phone does not know the id), `latest_red_patient_response` for the on-call page and the outreach task; web buttons, mobile buttons and outbox kind `red_care`. Never stops paging (proof with a sabotage).
6. **OQ-91.** PDF attachments removed; signed link `/d/<kind>/<id>` (`NOTIFICATIONS_LINK_SECRET`).
7. **OQ-94.** `public.check_notification_text` + trigger on `notification_broadcasts` + composer pre-check + lifestyle gateway check (fail closed).
8. **Reliability.** A phone says at registration that it has the `urgent` channel (`push_subscriptions.urgent_channel_ready`); the sender names the channel only for such a phone, because Expo accepts and reports delivered a push to a channel the phone lacks without showing it. Expo `priority/channelId/ttl/interruptionLevel` for safety rows; `IOS_CRITICAL_ALERTS_ENABLED` server switch; `apps/mobile/app.config.js` (entitlements opt-in per build, nothing by default); Android `urgent` channel created before the permission prompt; no full-screen intent; "Send me a test alert" on the S13b card (`send_my_test_alert`).
9. **CMO hub.** Line `red_outreach` + inline panel + action calling `confirm_task_type`. No new page, so no new search entry.

## Reused
S10 bus and S16 `create_clinical_task`/`apply_task_transition`, S19 `page_recipient`/`page_incident`, S13 delivery events and receipts, S13b diagnostics card, two-tier `patient_may_page_doctor`, `confirm_task_type`, `notification_text_violations` (DB copy of the INV-07 list), the mobile outbox.

## Tests
- DB proof `packages/db/tests/s13r4_critical_ladder_red_outreach.sql` (registered in `ci.manifest`): 75 checks, 4 sabotage steps (patient filter removed, Free gate stuck open, a response that acknowledges the page, the shared-task guard removed). Run on the live project inside `begin ... rollback` with the migration inside the same transaction; nothing left behind (verified).
- Adjusted existing proofs that count task types or the active rules row (`s16_clinical_tasks`, `s16b_cmo_signoff`, `s04b3_quiet_hours_default_off`). Re-run with the migration against live and passing: `s19_red_event_paging` (86), `two_tier_free_red_event_path` (56), `s13_notifications_framework` (41), `s13b_push_email_fallback` (20), `s16_clinical_tasks` (80), `s04b3` (16), `remove_whatsapp`, `minor_dependant_table_policy_complete`, `notification_delivery_fallback`. **Pre-existing failures on live before this work, not caused by it:** `critical_notification_dead_letter_without_pathway` (its pending-SMS control is turned into `failed` by the INV-08 trigger), `s39d_registry_purge_export`, `s16b_cmo_signoff` (live already differs from a fresh replay), `s39b_tied_staff_reads` (deadlock on live).
- Jest: packages/notifications 524 (new `s13r4-critical-path.test.ts` 36), packages/shared 293 (new mirror test 4), apps/mobile 1832 (new `red-care.test.ts`, `notification-channels.test.ts`), apps/web 5203 plus the new tests (document link 6, hub 3 + reader 4, action 4, red answer 4, patient action 4, gateway 4). `tsc` clean for web and mobile; ESLint no errors on touched files.

## Not proven (no phone, no deploy)
Anything on a handset (see the runbook; every row is NOT RUN). Push channel behaviour, `time-sensitive`/`critical` delivery, Android `urgent` channel importance, Tecno/Infinix/Itel survival. The Deno sender could not be type-checked here (`deno check` cannot resolve `npm:web-push`); its pure parts are covered by Jest and the HMAC signer is checked against Node. The `/d/...` route behind `proxy.ts` and the host split was not exercised. Expo `interruptionLevel`/`ttl`/`channelId` field names are from Expo's docs, not a live send. The live `send-pending-notifications` and `expo-push-receipts` were not touched.

## Apply and deploy order
1. Merge. The migration auto-applies (it carries no begin/commit). It creates tables, functions, two cron schedules, the task type (awaiting the CMO), `notifications.rules` v4.
2. Set edge secret `NOTIFICATIONS_LINK_SECRET` (same value in the web env) BEFORE deploying the sender, otherwise the two document emails go without a link until it is set (the document stays in the app).
3. Deploy `send-pending-notifications` (code first would also work against the old schema: it only reads columns that exist). Do not redeploy `expo-push-receipts` (unchanged).
4. Web deploys on merge (Vercel). Mobile: JS-only OTA publishes `urgent` channel, buttons, card button. `app.config.js` is listed as native-affecting in the OTA workflow; building with `IOS_TIME_SENSITIVE=1` or `IOS_CRITICAL_ALERTS_ENTITLEMENT=1` needs a fresh `eas build` and a `runtimeVersion` bump.
5. CMO confirms the task type on the sign-off hub. Until then a Member's unconfirmed red alert raises a sev1 incident (no task).
6. Founder: request the Apple Critical Alerts entitlement now (no code cost); later set `IOS_CRITICAL_ALERTS_ENABLED=true`.

## Proposed open questions
- **OQ-R4-1** `deliveredCountsAsConfirmed` (true per the plan): a delivered push receipt ends the wait. A silent phone can receive a push nobody sees. Recommend false once real data exists; CMO to decide.
- **OQ-R4-2** `couldNotGetCareOutreachNow` (true): "I could not get care" opens the call at once. It adds work, never removes any. CMO to confirm.
- **OQ-R4-3** `undeliveredMinutes` (5) and `expireHours` (6) are invented numbers; confirm.
- **OQ-R4-4** Clinician SMS paging is dead: the INV-08 trigger `notifications_suppress_sms_voice` fails every sms/voice insert, including clinician pages, so the clinician ladder's last hop (sms) can never send. Decide whether to allow clinician SMS once a Termii sender ID exists.
- **OQ-R4-5** `emergency_contact_alert` SMS keeps its old behaviour (named exception in `delivery.ts`); decide with the open emergency-contact question.
- **OQ-R4-6** `approve_triage_rule_set` refuses while any task type awaits confirmation, so the CMO must confirm the call task before approving the BP triage draft. Accept, or change that function to look only at task types the rule set uses.
- **OQ-R4-7** DPIA: add the notification channel and the new `red_care_responses` record (health data about seeking care, retention class proposed `review`).
- **OQ-R4-8** The signed document link lands a signed-out person on their home screen after login (login only honours role-home redirects). A deep link after login would need a login change.
- **OQ-R4-9** `PROPOSED_CONFIG` `notifications.rules` is owned by the CMO in v4 (v1-3 by the founder): confirm the owner.

## Follow-ups / not done
- The internal PDF routes `/api/internal/notifications/{lab-order-request-pdf,preventive-care-plan-pdf}` are now unused; delete in a later cleanup (kept so this change is reversible).
- Staff "send me a test alert" has no UI outside the mobile card.
- Free patients keep their own check-in; they get no red-care buttons (by design).
- Types: the new tables and RPCs are not in `packages/shared/src/database.types.ts` (not regenerated, to avoid importing other branches' schema); callers use narrow casts.
- A caregiver acting for a patient gets 42501 on the red-care answer (own account only); the mobile outbox marks it rejected and tells the person it did not save.
