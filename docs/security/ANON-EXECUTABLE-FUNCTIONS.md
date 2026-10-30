# Functions an anonymous caller can run (reviewed 2026-10-30)

Status: DRAFT for the founder (as DPO) and engineering to confirm. Nothing here is signed. This is the record for Stage 2 criterion E4 ("every function anonymous users can call is intended to be public").

**Scope.** The Supabase security advisor (`anon_security_definer_function_executable`) reports **17** functions in the `public` schema that the `anon` role can run through `/rest/v1/rpc/`. All 17 were read from the live database on 2026-10-30 (`pg_get_functiondef`) and each is accounted for below. Every one is `SECURITY DEFINER` with `search_path` set to empty. The list is enforced by `packages/db/tests/anon_executable_functions_allowlist.sql`: a new anonymous-callable function in `public` fails CI until it is added here and in that test with a reason.

**Not covered.** About 50 functions in the `private` schema are also executable by `anon` through the default PUBLIC grant. They are trigger functions and pure helpers (validity checks, append-only guards). The advisor only lists the API-exposed schema (`public`), which implies `private` is not exposed, but I did not read the API's exposed-schema setting itself, and I did not review the `private` functions one by one. Treat both as open until confirmed.

## Open lookups by a secret link or code

| Function | What an anonymous caller gets | Why it is public | What limits abuse |
|---|---|---|---|
| `emergency_card_by_token(p_token)` | The emergency card fields the patient chose to show (allergies, medicines, blood group, emergency contact and so on). Reproductive and mental-health items are hidden unless the patient switched them on. | A responder with the card's QR code has no account. | Token is a long random value (43 characters, checked 2026-10-29). Each view is audited and the patient is notified (via `emergency_card_full_by_token`). Unknown token returns nothing. |
| `health_passport_by_serial(p_serial, p_dob)` | Signature and status of an issued health passport; the name is masked unless the caller also gives the correct date of birth. | An embassy or employer verifying a printed passport has no account. | Serial must match a strict 16-character code. Date-of-birth confirmation stops after 20 tries an hour per passport. Each check is recorded and the patient is told at most once a day. |
| `record_share_peek(p_token)` | Only "ready", "pin_required" or nothing. | Lets the share page know whether to ask for a PIN. | Needs a valid 32+ character token. Failed lookups are logged (`log_public_lookup_failure`). |
| `record_share_by_token(p_token, p_pin, p_client_key)` | The sections of the record the patient chose to share. | A clinician or family member the patient sent a link to. | Token plus optional PIN. PIN locks after 5 wrong tries (3 per client in 15 minutes). Expiry, view caps and one-session windows apply. Every open is logged. |
| `pharmacy_snapshot_by_token(p_token, p_pin, p_client_key)` | A pharmacy counter view (adherence weeks) on top of the share door above. | Pharmacy counter staff. | Reuses all the share-door limits; also needs the `pharmacy_counter_snapshot` go-live gate open for that patient. |
| `verify_prescription_public(p_token)` | Drug, dose, quantity, repeats, status and the prescriber's name and verified credential. No patient name. Controlled medicines show only a status. | A pharmacist checking a prescription QR code. | 64-hex token only. |
| `record_prescription_supply_public(p_token, ...)` | **Writes**: records that a pharmacy supplied the medicine and notifies the patient. | A pharmacist with the prescription QR code records the supply without an account. | 64-hex token only. Controlled medicines are refused. No second supply within 10 minutes and none past the permitted repeats. Names and the registration number are checked for shape only; the registration is stored as unverified (`pharmacist_registration_verified = false`). Failed attempts are recorded (capped at 20 an hour per medicine). |
| `learn_shared_article(p_code)` | One health-education article that is marked shareable. | A patient shares an article with someone. | Only shareable items; members-only items return no body. |
| `verify_payer_board_report(p_report_number, p_content_hash)` | Whether an issued payer report is genuine, its period, attestation and status. | An insurer checking a printed report. | Needs both the report number and the 64-character hash. One message for "no such report" and "wrong hash", so numbers cannot be probed. |

## Public information for the marketing site and sign-in screens

| Function | What an anonymous caller gets | Why it is public |
|---|---|---|
| `public_price_list()` | Prices of on-sale products. No features, provider references or inactive rows. | The public pricing page. |
| `public_service_coverage()` | Which states have lab, pharmacy, specialist, home-visit and delivery cover. | The "where we work" page. |
| `public_response_commitments()` | The signed escalation response ceilings per tier (version, approver name). | A published promise; shown only while an active signed version exists. |
| `public_partner_locations()` | Name, address, coordinates and region of active labs, pharmacies, home-visit providers and delivery partners. No contacts. | The public map. |
| `platform_switch_is_on(p_key)` | True or false for a platform switch, only if that switch is marked readable by anonymous callers; anything else is false. | Signed-out pages need to know whether sign-up, invites and similar are open. |
| `membership_auto_renew_enabled()` | True or false for the auto-renew module. | The pricing and checkout screens. |

## Extension helpers

| Function | Note |
|---|---|
| `pgaudit_ddl_command_end()`, `pgaudit_sql_drop()` | Event-trigger functions from the `pgaudit` extension. They cannot be called as ordinary functions. No data. |

## Points for review (not fixed here)

1. `record_prescription_supply_public` is the one anonymous **write**. The pharmacist's registration is unverified by design; anyone holding the prescription QR can record a supply once, within the repeat limit. Confirm that is the intended trust level before public launch.
2. `public_partner_locations` publishes addresses. Confirm no `home_visit_providers` or `logistics_partners` row holds an individual's home address (not checked).
3. `record_share_by_token` locks a share after 5 wrong PINs, so someone holding only the link can lock it and the patient must make a new one. Acceptable, but known.
4. Attempt counters for the open lookups are per token or per share, not per caller address, apart from the share door's client key.
