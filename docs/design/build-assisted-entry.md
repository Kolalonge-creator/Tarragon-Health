# Assisted entry and caregiver red-care answer: design (2026-10-16)

Migrations: `*_assisted_entry_permission_value.sql` (adds `log_readings` to `caregiver_permission`; its own file because ADD VALUE cannot be
used in the same transaction) then `*_assisted_entry_and_caregiver_red_care.sql`. Proof: `packages/db/tests/assisted_entry_and_caregiver_red_care.sql`.

## 1. Caregiver answer to the red-care question

The 42501 came from `record_red_care_response`: it derives the patient from `auth.uid()` and refuses any event that is not the caller's. It
is left untouched (its three proofs and every older phone still use it). New `record_red_care_response_for(p_patient, ...)`:

- own account: delegates to the old function, so a patient's answer has one implementation;
- helper: needs a live, unexpired `manage` grant (`private.can_act_for`) naming `receive_alerts` OR `log_readings` (NULL permissions = all).
  The helper who typed the dangerous reading sees the guidance, so `log_readings` alone is enough;
- the event must belong to `p_patient`; the row is the PATIENT'S with `answered_by` = helper; idempotent by client id; audit_log actor is the
  helper with `acted_for`; the person's access log gets an `acted_for` line (scope `care_status`);
- never acknowledges anything and never stops paging (decision Q13); "could not get care" brings outreach forward exactly as before;
- `latest_red_patient_response` now says `answered_by_caregiver` so the responder knows it was not the patient.

Reproductive category: the answer carries no clinical content, returns only an id, and widens nothing. The proof asserts the helper still has no
`reproductive_health` access afterwards. Clients: web action uses the open "acting for" subject; the phone outbox uses `ownerUserId !== subjectId`
and the phone screen resolves the acting subject. 42501 is shown as "not allowed", not as a generic failure.

## 2. Assisted entry

**Finding.** A `manage` helper could already insert `vitals_readings` for the person, stamped by `stamp_acting_supporter`. Missing: its own
capability, limits, a consent record, visibility, a pharmacy seam.

**source stays 'manual'.** A new `vital_source` value would silently skip `r2_glucose_triage_wiring` (fires for 'manual','device' only), would
escape `stamp_manual_vitals_timestamp` (backdating), `vitals_readings_enforce_source_lock` and the S46/S47 source counts. "Assisted" is who
entered it, so it is `logged_by_profile_id` plus an `assisted_entry_log` row. This deviates from the brief's `source = 'assisted'` deliberately.

- **Capability:** `log_readings`; the helper insert policy now needs it. Live: 0 manage grants, so nobody loses anything.
- **Row flag:** `vitals_readings.assisted_entry`, set only by the guard (a client value is overwritten). It is the one fact every view, audited
  read and the rate limit use. `logged_by_profile_id` alone is not enough: staff-measured and imported rows carry a staff id there too.
- **Guard (BEFORE INSERT on vitals_readings):** only for API-path writes (`role = authenticated`) where the writer is not the patient and is
  not org staff (testing-day nurses and import confirmations go through their own governed paths). Needs the
  capability (an explicit `log_readings`, or an unrestricted grant PLUS the person's vitals category, so writes are never looser than reads), refuses wearable/cgm/fhir_import rows and deviceless device rows, bounds device/photo times to 7 days, applies versioned limits
  (`assisted_entry_config`: 6 per helper per person per hour, 30 per helper per day, PROPOSED, founder owned; counted on flagged readings, so a ledger
  failure cannot lift the limit; a blind retry of a reading that already landed is a duplicate, not a limit hit). SQLSTATE 53400 for limits (the
  phone retries later), 42501 for not permitted, 22023 too old.
- **Ledger (AFTER INSERT):** `assisted_entry_log`, append only, one row per reading: actor, kind, consent_basis (`explicit_permission` when the
  grant names log_readings, `full_manage_grant` when unrestricted, `counter_consent` reserved for pharmacy), grant id. A ledger failure
  warns and never aborts a possibly dangerous reading.
- **Consent record:** the person's grant (profile_access, with its own lifecycle log) is the consent; the ledger stores which grant and on what
  basis. Revoking the grant or removing `log_readings` ends it at once.
- **Same path:** the reading is an ordinary vitals row, so BP/glucose/pulse red flags fire for the patient. Proof A4.
- **Views:** patient history says "Entered for you by <name>" instead of "Typed by you" (`assisted_entry_attribution` RPC for names); clinician
  and patient trend charts carry a caption counting helper-entered points.
- **Offline:** routes map refusals to 403/422 (outbox rejects) and 429/503 (outbox retries). Entry itself is the existing outbox path.

## 3. Pharmacy seam (closed)

A `pharmacist` role exists but nothing ties a staff member to a branch, a patient or a counter consent. Go-live guard
`assisted_entry_pharmacy_enabled` (born off, no conditions defined so it cannot be switched on), `vitals_readings_insert_pharmacy_assisted`
policy and `private.pharmacy_assisted_entry_allowed` returning false. To open: answer OQ-ASSIST-1, write that function (it must check the guard
itself), add the guard's conditions. Proof A10.

## Open questions for the lead
- OQ-ASSIST-1 pharmacy: branch verification, counter consent, whose record is it.
- OQ-ASSIST-2 limits (6/hour, 30/day) are proposals. A limit that refuses a helper's 7th reading in an hour can also refuse a dangerous one before the
  red-flag triggers run. The refusal wording tells the helper to get the person to care first and that the person can enter it themselves; the
  alternative (exempt readings in the emergency range) needs the CMO's thresholds duplicated here, so it was not done. Decide.
- OQ-ASSIST-4 a helper with only `receive_alerts` or `log_readings` can answer for the person's latest red alert of any category (the answer carries
  no clinical content). If the CMO wants reproductive-context alerts excluded, the alert needs a category first; none exists on `emergency_events`.
- OQ-ASSIST-3 the brief's `source = 'assisted'` was not used, see above; confirm.
- The monitoring roster (`patient_monitoring_latest_readings`) does not yet flag a helper-entered latest value; the chart and history do.
