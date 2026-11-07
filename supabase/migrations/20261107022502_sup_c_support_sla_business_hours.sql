-- Customer Support Dashboard, phase C: service targets counted in staffed hours (SUP-3, docs/design/SUPPORT-DASHBOARD.md).
--
-- Three operational settings (versioned or audited, a change note, no CMO signature: G-01 puts support targets outside the
-- patient-harm list). Clinical support items do not run on these targets; they stay on the clinical escalation SLA.
--
--   support_sla_policies     one active row per priority. first_response_minutes / resolution_minutes are counted on the
--                            row's clock: 'business' (staffed hours only) or 'calendar'. A null resolution target means
--                            "assessed individually" (Urgent, per SUP-3). A change is a new row with version + 1 and a
--                            change note; the old row is deactivated, never edited, so the history stays readable.
--   support_business_hours   staffed hours per ISO weekday, Africa/Lagos. A weekday with no row is closed.
--   support_public_holidays  days the desk is closed. Seeded with the fixed Nigerian holidays and the Easter dates for the
--                            rest of 2026 and 2027. Islamic holidays (Eid al-Fitr, Eid al-Adha, Mawlid) are declared by the
--                            Federal Government close to the date, so they are NOT seeded; a support lead adds each one.
--
-- private.support_add_business_minutes(start, minutes) walks the staffed calendar. private.support_due(priority, start,
-- kind) applies the active policy. The pause while waiting on the customer is shown by the work-items view (sla_state
-- 'paused', no breach while paused); the due time itself is not extended by the paused span, a known limit recorded in the
-- design doc.
--
-- Seed (SUP-3): Urgent 1 hour on the clock, resolution assessed individually; High 4 business hours, 1 business day;
-- Normal 1 business day, 3 business days; Low 2 business days, 5 business days. A business day is 10 staffed hours
-- (08:00 to 18:00). This replaces the unconfirmed PROPOSED support.sla_targets (30m/2h/8h/24h on the calendar).

create table public.support_sla_policies (
  id                      uuid primary key default gen_random_uuid(),
  priority                text not null check (priority in ('urgent', 'high', 'normal', 'low')),
  version                 integer not null check (version >= 1),
  clock                   text not null check (clock in ('business', 'calendar')),
  first_response_minutes  integer not null check (first_response_minutes > 0),
  resolution_minutes      integer check (resolution_minutes is null or resolution_minutes > 0),
  is_active               boolean not null default true,
  change_note             text not null check (length(btrim(change_note)) >= 10),
  created_by              uuid references public.profiles(id) on delete restrict,
  created_at              timestamptz not null default now(),
  deactivated_at          timestamptz,
  unique (priority, version)
);

create unique index support_sla_policies_one_active_per_priority
  on public.support_sla_policies (priority) where is_active;

comment on table public.support_sla_policies is
  'Support desk service targets per priority (SUP-3). Operational setting: versioned, change note, no CMO signature. Internal targets, not a public promise. Clinical items use the clinical escalation SLA instead.';

create table public.support_business_hours (
  weekday     smallint primary key check (weekday between 1 and 7),
  opens       time not null,
  closes      time not null,
  updated_by  uuid references public.profiles(id) on delete restrict,
  updated_at  timestamptz not null default now(),
  check (closes > opens)
);

comment on table public.support_business_hours is
  'Support desk staffed hours per ISO weekday (1 = Monday), Africa/Lagos. A weekday with no row is closed.';

create table public.support_public_holidays (
  holiday_date  date primary key,
  name          text not null check (length(btrim(name)) >= 3),
  created_by    uuid references public.profiles(id) on delete restrict,
  created_at    timestamptz not null default now()
);

comment on table public.support_public_holidays is
  'Days the support desk is closed. Islamic holidays are declared close to the date and are added by a support lead, not seeded.';

alter table public.support_sla_policies enable row level security;
alter table public.support_business_hours enable row level security;
alter table public.support_public_holidays enable row level security;

create policy support_sla_policies_read on public.support_sla_policies
  for select to authenticated using ((select private.is_support_staff()));
create policy support_business_hours_read on public.support_business_hours
  for select to authenticated using ((select private.is_support_staff()));
create policy support_public_holidays_read on public.support_public_holidays
  for select to authenticated using ((select private.is_support_staff()));

