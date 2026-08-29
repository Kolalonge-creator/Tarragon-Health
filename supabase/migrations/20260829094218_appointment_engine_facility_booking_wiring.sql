-- Tarragon Health — Appointment Engine, Phase 7 (facility booking wiring)
--
-- 69.5 booking pipeline: Referral/Service -> Facility -> Clinician -> Date ->
-- Time -> Payment -> Confirmation. appointments.facility_id is the missing
-- link; provider_availability_rules.facility_id lets a clinician publish a
-- different recurring schedule per facility (Mon at Facility A, Wed at
-- Facility B is a real shift pattern, not an edge case). Both nullable —
-- a telemedicine appointment_type has no facility at all, and an existing
-- rule with no facility keeps working exactly as before (treated as
-- "not facility-scoped", same as a rule with no `location` today).
--
-- 69.6 pre-appointment preparation: preparation_instructions/
-- documents_required/investigations_required are plain columns on the
-- appointment itself (denormalised at booking time), not a live-editable
-- template a later facility_services change could silently rewrite —
-- matches how `service`/`location` are already free text captured once at
-- booking, not joined live from facility_services on every read.
--
-- get_available_appointment_slots() gains facility_id/facility_name output
-- columns and an optional p_facility_id filter, so a patient can search
-- "physical_clinic at Facility X" the same way they already search by
-- clinician. hold_appointment_slot() gains matching input parameters.
-- Both functions are dropped and recreated (not CREATE OR REPLACE) because
-- their signatures/return shapes change — Postgres treats a new parameter
-- list as a distinct overload rather than a replacement, which would leave
-- the old signature callable and undermine the point.

alter table public.appointments
  add column facility_id             uuid references public.facilities (id) on delete set null,
  add column preparation_instructions text,
  add column documents_required      text[] not null default '{}',
  add column investigations_required text[] not null default '{}';

create index appointments_facility_idx on public.appointments (facility_id) where facility_id is not null;
create index appointments_facility_time_idx on public.appointments (facility_id, scheduled_for) where facility_id is not null;

comment on column public.appointments.facility_id is
  '69.5: the physical facility this appointment is at. Null for telemedicine and for any appointment_type not tied to a physical location.';
comment on column public.appointments.preparation_instructions is
  '69.6: free-text prep the patient should know before the visit (e.g. "fast for 8 hours"). Captured once at booking time, not joined live from facility_services.';
comment on column public.appointments.documents_required is
  '69.6: what the patient should bring (e.g. "photo ID", "referral letter").';
comment on column public.appointments.investigations_required is
  '69.6: investigations the patient needs done ahead of the visit (e.g. "fasting lipid panel") — a free-text list, not a lab_orders FK; ordering the actual test stays lab_orders'' job.';

alter table public.provider_availability_rules
  add column facility_id uuid references public.facilities (id) on delete set null;

create index provider_availability_rules_facility_idx on public.provider_availability_rules (facility_id) where facility_id is not null;

comment on column public.provider_availability_rules.facility_id is
  '69.5/69.9: which facility this recurring window is published at. Null means the rule is not facility-scoped (e.g. a telemedicine-only rule).';

-- ---------------------------------------------------------------------------
-- hold_appointment_slot — same logic as 20260828001600, plus facility_id and
-- the 69.6 prep fields, all appended as trailing default-valued parameters
-- and copied straight onto the inserted row.
-- ---------------------------------------------------------------------------
drop function if exists public.hold_appointment_slot(uuid, uuid, public.appointment_type, public.appointment_consultation_method, timestamptz, timestamptz, text, text, text, uuid, uuid, uuid, integer);

