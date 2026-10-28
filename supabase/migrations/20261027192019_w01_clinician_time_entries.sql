-- W-01 doctor-time capture (INNOVATION-BUILD-GAP.md W-01, Prompt 5). Revised after review; this migration is UNAPPLIED, so it was edited in place.
--
-- Every unit-economics figure for Membership currently rests on an assumed ten minutes of doctor time per Member. This records the real
-- figure. It is for planning and pricing. It is NOT a performance measure and nothing here ranks, orders or compares clinicians:
--   * the raw table is readable by the owning clinician ONLY. The CMO and finance get the aggregate function and nothing else (finance
--     needs no patient ids), so there is no way for either to list one clinician's time;
--   * member_month_minutes groups by tier and by kind of work, never by clinician.
--
-- What is added (all additive; queue_next, task_claims and the notes table are untouched apart from one new AFTER trigger):
--   1. public.clinician_time_entries: append-only. Rows come from record_clinician_time (task / message / manual, own time only) or from the
--      consult trigger. A row is never deleted: it can be VOIDED (void_clinician_time: the owner within 7 days, or the CMO) and an idempotency
--      key (client_key, unique per clinician) makes a double send insert once. Manual entries are capped at 120 minutes.
--   2. private.consult_time_from_note: AFTER INSERT/UPDATE trigger on clinical_encounter_notes: when call_started_at and call_ended_at are
--      both set, one 'consult' row (seconds = the difference, capped at 4 hours), once per note.
--   3. public.record_clinician_time(...): the only client write path. A task entry is accepted when the caller held the claim at ANY time
--      (task_claims history), so finishing the task cannot lose the last minutes. A message or manual entry needs a real relationship to the
--      patient: private.clinician_has_patient_access (the repo's helper), or, for a message, having written in that thread.
--   4. public.member_month_minutes(p_month): CMO or finance. Starts from the Members (patient_memberships overlapping the Lagos month, including
--      ones that ended mid-month), left-joins time, so a Member with no time counts as 0. Per tier: members, mean, median and p90 of each
--      Member's TOTAL minutes, plus total minutes per kind of work. Consult time REPLACES task time for the same clinician, patient and day
--      (the overlap is subtracted), voided and test rows are ignored, and groups under 3 Members report null figures.
--   5. Registered in staff_read_scope and data_registry like every other patient-keyed table. It is stricter than 'tied': only the owner reads it.
--
-- Counts before: new table, 0 rows. No data conversion. ROLLBACK: drop the trigger and functions, the registry rows, then the table.

create table public.clinician_time_entries (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete cascade,
  clinician_profile_id uuid not null references public.profiles (id) on delete restrict,
  patient_id           uuid references public.profiles (id) on delete set null,
  source               text not null check (source in ('task', 'consult', 'message', 'manual')),
  source_ref           uuid,
  seconds              integer not null check (seconds between 1 and 14400),
  worked_on            date not null default ((now() at time zone 'Africa/Lagos')::date),
  client_key           uuid not null default gen_random_uuid(),
  voided_at            timestamptz,
  voided_by            uuid references public.profiles (id) on delete set null,
  void_reason          text,
  is_test              boolean not null default false,
  created_at           timestamptz not null default now(),
  constraint clinician_time_entries_manual_cap check (source <> 'manual' or seconds <= 7200),
  constraint clinician_time_entries_void_paired check ((voided_at is null) = (void_reason is null)),
  constraint clinician_time_entries_idempotent unique (clinician_profile_id, client_key)
);
create unique index clinician_time_entries_one_consult on public.clinician_time_entries (source_ref) where source = 'consult';
create index clinician_time_entries_month_idx on public.clinician_time_entries (organisation_id, worked_on);
create index clinician_time_entries_own_idx on public.clinician_time_entries (clinician_profile_id, worked_on);
comment on table public.clinician_time_entries is
  'W-01: seconds of doctor time by source (task, consult, message, manual). Append-only (void, never delete). Readable by the owning clinician only; the CMO and finance read the aggregate member_month_minutes. For planning and pricing only; never a performance measure and never ranked or compared by clinician.';

alter table public.clinician_time_entries enable row level security;
create policy clinician_time_entries_read on public.clinician_time_entries for select to authenticated
  using (clinician_profile_id = (select auth.uid()));
grant select on public.clinician_time_entries to authenticated;
revoke insert, update, delete, truncate on public.clinician_time_entries from authenticated, anon;

-- Registered like every other patient-keyed table (S39b staff_read_scope, S39d data_registry).
insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason) values
  ('clinician_time_entries', 'tied', 'patient_id', 'medical_history', null)
on conflict (table_name) do nothing;
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes) values
  ('clinician_time_entries', 'patient_id', 'operational', 'review', false,
   'W-01. Seconds of doctor time per patient, for planning and pricing. Readable by the owning clinician only (stricter than tied). PROPOSED class, to be confirmed by the CMO and DPO.')
