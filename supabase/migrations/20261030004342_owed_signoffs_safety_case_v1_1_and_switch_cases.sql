-- Two more owed signatures on the CMO's sign-off hub (not signatures): the screening safety case v1.1 additions (merged as #1447,
-- unsigned, not covered by the v1.0 signature) and the safety cases for the reproductive, sleep and wellbeing switches with the
-- sensitive-test visibility review (PR #1457). Same pattern as 20261029213238_owed_signoffs_ledger.sql; rows are raised only for an
-- organisation with an active Chief Medical Officer. Applied live 2026-10-30.
insert into public.owed_signoffs (organisation_id, subject_key, title, detail, running, raised_note)
select o.id, v.subject_key, v.title, v.detail, v.running, 'Raised 2026-10-30 after the safety case v1.0 was signed; not a signature.'
from public.organisations o
cross join (values
  ('screening_safety_case_v1_1', 'Screening safety case v1.1 additions: read and sign',
   'v1.1 sits under the signed v1.0 in docs/clinical-safety/screening-scheduler-safety-case.md (merged as #1447). It adds the scope gap, the state on switch-on, a hazard for a patient mistyping a confirmed value, a hazard for switches signed from chat, and the first-run check. It is not covered by your v1.0 signature. Fill in its own signature block in the file as well as signing here.',
   true),
  ('switch_safety_cases_2026_10_30', 'Safety cases for the reproductive, sleep and wellbeing switches, and the sensitive-test visibility review',
   'docs/clinical-safety/switch-safety-cases-2026-10-30.md (PR #1457) gives each of the three switches that went on without one a short safety case, and records who can see an automatically issued sensitive-test request. Read it, correct it, then sign. Each section is signed by marking it in the file.',
   true)
) as v(subject_key, title, detail, running)
where exists (select 1 from public.clinical_staff cs where cs.organisation_id = o.id and cs.doctor_tier = 'chief_medical_officer' and cs.active and cs.status = 'active')
on conflict (organisation_id, subject_key) do nothing;
