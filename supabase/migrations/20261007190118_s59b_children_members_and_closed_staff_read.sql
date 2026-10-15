-- S59b part 1: children, members only, and the closed org-wide staff read of symptom assessments.
--
-- Founder and CMO decisions of 2026-10-07 (build plan section 10):
--   1. CHILDREN. The checker refuses anyone under 18 until a paediatric protocol is signed, and a date of birth is REQUIRED before any
--      check can run (a missing date of birth never silently "does not match" an age rule). Enforced here in the database (a BEFORE
--      INSERT trigger on symptom_triage_assessments, after the go-live guard) and in the app (server action and screen).
--      "A paediatric protocol is signed" means: the ACTIVE signed triage protocol contains a pathway whose key starts with
--      `paediatric_`. Nothing here signs or activates anything.
--   2. MEMBERS ONLY. request_symptom_review (a clinician looking at a check) requires Membership, through the one seam
--      private.patient_is_member (S22, S26). A Free person still gets the result, the self-care steps and the in-app message route.
--      The refusal has its own SQLSTATE (TM001) so the screen can say "members" rather than "not open".
--   3. STAFF READ CLOSED (INV-12). The select policy on symptom_triage_assessments no longer admits private.is_org_staff: only the
--      patient and a current care-circle grantee (category medical_history) read the table. Staff read one session through
--      read_symptom_session_audited (S59, per-patient tie, audited). The org-wide UPDATE policy goes too (there was no app consumer);
--      a clinician's override is now written by override_symptom_assessment (tied, audited). The safety-monitoring view stops being
--      readable by every signed-in person (it ran as its owner): its aggregates are served by symptom_safety_monitoring() to an admin
--      or the CMO for their own organisation.
--
-- ROWS AFFECTED: none changed. No data conversion: a trigger, functions and policy changes only. Existing assessments are not
-- rewritten (the age gate checks inserts only).
-- GRANT NOTE: every new function revokes from public (anon inherits through PUBLIC) and grants to authenticated only.

-- ---------------------------------------------------------------------------
-- 1. Children and date of birth
-- ---------------------------------------------------------------------------
-- 18 is the founder's decision of 2026-10-07 (mirrored by packages/shared proposed-config symptom.adult_age_years; a Jest test fails if
-- the two differ). It is a policy age, not a clinical threshold.
create or replace function private.symptom_checker_adult_age() returns integer
language sql immutable set search_path = ''
as $$ select 18 $$;
revoke all on function private.symptom_checker_adult_age() from public, anon, authenticated;

create or replace function private.paediatric_pathways_signed() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.triage_protocols tp
      cross join lateral jsonb_array_elements(case when jsonb_typeof(tp.config -> 'pathways') = 'array' then tp.config -> 'pathways' else '[]'::jsonb end) p
     where tp.is_active and (p ->> 'key') like 'paediatric\_%' escape '\');
$$;
revoke all on function private.paediatric_pathways_signed() from public, anon, authenticated;

-- 'ok' | 'dob_required' | 'under_18'. A missing profile or date of birth is dob_required: never "adult by default".
create or replace function private.symptom_checker_age_status(p_patient uuid) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_dob date;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  select date_of_birth into v_dob from public.profiles where id = p_patient;
  if v_dob is null then return 'dob_required'; end if;
  if v_dob <= (v_today - make_interval(years => private.symptom_checker_adult_age()))::date then return 'ok'; end if;
  if private.paediatric_pathways_signed() then return 'ok'; end if;
  return 'under_18';
end $$;
revoke all on function private.symptom_checker_age_status(uuid) from public, anon, authenticated;

create or replace function private.symptom_triage_assessments_age_gate() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_status text := private.symptom_checker_age_status(new.patient_id);
begin
  if v_status <> 'ok' then
    raise exception 'symptom_checker_age_gate: %', v_status using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.symptom_triage_assessments_age_gate() from public, anon, authenticated;

drop trigger if exists symptom_triage_assessments_01_age_gate on public.symptom_triage_assessments;
create trigger symptom_triage_assessments_01_age_gate
  before insert on public.symptom_triage_assessments
  for each row execute function private.symptom_triage_assessments_age_gate();

