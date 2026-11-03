-- One more owed signature on the CMO's sign-off hub (not a signature): the paid consultations safety case v1.0 draft
-- (docs/clinical-safety/consultations-safety-case.md). It is the last unmet condition on the clinical_operations_enabled
-- master (clinical_safety_case_current is an attestation the database cannot read; the protocol, rule set and clinician
-- conditions are met from the data). Same pattern as 20261029213238_owed_signoffs_ledger.sql: raised only for an
-- organisation with an active Chief Medical Officer; running = false because consultations are not open yet. Nothing here
-- signs, attests or switches anything.
insert into public.owed_signoffs (organisation_id, subject_key, title, detail, running, raised_note)
select o.id, 'consultations_safety_case_v1', 'Paid consultations safety case: sign version 1.0',
  'docs/clinical-safety/consultations-safety-case.md is the clinical safety case and hazard log for opening paid consultations (the Clinical operations master switch). It has twelve hazards and six decisions for you. Read it, correct it, sign its block in the file, sign here, then record the clinical_safety_case_current attestation on the go-live page naming the document, version 1.0 and yourself. An admin then presses the switch.',
  false, 'Raised 2026-11-03 with the v1.0 draft; not a signature.'
from public.organisations o
where exists (select 1 from public.clinical_staff cs where cs.organisation_id = o.id and cs.doctor_tier = 'chief_medical_officer' and cs.active and cs.status = 'active')
on conflict (organisation_id, subject_key) do nothing;
