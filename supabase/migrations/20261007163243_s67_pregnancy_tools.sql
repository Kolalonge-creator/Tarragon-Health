-- S67 (module 16, pregnancy), migration 2 of 4: the antenatal schedule generator, kick counter, contraction timer, birth plan and
-- the week-by-week content store. Depends on migration 1 (public.pregnancies and its access helpers).
--
-- Every new table: RLS on, explicit grant to authenticated, nothing to anon, `source`, `recorded_by`, `is_test`, `organisation_id`,
-- and the same fresh reproductive_health access rule as public.pregnancies (patient, org staff, a caregiver only with an explicit
-- category grant and the adolescent gate, no emergency read-through). Writes: the patient or staff, never a caregiver.
--
-- What is NOT here: any clinical number. The weeks, the 10-in-2-hours rule and the 5-1-1 pattern live in the PROPOSED registry key
-- `maternal.rules` and are applied by packages/clinical; the database stores what a session found and which config version it used
-- (INV-16). The card a person sees is decided on the phone (works offline, INV-06) and re-stated here; the server never trusts it
-- to widen access, it only turns a "go today" result into a care-team alert.
--
-- Row counts at apply time (live, read-only, 2026-10-07): antenatal_visits 0 rows, so adding columns and an index to it moves nothing.

-- ---------------------------------------------------------------------------
-- 1. antenatal_visits: tie visits to a pregnancy and say where a row came from
-- ---------------------------------------------------------------------------
alter table public.antenatal_visits
  add column pregnancy_id uuid references public.pregnancies (id) on delete set null,
  add column target_week smallint check (target_week between 0 and 45),
  add column schedule_version integer,
  add column source text not null default 'patient' check (source in ('patient', 'clinician', 'system', 'migrated')),
  add column recorded_by uuid references public.profiles (id) on delete restrict,
  add column is_test boolean not null default false;
create unique index antenatal_visits_one_per_contact on public.antenatal_visits (pregnancy_id, visit_number) where pregnancy_id is not null;

-- A generated row is `system`; the generator never overwrites a row a person already wrote (on conflict do nothing).
create or replace function public.generate_antenatal_schedule(
  p_pregnancy_id uuid, p_visit_numbers integer[], p_target_weeks integer[], p_config_version integer)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  v_preg public.pregnancies%rowtype;
  v_n integer := 0;
  i integer;
begin
  select * into v_preg from public.pregnancies where id = p_pregnancy_id;
  if not found then raise exception 'pregnancy not found' using errcode = 'P0002'; end if;
  if v_preg.state <> 'active' then raise exception 'a schedule is only made for a current pregnancy' using errcode = '22023'; end if;
  if p_visit_numbers is null or p_target_weeks is null or cardinality(p_visit_numbers) <> cardinality(p_target_weeks) or cardinality(p_visit_numbers) > 16 then
    raise exception 'visit numbers and weeks must be two lists of the same length (at most 16)' using errcode = '22023';
  end if;
  for i in 1 .. cardinality(p_visit_numbers) loop
    if p_visit_numbers[i] < 1 or p_target_weeks[i] not between 0 and 45 then raise exception 'visit number or week out of range' using errcode = '22023'; end if;
    insert into public.antenatal_visits (organisation_id, patient_id, pregnancy_id, visit_number, target_week, gestational_week_at_visit,
                                         status, schedule_version, source, recorded_by, is_test)
    values (v_preg.organisation_id, v_preg.patient_id, v_preg.id, p_visit_numbers[i], p_target_weeks[i], p_target_weeks[i],
            'scheduled', p_config_version, 'system', (select auth.uid()), v_preg.is_test)
    on conflict (pregnancy_id, visit_number) where pregnancy_id is not null do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;
revoke all on function public.generate_antenatal_schedule(uuid, integer[], integer[], integer) from public, anon;
grant execute on function public.generate_antenatal_schedule(uuid, integer[], integer[], integer) to authenticated;

