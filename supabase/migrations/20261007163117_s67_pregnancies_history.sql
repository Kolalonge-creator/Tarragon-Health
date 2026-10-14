-- S67 (module 16, pregnancy), migration 1 of 4: a pregnancy HISTORY, the `pregnancy.recorded` event and fresh category-scoped RLS.
--
-- WHY. `patient_pregnancy` is one row per patient (unique patient_id), so a second pregnancy cannot be recorded without
-- overwriting the first. This adds `public.pregnancies` (one row per pregnancy) and keeps `patient_pregnancy` as the
-- CURRENT-STATE projection that the triage context (`triage_context_for_observation`), the phone and the web card already
-- read, so none of those readers changes. The two stay in step by two triggers, each acting only on a direct write (a trigger
-- that fires inside the other trigger does nothing, `pg_trigger_depth() > 1`), so there is no loop.
--
-- ROW COUNTS (read from the live project 2026-10-07, read-only): patient_pregnancy 0 rows, is_pregnant 0, high_risk 0;
-- antenatal_visits 0 rows. The backfill below therefore moves 0 rows today. It is still written, and the proof script runs it
-- against seeded rows, so a database that has rows at apply time is converted correctly.
--
-- RLS IS WRITTEN FRESH for the reproductive_health category, not copied from `patient_pregnancy` (which has no caregiver
-- branch at all, written before the category model). Rule: the patient; org staff; a caregiver only with an explicit
-- `reproductive_health` category grant AND the adolescent guardian gate. NO emergency break-glass branch (has_emergency_access
-- refuses reproductive_health by design, and a policy that calls it would be dead text that reads as if it opened). A sponsor
-- or an employer has no policy at all, so they read nothing.
--
-- STAFF SCOPE SEAM: reads use `private.is_org_staff(organisation_id)` like every sibling table. The S39b tied-staff rule
-- (INV-12) is not on this branch's base; when it lands, change the ONE helper `private.pregnancy_staff_may_read` and every S67
-- table follows (see docs/design/S67.md).
--
-- Never applied by the session that wrote it. Pinned to its own version when applied.