-- Hours and holidays are small reference lists the lead edits in place; every change is audited below.
create policy support_business_hours_lead_write on public.support_business_hours
  for all to authenticated
  using ((select private.is_support_lead())) with check ((select private.is_support_lead()));
create policy support_public_holidays_lead_write on public.support_public_holidays
  for all to authenticated
  using ((select private.is_support_lead())) with check ((select private.is_support_lead()));
-- Policies change only through public.set_support_sla_policy (new version, old row deactivated). No direct writes.

grant select on public.support_sla_policies to authenticated;
grant select, insert, update, delete on public.support_business_hours to authenticated;
grant select, insert, update, delete on public.support_public_holidays to authenticated;
revoke all on public.support_sla_policies, public.support_business_hours, public.support_public_holidays from anon;

do $$
begin
  if to_regproc('private.audit_row_change') is not null then
    execute 'create trigger support_sla_policies_audit after insert or update or delete on public.support_sla_policies for each row execute function private.audit_row_change()';
    execute 'create trigger support_business_hours_audit after insert or update or delete on public.support_business_hours for each row execute function private.audit_row_change()';
    execute 'create trigger support_public_holidays_audit after insert or update or delete on public.support_public_holidays for each row execute function private.audit_row_change()';
  end if;
end $$;

insert into public.support_sla_policies (priority, version, clock, first_response_minutes, resolution_minutes, change_note) values
  ('urgent', 1, 'calendar', 60,   null, 'SUP-3 seed, founder 2026-11-07: first response within 1 hour; resolution assessed individually.'),
  ('high',   1, 'business', 240,  600,  'SUP-3 seed, founder 2026-11-07: 4 business hours; resolved within 1 business day.'),
  ('normal', 1, 'business', 600,  1800, 'SUP-3 seed, founder 2026-11-07: 1 business day; resolved within 3 business days.'),
  ('low',    1, 'business', 1200, 3000, 'SUP-3 seed, founder 2026-11-07: 2 business days; resolved within 5 business days.');

insert into public.support_business_hours (weekday, opens, closes) values
  (1, '08:00', '18:00'), (2, '08:00', '18:00'), (3, '08:00', '18:00'), (4, '08:00', '18:00'), (5, '08:00', '18:00');

insert into public.support_public_holidays (holiday_date, name) values
  ('2026-12-25', 'Christmas Day'),
  ('2026-12-26', 'Boxing Day'),
  ('2027-01-01', 'New Year''s Day'),
  ('2027-03-26', 'Good Friday'),
  ('2027-03-29', 'Easter Monday'),
  ('2027-05-01', 'Workers'' Day'),
  ('2027-06-12', 'Democracy Day'),
  ('2027-10-01', 'Independence Day'),
  ('2027-12-25', 'Christmas Day'),
  ('2027-12-26', 'Boxing Day');

-- Walk the staffed calendar from p_start, spending p_minutes of open desk time. With no staffed hours configured at all,
-- falls back to calendar minutes rather than never coming due (a missing setting must not hide a late reply).
create or replace function private.support_add_business_minutes(p_start timestamptz, p_minutes integer)
returns timestamptz
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_local  timestamp;
  v_left   integer := p_minutes;
  v_day    date;
  v_open   time;
  v_close  time;
  v_from   timestamp;
  v_end    timestamp;
  v_avail  integer;
  v_guard  integer := 0;
begin
  if p_start is null or p_minutes is null then
    return null;
  end if;
  if not exists (select 1 from public.support_business_hours) then
    return p_start + make_interval(mins => p_minutes);
  end if;

  v_local := p_start at time zone 'Africa/Lagos';
  loop
    v_guard := v_guard + 1;
    if v_guard > 800 then
      -- More than two years without enough open time: a broken calendar. Calendar time, so the item still comes due.
      return p_start + make_interval(mins => p_minutes);
    end if;

    v_day := v_local::date;
    select h.opens, h.closes into v_open, v_close
      from public.support_business_hours h
     where h.weekday = extract(isodow from v_day)::smallint;

    if found and not exists (select 1 from public.support_public_holidays ph where ph.holiday_date = v_day) then
      v_from := greatest(v_local, v_day + v_open);
      v_end  := v_day + v_close;
      if v_from < v_end then
        v_avail := floor(extract(epoch from (v_end - v_from)) / 60)::integer;
        if v_avail >= v_left then
          return (v_from + make_interval(mins => v_left)) at time zone 'Africa/Lagos';
        end if;
        v_left := v_left - v_avail;
      end if;
    end if;

    v_local := (v_day + 1)::timestamp;
  end loop;
