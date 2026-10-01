# S05f click-through checklist (staff screens after the INV-10 closing migrations)

Why this exists: all ten health-record tables are now closed to direct staff access. Staff read and write them only through audited, tie-gated functions. I could not run any staff screen while building this (no Docker, no staff login), so every item below is unverified until you tick it. A missed reader does not fail loudly: a closed table returns nothing, so the symptom is a "not available to you" notice, an empty-looking panel, or a button that appears to do nothing.

Production deployments of record: C1 `509a6ac5`, C2 `262c2510`, D `5a7f15a3`, review fix #831. All migrations are applied.

## Setup (once)

You need four logins. "Tied" means the clinician is on the patient's care team (`care_team_assignment`), or has an open escalation or alert routed to them, a live appointment, a hosted video consultation, or an assigned open referral.

| Login | Role | Relationship to Patient P |
|---|---|---|
| T | Senior Medical Officer (clinician) | Tied: set as P's clinician in the care team |
| M | Medical Officer (clinician) | Tied (second care-team slot), no prescribing authority |
| U | Senior Medical Officer (clinician) | Untied: no relationship to P |
| A | Admin | Not clinical staff |
| P | Patient | The patient being viewed (use a test patient, never a real one) |

Give P: one active medication prescribed by T, one stopped medication, a few vitals readings (BP, weight, glucose), one logged dose, one symptom, one allergy and a referral if you can.

Pass rule for every U row below: the screen must say it is not available (or refuses clearly). It must never show an empty list that reads like "nothing recorded".

---

## 1. Clinician T (tied) on Patient P's chart (`/clinician/patients/<P>`)

- [ ] 1.1 Medications list shows the active medication with the care-plan condition and "Signed by" name. Stopped medications appear under the past-medications toggle.
- [ ] 1.2 Dose log history card lists the logged dose with the drug name (not "Unknown medicine").
- [ ] 1.3 Medication safety panel shows the medicine count and the allergy list. No "medication list is not available" notice.
- [ ] 1.4 Clinical decision support panel loads. No amber "medication cross-checks did not run" notice.
- [ ] 1.5 Vitals trend chart loads for BP, glucose and weight, and the BMI view loads. Switching the window keeps the newest readings at the right-hand edge.
- [ ] 1.6 BP ladder panel and pre-visit summary show the medications.
- [ ] 1.7 Medication effectiveness card shows if P is on a relevant drug and has matching readings.
- [ ] 1.8 Cardiovascular risk panel produces a score (it needs a recent BP).
- [ ] 1.9 Add a medication (the "Add medication" form): saves, appears in the list. Check the new row is attributed to T ("Signed by").
- [ ] 1.10 Amend a prescription: the old version is marked superseded, a new version appears.
- [ ] 1.11 Confirm a refill on a clinician-prescribed medicine: the refill date changes and "last confirmed" shows T. (This used to fail silently once the table closed; it must now either work or show an error.)
- [ ] 1.12 Chronic-programme review section: the dose history and dose-history medication names show.

Also check the audit trail: `select action, event->>'basis', result, created_at from audit_log where actor_id = '<T>' order by created_at desc limit 20;`
- [ ] 1.13 Rows with action `staff.chart_read`, basis `tied`, result `success` for medications and vitals reads.
- [ ] 1.14 Opening the chart repeatedly does NOT write a new audit row on every window focus (the hooks stay fresh for 60 seconds).

## 2. Clinician T on the escalation page and worklists

- [ ] 2.1 Escalation page for P: medications list, vitals trend chart, case brief and case cockpit load.
- [ ] 2.2 Case cockpit proposes actions (a refill confirmation proposal appears if a refill is due). Confirming a proposed refill works and shows T as the confirmer.
- [ ] 2.3 Generate a case brief (the brief card button): it completes and shows recent vitals.
- [ ] 2.4 Referral page: "assemble clinical summary" succeeds and the saved summary lists recent vitals and medications.
- [ ] 2.5 Worklists: medication issues (affordability and dispense flags), adherence alerts, prescription renewals, medication repeat requests and medication change requests all show the medication name in each row. A row with a blank or "Medication" name for a patient you ARE tied to is a bug.
- [ ] 2.6 Monitoring page (`/clinician/patients/monitoring`): P's card shows readings and a status badge. Header text says "N of M on your care team".
- [ ] 2.7 Hypertension quality page: KPIs show real percentages, not 0% across the board.
- [ ] 2.8 Care-management case file: the Medications and Conditions cards load.
- [ ] 2.9 Video visit for a consultation T hosts: the pre-visit prep panel loads (conditions, allergies, vitals, medications, prior notes). This now needs the tie.

## 3. Clinician U (untied) on the same screens