create table public.pregnancies (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  pregnancy_number smallint not null check (pregnancy_number > 0),
  state            text not null default 'active' check (state in ('active', 'delivered', 'loss', 'ended_unspecified')),
  -- Care-team-set codes, never inferred (the vocabulary is the CMO's, OQ-342). A shape check only.
  risk_flags       text[] not null default '{}'
                     check (cardinality(risk_flags) <= 12 and array_to_string(risk_flags, ',') ~ '^([a-z][a-z0-9_]{1,48}(,[a-z][a-z0-9_]{1,48})*)?$'),
  lmp              date,
  edd              date,
  outcome          text check (outcome in ('live_birth', 'pregnancy_loss', 'not_recorded')),
  outcome_date     date,
  source           text not null check (source in ('patient', 'clinician', 'migrated', 'system')),
  recorded_by      uuid references public.profiles (id) on delete restrict,
  is_test          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint pregnancies_outcome_matches_state check ((state = 'active') = (outcome is null)),
  constraint pregnancies_dates_sane check (lmp is null or edd is null or edd > lmp),
  unique (patient_id, pregnancy_number)
);
create unique index pregnancies_one_active on public.pregnancies (patient_id) where state = 'active';
create index pregnancies_org_idx on public.pregnancies (organisation_id);
comment on table public.pregnancies is
  'S67: one row per pregnancy (history). patient_pregnancy is the current-state projection kept in step by triggers. Reproductive-health category data: never visible to sponsors or employers, no emergency read-through.';

create trigger pregnancies_set_updated_at before update on public.pregnancies
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Access helpers. One place to change the staff rule (S39b) and one for the caregiver rule.
-- ---------------------------------------------------------------------------
create or replace function private.pregnancy_staff_may_read(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_org_staff(p_org)
$$;

create or replace function private.pregnancy_caregiver_may_read(p_patient uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_read_clinical(p_patient, 'reproductive_health'::public.care_access_category)
     and private.guardian_may_view_confidential_domain(p_patient, (select auth.uid()), 'sexual_reproductive_health')
$$;

-- Only the person themself or staff may WRITE; a caregiver may read with a grant, never write (the stricter of the two sibling shapes).
create or replace function private.pregnancy_may_write(p_patient uuid, p_org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (p_patient = (select auth.uid()) and p_org = private.current_org_id()) or private.pregnancy_staff_may_read(p_org)
$$;

revoke all on function private.pregnancy_staff_may_read(uuid), private.pregnancy_caregiver_may_read(uuid), private.pregnancy_may_write(uuid, uuid) from public, anon;
grant execute on function private.pregnancy_staff_may_read(uuid), private.pregnancy_caregiver_may_read(uuid), private.pregnancy_may_write(uuid, uuid) to authenticated;

alter table public.pregnancies enable row level security;
revoke all on public.pregnancies from public, anon;
create policy pregnancies_select on public.pregnancies for select to authenticated
  using (patient_id = (select auth.uid()) or private.pregnancy_staff_may_read(organisation_id) or private.pregnancy_caregiver_may_read(patient_id));
create policy pregnancies_insert on public.pregnancies for insert to authenticated
  with check (private.pregnancy_may_write(patient_id, organisation_id));
create policy pregnancies_update on public.pregnancies for update to authenticated
  using (private.pregnancy_may_write(patient_id, organisation_id))
  with check (private.pregnancy_may_write(patient_id, organisation_id));
-- No delete policy and no delete grant: a pregnancy record is ended, never erased by the app (erasure follows the retention decision B3).
grant select, insert, update on public.pregnancies to authenticated;

-- ---------------------------------------------------------------------------
-- Guards on what a patient may set: risk flags are the care team's, and a patient cannot reopen or back-date an ended pregnancy.
-- ---------------------------------------------------------------------------
create or replace function private.pregnancies_before_write() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_is_staff boolean;
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    select coalesce(is_test, false) into new.is_test from public.profiles where id = new.patient_id;
    new.is_test := coalesce(new.is_test, false);
    if new.pregnancy_number is null or new.pregnancy_number = 0 then
      select coalesce(max(pregnancy_number), 0) + 1 into new.pregnancy_number from public.pregnancies where patient_id = new.patient_id;
    end if;
    if new.recorded_by is null then new.recorded_by := v_uid; end if;
  end if;
  -- Only a signed-in app user is held to the rules below; the owner, migrations and the service role are not.
  if v_uid is not null and current_setting('role', true) = 'authenticated' then
    v_is_staff := private.is_org_staff(new.organisation_id);
    if not v_is_staff then
      if tg_op = 'INSERT' and cardinality(new.risk_flags) > 0 then
        raise exception 'risk flags are set by the care team' using errcode = '42501';
      end if;
      if tg_op = 'UPDATE' and new.risk_flags is distinct from old.risk_flags then
        raise exception 'risk flags are set by the care team' using errcode = '42501';
      end if;
      if tg_op = 'UPDATE' and old.state <> 'active' then
        raise exception 'an ended pregnancy can only be corrected by the care team' using errcode = '42501';
      end if;
    end if;
    if tg_op = 'INSERT' then new.source := case when v_is_staff then 'clinician' else 'patient' end; end if;
    if tg_op = 'UPDATE' then
      new.patient_id := old.patient_id; new.organisation_id := old.organisation_id; new.source := old.source; new.is_test := old.is_test;
      new.recorded_by := coalesce(old.recorded_by, v_uid);
    end if;
  end if;
  return new;
end $$;
revoke all on function private.pregnancies_before_write() from public, anon;
create trigger pregnancies_before_write before insert or update on public.pregnancies
  for each row execute function private.pregnancies_before_write();

-- ---------------------------------------------------------------------------
-- The event. `pregnancy.recorded` carries ids only (INV-10). It is emitted when a pregnancy starts or ends; the BP rule set,
-- content and danger signs switch because every reader looks at the CURRENT state at use time, so there is no subscriber to
-- keep in step (and none is registered: an event with no handler would sit dead in the delivery table).
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent)
values ('pregnancy.recorded', 'A pregnancy was started or ended (switches the blood pressure rule set, content and danger signs)', 'S67', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys)
values ('pregnancy.recorded', 1, array['pregnancy_id', 'state'])
on conflict do nothing;

create or replace function private.pregnancies_emit_event() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.state is distinct from old.state then
    perform private.emit_domain_event(
      'pregnancy.recorded', new.organisation_id,
      jsonb_build_object('pregnancy_id', new.id, 'state', new.state),
      'pregnancy.recorded:' || new.id::text || ':' || new.state,
      new.patient_id, 'pregnancy', new.id);
  end if;
  return null;
end $$;
revoke all on function private.pregnancies_emit_event() from public, anon;
create trigger pregnancies_emit_event after insert or update on public.pregnancies
  for each row execute function private.pregnancies_emit_event();

-- ---------------------------------------------------------------------------
-- pregnancies -> patient_pregnancy (the projection every existing reader uses)
-- ---------------------------------------------------------------------------
create or replace function private.pregnancies_sync_projection() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_active public.pregnancies%rowtype;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  select * into v_active from public.pregnancies where patient_id = new.patient_id and state = 'active';
  if found then
    insert into public.patient_pregnancy (organisation_id, patient_id, is_pregnant, estimated_due_date, last_menstrual_period_date, high_risk)
    values (v_active.organisation_id, v_active.patient_id, true, v_active.edd, v_active.lmp, cardinality(v_active.risk_flags) > 0)
    on conflict (patient_id) do update
      set is_pregnant = true, estimated_due_date = excluded.estimated_due_date,
          last_menstrual_period_date = excluded.last_menstrual_period_date, high_risk = excluded.high_risk;
  else
    update public.patient_pregnancy set is_pregnant = false, high_risk = false where patient_id = new.patient_id;
  end if;
  return null;
end $$;
revoke all on function private.pregnancies_sync_projection() from public, anon;
create trigger pregnancies_sync_projection after insert or update on public.pregnancies
  for each row execute function private.pregnancies_sync_projection();

-- ---------------------------------------------------------------------------
-- patient_pregnancy -> pregnancies (the older writers: the web form, the care team panel, tests)
-- ---------------------------------------------------------------------------
create or replace function private.patient_pregnancy_sync_history() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_active public.pregnancies%rowtype;
  v_uid uuid := (select auth.uid());
begin
  if pg_trigger_depth() > 1 then return null; end if;
  select * into v_active from public.pregnancies where patient_id = new.patient_id and state = 'active';
  if new.is_pregnant then
    if found then
      update public.pregnancies
         set lmp = new.last_menstrual_period_date,
             edd = case when new.last_menstrual_period_date is not null and new.estimated_due_date <= new.last_menstrual_period_date then null else new.estimated_due_date end,
             risk_flags = case
               when new.high_risk and not ('high_risk' = any (risk_flags)) then array_append(risk_flags, 'high_risk')
               when not new.high_risk then array_remove(risk_flags, 'high_risk')
               else risk_flags end
       where id = v_active.id;
    else
      insert into public.pregnancies (organisation_id, patient_id, pregnancy_number, state, lmp, edd, risk_flags, source, recorded_by)
      values (new.organisation_id, new.patient_id, 0, 'active', new.last_menstrual_period_date, new.estimated_due_date,
              case when new.high_risk then array['high_risk'] else '{}'::text[] end,
              case when v_uid is null then 'system' when private.is_org_staff(new.organisation_id) then 'clinician' else 'patient' end, v_uid);
    end if;
  elsif found then
    update public.pregnancies set state = 'ended_unspecified', outcome = 'not_recorded', outcome_date = current_date where id = v_active.id;
  end if;
  return null;
end $$;
revoke all on function private.patient_pregnancy_sync_history() from public, anon;
create trigger patient_pregnancy_sync_history after insert or update on public.patient_pregnancy
  for each row execute function private.patient_pregnancy_sync_history();

-- ---------------------------------------------------------------------------
-- Backfill: one active pregnancy per patient_pregnancy row that says pregnant. 0 rows live today (header). The sync trigger above
-- is created first, so it is switched off for the backfill (the rows are copied exactly, with source 'migrated').
-- ---------------------------------------------------------------------------
alter table public.patient_pregnancy disable trigger patient_pregnancy_sync_history;
insert into public.pregnancies (organisation_id, patient_id, pregnancy_number, state, lmp, edd, risk_flags, source, recorded_by, is_test)
select pp.organisation_id, pp.patient_id, 1, 'active', pp.last_menstrual_period_date,
       case when pp.last_menstrual_period_date is not null and pp.estimated_due_date <= pp.last_menstrual_period_date then null else pp.estimated_due_date end,
       case when pp.high_risk then array['high_risk'] else '{}'::text[] end, 'migrated', null, coalesce(p.is_test, false)
  from public.patient_pregnancy pp join public.profiles p on p.id = pp.patient_id
 where pp.is_pregnant
on conflict do nothing;
alter table public.patient_pregnancy enable trigger patient_pregnancy_sync_history;

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('anon', 'public.pregnancies', 'SELECT') then raise exception 'anon must not read pregnancies'; end if;
  if has_function_privilege('anon', 'private.pregnancy_caregiver_may_read(uuid)', 'EXECUTE') then raise exception 'anon must not execute the caregiver helper'; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pregnancies' and coalesce(qual, '') || coalesce(with_check, '') ilike '%has_emergency_access%') then
    raise exception 'pregnancies must have no emergency read-through';
  end if;
  if (select count(*) from public.pregnancies where source = 'migrated') <> (select count(*) from public.patient_pregnancy where is_pregnant) then
    raise exception 'backfill did not carry every pregnant patient_pregnancy row';
  end if;
end $$;
