-- MSG-1 (founder decision 2026-11-04, messaging redesign): a Free member cannot open a CLINICAL care-team conversation. Routine clinical
-- messaging is a Membership benefit. Support conversations (appointment, laboratory, pharmacy, billing, technical, general) stay open to
-- everyone, and the safety path never depends on paying.
--
-- The hole this closes (found in the 2026-11-04 messaging audit): public.start_care_thread checked who the caller is and caregiver
-- access, never Membership; only the dashboard card was gated (RequiresEntitlement 'doctor_checkin'). /patient/messages had no gate at
-- all, and the table's own insert and update policies let a patient write a thread row directly, or change its category afterwards.
--
-- What changes
--   1. private.care_thread_member_clinical_gate(), BEFORE INSERT OR UPDATE OF category on care_message_threads. It refuses a thread whose
--      category is 'clinical' or 'medication' when the caller is a signed-in non-staff account (the patient, or a supporter acting for
--      them) and the patient is not a Member now (private.patient_is_member). Staff are never refused: a doctor following up a Free
--      member's dangerous result must be able to write to them. A call with no auth.uid() (service role, cron, migrations) is not a
--      person choosing a category and is let through. Enforcing it on the table, not only in the RPC, is what makes it hold against a
--      direct PostgREST insert or a later category change.
--   2. public.start_care_thread (redefined from its LIVE body, read 2026-11-04) keeps the safety path open. When a non-Member asks for a
--      clinical category and the first message matches the deterministic danger-phrase screen
--      (private.screen_care_message_for_emergency, unchanged), the thread is opened as 'general' instead of refused, so the message is
--      saved and the existing AFTER INSERT safety screen on care_messages pages a clinician exactly as it does for anyone. Without a
--      match it raises with hint 'membership_required', which the patient screen turns into the upgrade explanation.
--
-- 'laboratory' is deliberately NOT gated: for a Free member it is a lab-directory or upload question, which the founder's table keeps
-- open. A Free member asking what a result means in any open category still reaches a person; it is the later routing change (MSG-3)
-- that sends every Free member's thread to the support queue rather than to a doctor.
--
-- Live counts before (2026-11-04): 1 thread, category general; 2 active memberships. Nothing is converted or refused retroactively: the
-- trigger checks only new rows and category changes.

create or replace function private.care_thread_member_clinical_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if new.category not in ('clinical', 'medication') then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.category = new.category then
    return new;
  end if;
  if v_uid is null or private.is_org_staff(new.organisation_id) then
    return new;
  end if;
  if private.patient_is_member(new.patient_id) then
    return new;
  end if;
  raise exception 'Clinical messages to the care team are included in Membership.'
    using errcode = '42501', hint = 'membership_required';
end;
$$;

comment on function private.care_thread_member_clinical_gate() is
  'MSG-1: refuses a clinical or medication care_message_threads row (insert or category change) from a signed-in non-staff caller when the patient is not a Member. Staff and system calls pass. Hint membership_required.';

revoke all on function private.care_thread_member_clinical_gate() from public, anon, authenticated;

drop trigger if exists care_message_threads_member_clinical_gate on public.care_message_threads;
create trigger care_message_threads_member_clinical_gate
  before insert or update of category on public.care_message_threads
  for each row execute function private.care_thread_member_clinical_gate();

create or replace function public.start_care_thread(
  p_subject text,
  p_body text,
  p_patient_id uuid default null,
  p_escalation_id uuid default null,
  p_care_plan_id uuid default null,
  p_category public.care_message_category default 'general',
  p_confidential boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_patient uuid;
  v_thread_id uuid;
  v_is_staff_or_self boolean;
  v_is_staff boolean;
  v_category public.care_message_category := coalesce(p_category, 'general');
  v_matches text[];
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if length(coalesce(trim(p_subject), '')) = 0 then raise exception 'subject required'; end if;
  if length(coalesce(trim(p_body), '')) = 0 then raise exception 'message required'; end if;

  if p_patient_id is not null and p_patient_id <> v_uid then
    select organisation_id into v_org from public.profiles where id = p_patient_id;
    v_patient := p_patient_id;
    v_is_staff_or_self := private.is_org_staff(v_org);
    if v_org is null
       or not (v_is_staff_or_self or private.can_read_clinical(p_patient_id, 'messaging'::public.care_access_category)) then
      raise exception 'not authorised' using errcode = '42501';
    end if;
  else
    select organisation_id into v_org from public.profiles where id = v_uid;
    v_patient := v_uid;
    v_is_staff_or_self := true;
  end if;
  if v_org is null then raise exception 'no organisation'; end if;

  -- MSG-1: a non-Member's clinical request is refused, unless the message itself reads as a possible emergency. Then it is kept as a
  -- general thread so it is saved and the care_messages safety screen pages a clinician. Payment never stands between a patient and that.
  if v_category in ('clinical', 'medication') then
    v_is_staff := private.is_org_staff(v_org);
    if not v_is_staff and not private.patient_is_member(v_patient) then
      v_matches := private.screen_care_message_for_emergency(p_body);
      if v_matches is not null and array_length(v_matches, 1) is not null then
        v_category := 'general';
      else
        raise exception 'Clinical messages to the care team are included in Membership.'
          using errcode = '42501', hint = 'membership_required';
      end if;
    end if;
  end if;

  insert into public.care_message_threads
    (organisation_id, patient_id, subject, created_by, escalation_id, care_plan_id, category, confidential)
  values (
    v_org, v_patient, trim(p_subject), v_uid, p_escalation_id, p_care_plan_id, v_category,
    coalesce(p_confidential, false) and v_is_staff_or_self
  )
  returning id into v_thread_id;

  insert into public.care_messages (thread_id, body) values (v_thread_id, trim(p_body));

  perform private.log_care_access(v_patient, 'acted_for', 'messaging', jsonb_build_object('thread_id', v_thread_id));

  return v_thread_id;
end;
$$;
revoke execute on function public.start_care_thread(text, text, uuid, uuid, uuid, public.care_message_category, boolean) from public, anon;
grant execute on function public.start_care_thread(text, text, uuid, uuid, uuid, public.care_message_category, boolean) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'care_message_threads_member_clinical_gate' and tgrelid = 'public.care_message_threads'::regclass and not tgisinternal
  ) then
    raise exception 'FAIL: care_message_threads_member_clinical_gate trigger missing';
  end if;
  if pg_get_functiondef('public.start_care_thread(text,text,uuid,uuid,uuid,public.care_message_category,boolean)'::regprocedure)
       not like '%screen_care_message_for_emergency%'
     or pg_get_functiondef('public.start_care_thread(text,text,uuid,uuid,uuid,public.care_message_category,boolean)'::regprocedure)
       not like '%log_care_access%' then
    raise exception 'FAIL: start_care_thread lost its safety exception or its access log';
  end if;
  if has_function_privilege('anon', 'public.start_care_thread(text,text,uuid,uuid,uuid,public.care_message_category,boolean)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute start_care_thread';
  end if;
end $$;