- [ ] 3.1 Chart: medications list, medication safety, decision support and vitals charts show "not available to you" (or the panel's refusal notice), never "no medications" or "no readings".
- [ ] 3.2 Medication safety panel: the amber notice says the medication list is not available, and "a quiet panel is not a clearance".
- [ ] 3.3 Dose log history: "Dose history is not available to you for this patient."
- [ ] 3.4 Monitoring page: P is listed as "Not on your care team" with no vitals tiles, is excluded from the exception count, and is not drawn as "Normal".
- [ ] 3.5 Add medication for P: refused with "Not authorised to prescribe for this patient". Nothing is written.
- [ ] 3.6 Confirm refill or amend for P: refused with a readable message (not a silent success).
- [ ] 3.7 Open the video-visit prep for a consultation U does not host: refused.
- [ ] 3.8 Referral summary for a referral U cannot see: refused ("not available to you"), and no summary is saved.
- [ ] 3.9 Audit: `select … from audit_log where actor_id = '<U>'` shows `staff.chart_read` rows with result `denied` for the chart reads (the database audits refusals on the read functions; the prep-bundle and refill refusals raise and are not audited by the database).

## 4. Medical Officer M (tied, no prescribing authority)

- [ ] 4.1 Confirm a refill on a clinician-prescribed medicine: works, shows M as the confirmer.
- [ ] 4.2 Add or amend a medication: refused (no prescribing authority). Confirm refill on a patient-added medicine: refused.

## 5. Admin A

- [ ] 5.1 Support view-as: start a session for P, open the session page. Medications and vitals show (through the audited read), and there is a clear notice if either cannot be read. Ending the session hides them.
- [ ] 5.2 Patient merge page (`/admin/patients/merge?a=<P>&b=<another>`): the record-weight counts for medications and vitals show real numbers (a patient with history must NOT read 0).
- [ ] 5.3 Care-team outcome report (corporate/HMO reports, "Generate outcome report"): the saved snapshot's medication-outcomes section is populated, not zero de-prescribing.
- [ ] 5.4 Admin cannot read P's chart medications or vitals directly: chart panels show "not available" unless A is tied or has break-glass.

## 6. Patient P (must be unchanged)

- [ ] 6.1 Medications page: list, today's doses and stopped medications all load.
- [ ] 6.2 Add a medication yourself (source patient): saves.
- [ ] 6.3 Stop a medication that T prescribed: works. Try to edit its dose (only possible through a crafted request): refused. Change reminder times on a prescribed medicine: works.
- [ ] 6.4 Log a dose, log a symptom, log a vitals reading: all save and appear. A dangerous reading (for example BP 210/130) shows the emergency guidance and raises the alert.
- [ ] 6.5 Vitals page: history ("Load more"), trends and BMI load. Health summary and health passport load.
- [ ] 6.6 Add an allergy: saves. Conditions list loads (read-only for the patient).
- [ ] 6.7 Data export includes medications and vitals.
- [ ] 6.8 Embedded lists on P's own pages still show the medication name: adherence check-ins, lab monitoring.

## 7. Caregiver and supporter (unchanged)

- [ ] 7.1 A caregiver with the "medications" category grant can see P's medication log and medication list.
- [ ] 7.2 An acting supporter (manage level) can log a dose and a vitals reading for P, and it is stamped with their profile.
- [ ] 7.3 A caregiver without the grant sees nothing.

## 8. Database spot checks (read-only, safe on production)

Run each with `npx supabase db query --linked`.

- [ ] 8.1 No staff clause on any of the ten tables:
  `select tablename, count(*) filter (where qual ~* 'is_org_staff|has_emergency_access|can_support_view' or with_check ~* 'is_org_staff|has_emergency_access|can_support_view') from pg_policies where schemaname='public' and tablename in ('patient_documents','family_history','patient_allergies','patient_conditions','clinical_encounter_notes','specialist_referrals','medication_logs','symptoms','medications','vitals_readings') group by 1;` Every count must be 0.
- [ ] 8.2 The 17 triggers on `vitals_readings` and the 21 on `medications` are still present (`pg_trigger`, not internal).
- [ ] 8.3 `has_function_privilege('anon', …)` is false for every function named in the C1, C2, D and review migrations.

## If something fails

| Symptom | Most likely cause |
|---|---|
| Blank medication name in a worklist row | A list was missed by the embedded-select helper (`attachMedicationEmbeds`), or the viewer is untied |
| "Not authorised to prescribe for this patient" for a clinician who should be tied | The tie is missing: check `care_team_assignment`, open escalations and alerts, appointments, hosted video consultations, assigned referrals |
| Refill button does nothing and shows no error | A caller still does a direct staff `.update()` (it matches zero rows). Search for `.from("medications").update` |
| 0% on the hypertension quality page | The view is not reading through `private.hqm_latest_bp_rows()` |
| CV-risk panel empty | BP or medication read refused or errored (it returns no assessment rather than scoring from nothing) |
| Patient merge page counts read 0 | Counts must come from `patient_record_counts_for_merge`, not a head-count |

Report any failing item with the login used, the screen and the exact text shown. Where an item fails only for U and shows a clear refusal, that is correct behaviour, not a bug.