create function public.hold_appointment_slot(
  p_organisation_id uuid,
  p_clinician_id uuid,
  p_appointment_type public.appointment_type,
  p_consultation_method public.appointment_consultation_method,
  p_scheduled_for timestamptz,
  p_ends_at timestamptz,
  p_reason text default null,
  p_service text default null,
  p_location text default null,
  p_specialist_referral_id uuid default null,
  p_care_plan_id uuid default null,
  p_patient_id uuid default null,
  p_hold_minutes integer default 10,
  p_facility_id uuid default null,
  p_preparation_instructions text default null,
  p_documents_required text[] default '{}',
  p_investigations_required text[] default '{}'
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_patient uuid;
  v_org uuid;
  v_is_high_priority boolean := false;
  v_result public.appointments;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  v_patient := coalesce(p_patient_id, v_uid);
  select organisation_id into v_org from public.profiles where id = v_uid;
  if v_org is distinct from p_organisation_id then
    raise exception 'not authorized for this organisation';
  end if;
  if v_patient <> v_uid and not private.is_org_staff(p_organisation_id) then
    raise exception 'only staff may book on behalf of another patient';
  end if;

  if p_scheduled_for <= now() then
    raise exception 'that time has passed — pick another slot';
  end if;
  if p_ends_at <= p_scheduled_for then
    raise exception 'invalid time range';
  end if;

  if p_specialist_referral_id is not null then
    select (urgency in ('urgent', 'priority')) into v_is_high_priority
    from public.specialist_referrals
    where id = p_specialist_referral_id and organisation_id = p_organisation_id;
  end if;

  begin
    insert into public.appointments (
      organisation_id, patient_id, clinician_id, appointment_type, consultation_method,
      scheduled_for, ends_at, status, reason, service, location,
      specialist_referral_id, care_plan_id, booked_by, is_high_priority, hold_expires_at,
      facility_id, preparation_instructions, documents_required, investigations_required
    ) values (
      p_organisation_id, v_patient, p_clinician_id, p_appointment_type, p_consultation_method,
      p_scheduled_for, p_ends_at, 'held', p_reason, p_service, p_location,
      p_specialist_referral_id, p_care_plan_id, v_uid, coalesce(v_is_high_priority, false),
      now() + (p_hold_minutes * interval '1 minute'),
      p_facility_id, p_preparation_instructions,
      coalesce(p_documents_required, '{}'), coalesce(p_investigations_required, '{}')
    )
    returning * into v_result;
  exception
    when exclusion_violation then
      raise exception 'that time was just taken — pick another slot';
  end;

  return v_result;
end;
$$;

comment on function public.hold_appointment_slot(uuid, uuid, public.appointment_type, public.appointment_consultation_method, timestamptz, timestamptz, text, text, text, uuid, uuid, uuid, integer, uuid, text, text[], text[]) is
  '10.6/10.7/69.5/69.6: inserts a held appointment, now facility- and preparation-aware. The appointments_no_provider_overlap EXCLUDE constraint is the actual concurrency guard, this function only turns its error into a friendly one.';

revoke execute on function public.hold_appointment_slot(uuid, uuid, public.appointment_type, public.appointment_consultation_method, timestamptz, timestamptz, text, text, text, uuid, uuid, uuid, integer, uuid, text, text[], text[]) from public, anon;
grant execute on function public.hold_appointment_slot(uuid, uuid, public.appointment_type, public.appointment_consultation_method, timestamptz, timestamptz, text, text, text, uuid, uuid, uuid, integer, uuid, text, text[], text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- get_available_appointment_slots — same logic as 20260828000941, plus an
-- optional facility filter and facility_id/facility_name in the result.
-- ---------------------------------------------------------------------------
drop function if exists public.get_available_appointment_slots(uuid, public.appointment_type, public.appointment_consultation_method, uuid, date, date);

create function public.get_available_appointment_slots(
  p_organisation_id uuid,
  p_appointment_type public.appointment_type,
  p_consultation_method public.appointment_consultation_method default null,
  p_clinician_id uuid default null,
  p_from date default current_date,
  p_to date default current_date + 13,
  p_facility_id uuid default null
)
returns table (
  clinician_id uuid,
  clinician_name text,
  slot_start timestamptz,
  slot_end timestamptz,
  consultation_method public.appointment_consultation_method,
  location text,
  facility_id uuid,
  facility_name text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_organisation_id is distinct from private.current_org_id() and not private.is_org_staff(p_organisation_id) then
    raise exception 'not authorized for this organisation';
  end if;
  if p_to < p_from then
    raise exception 'p_to must not be before p_from';
  end if;
  if p_to - p_from > 60 then
    raise exception 'date range too large — 60 days max';
  end if;

  return query
  with days as (
    select d::date as the_date
    from generate_series(p_from, p_to, interval '1 day') as d
  ),
  candidate_rules as (
    select r.*
    from public.provider_availability_rules r
    where r.organisation_id = p_organisation_id
      and r.is_active
      and p_appointment_type = any (r.appointment_types)
      and (p_consultation_method is null or r.consultation_method = p_consultation_method)
      and (p_clinician_id is null or r.clinician_id = p_clinician_id)
      and (p_facility_id is null or r.facility_id = p_facility_id)
  ),
  rule_days as (
    select cr.*, dd.the_date
    from candidate_rules cr
    join days dd on extract(dow from dd.the_date)::smallint = cr.day_of_week
    where dd.the_date >= cr.effective_from
      and (cr.effective_until is null or dd.the_date <= cr.effective_until)
  ),
  raw_slots as (
    select
      rd.clinician_id,
      rd.consultation_method,
      rd.location,
      rd.facility_id,
      gs as slot_start,
      gs + (rd.slot_duration_minutes * interval '1 minute') as slot_end
    from rule_days rd
    cross join lateral generate_series(
      (rd.the_date + rd.start_time)::timestamptz,
      (rd.the_date + rd.end_time)::timestamptz - (rd.slot_duration_minutes * interval '1 minute'),
      (rd.slot_duration_minutes + rd.buffer_minutes) * interval '1 minute'
    ) as gs
  )
  select
    rs.clinician_id,
    p.full_name as clinician_name,
    rs.slot_start,
    rs.slot_end,
    rs.consultation_method,
    rs.location,
    rs.facility_id,
    f.name as facility_name
  from raw_slots rs
  join public.profiles p on p.id = rs.clinician_id
  left join public.facilities f on f.id = rs.facility_id
  where rs.slot_start > now()
    and not exists (
      select 1 from public.provider_time_off t
      where t.clinician_id = rs.clinician_id
        and tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(rs.slot_start, rs.slot_end, '[)')
    )
    and not exists (
      select 1 from public.appointments a
      where a.clinician_id = rs.clinician_id
        and a.status not in ('cancelled', 'patient_cancelled', 'provider_cancelled', 'no_show', 'expired', 'failed', 'rescheduled')
        and tstzrange(a.scheduled_for, a.ends_at, '[)') && tstzrange(rs.slot_start, rs.slot_end, '[)')
    )
  order by rs.slot_start, rs.clinician_id;
end;
$$;

comment on function public.get_available_appointment_slots(uuid, public.appointment_type, public.appointment_consultation_method, uuid, date, date, uuid) is
  '10.4/10.5/69.5: expands provider_availability_rules into concrete bookable slots, netting out provider_time_off and any non-terminal existing appointment, optionally filtered to one facility. Read-only and race-tolerant by construction — the actual double-booking guard is the appointments_no_provider_overlap EXCLUDE constraint enforced at hold time, not this function.';

revoke execute on function public.get_available_appointment_slots(uuid, public.appointment_type, public.appointment_consultation_method, uuid, date, date, uuid) from public, anon;
grant execute on function public.get_available_appointment_slots(uuid, public.appointment_type, public.appointment_consultation_method, uuid, date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- reschedule_appointment — same logic as 20260828001600, now also carrying
-- facility_id and the 69.6 prep fields forward onto the new row (a
-- reschedule keeps the same facility/prep context, not just the same
-- clinician/type).
-- ---------------------------------------------------------------------------
create or replace function public.reschedule_appointment(
  p_appointment_id uuid,
  p_new_scheduled_for timestamptz,
  p_new_ends_at timestamptz
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_old public.appointments;
  v_new public.appointments;
begin
  select * into v_old from public.appointments where id = p_appointment_id for update;
  if v_old.id is null then
    raise exception 'appointment not found';
  end if;
  if v_old.patient_id <> v_uid and not private.is_org_staff(v_old.organisation_id) then
    raise exception 'not authorized';
  end if;
  if v_old.status not in ('held', 'booked', 'confirmed') then
    raise exception 'cannot reschedule an appointment that is %', v_old.status;
  end if;
  if p_new_ends_at <= p_new_scheduled_for or p_new_scheduled_for <= now() then
    raise exception 'invalid new time';
  end if;

  begin
    insert into public.appointments (
      organisation_id, patient_id, clinician_id, appointment_type, consultation_method,
      scheduled_for, ends_at, status, reason, service, location, payment_status,
      specialist_referral_id, care_plan_id, booked_by, is_high_priority, rescheduled_from_id,
      facility_id, preparation_instructions, documents_required, investigations_required
    )
    select
      organisation_id, patient_id, clinician_id, appointment_type, consultation_method,
      p_new_scheduled_for, p_new_ends_at, 'booked', reason, service, location, payment_status,
      specialist_referral_id, care_plan_id, v_uid, is_high_priority, id,
      facility_id, preparation_instructions, documents_required, investigations_required
    from public.appointments where id = p_appointment_id
    returning * into v_new;
  exception
    when exclusion_violation then
      raise exception 'that new time was just taken — pick another slot';
  end;

  update public.appointments set status = 'rescheduled' where id = p_appointment_id;

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
  values (
    v_new.organisation_id, v_new.patient_id, 'whatsapp', 'pending', 'appointment_rescheduled',
    jsonb_build_object('old_appointment_id', v_old.id, 'new_appointment_id', v_new.id, 'scheduled_for', v_new.scheduled_for),
    'non_clinical'
  );

  return v_new;
end;
$$;

revoke execute on function public.reschedule_appointment(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.reschedule_appointment(uuid, timestamptz, timestamptz) to authenticated;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'appointments' and column_name = 'facility_id'
  ) then
    raise exception 'appointments.facility_id missing after migration';
  end if;

  if has_function_privilege('anon', 'public.hold_appointment_slot(uuid, uuid, public.appointment_type, public.appointment_consultation_method, timestamptz, timestamptz, text, text, text, uuid, uuid, uuid, integer, uuid, text, text[], text[])', 'EXECUTE') then
    raise exception 'FAIL: anon can execute hold_appointment_slot';
  end if;
  if has_function_privilege('anon', 'public.get_available_appointment_slots(uuid, public.appointment_type, public.appointment_consultation_method, uuid, date, date, uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute get_available_appointment_slots';
  end if;

  -- The pre-facility 13-arg/6-arg overloads must be gone, not just
  -- shadowed, so nothing can still book/search without facility awareness —
  -- the explicit `drop function` above should have removed them; this
  -- confirms exactly one overload of each survives (a stray extra one would
  -- mean the old signature is still callable).
  if (
    select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'hold_appointment_slot'
  ) <> 1 then
    raise exception 'expected exactly one hold_appointment_slot overload after this migration';
  end if;
  if (
    select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_available_appointment_slots'
  ) <> 1 then
    raise exception 'expected exactly one get_available_appointment_slots overload after this migration';
  end if;

  raise notice 'PASS: facility-aware booking pipeline (hold/search/reschedule) in place';
end $$;
