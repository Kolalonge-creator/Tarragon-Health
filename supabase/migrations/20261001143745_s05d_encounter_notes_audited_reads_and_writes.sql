-- S05d: clinical_encounter_notes moves to the audited path and the direct staff path closes (INV-10, INV-12, OQ-54: one surface at a time).
--
-- Counted first (live, 2026-10-01): clinical_encounter_notes 0 rows. Staff user-session call sites (code scan, all in one file plus the
-- clinician home page): list / create / update-draft / finalize hooks in lib/queries/encounter-notes.ts, the "notes to complete" worklist
-- (app shell banner and clinician home). Database: every function that reads the table is SECURITY DEFINER except
-- private.validate_note_amendment (added in S05), which is made SECURITY DEFINER here; the only view is the S05 `notes` view, reached
-- only through audited functions. FKs into the table (follow-ups, summaries, prescriptions) are checked by the table owner.
--
-- Because nothing may read the table directly any more, UPDATE and the staff INSERT also need a row they can see, so the write paths
-- become SECURITY DEFINER functions that apply the tie (INV-12) and then let the existing triggers do what they always did
-- (private.enforce_clinical_encounter_note_attribution derives the author, status and sign-off from auth.uid(); finalized notes stay
-- immutable; CHECKs still require identity confirmation and an outcome).
--
-- Reads:
--   read_patient_encounter_notes_audited(patient, reason) -> {status: ok | own_only | denied, notes: [...]}
--     ok        the caller is tied (or has break-glass / a support session): every note, audited with its access basis.
--     own_only  the caller is not tied but authored some notes (an assignment ended before she signed): only hers, so she can finish them.
--     denied    nothing; the refusal is audited. Never an empty list standing in for a refusal.
--   my_pending_auto_drafted_notes() -> the caller's own auto-drafted notes still awaiting her review (the "notes to complete" worklist).
--     Own-authored work only, unaudited on purpose: it loads on every clinician page.
-- Writes: create_encounter_note, update_encounter_note_draft, finalize_encounter_note.
-- The closing of the table (dropping its SELECT / INSERT / UPDATE policies) is the NEXT migration, applied only after the code that uses
-- these functions has deployed: until then the live app still reads and writes the table directly.

alter function private.validate_note_amendment() security definer;
alter function private.validate_note_amendment() set search_path = '';

-- Access basis in the audit row learns about authorship.
create or replace function private.audit_chart_read(p_patient uuid, p_sections text[], p_reason text, p_result text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_basis text;
begin
  v_basis := case
    when private.clinician_has_patient_access(p_patient) then 'tied'
    when private.has_emergency_access(p_patient) then 'break_glass'
    when private.can_support_view(p_patient) then 'support_view'
    when exists (select 1 from public.clinical_encounter_notes n join public.clinical_staff cs on cs.id = n.authored_by_staff
                  where n.patient_id = p_patient and cs.profile_id = (select auth.uid())) then 'author'
    else 'none'
  end;
  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event, reason, result, subject_patient_id, ip)
  select pr.organisation_id, (select auth.uid()), 'staff.chart_read', 'patient_chart', pr.id,
         jsonb_build_object('reason', btrim(p_reason), 'sections', to_jsonb(p_sections), 'basis', v_basis),
         btrim(p_reason), p_result, pr.id, private.request_ip()
    from public.profiles pr
   where pr.id = p_patient
  returning id into v_id;
  if v_id is null then
    raise exception 'unknown patient' using errcode = '22023';
  end if;
  return v_id;
end;
$$;
revoke all on function private.audit_chart_read(uuid, text[], text, text) from public, anon, authenticated;

create or replace function private.my_clinical_staff_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.clinical_staff where profile_id = (select auth.uid()) and active limit 1;
$$;
revoke all on function private.my_clinical_staff_id() from public, anon;
grant execute on function private.my_clinical_staff_id() to authenticated;

create or replace function public.read_patient_encounter_notes_audited(p_patient uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_page constant integer := 500;                      -- technical page size, not a clinical value
  v_staff uuid := private.my_clinical_staff_id();
  v_all boolean;
  v_notes jsonb;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if (select auth.uid()) is null
     or exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'patient') then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  v_all := private.can_staff_read_clinical(p_patient, 'appointments_care_plan');
  if not v_all and (v_staff is null or not exists (
       select 1 from public.clinical_encounter_notes n where n.patient_id = p_patient and n.authored_by_staff = v_staff)) then
    perform private.audit_chart_read(p_patient, array['notes'], p_reason, 'denied');
    return jsonb_build_object('status', 'denied', 'notes', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.encounter_date desc), '[]'::jsonb) into v_notes from (
    select n.* from public.clinical_encounter_notes n
     where n.patient_id = p_patient and (v_all or n.authored_by_staff = v_staff)
     order by n.encounter_date desc limit c_page) x;

  perform private.audit_chart_read(p_patient, array['notes'], p_reason, 'success');
  return jsonb_build_object('status', case when v_all then 'ok' else 'own_only' end, 'notes', v_notes);
end;
$$;

