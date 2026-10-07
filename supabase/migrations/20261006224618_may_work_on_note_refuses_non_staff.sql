-- private.may_work_on_note let a signed-in user with no clinical_staff row through: my_clinical_staff_id() is NULL for them, so
-- `v_author = NULL` is NULL, `NULL or false` is NULL, `not NULL` is NULL and the IF was skipped. Only the body of the one function
-- changes (v_author = my_clinical_staff_id() is coalesced to false); signature, SECURITY DEFINER, search_path and grants are unchanged.
create or replace function private.may_work_on_note(p_note uuid)
 returns uuid
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_patient uuid;
  v_author uuid;
begin
  select patient_id, authored_by_staff into v_patient, v_author from public.clinical_encounter_notes where id = p_note;
  if v_patient is null then
    raise exception 'note not found' using errcode = 'P0002';
  end if;
  if (select auth.uid()) is null
     or not (coalesce(v_author = private.my_clinical_staff_id(), false) or private.can_staff_read_clinical(v_patient, 'appointments_care_plan')) then
    raise exception 'not authorised for this note' using errcode = '42501';
  end if;
  return v_patient;
end;
$function$;

do $$
begin
  if pg_get_functiondef('private.may_work_on_note(uuid)'::regprocedure) not like '%coalesce(v_author = private.my_clinical_staff_id(), false)%' then
    raise exception 'may_work_on_note was not updated';
  end if;
  if has_function_privilege('anon', 'private.may_work_on_note(uuid)', 'EXECUTE') then
    raise exception 'anon can execute may_work_on_note';
  end if;
end $$;