end;
$$;

create or replace function private.support_due(p_priority text, p_start timestamptz, p_kind text)
returns timestamptz
language sql
stable
security definer
set search_path to ''
as $$
  select case
           when m.minutes is null then null
           when sp.clock = 'calendar' then p_start + make_interval(mins => m.minutes)
           else private.support_add_business_minutes(p_start, m.minutes)
         end
    from public.support_sla_policies sp
    cross join lateral (
      select case p_kind when 'first_response' then sp.first_response_minutes
                         when 'resolution' then sp.resolution_minutes end as minutes
    ) m
   where sp.priority = p_priority and sp.is_active;
$$;

comment on function private.support_due(text, timestamptz, text) is
  'Due time for a support item of p_priority received at p_start, kind first_response or resolution, under the active SUP-3 policy. Null when no target applies.';

revoke all on function private.support_add_business_minutes(timestamptz, integer) from public, anon;
revoke all on function private.support_due(text, timestamptz, text) from public, anon;
grant execute on function private.support_add_business_minutes(timestamptz, integer) to authenticated;
grant execute on function private.support_due(text, timestamptz, text) to authenticated;

-- The only way to change a target: a new version with a change note; the previous one is kept, inactive.
create or replace function public.set_support_sla_policy(
  p_priority text,
  p_clock text,
  p_first_response_minutes integer,
  p_resolution_minutes integer,
  p_change_note text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_version integer;
  v_id uuid;
begin
  if not private.is_support_lead() then
    raise exception 'Only a support lead can change support targets' using errcode = '42501';
  end if;
  if p_change_note is null or length(btrim(p_change_note)) < 10 then
    raise exception 'Say why the target is changing (at least 10 characters)' using errcode = '22023';
  end if;

  select coalesce(max(version), 0) + 1 into v_version
    from public.support_sla_policies where priority = p_priority;

  update public.support_sla_policies
     set is_active = false, deactivated_at = now()
   where priority = p_priority and is_active;

  insert into public.support_sla_policies
    (priority, version, clock, first_response_minutes, resolution_minutes, change_note, created_by)
  values
    (p_priority, v_version, p_clock, p_first_response_minutes, p_resolution_minutes, btrim(p_change_note), (select auth.uid()))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.set_support_sla_policy(text, text, integer, integer, text) from public, anon;
grant execute on function public.set_support_sla_policy(text, text, integer, integer, text) to authenticated;

do $$
declare
  v_due timestamptz;
begin
  if (select count(*) from public.support_sla_policies where is_active) <> 4 then
    raise exception 'expected one active support target per priority';
  end if;

  -- Friday 2027-01-08 17:00 Lagos + 4 business hours: 1 hour on Friday, 3 on Monday -> Monday 2027-01-11 11:00 Lagos.
  v_due := private.support_add_business_minutes('2027-01-08 17:00:00+01', 240);
  if v_due <> '2027-01-11 11:00:00+01'::timestamptz then
    raise exception 'business clock across a weekend: expected Monday 11:00 Lagos, got %', v_due;
  end if;

  -- Thursday 2027-03-25 16:00 + 1 business day (600 min): 2h Thu, Good Friday and Easter Monday closed, 8h Tue -> Tue 16:00.
  v_due := private.support_due('normal', '2027-03-25 16:00:00+01', 'first_response');
  if v_due <> '2027-03-30 16:00:00+01'::timestamptz then
    raise exception 'business clock across Easter: expected Tuesday 16:00 Lagos, got %', v_due;
  end if;

  -- Urgent is on the calendar clock: Saturday 03:00 + 60 min = Saturday 04:00.
  v_due := private.support_due('urgent', '2027-01-09 03:00:00+01', 'first_response');
  if v_due <> '2027-01-09 04:00:00+01'::timestamptz then
    raise exception 'urgent calendar clock: expected 04:00, got %', v_due;
  end if;
  if private.support_due('urgent', now(), 'resolution') is not null then
    raise exception 'urgent resolution must be assessed individually (null)';
  end if;
end $$;
