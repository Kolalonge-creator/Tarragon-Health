-- S77 (clinical follow-ups, live red-flag prompts): two fixes the replay found once these tables met today's main-dev.
--
-- 1. private.follow_up_actor_is_clinician(uuid) is called from the SELECT policy on clinical_follow_ups (added by 20261007160301_s75_80_review_fixes.sql so a Care
--    Coordinator cannot read the table directly), but it was revoked from authenticated, so EVERY signed-in read of the table raised "permission denied for
--    function". A function used by a row-security policy runs as the reader and needs EXECUTE. It is a SECURITY DEFINER boolean about the caller (the same shape
--    as private.clinician_has_patient_access, which is already granted), and the private schema is not exposed through the API.
-- 2. S39b requires every patient table with a staff read policy to be listed in staff_read_scope. Both tables restrict the read inside the policy itself (the
--    owner or a clinician with a care relationship; the clinician's own prompts), so they are listed as 'org' with that reason: the S39b switch must not rewrite them.
-- Idempotent.

grant execute on function private.follow_up_actor_is_clinician(uuid) to authenticated;

insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason)
select v.table_name, 'org', 'patient_id', 'medical_history'::public.care_access_category, v.reason
  from (values
    ('clinical_follow_ups', 'The read policy already limits staff to the follow-up''s owner or a clinician with a care relationship (private.clinician_has_patient_access) and requires a clinical tier, so there is no organisation-wide staff read for S39b to tie.'),
    ('live_prompts', 'The read policy already limits a clinician to the prompts raised for them (clinician_id = the reader); there is no organisation-wide staff read for S39b to tie.')
  ) as v(table_name, reason)
 where to_regclass('public.' || v.table_name) is not null
on conflict (table_name) do nothing;