on conflict (table_name) do nothing;

-- Append-only: the only changes are voiding a row, and the foreign key nulling patient_id when a patient record is erased.
create function private.clinician_time_entries_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.patient_id is null and old.patient_id is not null
       and (to_jsonb(new) - 'patient_id') = (to_jsonb(old) - 'patient_id') then
      return new;
    end if;
    if old.voided_at is null and new.voided_at is not null
       and (to_jsonb(new) - 'voided_at' - 'voided_by' - 'void_reason') = (to_jsonb(old) - 'voided_at' - 'voided_by' - 'void_reason') then
      return new;
    end if;
  end if;
  raise exception 'clinician_time_entries is append-only (void a row, never change or delete it)' using errcode = '42501';
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

-- The client write path: own time only, idempotent on client_key.
create function public.record_clinician_time(p_source text, p_source_ref uuid, p_patient uuid, p_seconds integer, p_client_key uuid default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_test boolean;
  v_id uuid;
  v_ok boolean := false;
  v_key uuid := coalesce(p_client_key, gen_random_uuid());
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
  if p_source = 'manual' and p_seconds > 7200 then
    raise exception 'manual time is capped at 120 minutes' using errcode = '22023';
  end if;

  -- a repeat of the same send is a no-op that returns the first row
  select id into v_id from public.clinician_time_entries where clinician_profile_id = v_uid and client_key = v_key;
  if v_id is not null then return v_id; end if;

  select organisation_id, coalesce(is_test, false) into v_org, v_test from public.profiles where id = v_uid;
  if p_source = 'task' then
    -- the caller held the claim at any time (history), so finishing or handing back the task cannot lose the last minutes
    select true into v_ok from public.clinical_tasks t
     where t.id = p_source_ref and t.patient_id = p_patient and t.organisation_id = v_org
       and (t.claimed_by = v_uid or exists (select 1 from public.task_claims c where c.task_id = t.id and c.clinician_id = v_uid));
  elsif p_source = 'message' then
    select true into v_ok from public.care_message_threads th
     where th.id = p_source_ref and th.patient_id = p_patient and th.organisation_id = v_org
       and (private.clinician_has_patient_access(p_patient)
            or exists (select 1 from public.care_messages m where m.thread_id = th.id and m.author_profile_id = v_uid));
  else
    select true into v_ok from public.profiles p
     where p.id = p_patient and p.organisation_id = v_org and private.clinician_has_patient_access(p_patient);
  end if;
  if not coalesce(v_ok, false) then
    raise exception 'time entry does not match your work' using errcode = '42501';
  end if;

  v_test := v_test or coalesce((select is_test from public.profiles where id = p_patient), false);
  insert into public.clinician_time_entries (organisation_id, clinician_profile_id, patient_id, source, source_ref, seconds, client_key, is_test)
  values (v_org, v_uid, p_patient, p_source, p_source_ref, p_seconds, v_key, v_test)
  on conflict (clinician_profile_id, client_key) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.clinician_time_entries where clinician_profile_id = v_uid and client_key = v_key;
  end if;
  return v_id;
end $$;
revoke all on function public.record_clinician_time(text, uuid, uuid, integer, uuid) from public, anon;
grant execute on function public.record_clinician_time(text, uuid, uuid, integer, uuid) to authenticated;

-- Corrections: void, never delete. The owner within 7 days, or the CMO.
create function public.void_clinician_time(p_entry uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  e record;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 5 then raise exception 'a reason of 5 characters or more is required' using errcode = '22023'; end if;
  select * into e from public.clinician_time_entries where id = p_entry;
  if e.id is null then raise exception 'entry not found' using errcode = 'P0002'; end if;
  if e.voided_at is not null then raise exception 'already voided' using errcode = 'P0002'; end if;
  if not ((e.clinician_profile_id = v_uid and e.created_at >= now() - interval '7 days')
          or (private.credential_is_cmo() and e.organisation_id = private.current_org_id())) then
    raise exception 'only the owner within 7 days, or the Chief Medical Officer, can void an entry' using errcode = '42501';
  end if;
  update public.clinician_time_entries set voided_at = now(), voided_by = v_uid, void_reason = btrim(p_reason) where id = p_entry;
  perform private.log_audit('clinician_time.voided', 'clinician_time_entries', p_entry, jsonb_build_object('by_owner', e.clinician_profile_id = v_uid));
end $$;
revoke all on function public.void_clinician_time(uuid, text) from public, anon;
grant execute on function public.void_clinician_time(uuid, text) to authenticated;

-- Aggregate for the CMO page. No clinician identity in, none out, no ordering by anything about a person.
create function public.member_month_minutes(p_month date)
returns table (kind text, tier text, source text, members integer, mean_minutes numeric, median_minutes numeric, p90_minutes numeric, total_minutes numeric)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_first date := date_trunc('month', coalesce(p_month, (now() at time zone 'Africa/Lagos')::date))::date;
  v_from timestamptz := (v_first::timestamp at time zone 'Africa/Lagos');
  v_to timestamptz := ((v_first + interval '1 month')::timestamp at time zone 'Africa/Lagos');
  v_last date := (v_first + interval '1 month')::date - 1;
  v_org uuid := private.current_org_id();
begin
  if not (private.credential_is_cmo() or private.is_finance()) then
    raise exception 'only the Chief Medical Officer or finance can read care team time' using errcode = '42501';
  end if;
  return query
  with members as (
    -- every Member active at any point in the Lagos month, once, on the tier they held last in it
    select distinct on (pm.patient_id) pm.patient_id as pid, pm.tier as tr
      from public.patient_memberships pm
      join public.profiles pr on pr.id = pm.patient_id
     where pm.organisation_id = v_org and not pm.is_test and not coalesce(pr.is_test, false)
       and pm.starts_at < v_to and coalesce(pm.ended_at, pm.ends_at, 'infinity'::timestamptz) > v_from
     order by pm.patient_id, pm.starts_at desc
  ),
  base as (
    select e.patient_id as pid, e.clinician_profile_id as cid, e.worked_on as d, e.source as src, sum(e.seconds)::numeric as secs
      from public.clinician_time_entries e
     where e.organisation_id = v_org and not e.is_test and e.voided_at is null and e.patient_id is not null
       and e.worked_on >= v_first and e.worked_on <= v_last
     group by e.patient_id, e.clinician_profile_id, e.worked_on, e.source
  ),
  adj as (
    -- consult seconds replace overlapping task seconds for the same clinician, patient and day
    select b.pid, b.src,
           case when b.src = 'task'
                then greatest(0::numeric, b.secs - coalesce((select sum(x.secs) from base x where x.pid = b.pid and x.cid = b.cid and x.d = b.d and x.src = 'consult'), 0))
                else b.secs end as secs
      from base b
  ),
  per_src as (select a.pid, a.src, sum(a.secs) / 60.0 as minutes from adj a group by a.pid, a.src),
  per_member as (
    select m.pid, m.tr, coalesce(sum(s.minutes), 0) as total
      from members m left join per_src s on s.pid = m.pid
     group by m.pid, m.tr
  ),
  tier_n as (select pm.tr, count(*) as n from per_member pm group by pm.tr)
  select 'total'::text, pm.tr, null::text, count(*)::integer,
         case when count(*) >= 3 then round(avg(pm.total)::numeric, 1) end,
         case when count(*) >= 3 then round((percentile_cont(0.5) within group (order by pm.total))::numeric, 1) end,
         case when count(*) >= 3 then round((percentile_cont(0.9) within group (order by pm.total))::numeric, 1) end,
         case when count(*) >= 3 then round(sum(pm.total)::numeric, 1) end
    from per_member pm group by pm.tr
  union all
  select 'source'::text, m.tr, s.src, null::integer, null::numeric, null::numeric, null::numeric, round(sum(s.minutes)::numeric, 1)
    from per_src s join members m on m.pid = s.pid join tier_n tn on tn.tr = m.tr and tn.n >= 3
   group by m.tr, s.src;
end $$;
revoke all on function public.member_month_minutes(date) from public, anon;
grant execute on function public.member_month_minutes(date) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.record_clinician_time(text,uuid,uuid,integer,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.void_clinician_time(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.member_month_minutes(date)', 'EXECUTE') then
    raise exception 'self-check: anon can execute a W-01 function';
  end if;
  if has_table_privilege('anon', 'public.clinician_time_entries', 'SELECT')
     or has_table_privilege('authenticated', 'public.clinician_time_entries', 'INSERT')
     or has_table_privilege('authenticated', 'public.clinician_time_entries', 'UPDATE') then
    raise exception 'self-check: clinician_time_entries grants are wrong';
  end if;
  if not has_table_privilege('authenticated', 'public.clinician_time_entries', 'SELECT') then
    raise exception 'self-check: authenticated cannot read clinician_time_entries';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.clinician_time_entries'::regclass) then
    raise exception 'self-check: RLS is off on clinician_time_entries';
  end if;
  -- the raw table must be readable by the owner only: the one policy may not mention the CMO or finance
  if (select count(*) from pg_policies where tablename = 'clinician_time_entries') <> 1
     or exists (select 1 from pg_policies where tablename = 'clinician_time_entries' and (qual ilike '%cmo%' or qual ilike '%finance%')) then
    raise exception 'self-check: clinician_time_entries must have exactly one owner-only policy';
  end if;
  if not exists (select 1 from public.staff_read_scope where table_name = 'clinician_time_entries')
     or not exists (select 1 from public.data_registry where table_name = 'clinician_time_entries') then
    raise exception 'self-check: clinician_time_entries is not registered';
  end if;
end $$;
