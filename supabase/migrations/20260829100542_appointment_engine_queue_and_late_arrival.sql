-- Tarragon Health — Appointment Engine, Phase 7 (queue management + late arrival)
--
-- 69.8 queue: Appointment -> Checked in -> Waiting -> Called -> Consultation
-- -> Completed. checked_in already exists and doubles as "waiting" (see the
-- types migration's reasoning); this adds 'called' as an explicit staff
-- action between checked-in and in-progress, plus get_facility_queue_today()
-- so a facility's front desk can see who's waiting, in arrival order (with
-- priority patients surfaced first), without inventing a stored queue
-- position that could drift out of order — position is always computed
-- fresh from checked_in_at, the same "computed on demand, not
-- pre-materialised" discipline get_available_appointment_slots() already
-- uses.
--
-- 69.9 late arrival: the spec asks the system to "define how late arrivals
-- are handled" — this adds the mechanism (a per-org/type configurable grace
-- period on the existing appointment_cancellation_policies table, and an
-- is_late_arrival flag computed the moment a patient actually checks in)
-- without inventing a business rule for what staff must then do about it
-- (auto-cancel, work them in as a walk-in, etc. stays a staff judgement
-- call, surfaced by the flag) — same "no invented fee amounts, mechanism
-- only" posture that table's own migration comment already established for
-- cancellation refund percentages.

alter table public.appointment_cancellation_policies
  add column late_arrival_grace_minutes integer not null default 15
    constraint appointment_cancellation_policies_late_grace_non_negative check (late_arrival_grace_minutes >= 0);

comment on column public.appointment_cancellation_policies.late_arrival_grace_minutes is
  '69.9: how many minutes past scheduled_for a patient may still check in without being flagged is_late_arrival. Resolved via the same private.resolve_cancellation_policy() org/type fallback as every other column on this table. A conservative default (15 min), not a founder-confirmed business figure — see this table''s original migration comment on why no fee/window here is treated as authoritative business fact.';

alter table public.appointments
  add column called_at       timestamptz,
  add column is_late_arrival boolean not null default false;

comment on column public.appointments.called_at is
  '69.8: when staff called this patient in from the waiting room. Null until the ''called'' transition.';
comment on column public.appointments.is_late_arrival is
  '69.9: set at check-in time when the patient arrived more than the resolved policy''s late_arrival_grace_minutes after scheduled_for. Informational only — staff still decide whether to see them, fit them in, or apply the org''s no-show policy.';

create index appointments_facility_queue_idx
  on public.appointments (facility_id, status)
  where status in ('checked_in', 'called');

