# S11 to S15 go-live order (six packages, one branch)

Branch `s11-s15/integration` holds P1 chain canary, P2 glucose engine, P3 critical notifications, P4 provider layer, P5 credentialing and P6 triage coverage. Merging into `main-dev` AUTO-APPLIES the migrations, so some deploys go first. Nothing here signs, switches on or deletes by itself. Detail per package: `docs/design/S11-S15-*-closeout.md`.

## 1. Before the merge (lead)
1. Run `list_migrations` on `koiplnmbgnqnbywhpjlf`. The 12 new versions are `20261013223014` to `20261013225511`. If the live head has moved past them, rename the later-applying files to later real timestamps (never round numbers) and keep references in tests.
2. Set edge secret `NOTIFICATIONS_LINK_SECRET` (same value in the web env) so the two document emails carry a link (P3).
3. Deploy edge function `process-events` from this branch FIRST. It carries the P2 glucose branch and the P6 coverage handler; an old build would consume a glucose event as "not blood pressure" and drop it. Both are inert until their data exists.
4. Deploy `send-pending-notifications` from this branch (P3 sender, P5 catalogue keys). It works against the old schema.
5. Required CI must be green (the migration replay job runs each file in its own transaction, which the enum file `...223014` needs).

## 2. The merge
Auto-applies, in version order: P5 `...223014` (enum value, own file) and `...223016`; P6 `...223020`; P4 `...223052`; P1 `...223401`; P4 `...223547`; P3 `...223633`; P2 `...223643`, `...223731`; P1 `...223824`; P2 `...225326`; P4 `...225511`. Web deploys with the merge. Check afterwards that no new object is left behind unexpectedly: cron jobs added are `chain-canary` (11,41), `credential-recheck-sweep` (05:37 UTC), `sweep-unconfirmed-red-alerts` (4-59/5), `expo-push-receipts-critical` (3-59/5) and `triage-coverage-daily` (06:52 UTC, does nothing while OFF).

## 3. After the merge (lead)
Deploy, in this order: `resend-webhook`, `zoom-webhook`, `paystack-webhook` (flag off, behaviour unchanged), `order-checkout` (flag off), new `settlement-reconcile`, new `provider-event-drain`. Do not schedule the last two yet (vault secrets `provider_drain_secret`, `settlement_reconcile_secret`, staggered cron; the connection budget is tight). Do not redeploy `expo-push-receipts` (unchanged). Mobile: JS-only OTA publishes the P2 and P3 phone changes; `app.config.js` is native-affecting, so building with `IOS_TIME_SENSITIVE=1` or `IOS_CRITICAL_ALERTS_ENTITLEMENT=1` needs a fresh `eas build` and a `runtimeVersion` bump.

## 4. Founder
- Request the Apple Critical Alerts entitlement now; set `IOS_CRITICAL_ALERTS_ENABLED=true` only after it is granted and a build carries it.
- Delete the two deployed functions that have no source any more: `supabase functions delete whatsapp-webhook` and `... send-support-reply`.
- Answer the questions OQ-314 to OQ-358 in `docs/OPEN-QUESTIONS.md`, first OQ-315 (synthetic canary organisation in production).

## 5. Ops
Record MDCN or DataFlow evidence for the two active clinicians (upload the file; a reviewer other than that person records route, reference, date; enter licence and cover dates). Until then both are grandfathered (eligible) and show on the credentialing work list and the CMO hub. The CMO's own record is entered by an admin.

## 6. CMO (all on `/clinician/clinical-signoff`; nothing is pre-signed)
1. Confirm task type "Call the patient: a red alert was not confirmed" (`red_patient_outreach`). Until then a Member's unconfirmed red raises a sev1 incident and no task.
2. Confirm task type "Urgent glucose review" (`amber_glucose_review`). Both task types must be confirmed before ANY triage rule set (glucose, or `bp_care_triage` v4) can be signed.
3. Read and sign the glucose rules (version 1 draft; guideline basis and full wording are on the panel). Sign the glucose wording separately. Run the glucose divergence report over real readings first.
4. Confirm `notifications.rules` v4 and the `chain.canary_and_health` values (new version to change). `bp_care_triage` v4 stays unsigned until the CMO chooses.
5. The licence and cover attention line on the hub is not a signature.

## 7. First checks after apply
At minutes 11 and 41 the canary creates its synthetic organisation and runs; open `/admin/ops/chain-health` after the second tick. A fail at "graded" means the deployed `process-events` or its secret. Use the "Send me a test alert" button on the notifications card on a real phone, then follow `docs/runbooks/red-alert-handset-matrix.md`.

## 8. Stays OFF or unsigned
`triage_coverage_config` rules `enabled=false`; feature flags `provider_inbox_paystack`, `provider_circuit_breaker`, `payout_batch_maker_checker`, `payout_gl_posting`; `payouts_enabled`; `IOS_CRITICAL_ALERTS_ENABLED`; the document purge; AI-017; the canary glucose fixture (`glucose_red_severe_hypo`, enable only after the CMO signs the glucose rules); `grandfather_ends_on` (null). Legacy BP and glucose alerts are NOT retired; retirement needs the parity window and a signed count-first migration.
