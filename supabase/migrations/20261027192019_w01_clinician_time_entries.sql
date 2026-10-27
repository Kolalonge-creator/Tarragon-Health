-- W-01 doctor-time capture (INNOVATION-BUILD-GAP.md W-01, Prompt 5).
--
-- Every unit-economics figure for Membership currently rests on an assumed ten minutes of doctor time per Member. This records the real
-- figure. It is for planning and pricing. It is NOT a performance measure and nothing here ranks, orders or compares clinicians:
--   * the only aggregate (member_month_minutes) groups by source and tier, never by clinician;
--   * the CMO page reads only that aggregate.
--
-- What is added (all additive; queue_next, task_claims and the notes table are untouched apart from one new AFTER trigger):
--   1. public.clinician_time_entries: append-only. Rows are written by record_clinician_time (task / message / manual, own time only) or by
--      the consult trigger below. Read: the clinician's own rows; the CMO and finance for the organisation.
--   2. private.consult_time_from_note: AFTER INSERT/UPDATE trigger on clinical_encounter_notes. When call_ended_at and call_started_at are
--      both set, one 'consult' row is written (seconds = the difference, capped at 4 hours), once per note.
--   3. public.record_clinician_time(...): the only client write path.
--   4. public.member_month_minutes(p_month): CMO or finance only. Per Member-month minutes, median and 90th percentile, by source and tier
--      (plus / evergreen). Test rows and Free patients (no active membership in the month) are excluded. Groups under 3 Members are
--      reported with null medians so one clinician's pattern cannot be read from a tiny group.
--
-- Counts before: new table, 0 rows. No data conversion. ROLLBACK: drop trigger/functions then the table (nothing else depends on it).

create table public.clinician_time_entries (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete cascade,
  clinician_profile_id uuid not null references public.profiles (id) on delete restrict,
  patient_id           uuid references public.profiles (id) on delete set null,
  source               text not null check (source in ('task', 'consult', 'message', 'manual')),
  source_ref           uuid,
  seconds              integer not null check (seconds between 1 and 14400),
  worked_on            date not null default ((now() at time zone 'Africa/Lagos')::date),
  is_test              boolean not null default false,
  created_at           timestamptz not null default now()
);
create unique index clinician_time_entries_one_consult on public.clinician_time_entries (source_ref) where source = 'consult';
create index clinician_time_entries_month_idx on public.clinician_time_entries (organisation_id, worked_on);
create index clinician_time_entries_own_idx on public.clinician_time_entries (clinician_profile_id, worked_on);
comment on table public.clinician_time_entries is
  'W-01: seconds of doctor time by source (task, consult, message, manual). Append-only. For planning and pricing only; never a performance measure and never ranked or compared by clinician.';

alter table public.clinician_time_entries enable row level security;
create policy clinician_time_entries_read on public.clinician_time_entries for select to authenticated
  using (
    clinician_profile_id = (select auth.uid())
    or ((private.credential_is_cmo() or private.is_finance()) and organisation_id = private.current_org_id())
  );
grant select on public.clinician_time_entries to authenticated;
revoke insert, update, delete, truncate on public.clinician_time_entries from authenticated, anon;

-- Append-only. The one permitted change is the foreign key action nulling patient_id when a patient record is erased.
create function private.clinician_time_entries_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.patient_id is null and old.patient_id is not null
     and (to_jsonb(new) - 'patient_id') = (to_jsonb(old) - 'patient_id') then
    return new;
  end if;
  raise exception 'clinician_time_entries is append-only' using errcode = '42501';
end $$;
revoke all on function private.clinician_time_entries_guard() from public, anon, authenticated;
create trigger clinician_time_entries_no_change before update or delete on public.clinician_time_entries
  for each row execute function private.clinician_time_entries_guard();

-- Consult seconds, derived from the call timestamps already on the note.
create function private.consult_time_from_note() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_seconds integer;
  v_clinician uuid;
begin
  if new.call_started_at is null or new.call_ended_at is null then return new; end if;
  v_clinician := new.authored_by_profile;
  if v_clinician is null then return new; end if;
  v_seconds := least(14400, floor(extract(epoch from (new.call_ended_at - new.call_started_at)))::integer);
  if v_seconds < 1 then return new; end if;
  insert into public.clinician_time_entries (organisation_id, clinician_profile_id, patient_id, source, source_ref, seconds, worked_on, is_test)
  values (new.organisation_id, v_clinician, new.patient_id, 'consult', new.id, v_seconds,
          (new.call_ended_at at time zone 'Africa/Lagos')::date, coalesce(new.is_test, false))
  on conflict (source_ref) where source = 'consult' do nothing;
  return new;
