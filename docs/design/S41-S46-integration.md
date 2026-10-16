# S41-S46 integration

Branch `integration/s41-s46`, built off `origin/main-dev` (first c7edfd735, then merged again with 6fef31181, which added S39b and S39c) on 2026-10-07 by merging three stacks locally. Nothing is pushed, no PR, no production migration applied, nothing signed. The S40 gate was waived by the founder for this session only.

## Stacks merged

- A: `s41/account-signin-consent` then `s42/consent-privacy-dependants`
- B: `s43/health-passport` then `s44/interoperability`
- C: `s45/risk-screening-packages`, `s46/results-and-health-report`, `s46c/report-routing-and-caregiver-read`
- Not merged: PR 988 / s38c. main-dev already carries `s38e_sponsor_cohorts` (`join_cohort` exists), so the cohort concurrency proof RAN here and passed (30 callers, 5 places, never 6; the lock-free control broke the limit).

## Migration apply order (20 files, all new)

Every file was renamed so that it sorts after the newest migration on main-dev (`20261007153917`) and after the newest live version seen on the production project (`20261007200000`, read only). Contents are unchanged. No live version matched any of the 20 new names or old names.

| New version | File |
|---|---|
| 20261007230154 | s41_onboarding_answers_and_lga |
| 20261007230331 | s43_record_foundations |
| 20261007230508 | s43_share_links_and_emergency_card_fields |
| 20261007230645 | s43_biomarker_trends_and_vaccination_schedule |
| 20261007230822 | s42_consent_matrix |
| 20261007230959 | s45a_screening_status_not_applicable |
| 20261007231136 | s45_risk_screening_packages |
| 20261007231313 | s42_privacy_centre_export_and_anonymiser |
| 20261007231450 | s42_dependants_handover_and_permissions |
| 20261007231627 | s46_results_serology_health_report |
| 20261007231804 | s46b_ai019_health_report_summary_registration |
| 20261007231941 | s42_proxy_coercion_safeguards |
| 20261007232118 | s44_external_exchange_consent_and_records |
| 20261007232255 | s44_item_notes_and_correction_requests |
| 20261007232432 | s44_fhir_export_snapshot |
| 20261007232609 | s44_lab_structured_push_mappings |
| 20261007232746 | s46c_hepatitis_catalogue_copy_yearly |
| 20261007232923 | s46c_report_signoff_as_clinical_task |
| 20261007233100 | s46c_caregiver_read_of_signed_report |
| 20261007233237 | s42_drop_sms_enabled_preference (last on purpose) |

Apply with the CLI in this exact order, or pin each `schema_migrations.version` to the file name (never bare `apply_migration`, which stamps wall-clock time).

## Deploy order

1. Apply the 19 migrations before the `s42_drop_sms_enabled_preference` one.
2. Deploy the web app (and the console and edge functions touched by the stacks). No deployed code may still read `sms_enabled`.
3. Apply `s42_drop_sms_enabled_preference` last, after confirming nothing reads the column.
4. Mobile: the S43/S44 screens ship with the next build (JS only unless a native dependency changed; check `runtimeVersion`).

## What each stack needs from the others

- B (S44) needs A (S42): `consent_in_force` and the consent matrix back the external-exchange consent.
- C (S46c caregiver read) needs A (S42): the category-to-permission mapping and handover rules.
- C (S45/S46) and B (S43) both add go-live guards, proposed-config keys and AI registrations: AI-018 is S43 document capture, AI-019 is S46 report summary, AI-017 stays the scribe on main-dev.
- Go-live guard proofs (`s37_go_live_guards.sql`, `s36b_go_live_status_ops_read.sql`) count the original seven by key and compare everything else with the live total, so they do not hard-code a number of guards.

## Integration breaks found by the proofs and fixed (none by weakening a check)

1. S43 redefined `record_share_by_token` and dropped S39's failed-lookup counting. Fixed in the S43 migration: `record_share_open` now calls `private.log_public_lookup_failure('record_share')` on a miss, revoked or expired link, and also finds a legacy row by its plaintext token. `s39_security_catalog.sql` gained `public.record_share_open` in the reviewed anon list (anon by design: 256-bit token, PIN lock, view cap). `s39_public_lookup_failures.sql` sabotage steps re-pointed at the functions that now hold the logic (`emergency_card_full_by_token`, `record_share_open`); they still flip.
2. S42 restated `private.circle_view_blocks`, silently dropping S38d's monthly block (S38d had renamed that function to `_core` and put a wrapper under the old name). The S42 migration now restates `circle_view_blocks_core`. `s38d_care_circle_monthly_and_notice.sql` and `s29_care_circle.sql` pass unchanged.
3. S27g (on main-dev) left one lab panel, `membership_annual`, with five more required analytes. S44, S45 and S46 proofs used the deleted `essential` and `annual_health_check` panel codes. Proof fixtures updated to `membership_annual` (S44 also maps and pushes the five extra analytes: 17 mappings, 15 pushed items). No migration or app logic changed for this.
4. S42 created `dependant_handovers` with `organisation_id`, `birthday_18` and a completed-state check; the S46c proof's stand-in row did not. Fixture updated to the real shape.
5. `apps/mobile` correction-request row literal gained `item_id` and `item_table` (S44 columns).

## Remaining risks and things not proven

- `apps/web` Jest: 1 test fails and is NOT fixed: `src/lib/document-capture/no-other-readers.test.ts`. S44's `components/item-note.tsx` names `"patient_documents"` in a Set of annotatable table names (no query). The edit that would allow-list that file was blocked by the permission classifier; a person should decide between allow-listing the file in the test (with the reason) or moving the name list out of a string literal.
- The database was NOT built with `supabase db reset`. The shared Docker host was out of network address pools (the CLI failed with "all predefined address pools have been fully subnetted"), so a plain `supabase/postgres` 17.6.1.167 container was used, with the auth, storage and realtime schemas taken from a sibling local stack's schema-only dump, the same grants, and every migration applied in file order, one transaction per file (same as the CLI). 1672 of 1672 migrations and the seed applied. Not run: the CLI's own bootstrap, the edge runtime, Studio.
- Live `list_migrations` (read only) showed none of the 20 new or old file versions; newest live version seen was 20261007200000. New versions start at 20261007230154. Re-check before applying, other sessions keep adding.
- Not run: any real device, Paystack, Zoom, edge function deploy, `/code-review`.
- S39b (tied staff reads) merged cleanly; the new S42 to S46 tables were not individually re-audited against the 128-table tie beyond the grep that none use `is_org_staff`.
- Still unsigned and off: the CVD instrument, the immunisation schedule, the consent wording keys (placeholders), AI-018 and AI-019 (registered disabled), all go-live guards.
- The S42 `sms_enabled` drop must stay last and web must deploy first.
## Conflicts resolved

- `docs/BUILD-PROGRESS.md`, `docs/OPEN-QUESTIONS.md`, `ci.manifest`, `en.ts`: union of both sides. No new duplicate `OQ-` headings were introduced (main-dev already had 48 duplicate headings from earlier sessions; untouched). S45 and S46 use `OQ-S45-n` / `OQ-S46-n`. No duplicate manifest lines, no duplicate i18n keys.
- `registry.ts` (proposed config): entries added by key, ours kept; four new keys from stack B and three from stack C.
- Both `database.types.ts`: union of hand-spliced functions; one duplicate `join_cohort` removed; `tsc` clean for all workspaces.
- `system-codes.ts`: AI-018 and AI-019 both kept.
- Mobile `profile-screen.tsx`: the local correction-request row literal gained `item_id` and `item_table` (added to the table by S44).

