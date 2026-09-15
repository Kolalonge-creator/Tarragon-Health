-- Tarragon Health — Appointment Engine, Phase 3 (recurring availability, leave/
-- blocked time, waiting list, slot computation)
--
-- Closes the real gap docs/CLINICAL_NETWORK_SPEC.md §4.4/4.5 named:
-- consult_availability_slots only supports one-off, manually-published slots
-- (no recurring rule, no leave/blocked-time concept). 10.4/10.5/10.9 want a
-- provider to define "every Monday 9-1" once and have the engine generate
-- bookable slots on demand; 10.10 wants leave to automatically identify and
-- offer alternatives to affected patients. consult_availability_slots itself
-- is untouched — this is the new, general path for every appointment_type.

-- ---------------------------------------------------------------------------
-- provider_availability_rules — 10.4/10.9
-- ---------------------------------------------------------------------------
create table public.provider_availability_rules (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  clinician_id          uuid not null references public.profiles (id) on delete cascade,
  day_of_week           smallint not null check (day_of_week between 0 and 6),
  start_time            time not null,
  end_time              time not null,
  consultation_method   public.appointment_consultation_method not null,
  appointment_types     public.appointment_type[] not null,
  slot_duration_minutes integer not null default 30,
  buffer_minutes        integer not null default 0,
  location              text,
  effective_from        date not null default current_date,
  effective_until       date,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint provider_availability_rules_time_valid check (end_time > start_time),
  constraint provider_availability_rules_duration_positive check (slot_duration_minutes > 0),
  constraint provider_availability_rules_buffer_non_negative check (buffer_minutes >= 0),
  constraint provider_availability_rules_types_non_empty check (array_length(appointment_types, 1) > 0),
  constraint provider_availability_rules_effective_range check (effective_until is null or effective_until >= effective_from)
);

comment on table public.provider_availability_rules is
  '"Every Monday 9-1, telemedicine" style recurring windows a provider defines once (10.4/10.9); public.get_available_appointment_slots() expands these into concrete bookable slots on demand rather than pre-materialising rows.';

create index provider_availability_rules_clinician_idx
  on public.provider_availability_rules (clinician_id, day_of_week) where is_active;
create index provider_availability_rules_org_idx
  on public.provider_availability_rules (organisation_id);

create trigger provider_availability_rules_set_updated_at
  before update on public.provider_availability_rules
  for each row execute function private.set_updated_at();

alter table public.provider_availability_rules enable row level security;