end $$;
revoke all on function private.consult_time_from_note() from public, anon, authenticated;
create trigger clinical_encounter_notes_consult_time after insert or update of call_started_at, call_ended_at on public.clinical_encounter_notes
  for each row execute function private.consult_time_from_note();

-- The client write path: own time only.
create function public.record_clinician_time(p_source text, p_source_ref uuid, p_patient uuid, p_seconds integer)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_test boolean;
  v_id uuid;
  v_ok boolean := false;
begin
  if v_uid is null or not exists (select 1 from public.clinical_staff cs where cs.profile_id = v_uid and cs.active and cs.doctor_tier <> 'care_coordinator') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_source not in ('task', 'message', 'manual') then
    raise exception 'time source not allowed' using errcode = '22023';
  end if;
  if p_seconds is null or p_seconds < 1 or p_seconds > 14400 or p_patient is null then
    raise exception 'time entry is not in the expected shape' using errcode = '22023';
  end if;

  select organisation_id, coalesce(is_test, false) into v_org, v_test from public.profiles where id = v_uid;
  if p_source = 'task' then
    select true into v_ok from public.clinical_tasks t
     where t.id = p_source_ref and t.claimed_by = v_uid and t.patient_id = p_patient and t.organisation_id = v_org;
  elsif p_source = 'message' then
    select true into v_ok from public.care_message_threads th
     where th.id = p_source_ref and th.patient_id = p_patient and th.organisation_id = v_org;
  else
    select true into v_ok from public.profiles p where p.id = p_patient and p.organisation_id = v_org;
  end if;
  if not coalesce(v_ok, false) then
    raise exception 'time entry does not match your work' using errcode = '42501';
  end if;

  v_test := v_test or coalesce((select is_test from public.profiles where id = p_patient), false);
  insert into public.clinician_time_entries (organisation_id, clinician_profile_id, patient_id, source, source_ref, seconds, is_test)
  values (v_org, v_uid, p_patient, p_source, p_source_ref, p_seconds, v_test)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_clinician_time(text, uuid, uuid, integer) from public, anon;
grant execute on function public.record_clinician_time(text, uuid, uuid, integer) to authenticated;

-- Aggregate for the CMO page. No clinician identity in, none out, and no ordering by anything about a person.
create function public.member_month_minutes(p_month date)
returns table (source text, tier text, members integer, median_minutes numeric, p90_minutes numeric, total_minutes numeric)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_start date := date_trunc('month', coalesce(p_month, (now() at time zone 'Africa/Lagos')::date))::date;
  v_org uuid := private.current_org_id();
begin
  if not (private.credential_is_cmo() or private.is_finance()) then
    raise exception 'only the Chief Medical Officer or finance can read care team time' using errcode = '42501';
  end if;
  return query
  with per_member as (
    select e.source as src, m.tier as tr, e.patient_id as pid, sum(e.seconds) / 60.0 as minutes
      from public.clinician_time_entries e
      join lateral (
        select pm.tier from public.patient_memberships pm
         where pm.patient_id = e.patient_id and pm.state = 'active'
           and pm.starts_at < (v_start + interval '1 month') and (pm.ends_at is null or pm.ends_at >= v_start)
         order by pm.starts_at desc limit 1
      ) m on true
     where e.organisation_id = v_org and not e.is_test and e.patient_id is not null
       and e.worked_on >= v_start and e.worked_on < (v_start + interval '1 month')
     group by e.source, m.tier, e.patient_id
  )
  select pm.src, pm.tr, count(*)::integer,
         case when count(*) >= 3 then round((percentile_cont(0.5) within group (order by pm.minutes))::numeric, 1) end,
         case when count(*) >= 3 then round((percentile_cont(0.9) within group (order by pm.minutes))::numeric, 1) end,
         round(sum(pm.minutes)::numeric, 1)
    from per_member pm
   group by pm.src, pm.tr;
end $$;
revoke all on function public.member_month_minutes(date) from public, anon;
grant execute on function public.member_month_minutes(date) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.record_clinician_time(text,uuid,uuid,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.member_month_minutes(date)', 'EXECUTE') then
    raise exception 'self-check: anon can execute a W-01 function';
  end if;
  if has_table_privilege('anon', 'public.clinician_time_entries', 'SELECT')
     or has_table_privilege('authenticated', 'public.clinician_time_entries', 'INSERT') then
    raise exception 'self-check: clinician_time_entries grants are wrong';
  end if;
  if not has_table_privilege('authenticated', 'public.clinician_time_entries', 'SELECT') then
    raise exception 'self-check: authenticated cannot read clinician_time_entries';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.clinician_time_entries'::regclass) then
    raise exception 'self-check: RLS is off on clinician_time_entries';
  end if;
end $$;
