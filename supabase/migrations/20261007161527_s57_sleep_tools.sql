-- S57 step 3 of 4: sleep tools (functions 10.10 and 10.11).
--
-- 1. sleep_log_entries gains the two short-diary fields (time to fall asleep, night wakings). Both nullable; every existing row stays
--    valid. Rows affected on migrate: none (columns added with no backfill).
-- 2. sleep_wind_down_plans: the patient's wind-down planner (fixed step list, lead time). Patient-only.
-- 3. The snoring and daytime sleepiness questionnaire: a DRAFT, UNSIGNED instrument (sleep_apnoea_screen_config v1). Items, points and
--    cut-off are PROPOSED and mirrored in packages/shared. A referral task is created ONLY when the active instrument is confirmed by
--    the CMO, the guard sleep_apnoea_screen_enabled is open for the patient AND the cut-off is met. An unsigned instrument saves the
--    answers, shows no result and never creates a task, whatever the answers or the guard.
--    Stored with per-patient access (INV-12): the patient reads their own; staff only through read_patient_sleep_screens_audited
--    (clinician with a tie, or break-glass; every read and refusal audited). No table read for anyone else.
-- No single sleep score exists anywhere in this schema (orthosomnia; plan 4.2).

alter table public.sleep_log_entries
  add column if not exists sleep_latency_minutes integer check (sleep_latency_minutes is null or sleep_latency_minutes between 0 and 600),
  add column if not exists night_awakenings integer check (night_awakenings is null or night_awakenings between 0 and 30);

create table if not exists public.sleep_wind_down_plans (
  patient_id       uuid primary key references public.profiles (id) on delete cascade,
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  lead_minutes     integer not null default 45 check (lead_minutes between 10 and 120),
  steps            text[] not null default '{}'::text[],
  reminder_enabled boolean not null default false,
  updated_at       timestamptz not null default now(),
  constraint sleep_wind_down_steps_allowed check (cardinality(steps) <= 6
    and steps <@ array['screens_away', 'dim_lights', 'quiet_audio', 'breathing', 'write_down_thoughts', 'prepare_tomorrow']::text[])
);
create index if not exists sleep_wind_down_plans_org_idx on public.sleep_wind_down_plans (organisation_id);
alter table public.sleep_wind_down_plans enable row level security;
drop policy if exists sleep_wind_down_plans_select on public.sleep_wind_down_plans;
create policy sleep_wind_down_plans_select on public.sleep_wind_down_plans for select to authenticated using (patient_id = (select auth.uid()));
revoke all on public.sleep_wind_down_plans from anon;
revoke insert, update, delete, truncate on public.sleep_wind_down_plans from authenticated;
grant select on public.sleep_wind_down_plans to authenticated;