-- ---------------------------------------------------------------------------
-- advance_appointment_status — same logic as 20260828001600 (as fixed by
-- 20260828002313's cast fix), plus the 'called' transition and is_late_arrival
-- computation on check-in. Same signature as before, so CREATE OR REPLACE is
-- safe here (unlike the previous migration's two dropped functions).
-- ---------------------------------------------------------------------------
create or replace function public.advance_appointment_status(
  p_appointment_id uuid,
  p_to public.appointment_status
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_appt public.appointments;
  v_valid boolean := false;
  v_policy public.appointment_cancellation_policies;
  v_late boolean := false;
begin
  select * into v_appt from public.appointments where id = p_appointment_id for update;
  if v_appt.id is null then
    raise exception 'appointment not found';
  end if;

  if p_to = 'checked_in' then
    v_valid := v_appt.status in ('booked', 'confirmed')
      and (v_appt.patient_id = v_uid or private.is_org_staff(v_appt.organisation_id));
  elsif p_to = 'called' then
    v_valid := v_appt.status = 'checked_in' and private.is_org_staff(v_appt.organisation_id);
  elsif p_to = 'in_progress' then
    v_valid := v_appt.status in ('checked_in', 'called', 'confirmed') and private.is_org_staff(v_appt.organisation_id);
  elsif p_to = 'completed' then
    v_valid := v_appt.status in ('in_progress', 'checked_in', 'called', 'confirmed', 'booked') and private.is_org_staff(v_appt.organisation_id);
  elsif p_to = 'no_show' then
    v_valid := v_appt.status in ('booked', 'confirmed', 'checked_in', 'called') and private.is_org_staff(v_appt.organisation_id);
  else
    raise exception 'unsupported target status: %', p_to;
  end if;

  if not v_valid then
    raise exception 'cannot move appointment from % to %', v_appt.status, p_to;
  end if;

  if p_to = 'checked_in' then
    v_policy := private.resolve_cancellation_policy(v_appt.organisation_id, v_appt.appointment_type);
    v_late := v_policy.id is not null and now() > (v_appt.scheduled_for + (v_policy.late_arrival_grace_minutes * interval '1 minute'));
  end if;

  update public.appointments set
    status = p_to,
    checked_in_at = case when p_to = 'checked_in' then now() else checked_in_at end,
    called_at = case when p_to = 'called' then now() else called_at end,
    started_at = case when p_to = 'in_progress' then now() else started_at end,
    completed_at = case when p_to = 'completed' then now() else completed_at end,
    no_show_marked_at = case when p_to = 'no_show' then now() else no_show_marked_at end,
    is_late_arrival = case when p_to = 'checked_in' then v_late else is_late_arrival end
  where id = p_appointment_id
  returning * into v_appt;

  return v_appt;
end;
$$;

comment on function public.advance_appointment_status(uuid, public.appointment_status) is
  '69.8 state machine: booked/confirmed -> checked_in (patient or staff, waiting-room state, flags is_late_arrival per 69.9) -> called (staff only) -> in_progress -> completed (staff only), or -> no_show (staff only). Cancellation/reschedule are separate functions since they have their own side effects (refund flag, waiting-list offer).';

revoke execute on function public.advance_appointment_status(uuid, public.appointment_status) from public, anon;
grant execute on function public.advance_appointment_status(uuid, public.appointment_status) to authenticated;

-- ---------------------------------------------------------------------------
-- get_facility_queue_today — 69.8 front-desk view. Position is computed
-- fresh on every read (priority patients first, then earliest checked-in),
-- never a stored column that could go stale as patients are called out of
-- order.
-- ---------------------------------------------------------------------------
create or replace function public.get_facility_queue_today(
  p_facility_id uuid,
  p_clinician_id uuid default null
)
returns table (
  appointment_id uuid,
  patient_id uuid,
  patient_name text,
  patient_number text,
  clinician_id uuid,
  clinician_name text,
  appointment_type public.appointment_type,
  status public.appointment_status,
  scheduled_for timestamptz,
  checked_in_at timestamptz,
  called_at timestamptz,
  is_high_priority boolean,
  is_late_arrival boolean,
  queue_position bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select organisation_id into v_org from public.profiles where id = (select auth.uid());
  if v_org is null or not private.is_org_staff(v_org) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  select
    a.id, a.patient_id, pp.full_name, pp.patient_number,
    a.clinician_id, cp.full_name,
    a.appointment_type, a.status, a.scheduled_for, a.checked_in_at, a.called_at,
    a.is_high_priority, a.is_late_arrival,
    row_number() over (order by a.is_high_priority desc, coalesce(a.checked_in_at, a.scheduled_for)) as queue_position
  from public.appointments a
  join public.profiles pp on pp.id = a.patient_id
  left join public.profiles cp on cp.id = a.clinician_id
  where a.facility_id = p_facility_id
    and a.organisation_id = v_org
    and a.status in ('checked_in', 'called')
    and a.scheduled_for >= date_trunc('day', now())
    and a.scheduled_for < date_trunc('day', now()) + interval '1 day'
    and (p_clinician_id is null or a.clinician_id = p_clinician_id)
  order by a.is_high_priority desc, coalesce(a.checked_in_at, a.scheduled_for);
end;
$$;

comment on function public.get_facility_queue_today(uuid, uuid) is
  '69.8: today''s waiting-room queue at a facility for the caller''s own organisation — checked_in and called appointments, ordered priority-first then by check-in time. Position is computed fresh on every call, never stored.';

revoke execute on function public.get_facility_queue_today(uuid, uuid) from public, anon;
grant execute on function public.get_facility_queue_today(uuid, uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'appointments' and column_name = 'is_late_arrival'
  ) then
    raise exception 'appointments.is_late_arrival missing after migration';
  end if;
  if has_function_privilege('anon', 'public.get_facility_queue_today(uuid, uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute get_facility_queue_today';
  end if;
  if has_function_privilege('anon', 'public.advance_appointment_status(uuid, public.appointment_status)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute advance_appointment_status';
  end if;
  raise notice 'PASS: queue management (called status, facility queue) + late-arrival flagging in place';
end $$;