create or replace function public.my_pending_auto_drafted_notes()
returns table (id uuid, patient_id uuid, encounter_type text, reason_for_encounter text, encounter_date timestamptz, patient_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select n.id, n.patient_id, n.encounter_type, n.reason_for_encounter, n.encounter_date, p.full_name
    from public.clinical_encounter_notes n
    join public.profiles p on p.id = n.patient_id
   where n.authored_by_staff = private.my_clinical_staff_id()
     and n.auto_generated and n.status = 'draft'
   order by n.encounter_date asc;
$$;

create or replace function public.create_encounter_note(
  p_patient uuid, p_encounter_type text, p_reason text,
  p_history text default null, p_examination text default null, p_assessment text default null, p_diagnosis text default null,
  p_plan text default null, p_follow_up text default null,
  p_video_consultation_id uuid default null, p_escalation_id uuid default null, p_async_consult_id uuid default null,
  p_call_started_at timestamptz default null, p_call_ended_at timestamptz default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select organisation_id into v_org from public.profiles where id = p_patient and role = 'patient';
  if v_org is null then
    raise exception 'patient not found' using errcode = 'P0002';
  end if;
  -- INV-12: you cannot start a note about a patient you cannot see.
  if not private.can_staff_read_clinical(p_patient, 'appointments_care_plan') then
    raise exception 'not authorised for this patient' using errcode = '42501';
  end if;
  -- The BEFORE INSERT trigger still requires an active clinical-tier member and derives the author and status.
  insert into public.clinical_encounter_notes
    (organisation_id, patient_id, encounter_type, reason_for_encounter, history, examination_findings, assessment, diagnosis, plan,
     follow_up_instructions, video_consultation_id, escalation_id, async_consult_id, call_started_at, call_ended_at)
  values
    (v_org, p_patient, p_encounter_type, p_reason, p_history, p_examination, p_assessment, p_diagnosis, p_plan,
     p_follow_up, p_video_consultation_id, p_escalation_id, p_async_consult_id, p_call_started_at, p_call_ended_at)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function private.may_work_on_note(p_note uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_patient uuid;
  v_author uuid;
begin
  select patient_id, authored_by_staff into v_patient, v_author from public.clinical_encounter_notes where id = p_note;
  if v_patient is null then
    raise exception 'note not found' using errcode = 'P0002';
  end if;
  if (select auth.uid()) is null
     or not (v_author = private.my_clinical_staff_id() or private.can_staff_read_clinical(v_patient, 'appointments_care_plan')) then
    raise exception 'not authorised for this note' using errcode = '42501';
  end if;
  return v_patient;
end;
$$;
revoke all on function private.may_work_on_note(uuid) from public, anon, authenticated;

create or replace function public.update_encounter_note_draft(p_note uuid, p_fields jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.may_work_on_note(p_note);
  update public.clinical_encounter_notes n set
    reason_for_encounter   = case when p_fields ? 'reason_for_encounter'   then p_fields ->> 'reason_for_encounter'   else n.reason_for_encounter end,
    history                = case when p_fields ? 'history'                then p_fields ->> 'history'                else n.history end,
    examination_findings   = case when p_fields ? 'examination_findings'   then p_fields ->> 'examination_findings'   else n.examination_findings end,
    assessment             = case when p_fields ? 'assessment'             then p_fields ->> 'assessment'             else n.assessment end,
    diagnosis              = case when p_fields ? 'diagnosis'              then p_fields ->> 'diagnosis'              else n.diagnosis end,
    plan                   = case when p_fields ? 'plan'                   then p_fields ->> 'plan'                   else n.plan end,
    follow_up_instructions = case when p_fields ? 'follow_up_instructions' then p_fields ->> 'follow_up_instructions' else n.follow_up_instructions end
  where n.id = p_note;
end;
$$;

create or replace function public.finalize_encounter_note(p_note uuid, p_outcome public.consultation_outcome, p_identity_confirmed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.may_work_on_note(p_note);
  -- The trigger stamps finalized_by_staff / finalized_at / identity confirmation, and the CHECKs require an outcome and identity.
  update public.clinical_encounter_notes
     set status = 'finalized', outcome = p_outcome, identity_confirmed = p_identity_confirmed
   where id = p_note;
end;
$$;

revoke all on function public.read_patient_encounter_notes_audited(uuid, text) from public;
revoke all on function public.my_pending_auto_drafted_notes() from public;
revoke all on function public.create_encounter_note(uuid, text, text, text, text, text, text, text, text, uuid, uuid, uuid, timestamptz, timestamptz) from public;
revoke all on function public.update_encounter_note_draft(uuid, jsonb) from public;
revoke all on function public.finalize_encounter_note(uuid, public.consultation_outcome, boolean) from public;
grant execute on function public.read_patient_encounter_notes_audited(uuid, text) to authenticated;
grant execute on function public.my_pending_auto_drafted_notes() to authenticated;
grant execute on function public.create_encounter_note(uuid, text, text, text, text, text, text, text, text, uuid, uuid, uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.update_encounter_note_draft(uuid, jsonb) to authenticated;
grant execute on function public.finalize_encounter_note(uuid, public.consultation_outcome, boolean) to authenticated;

do $$
declare
  v_fn text;
begin
  if not (select prosecdef from pg_proc where oid = 'private.validate_note_amendment()'::regprocedure) then
    raise exception 'S05d assertion: validate_note_amendment is not SECURITY DEFINER';
  end if;
  foreach v_fn in array array[
    'public.read_patient_encounter_notes_audited(uuid,text)', 'public.my_pending_auto_drafted_notes()',
    'public.create_encounter_note(uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,timestamptz,timestamptz)',
    'public.update_encounter_note_draft(uuid,jsonb)', 'public.finalize_encounter_note(uuid,public.consultation_outcome,boolean)'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then
      raise exception 'S05d assertion: anon can execute %', v_fn;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'private.may_work_on_note(uuid)', 'EXECUTE') then
    raise exception 'S05d assertion: may_work_on_note is executable by authenticated';
  end if;
end $$;
