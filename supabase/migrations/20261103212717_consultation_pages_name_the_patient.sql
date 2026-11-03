-- Consultation pages name the patient (founder ask after the first live video consultation, 2026-11-03).
--
-- A doctor opening /clinician/consultations saw only the patient's first name and had no link to the record, so they
-- did not know who they were about to call. Two scoped reads, both answered only to the clinician the encounter is
-- assigned to (INV-12), nothing from the chart (INV-10 reads stay on their audited paths):
--
--   1. public.my_clinician_encounters: redefined from the LIVE body (pg_get_functiondef, 2026-11-03) with three more
--      columns per row, patient_id, patient_full_name and patient_is_test. Same rows, same window, same order, same cap.
--   2. public.consultation_patient_header(p_encounter): the same three fields for ONE encounter, for the pre-call page
--      and the room page. Null for anyone who is not that encounter's clinician, including the patient and another doctor.
--
-- patient_is_test rides along so every staff screen can badge a test account next to the name (INV-13, PR #1651).

create or replace function public.my_clinician_encounters(p_from timestamptz default null, p_to timestamptz default null)
returns jsonb
language sql
stable security definer
set search_path to ''
as $function$
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.scheduled_at), '[]'::jsonb)
    from (
      select e.id as encounter_id, e.type, e.status, e.scheduled_at, e.final_media_mode,
             split_part(coalesce(p.full_name, ''), ' ', 1) as patient_first_name,
             e.patient_id,
             p.full_name as patient_full_name,
             coalesce(p.is_test, false) as patient_is_test
        from public.encounters e
        join public.profiles p on p.id = e.patient_id
       where e.clinician_id = (select auth.uid())
         and e.scheduled_at >= coalesce(p_from, date_trunc('day', now()))
         and e.scheduled_at < coalesce(p_to, date_trunc('day', now()) + interval '2 days')
       order by e.scheduled_at
       limit 200
    ) x;
$function$;

revoke all on function public.my_clinician_encounters(timestamptz, timestamptz) from public, anon;
grant execute on function public.my_clinician_encounters(timestamptz, timestamptz) to authenticated;

create or replace function public.consultation_patient_header(p_encounter uuid)
returns jsonb
language sql
stable security definer
set search_path to ''
as $function$
  select jsonb_build_object(
           'patient_id', e.patient_id,
           'patient_full_name', p.full_name,
           'patient_is_test', coalesce(p.is_test, false))
    from public.encounters e
    join public.profiles p on p.id = e.patient_id
   where e.id = p_encounter
     and e.clinician_id = (select auth.uid());
$function$;

comment on function public.consultation_patient_header(uuid) is
  'Who the doctor is about to call: the patient''s id, full name and test flag for one encounter, answered only to the clinician it is assigned to (INV-12). Not a chart read.';

revoke all on function public.consultation_patient_header(uuid) from public, anon;
grant execute on function public.consultation_patient_header(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.consultation_patient_header(uuid)', 'EXECUTE') then
    raise exception 'anon can execute consultation_patient_header';
  end if;
  if has_function_privilege('anon', 'public.my_clinician_encounters(timestamptz, timestamptz)', 'EXECUTE') then
    raise exception 'anon can execute my_clinician_encounters';
  end if;
end $$;