-- Staff only: why the care team may want an earlier contact (a prompt, never a change). Audited read (INV-10).
create or replace function public.antenatal_schedule_review_prompt(p_pregnancy_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_preg public.pregnancies%rowtype;
  v_reasons text[] := '{}';
begin
  select * into v_preg from public.pregnancies where id = p_pregnancy_id;
  if not found or not private.is_org_staff(v_preg.organisation_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  perform private.log_audit('read', 'antenatal_schedule_review_prompt', v_preg.id, jsonb_build_object('patient_id', v_preg.patient_id));
  if cardinality(v_preg.risk_flags) > 0 then v_reasons := array_append(v_reasons, 'risk_flag'); end if;
  -- An amber pregnancy reading in the last 14 days: a BP-P1 referral task opened for this patient.
  if exists (select 1 from public.triage_events e
              where e.patient_id = v_preg.patient_id and not e.shadow and e.grade = 'amber' and e.rule_id = 'BP-P1'
                and e.created_at > now() - interval '14 days') then
    v_reasons := array_append(v_reasons, 'amber_blood_pressure');
  end if;
  return jsonb_build_object('pregnancy_id', v_preg.id, 'reasons', to_jsonb(v_reasons));
end $$;
revoke all on function public.antenatal_schedule_review_prompt(uuid) from public, anon;
grant execute on function public.antenatal_schedule_review_prompt(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. kick_counts: one row per counting session
-- ---------------------------------------------------------------------------
create table public.kick_counts (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  pregnancy_id       uuid references public.pregnancies (id) on delete set null,
  client_id          uuid not null,
  started_at         timestamptz not null,
  ended_at           timestamptz,
  movement_offsets_s integer[] not null default '{}' check (cardinality(movement_offsets_s) <= 200),
  reported_less      boolean not null default false,
  result             text not null check (result in ('target_reached', 'contact_today', 'stopped')),
  result_reason      text check (result_reason in ('window_elapsed_without_target', 'clear_drop', 'reported_less_movement')),
  minutes_to_target  numeric(7, 2) check (minutes_to_target >= 0),
  week_at_start      smallint check (week_at_start between 0 and 45),
  config_version     integer not null,
  source             text not null check (source in ('patient', 'clinician', 'system')),
  recorded_by        uuid references public.profiles (id) on delete restrict,
  is_test            boolean not null default false,
  created_at         timestamptz not null default now(),
  constraint kick_counts_reason_matches check ((result = 'contact_today') = (result_reason is not null)),
  unique (patient_id, client_id)
);
create index kick_counts_patient_idx on public.kick_counts (patient_id, started_at desc);
create index kick_counts_org_idx on public.kick_counts (organisation_id);

-- ---------------------------------------------------------------------------
-- 3. contractions: one row per timing session
-- ---------------------------------------------------------------------------
create table public.contractions (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  pregnancy_id    uuid references public.pregnancies (id) on delete set null,
  client_id       uuid not null,
  started_at      timestamptz not null,
  -- [{ "s": seconds from started_at, "d": duration in seconds }, ...]
  timings         jsonb not null default '[]' check (jsonb_typeof(timings) = 'array' and jsonb_array_length(timings) <= 300),
  instant_signs   text[] not null default '{}' check (instant_signs <@ array['waters_break', 'vaginal_bleeding', 'reduced_fetal_movement', 'fit', 'severe_headache']),
  pattern         text not null check (pattern in ('standard', 'earlier')),
  result          text not null check (result in ('keep_timing', 'go_now')),
  result_reason   text check (result_reason in ('instant_sign', 'before_term', 'pattern')),
  week_at_start   smallint check (week_at_start between 0 and 45),
  config_version  integer not null,
  source          text not null check (source in ('patient', 'clinician', 'system')),
  recorded_by     uuid references public.profiles (id) on delete restrict,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint contractions_reason_matches check ((result = 'go_now') = (result_reason is not null)),
  unique (patient_id, client_id)
);
create index contractions_patient_idx on public.contractions (patient_id, started_at desc);
create index contractions_org_idx on public.contractions (organisation_id);

-- ---------------------------------------------------------------------------
-- 4. birth_plans: one per pregnancy. Money is a PLAN NOTE in integer kobo, never a balance (INV-09): nothing here can be paid into,
--    drawn from or topped up, and no column holds a running amount.
-- ---------------------------------------------------------------------------
create table public.birth_plans (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  patient_id          uuid not null references public.profiles (id) on delete cascade,
  pregnancy_id        uuid not null references public.pregnancies (id) on delete cascade,
  place_of_birth      text check (char_length(place_of_birth) <= 200),
  transport_plan      text check (char_length(transport_plan) <= 300),
  money_plan_kobo     bigint check (money_plan_kobo is null or money_plan_kobo between 0 and 100000000000),
  money_plan_note     text check (char_length(money_plan_note) <= 300),
  blood_donor_name    text check (char_length(blood_donor_name) <= 120),
  blood_donor_phone   text check (blood_donor_phone ~ '^\+[1-9][0-9]{7,14}$'),
  escort_name         text check (char_length(escort_name) <= 120),
  escort_phone        text check (escort_phone ~ '^\+[1-9][0-9]{7,14}$'),
  long_journey        boolean not null default false,
  previous_fast_labour boolean not null default false,
  previous_births     smallint not null default 0 check (previous_births between 0 and 20),
  source              text not null check (source in ('patient', 'clinician', 'system')),
  recorded_by         uuid references public.profiles (id) on delete restrict,
  is_test             boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (pregnancy_id)
);
create index birth_plans_org_idx on public.birth_plans (organisation_id);
create trigger birth_plans_set_updated_at before update on public.birth_plans for each row execute function private.set_updated_at();
comment on column public.birth_plans.money_plan_kobo is 'A plan note in integer kobo ("I plan to set aside"). Not a wallet or a balance (INV-09).';

-- ---------------------------------------------------------------------------
-- 5. Stamp the actor columns, and (kick, contractions) turn a "go today" result into a care-team alert
-- ---------------------------------------------------------------------------
create or replace function private.pregnancy_tool_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_pregnancy_patient uuid;
begin
  select coalesce(is_test, false) into new.is_test from public.profiles where id = new.patient_id;
  new.is_test := coalesce(new.is_test, false);
  if new.recorded_by is null then new.recorded_by := v_uid; end if;
  if v_uid is not null and current_setting('role', true) = 'authenticated' then
    new.source := case when private.is_org_staff(new.organisation_id) then 'clinician' else 'patient' end;
  end if;
  -- The phone often does not know the pregnancy id offline: attach the patient's current pregnancy.
  if new.pregnancy_id is null then
    select id into new.pregnancy_id from public.pregnancies where patient_id = new.patient_id and state = 'active';
  end if;
  if new.pregnancy_id is not null then
    select patient_id into v_pregnancy_patient from public.pregnancies where id = new.pregnancy_id;
    if v_pregnancy_patient is distinct from new.patient_id then
      raise exception 'the pregnancy belongs to someone else' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.pregnancy_tool_before_insert() from public, anon;
create trigger kick_counts_before_insert before insert on public.kick_counts for each row execute function private.pregnancy_tool_before_insert();
create trigger contractions_before_insert before insert on public.contractions for each row execute function private.pregnancy_tool_before_insert();
create trigger birth_plans_before_insert before insert on public.birth_plans for each row execute function private.pregnancy_tool_before_insert();

-- The existing emergency path raises a Priority 1 clinician alert and the patient safety net (INV-05). Source 'pregnancy_symptom_checklist'
-- already exists. One alert per hour per patient is enough: a second card inside the hour adds nothing for the clinician.
create or replace function private.pregnancy_tool_raise_alert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_detail text;
begin
  if tg_table_name = 'kick_counts' and new.result = 'contact_today' then
    v_detail := 'Baby movement counter: advised to contact the care team today (' || replace(new.result_reason, '_', ' ') || ')';
  elsif tg_table_name = 'contractions' and new.result = 'go_now' and new.result_reason in ('instant_sign', 'before_term') then
    v_detail := 'Contraction timer: go-now sign (' || replace(new.result_reason, '_', ' ') || ')';
  else
    return null;
  end if;
  if exists (select 1 from public.emergency_events e
              where e.patient_id = new.patient_id and e.source = 'pregnancy_symptom_checklist' and e.created_at > now() - interval '1 hour') then
    return null;
  end if;
  insert into public.emergency_events (organisation_id, patient_id, source, trigger_detail, status)
  values (new.organisation_id, new.patient_id, 'pregnancy_symptom_checklist', v_detail, 'active');
  return null;
end $$;
revoke all on function private.pregnancy_tool_raise_alert() from public, anon;
create trigger kick_counts_raise_alert after insert on public.kick_counts for each row execute function private.pregnancy_tool_raise_alert();
create trigger contractions_raise_alert after insert on public.contractions for each row execute function private.pregnancy_tool_raise_alert();

-- ---------------------------------------------------------------------------
-- 6. RLS and grants (the same access rule as public.pregnancies)
-- ---------------------------------------------------------------------------
alter table public.kick_counts enable row level security;
alter table public.contractions enable row level security;
alter table public.birth_plans enable row level security;
revoke all on public.kick_counts, public.contractions, public.birth_plans from public, anon;

create policy kick_counts_select on public.kick_counts for select to authenticated
  using (patient_id = (select auth.uid()) or private.pregnancy_staff_may_read(organisation_id) or private.pregnancy_caregiver_may_read(patient_id));
create policy kick_counts_insert on public.kick_counts for insert to authenticated with check (private.pregnancy_may_write(patient_id, organisation_id));
create policy contractions_select on public.contractions for select to authenticated
  using (patient_id = (select auth.uid()) or private.pregnancy_staff_may_read(organisation_id) or private.pregnancy_caregiver_may_read(patient_id));
create policy contractions_insert on public.contractions for insert to authenticated with check (private.pregnancy_may_write(patient_id, organisation_id));
create policy birth_plans_select on public.birth_plans for select to authenticated
  using (patient_id = (select auth.uid()) or private.pregnancy_staff_may_read(organisation_id) or private.pregnancy_caregiver_may_read(patient_id));
create policy birth_plans_insert on public.birth_plans for insert to authenticated with check (private.pregnancy_may_write(patient_id, organisation_id));
create policy birth_plans_update on public.birth_plans for update to authenticated
  using (private.pregnancy_may_write(patient_id, organisation_id)) with check (private.pregnancy_may_write(patient_id, organisation_id));
-- Sessions are a record of what happened: insert and read only, no update or delete.
grant select, insert on public.kick_counts, public.contractions to authenticated;
grant select, insert, update on public.birth_plans to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Week-by-week and guidance content: a scaffold. Nothing here is clinical content: rows start `draft_pending_cmo` and a patient
--    reads only rows the CMO has marked reviewed, so an unreviewed sentence can never reach a screen (OQ-343). No row is seeded.
-- ---------------------------------------------------------------------------
create table public.pregnancy_content (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null check (kind in ('week', 'nutrition', 'medicine_safety', 'danger_signs')),
  topic_key     text not null check (topic_key ~ '^[a-z][a-z0-9_]{1,60}$'),
  week          smallint check (week between 0 and 45),
  title         text not null check (char_length(title) between 1 and 120),
  body_text     text not null check (char_length(body_text) between 1 and 2000),
  -- Seam for the S32 audio manifest: the clip id, or null when there is no recording. The text is always shown.
  audio_clip_id text,
  review_state  text not null default 'draft_pending_cmo' check (review_state in ('draft_pending_cmo', 'cmo_reviewed')),
  reviewed_by   uuid references public.profiles (id) on delete restrict,
  reviewed_at   timestamptz,
  version       integer not null default 1 check (version > 0),
  source        text not null check (source in ('clinician', 'system')),
  recorded_by   uuid references public.profiles (id) on delete restrict,
  is_test       boolean not null default false,
  created_at    timestamptz not null default now(),
  constraint pregnancy_content_review_complete check ((review_state = 'cmo_reviewed') = (reviewed_by is not null and reviewed_at is not null)),
  constraint pregnancy_content_week_for_week check ((kind = 'week') = (week is not null))
);
create unique index pregnancy_content_one_current on public.pregnancy_content (kind, topic_key, coalesce(week, -1), version);
alter table public.pregnancy_content enable row level security;
revoke all on public.pregnancy_content from public, anon;
-- Reviewed content is public to every signed-in person (it is general information, not a record); drafts only to staff.
create policy pregnancy_content_select on public.pregnancy_content for select to authenticated
  using (review_state = 'cmo_reviewed' or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and private.is_org_staff(p.organisation_id)));
grant select on public.pregnancy_content to authenticated;
-- Writing a row or reviewing it is a person's act, done through the sign-off hub or an admin tool later; there is no write grant here.

-- ---------------------------------------------------------------------------
-- 8. Self-check
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['kick_counts', 'contractions', 'birth_plans', 'pregnancy_content'] loop
    if has_table_privilege('anon', 'public.' || t, 'SELECT') then raise exception 'anon must not read %', t; end if;
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception 'RLS off on %', t; end if;
  end loop;
  if has_function_privilege('anon', 'public.generate_antenatal_schedule(uuid,integer[],integer[],integer)', 'EXECUTE') then raise exception 'anon may execute generate_antenatal_schedule'; end if;
  if has_function_privilege('anon', 'public.antenatal_schedule_review_prompt(uuid)', 'EXECUTE') then raise exception 'anon may execute the review prompt'; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('kick_counts', 'contractions', 'birth_plans', 'pregnancy_content')
              and coalesce(qual, '') || coalesce(with_check, '') ilike '%has_emergency_access%') then
    raise exception 'no S67 table may have an emergency read-through';
  end if;
end $$;