-- Staff-only surface (same permissiveness as consult_availability_slots: any
-- org staff member, not only the named clinician, may manage it — a
-- coordinator publishing on a doctor's behalf). Patients never read the raw
-- rules; they always go through get_available_appointment_slots() below,
-- which also needs to net out leave/blocked time and existing bookings that
-- a raw rules SELECT couldn't show them anyway.
create policy provider_availability_rules_select on public.provider_availability_rules
  for select to authenticated using (private.is_org_staff(organisation_id));
create policy provider_availability_rules_insert on public.provider_availability_rules
  for insert to authenticated with check (private.is_org_staff(organisation_id));
create policy provider_availability_rules_update on public.provider_availability_rules
  for update to authenticated
  using (private.is_org_staff(organisation_id)) with check (private.is_org_staff(organisation_id));
create policy provider_availability_rules_delete on public.provider_availability_rules
  for delete to authenticated using (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.provider_availability_rules to authenticated;

-- ---------------------------------------------------------------------------
-- provider_time_off — 10.5/10.10 (leave + ad-hoc blocked time, one shape)
-- ---------------------------------------------------------------------------
create table public.provider_time_off (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  clinician_id    uuid not null references public.profiles (id) on delete cascade,
  kind            text not null check (kind in ('leave', 'blocked')),
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  reason          text,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint provider_time_off_time_valid check (ends_at > starts_at)
);

comment on table public.provider_time_off is
  'Leave and ad-hoc blocked time share one shape because both remove a provider from bookability the same way (10.5); inserting either cascades via provider_time_off_cascade below (10.10) — any already-booked appointment it overlaps is provider_cancelled, the patient is notified, and they are placed on the waiting list for a replacement slot.';

create index provider_time_off_clinician_idx on public.provider_time_off (clinician_id, starts_at, ends_at);

alter table public.provider_time_off enable row level security;

create policy provider_time_off_select on public.provider_time_off
  for select to authenticated using (private.is_org_staff(organisation_id));
create policy provider_time_off_insert on public.provider_time_off
  for insert to authenticated with check (private.is_org_staff(organisation_id));
create policy provider_time_off_update on public.provider_time_off
  for update to authenticated
  using (private.is_org_staff(organisation_id)) with check (private.is_org_staff(organisation_id));
create policy provider_time_off_delete on public.provider_time_off
  for delete to authenticated using (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.provider_time_off to authenticated;

-- ---------------------------------------------------------------------------
-- appointment_waiting_list — 10.17
-- ---------------------------------------------------------------------------
create type public.appointment_waiting_list_status as enum (
  'waiting', 'offered', 'accepted', 'expired', 'cancelled'
);

create table public.appointment_waiting_list (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  patient_id              uuid not null references public.profiles (id) on delete cascade,
  clinician_id            uuid references public.profiles (id) on delete cascade,
  appointment_type        public.appointment_type not null,
  consultation_method     public.appointment_consultation_method,
  preferred_from          timestamptz not null,
  preferred_until         timestamptz not null,
  status                  public.appointment_waiting_list_status not null default 'waiting',
  offered_appointment_id  uuid references public.appointments (id) on delete set null,
  offer_expires_at        timestamptz,
  source_appointment_id   uuid references public.appointments (id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint appointment_waiting_list_window_valid check (preferred_until > preferred_from)
);

comment on table public.appointment_waiting_list is
  'clinician_id null = any provider will do. source_appointment_id is set when a patient landed here via the provider_time_off cascade rather than self-joining. Only ever mutated by the SECURITY DEFINER RPCs (offer/accept/expire) — see the next Appointment Engine migration — never by a direct patient UPDATE, so "one live offer at a time" cannot be raced.';

create index appointment_waiting_list_match_idx
  on public.appointment_waiting_list (organisation_id, clinician_id, appointment_type, status)
  where status = 'waiting';
create index appointment_waiting_list_patient_idx on public.appointment_waiting_list (patient_id, status);

create trigger appointment_waiting_list_set_updated_at
  before update on public.appointment_waiting_list
  for each row execute function private.set_updated_at();

alter table public.appointment_waiting_list enable row level security;

-- Patient may read/join (insert) their own entry; only staff or the RPCs
-- below (security definer, bypass RLS) transition its status.
create policy appointment_waiting_list_select on public.appointment_waiting_list
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy appointment_waiting_list_insert on public.appointment_waiting_list
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy appointment_waiting_list_update on public.appointment_waiting_list
  for update to authenticated
  using (private.is_org_staff(organisation_id)) with check (private.is_org_staff(organisation_id));
create policy appointment_waiting_list_delete on public.appointment_waiting_list
  for delete to authenticated using (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.appointment_waiting_list to authenticated;

-- ---------------------------------------------------------------------------
-- 10.10 leave/blocked-time cascade
-- ---------------------------------------------------------------------------
create or replace function private.cascade_provider_time_off()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_appt record;
  v_default_reason text;
begin
  v_default_reason := case when new.kind = 'leave'
    then 'Your provider is on leave for this time'
    else 'Your provider is unavailable at this time'
  end;

  for v_appt in
    select *
    from public.appointments
    where clinician_id = new.clinician_id
      and status in ('held', 'booked', 'confirmed')
      and tstzrange(scheduled_for, ends_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)')
    for update
  loop
    update public.appointments
      set status = 'provider_cancelled',
          cancelled_at = now(),
          cancellation_reason = coalesce(new.reason, v_default_reason),
          hold_expires_at = null
      where id = v_appt.id;

    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
    values (
      v_appt.organisation_id, v_appt.patient_id, 'whatsapp', 'pending', 'appointment_provider_cancelled',
      jsonb_build_object(
        'appointment_id', v_appt.id,
        'scheduled_for', v_appt.scheduled_for,
        'appointment_type', v_appt.appointment_type,
        'reason', coalesce(new.reason, v_default_reason)
      ),
      'non_clinical'
    );

    insert into public.appointment_waiting_list (
      organisation_id, patient_id, clinician_id, appointment_type, consultation_method,
      preferred_from, preferred_until, source_appointment_id
    ) values (
      v_appt.organisation_id, v_appt.patient_id, v_appt.clinician_id, v_appt.appointment_type, v_appt.consultation_method,
      now(), v_appt.scheduled_for + interval '30 days', v_appt.id
    );
  end loop;

  return new;
end;
$$;

comment on function private.cascade_provider_time_off() is
  '10.10: Leave entered -> future slots affected -> patients identified -> alternative appointments offered (via appointment_waiting_list) -> notifications sent. Runs for both leave and blocked time (10.5 groups them as the same slot-generation input); only held/booked/confirmed appointments are affected, not already-terminal ones.';

create trigger provider_time_off_cascade
  after insert on public.provider_time_off
  for each row execute function private.cascade_provider_time_off();

revoke all on function private.cascade_provider_time_off() from public, anon;

-- ---------------------------------------------------------------------------
-- 10.4/10.5 slot generation — computed on demand, not pre-materialised, so
-- it always reflects the current rules/leave/bookings with no expiry sweep
-- needed for stale rows.
-- ---------------------------------------------------------------------------
create or replace function public.get_available_appointment_slots(
  p_organisation_id uuid,
  p_appointment_type public.appointment_type,
  p_consultation_method public.appointment_consultation_method default null,
  p_clinician_id uuid default null,
  p_from date default current_date,
  p_to date default current_date + 13
)
returns table (
  clinician_id uuid,
  clinician_name text,
  slot_start timestamptz,
  slot_end timestamptz,
  consultation_method public.appointment_consultation_method,
  location text
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
    rs.location
  from raw_slots rs
  join public.profiles p on p.id = rs.clinician_id
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

comment on function public.get_available_appointment_slots(uuid, public.appointment_type, public.appointment_consultation_method, uuid, date, date) is
  '10.4/10.5: expands provider_availability_rules into concrete bookable slots, netting out provider_time_off and any non-terminal existing appointment. Read-only and race-tolerant by construction — the actual double-booking guard is the appointments_no_provider_overlap EXCLUDE constraint enforced at hold time, not this function.';

revoke execute on function public.get_available_appointment_slots(uuid, public.appointment_type, public.appointment_consultation_method, uuid, date, date) from public, anon;
grant execute on function public.get_available_appointment_slots(uuid, public.appointment_type, public.appointment_consultation_method, uuid, date, date) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.get_available_appointment_slots(uuid, public.appointment_type, public.appointment_consultation_method, uuid, date, date)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute get_available_appointment_slots';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.provider_time_off'::regclass and tgname = 'provider_time_off_cascade' and not tgisinternal
  ) then
    raise exception 'provider_time_off_cascade trigger missing';
  end if;
  raise notice 'PASS: recurring availability, time-off cascade, and slot computation in place';
end $$;
