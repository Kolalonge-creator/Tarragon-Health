-- Tarragon Health — Appointment Engine index cleanup
--
-- Per mcp__Supabase__get_advisors (performance): appointments_patient_time_idx
-- duplicates the pre-existing appointments_patient_idx (both cover
-- (patient_id, scheduled_for desc)) — drop the redundant one this feature
-- introduced rather than the original. The remaining findings are real
-- unindexed-foreign-key warnings on the new tables/columns; every "index not
-- used" finding is expected noise from a feature with zero production rows
-- yet and needs no action.

drop index if exists public.appointments_patient_time_idx;

create index appointments_booked_by_idx on public.appointments (booked_by) where booked_by is not null;
create index appointments_cancelled_by_idx on public.appointments (cancelled_by) where cancelled_by is not null;
create index appointments_rescheduled_from_idx on public.appointments (rescheduled_from_id) where rescheduled_from_id is not null;
create index appointments_video_consultation_idx on public.appointments (video_consultation_id) where video_consultation_id is not null;

create index provider_time_off_org_idx on public.provider_time_off (organisation_id);
create index provider_time_off_created_by_idx on public.provider_time_off (created_by) where created_by is not null;

create index appointment_waiting_list_clinician_idx on public.appointment_waiting_list (clinician_id) where clinician_id is not null;
create index appointment_waiting_list_offered_appointment_idx on public.appointment_waiting_list (offered_appointment_id) where offered_appointment_id is not null;
create index appointment_waiting_list_source_appointment_idx on public.appointment_waiting_list (source_appointment_id) where source_appointment_id is not null;

do $$
begin
  if exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'appointments_patient_time_idx') then
    raise exception 'appointments_patient_time_idx still exists after drop';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'appointment_waiting_list_source_appointment_idx') then
    raise exception 'appointment_waiting_list_source_appointment_idx missing after migration';
  end if;
  raise notice 'PASS: duplicate index dropped, FK-covering indexes added';
end $$;