create or replace function public.save_wind_down_plan(p_lead_minutes integer, p_steps text[], p_reminder boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_pr public.profiles%rowtype;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into v_pr from public.profiles where id = v_uid and role = 'patient';
  if not found then raise exception 'not authorised' using errcode = '42501'; end if;
  insert into public.sleep_wind_down_plans (patient_id, organisation_id, lead_minutes, steps, reminder_enabled)
  values (v_uid, v_pr.organisation_id, p_lead_minutes, coalesce(p_steps, '{}'::text[]), coalesce(p_reminder, false))
  on conflict (patient_id) do update set lead_minutes = excluded.lead_minutes, steps = excluded.steps,
    reminder_enabled = excluded.reminder_enabled, updated_at = now();
end $$;
revoke all on function public.save_wind_down_plan(integer, text[], boolean) from public, anon;
grant execute on function public.save_wind_down_plan(integer, text[], boolean) to authenticated;

-- Instrument config -----------------------------------------------------------------------------------------------------------
create table if not exists public.sleep_apnoea_screen_config (
  id           uuid primary key default gen_random_uuid(),
  version      integer not null unique check (version >= 1),
  status       text not null default 'proposed' check (status in ('proposed', 'confirmed')),
  config       jsonb not null,
  notes        text,
  confirmed_by uuid references public.profiles (id) on delete restrict,
  confirmed_at timestamptz,
  is_active    boolean not null default false,
  created_at   timestamptz not null default now(),
  constraint sleep_apnoea_config_confirmed_has_signer check (status <> 'confirmed' or (confirmed_by is not null and confirmed_at is not null))
);
create unique index if not exists sleep_apnoea_screen_config_one_active on public.sleep_apnoea_screen_config (is_active) where is_active;
create index if not exists sleep_apnoea_screen_config_confirmed_by_idx on public.sleep_apnoea_screen_config (confirmed_by) where confirmed_by is not null;
alter table public.sleep_apnoea_screen_config enable row level security;
drop policy if exists sleep_apnoea_screen_config_select on public.sleep_apnoea_screen_config;
create policy sleep_apnoea_screen_config_select on public.sleep_apnoea_screen_config for select to authenticated
  using (private.is_admin() or private.is_active_clinical_director());
revoke all on public.sleep_apnoea_screen_config from anon;
revoke insert, update, delete, truncate on public.sleep_apnoea_screen_config from authenticated;
grant select on public.sleep_apnoea_screen_config to authenticated;
-- sleepscreen-v1-begin
insert into public.sleep_apnoea_screen_config (version, status, config, notes, is_active)
values (1, 'proposed', $json${"cut_off":3,"unsure_points":1,"items":[{"id":"snoring","kind":"yes_no","points":1},{"id":"tired","kind":"yes_no","points":1},{"id":"observed_pauses","kind":"yes_no","points":1},{"id":"high_blood_pressure","kind":"yes_no","points":1},{"id":"bmi","kind":"bmi","points":1,"above":35},{"id":"age_over_50","kind":"yes_no","points":1},{"id":"neck","kind":"neck_cm","points":1,"at_least":40},{"id":"sex_male","kind":"yes_no","points":1}]}$json$::jsonb,
  'DRAFT, UNSIGNED (S57b redraft, 2026-10-07). Eight items following the published STOP-Bang tool (Chung et al.; see docs/research/S57b.md) in the build''s own plain wording: snoring, tired, observed pauses, blood pressure, BMI above 35 (computed from height and weight), age above 50, neck 40 cm or more, male. Cut-off 3 of 8. A "not sure" or missing measurement scores one point (unsure_points), the cautious reading. NOT verified: the licence to use the instrument (UHN), the neck threshold operator (original paper above 40 cm, the published form 40 cm or larger), the cut-off for a primary-care population. PROPOSED, owner CMO: read, amend or replace, then confirm. Until confirmed the questionnaire saves answers and does nothing else.', true)
on conflict (version) do nothing;
-- sleepscreen-v1-end

create table if not exists public.sleep_apnoea_screens (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  config_version  integer not null references public.sleep_apnoea_screen_config (version) on delete restrict,
  answers         jsonb not null,
  total           integer not null check (total >= 0),
  unsure_count    integer not null default 0 check (unsure_count >= 0),
  signed          boolean not null default false,
  cut_off_met     boolean,
  task_id         uuid,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint sleep_apnoea_result_only_when_signed check (signed or cut_off_met is null)
);
create index if not exists sleep_apnoea_screens_patient_idx on public.sleep_apnoea_screens (patient_id, created_at desc);
create index if not exists sleep_apnoea_screens_org_idx on public.sleep_apnoea_screens (organisation_id);
create index if not exists sleep_apnoea_screens_config_idx on public.sleep_apnoea_screens (config_version);
alter table public.sleep_apnoea_screens enable row level security;
drop policy if exists sleep_apnoea_screens_select on public.sleep_apnoea_screens;
create policy sleep_apnoea_screens_select on public.sleep_apnoea_screens for select to authenticated using (patient_id = (select auth.uid()));
revoke all on public.sleep_apnoea_screens from anon;
revoke insert, update, delete, truncate on public.sleep_apnoea_screens from authenticated;
grant select on public.sleep_apnoea_screens to authenticated;

-- The UI reads the item ids (wording lives in i18n) and whether the instrument is signed.
create or replace function public.get_sleep_apnoea_instrument() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_cfg public.sleep_apnoea_screen_config%rowtype;
begin
  if v_uid is null or not private.go_live_open_patient('sleep_apnoea_screen_enabled', v_uid) then
    return jsonb_build_object('open', false);
  end if;
  select * into v_cfg from public.sleep_apnoea_screen_config where is_active;
  if not found then return jsonb_build_object('open', false); end if;
  return jsonb_build_object('open', true, 'version', v_cfg.version, 'signed', v_cfg.status = 'confirmed',
    'items', (select jsonb_agg(jsonb_build_object('id', i ->> 'id', 'kind', i ->> 'kind')) from jsonb_array_elements(v_cfg.config -> 'items') i));
end $$;
revoke all on function public.get_sleep_apnoea_instrument() from public, anon;
grant execute on function public.get_sleep_apnoea_instrument() to authenticated;

-- A measurement answer: a number inside a plausible range, or the word "unsure" (returned as null). Anything else is refused.
create or replace function private.sleep_measure(p_answers jsonb, p_key text, p_min numeric, p_max numeric) returns numeric
language plpgsql immutable set search_path = '' as $$
declare v jsonb := p_answers -> p_key;
begin
  if v is null then raise exception 'answer every question' using errcode = '22023'; end if;
  if jsonb_typeof(v) = 'string' and v #>> '{}' = 'unsure' then return null; end if;
  if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric < p_min or (v #>> '{}')::numeric > p_max then
    raise exception 'check the numbers you entered' using errcode = '22023';
  end if;
  return (v #>> '{}')::numeric;
end $$;
revoke all on function private.sleep_measure(jsonb, text, numeric, numeric) from public, anon, authenticated;

create or replace function public.submit_sleep_apnoea_screen(p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_pr public.profiles%rowtype; v_cfg public.sleep_apnoea_screen_config%rowtype;
  v_signed boolean; v_total integer := 0; v_unsure integer := 0; v_met boolean; v_id uuid := gen_random_uuid(); v_task uuid; v_item jsonb; v_ans text; v_keys integer := 0;
  v_kind text; v_h numeric; v_w numeric; v_nk numeric; v_unsure_pts integer;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into v_pr from public.profiles where id = v_uid and role = 'patient';
  if not found then raise exception 'not authorised' using errcode = '42501'; end if;
  if not private.go_live_open_patient('sleep_apnoea_screen_enabled', v_uid) then raise exception 'not open yet' using errcode = '42501'; end if;
  select * into v_cfg from public.sleep_apnoea_screen_config where is_active;
  if not found then raise exception 'no instrument' using errcode = '22023'; end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then raise exception 'bad answers' using errcode = '22023'; end if;
  v_unsure_pts := coalesce((v_cfg.config ->> 'unsure_points')::integer, 0);
  -- Every configured item must be answered; the answer keys are the item id (yes_no), height_cm and weight_kg (bmi) or neck_cm (neck_cm).
  -- A number outside a plausible range is refused; "unsure" is always allowed and scores unsure_points (the cautious reading).
  for v_item in select * from jsonb_array_elements(v_cfg.config -> 'items') loop
    v_kind := v_item ->> 'kind';
    if v_kind = 'yes_no' then
      v_ans := p_answers ->> (v_item ->> 'id');
      if v_ans is null or v_ans not in ('yes', 'no', 'unsure') then raise exception 'answer every question' using errcode = '22023'; end if;
      v_keys := v_keys + 1;
      if v_ans = 'yes' then v_total := v_total + (v_item ->> 'points')::integer;
      elsif v_ans = 'unsure' then v_unsure := v_unsure + 1; v_total := v_total + v_unsure_pts; end if;
    elsif v_kind = 'bmi' then
      v_h := private.sleep_measure(p_answers, 'height_cm', 100, 230);
      v_w := private.sleep_measure(p_answers, 'weight_kg', 25, 350);
      v_keys := v_keys + 2;
      if v_h is null or v_w is null then
        v_unsure := v_unsure + 1; v_total := v_total + v_unsure_pts;
      elsif v_w / ((v_h / 100.0) * (v_h / 100.0)) > (v_item ->> 'above')::numeric then
        v_total := v_total + (v_item ->> 'points')::integer;
      end if;
    elsif v_kind = 'neck_cm' then
      v_nk := private.sleep_measure(p_answers, 'neck_cm', 20, 80);
      v_keys := v_keys + 1;
      if v_nk is null then
        v_unsure := v_unsure + 1; v_total := v_total + v_unsure_pts;
      elsif v_nk >= (v_item ->> 'at_least')::numeric then
        v_total := v_total + (v_item ->> 'points')::integer;
      end if;
    else
      raise exception 'unknown item kind' using errcode = '22023';
    end if;
  end loop;
  if (select count(*) from jsonb_object_keys(p_answers)) <> v_keys then raise exception 'unknown question' using errcode = '22023'; end if;

  v_signed := v_cfg.status = 'confirmed';
  v_met := case when v_signed then v_total >= (v_cfg.config ->> 'cut_off')::integer end;
  insert into public.sleep_apnoea_screens (id, organisation_id, patient_id, config_version, answers, total, unsure_count, signed, cut_off_met, is_test)
  values (v_id, v_pr.organisation_id, v_uid, v_cfg.version, p_answers, v_total, v_unsure, v_signed, v_met, coalesce(v_pr.is_test, false));

  if v_signed and v_met then
    begin
      v_task := private.create_clinical_task(v_uid, 'admin_clinical', null, 'sleep_apnoea:' || v_uid);
      update public.sleep_apnoea_screens set task_id = v_task where id = v_id;
    exception when others then
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (v_pr.organisation_id, 'sleep_apnoea_task.error', 'sleep_apnoea_screen', v_id, jsonb_build_object('error', sqlerrm));
      perform private.page_incident(v_pr.organisation_id, 'sleep_apnoea_task_failed:' || v_id, 'A sleep referral task could not be created',
        'A sleep questionnaire met its cut-off but the task failed; see audit_log action sleep_apnoea_task.error.');
    end;
  end if;
  -- The patient sees a result only from a signed instrument.
  return jsonb_build_object('saved', true, 'show_result', v_signed, 'cut_off_met', v_met, 'unsure_count', v_unsure);
end $$;
revoke all on function public.submit_sleep_apnoea_screen(jsonb) from public, anon;
grant execute on function public.submit_sleep_apnoea_screen(jsonb) to authenticated;

-- Staff read: audited, tie or break-glass ----------------------------------------------------------------------------------------
create or replace function public.read_patient_sleep_screens_audited(p_patient uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_rows jsonb;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_patient <> v_uid then
    if exists (select 1 from public.profiles where id = v_uid and role = 'patient') then raise exception 'not authorised' using errcode = '42501'; end if;
    if p_reason is null or char_length(btrim(p_reason)) < 10 then raise exception 'a reason of at least 10 characters is required' using errcode = '22023'; end if;
    if not private.can_staff_read_mental_health(p_patient) then
      perform private.audit_mental_health_read(p_patient, array['sleep_screens'], p_reason, 'denied');
      return jsonb_build_object('status', 'denied');
    end if;
    perform private.audit_mental_health_read(p_patient, array['sleep_screens'], p_reason, 'success');
  end if;
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_rows from (
    select id, config_version, answers, total, unsure_count, signed, cut_off_met, task_id, created_at
      from public.sleep_apnoea_screens where patient_id = p_patient order by created_at desc limit 50) x;
  return jsonb_build_object('status', 'ok', 'rows', v_rows);
end $$;
revoke all on function public.read_patient_sleep_screens_audited(uuid, text) from public, anon;
grant execute on function public.read_patient_sleep_screens_audited(uuid, text) to authenticated;

-- The CMO confirms a proposed version (the build never calls this) ------------------------------------------------------------------
create or replace function public.confirm_sleep_apnoea_screen_config(p_version integer) returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.credential_is_cmo() then raise exception 'not authorised' using errcode = '42501'; end if;
  if not exists (select 1 from public.sleep_apnoea_screen_config where version = p_version and status = 'proposed') then
    raise exception 'that version is not waiting for confirmation' using errcode = '22023';
  end if;
  update public.sleep_apnoea_screen_config set is_active = false where is_active and version <> p_version;
  update public.sleep_apnoea_screen_config set status = 'confirmed', confirmed_by = v_uid, confirmed_at = now(), is_active = true where version = p_version;
end $$;
revoke all on function public.confirm_sleep_apnoea_screen_config(integer) from public, anon;
grant execute on function public.confirm_sleep_apnoea_screen_config(integer) to authenticated;

do $$
begin
  if exists (select 1 from public.sleep_apnoea_screen_config where status = 'confirmed' or confirmed_by is not null) then raise exception 'FAIL: an instrument is signed by the build'; end if;
  if not exists (select 1 from public.go_live_guards where key = 'sleep_apnoea_screen_enabled' and not is_on) then raise exception 'FAIL: sleep guard missing or on'; end if;
  if has_function_privilege('anon', 'public.submit_sleep_apnoea_screen(jsonb)', 'EXECUTE') then raise exception 'FAIL: anon can submit'; end if;
  if jsonb_array_length(private.go_live_conditions('sleep_apnoea_screen_enabled', null)) <> 2 then raise exception 'FAIL: expected two sleep conditions'; end if;
  if jsonb_array_length(private.go_live_conditions('wellbeing_library_clinical_scripts', null)) <> 2 then raise exception 'FAIL: expected two library conditions'; end if;
  if jsonb_array_length(private.go_live_conditions('mental_health_follow_up_enabled', null)) <> 2 then raise exception 'FAIL: S56 conditions disturbed'; end if;
end $$;