-- What the screen and the server action ask before a check starts: the caller, or a person they hold a medical_history grant for.
create or replace function public.symptom_checker_eligibility(p_subject uuid default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_subject uuid := coalesce(p_subject, (select auth.uid()));
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if v_subject <> v_uid and not private.can_read_clinical(v_subject, 'medical_history'::public.care_access_category) then
    raise exception 'not found' using errcode = '42501';
  end if;
  return jsonb_build_object('status', private.symptom_checker_age_status(v_subject));
end $$;
revoke all on function public.symptom_checker_eligibility(uuid) from public;
grant execute on function public.symptom_checker_eligibility(uuid) to authenticated;
comment on function public.symptom_checker_eligibility(uuid) is
  'S59b: ok | dob_required | under_18. Under 18 is refused until a paediatric pathway is in the signed protocol; no date of birth is refused.';

update public.go_live_guards
   set enforced_in = enforced_in || array['symptom_triage_assessments age gate (trigger symptom_triage_assessments_01_age_gate: under 18 or no date of birth refused)']
 where key = 'symptom_checker_enabled'
   and not (enforced_in @> array['symptom_triage_assessments age gate (trigger symptom_triage_assessments_01_age_gate: under 18 or no date of birth refused)']);

-- ---------------------------------------------------------------------------
-- 2. Members only: asking a clinician to look at a check
-- ---------------------------------------------------------------------------
-- Same body as S60 (with its review fixes) plus one gate: the person the check is FOR must be a Member. TM001 = membership required.
create or replace function public.request_symptom_review(p_assessment uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  a public.symptom_triage_assessments%rowtype;
  r public.symptom_reviews%rowtype;
  v_sla_version integer;
  v_minutes integer;
  v_task uuid;
  v_test boolean;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into a from public.symptom_triage_assessments where id = p_assessment;
  -- the same answer for "no such assessment" and "not yours": never confirm another person's assessment exists
  -- Same rule as the read policy on symptom_reviews: the patient, or someone who CURRENTLY holds a clinical-read grant for them.
  if not found or not (a.patient_id = v_uid or private.can_read_clinical(a.patient_id, 'medical_history'::public.care_access_category)) then
    raise exception 'not found' using errcode = '42501';
  end if;
  -- INV-14: a closed checker starts nothing, whatever the app sent
  if not private.go_live_open_patient('symptom_checker_enabled', a.patient_id) then
    raise exception 'The symptom checker is not open yet' using errcode = '42501';
  end if;
  -- S59b (founder 2026-10-07): a clinician's look at a check is a Membership benefit. An existing request is still returned (below),
  -- so a person whose membership ended does not lose sight of a review already asked for.
  select * into r from public.symptom_reviews where assessment_id = a.id;
  if not found and not private.patient_is_member(a.patient_id) then
    raise exception 'membership_required' using errcode = 'TM001';
  end if;

  if not found then
    select s.sla_version, s.minutes into v_sla_version, v_minutes from private.symptom_review_sla() s;
    select coalesce(is_test, false) into v_test from public.profiles where id = a.patient_id;
    insert into public.symptom_reviews
      (organisation_id, assessment_id, patient_id, recorded_by, sla_version, stated_minutes, due_at, protocol_version, is_test)
    values
      (a.organisation_id, a.id, a.patient_id, v_uid, v_sla_version, v_minutes,
       case when v_minutes is null then null else now() + make_interval(mins => v_minutes) end, a.protocol_version, coalesce(v_test, false))
    on conflict (assessment_id) do nothing;
    select * into r from public.symptom_reviews where assessment_id = a.id;
  end if;

  -- The work item. A repeat request retries it if the first attempt failed; a failure is loud, never a silent success.
  if r.task_id is null and r.status = 'requested' then
    begin
      v_task := private.create_clinical_task(r.patient_id, 'symptom_review', r.stated_minutes, 'symptom_review:' || r.id, null, null, null);
      update public.symptom_reviews set task_id = v_task where id = r.id;
      r.task_id := v_task;
    exception when others then
      insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
        values (r.organisation_id, v_uid, 'symptom_review.task_error', 'symptom_review', r.id, jsonb_build_object('error', sqlerrm));
      perform private.page_incident(r.organisation_id, 'symptom_review_task_failed:' || r.id, 'A symptom review request has no task',
        'A patient asked for a symptom review and the clinical task could not be created; see audit_log action symptom_review.task_error. Asking again retries it.');
    end;
  end if;

  return jsonb_build_object('review_id', r.id, 'status', r.status, 'stated_minutes', r.stated_minutes, 'due_at', r.due_at, 'has_task', r.task_id is not null);
end $$;
revoke all on function public.request_symptom_review(uuid) from public;
grant execute on function public.request_symptom_review(uuid) to authenticated;

-- Whether the person a check is for is a Member, for the screen (it hides the request button and says so). Same reach as the context.
create or replace function public.symptom_review_entitled(p_subject uuid default null) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_subject uuid := coalesce(p_subject, (select auth.uid()));
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if v_subject <> v_uid and not private.can_read_clinical(v_subject, 'medical_history'::public.care_access_category) then
    raise exception 'not found' using errcode = '42501';
  end if;
  return private.patient_is_member(v_subject);
end $$;
revoke all on function public.symptom_review_entitled(uuid) from public;
grant execute on function public.symptom_review_entitled(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Close the org-wide staff read (INV-12)
-- ---------------------------------------------------------------------------
drop policy if exists symptom_triage_assessments_select on public.symptom_triage_assessments;
create policy symptom_triage_assessments_select on public.symptom_triage_assessments
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.can_read_clinical(patient_id, 'medical_history'::public.care_access_category)
  );

-- The org-wide staff UPDATE (override and safety-flag annotation) is replaced by an audited, tied function. There was no app consumer.
drop policy if exists symptom_triage_assessments_update on public.symptom_triage_assessments;
revoke update on public.symptom_triage_assessments from authenticated;

-- A clinician's override of the checker's category (the clinician_override discipline): tied to the patient, reviewing tier, a
-- written reason, one audit row. It only RECORDS the override; it never lowers what the patient was told or reverses an escalation.
create or replace function public.override_symptom_assessment(p_assessment uuid, p_category public.triage_category, p_reason text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  a public.symptom_triage_assessments%rowtype;
  v_staff uuid;
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if v_uid is null or not private.is_reviewing_clinician() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select * into a from public.symptom_triage_assessments where id = p_assessment;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if not private.can_staff_read_clinical(a.patient_id, 'medical_history'::public.care_access_category) then
    perform private.audit_chart_read(a.patient_id, array['symptom_session'], 'override attempt: ' || p_reason, 'denied');
    return jsonb_build_object('status', 'denied');
  end if;
  select id into v_staff from public.clinical_staff where profile_id = v_uid and active limit 1;
  if v_staff is null then raise exception 'not authorised' using errcode = '42501'; end if;
  update public.symptom_triage_assessments
     set override_category = p_category, override_reason = btrim(p_reason), overridden_by = v_staff, overridden_at = now()
   where id = a.id;
  perform private.audit_chart_read(a.patient_id, array['symptom_session'], 'override recorded: ' || p_reason, 'success');
  return jsonb_build_object('status', 'ok');
end $$;
revoke all on function public.override_symptom_assessment(uuid, public.triage_category, text) from public;
grant execute on function public.override_symptom_assessment(uuid, public.triage_category, text) to authenticated;

-- The safety-monitoring view ran as its owner and was granted to every signed-in person: any patient could read every
-- organisation's counts. Aggregates now come through a function for an admin or the CMO, for their own organisation only.
revoke all on public.triage_safety_monitoring from public, anon, authenticated;

create or replace function public.symptom_safety_monitoring() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v jsonb;
begin
  if (select auth.uid()) is null or not (private.is_admin() or private.credential_is_cmo()) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select to_jsonb(m) into v from public.triage_safety_monitoring m where m.organisation_id = private.caller_org();
  return coalesce(v, '{}'::jsonb);
end $$;
revoke all on function public.symptom_safety_monitoring() from public;
grant execute on function public.symptom_safety_monitoring() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Self-checks
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'symptom_triage_assessments'
               and (qual ilike '%is_org_staff%' or with_check ilike '%is_org_staff%')) then
    raise exception 'S59b assertion: a staff-wide policy still exists on symptom_triage_assessments';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'symptom_triage_assessments' and cmd in ('UPDATE', 'ALL', 'DELETE', 'INSERT')) then
    raise exception 'S59b assertion: a write policy still exists on symptom_triage_assessments';
  end if;
  if has_table_privilege('authenticated', 'public.symptom_triage_assessments', 'UPDATE') then
    raise exception 'S59b assertion: authenticated can still update symptom_triage_assessments';
  end if;
  if has_table_privilege('authenticated', 'public.triage_safety_monitoring', 'SELECT') or has_table_privilege('anon', 'public.triage_safety_monitoring', 'SELECT') then
    raise exception 'S59b assertion: triage_safety_monitoring is still readable by a client role';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.symptom_triage_assessments'::regclass and tgname = 'symptom_triage_assessments_01_age_gate') then
    raise exception 'S59b assertion: the age gate trigger is missing';
  end if;
  if has_function_privilege('anon', 'public.symptom_checker_eligibility(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.symptom_review_entitled(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.override_symptom_assessment(uuid,public.triage_category,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.symptom_safety_monitoring()', 'EXECUTE')
     or has_function_privilege('anon', 'public.request_symptom_review(uuid)', 'EXECUTE') then
    raise exception 'S59b assertion: anon can execute a symptom function';
  end if;
end $$;
