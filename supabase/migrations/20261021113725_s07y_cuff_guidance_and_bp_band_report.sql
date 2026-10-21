-- S07y: cuff size and validated-device guidance, the patient's own cuff record, and the OQ-67 band comparison report.
--
-- NOTHING IS SWITCHED ON AND NO BAND CHANGES.
--   1. bp_cuff_guidance_signoffs   the governed arm-circumference to cuff-size table (the shared single-active-row shape). Seeded v1 UNSIGNED and INACTIVE.
--                                  public.my_bp_cuff_guidance() returns nothing until the Chief Medical Officer signs it (sign_bp_cuff_guidance), so the phone shows no
--                                  cuff-size step and record_my_bp_cuff() refuses (INV-14, INV-16). The patient wording lives in packages/i18n (hc.cuff.*), not here.
--   2. patient_bp_cuffs            what the patient says she measures with: cuff_type (the SAME three values as vitals_readings.cuff_type from S12b, proved equal
--                                  below, not a second vocabulary), an optional model name and an optional arm measurement. Append-only; the latest row is current.
--   3. The validated-device list   is NOT a new table. public.device_catalog (S70a, 18.2) already holds it: evidence columns, a CMO-only review, recommended_devices(),
--                                  module device_recommended_list (off). This migration only reads it (private.bp_cuff_model_listing): a model is "listed" only when a
--                                  reviewed, active, recommend-only blood pressure row matches; with no such row the answer is "list_empty", never "not validated".
--                                  No device is invented or seeded here. The admin editor is a page over device_catalog (admin insert/update policies already exist).
--   4. public.bp_band_divergence_report(days)  OQ-67 evidence for the CMO: for the last N days, how many readings the app band (private.classify_bp_level, which
--                                  the phone and web badge mirror) and the level the live trigger private.handle_bp_reading_red_flag actually acts on place differently,
--                                  and why. Read-only, aggregates only, no patient id, test accounts excluded. It changes no threshold.
--
-- LIVE FACTS READ 2026-10-20 (read-only, project koiplnmbgnqnbywhpjlf): the live handle_bp_reading_red_flag adds three steps after classify_bp_level: a personal
-- target can lift green to amber; pregnancy lifts to red or emergency at 140/90 and 160/110; and, once the CMO has approved the triage rule set
-- (private.approved_bp_rule_params() not null), an emergency-range reading with no red-flag symptom near it (not in pregnancy or after a birth) is treated as red.
-- device_catalog held 3 rows; no cuff guidance or cuff record table existed. Latest live migration 20261020173600 matches a file on main-dev.
-- LIMITS of the report (also in the function comment): it re-derives the level from the stored reading and the CURRENT profile and target (pregnancy and target may
-- have differed on the day), it does not model plan gating (Free patients get a self-care suggestion, not an alert) or alert merging. It reads private.vitals_readings_current, which leaves out corrected
-- (superseded) rows and wearable estimates, and looks back at most 90 days.

-- 1. The governed cuff-size table ------------------------------------------------------------------------------------------------------------
create table public.bp_cuff_guidance_signoffs (
  id          uuid primary key default gen_random_uuid(),
  version     integer not null unique check (version >= 1),
  is_active   boolean not null default false,
  config      jsonb not null,
  notes       text,
  approved_by uuid references public.clinical_staff (id),
  approved_at timestamptz,
  created_at  timestamptz not null default now(),
  check ((approved_by is null) = (approved_at is null))
);
create unique index bp_cuff_guidance_signoffs_one_active on public.bp_cuff_guidance_signoffs (is_active) where is_active;

-- cuff-config-begin
insert into public.bp_cuff_guidance_signoffs (version, is_active, config, notes)
values (1, false, $json${
  "sizes": [
    { "key": "small_adult", "minCm": 22, "maxCm": 26 },
    { "key": "adult", "minCm": 27, "maxCm": 34 },
    { "key": "large_adult", "minCm": 35, "maxCm": 44 },
    { "key": "extra_large", "minCm": 45, "maxCm": 52 }
  ],
  "measureMinCm": 15,
  "measureMaxCm": 60,
  "wordingSha256": "1179c39d263814d87b9563886afd9fc18f2764d58368f29f0bb53318033162cf"
}$json$::jsonb,
 'PROPOSED, unsigned and inactive. Arm circumference ranges from the published AHA 2019 and ESH 2023 cuff-size tables (docs/research/S07y.md); the CMO checks them against the Nigerian guideline (NG-2023 section 3.1.1) and signs with sign_bp_cuff_guidance().');
-- cuff-config-end

create function public.sign_bp_cuff_guidance(p_id uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_staff uuid;
begin
  if not exists (select 1 from public.bp_cuff_guidance_signoffs where id = p_id) then raise exception 'Cuff guidance version not found'; end if;
  if exists (select 1 from public.bp_cuff_guidance_signoffs where id = p_id and approved_by is not null) then
    raise exception 'this version is already signed; a change is a new version';
  end if;
  -- the whole structure the lookup and the phone rely on is checked here, not only in the screen: numeric, ordered, no overlap, wording pinned
  perform 1 from public.bp_cuff_guidance_signoffs c
   where c.id = p_id and (
     jsonb_typeof(c.config -> 'sizes') is distinct from 'array' or jsonb_array_length(c.config -> 'sizes') = 0
     or jsonb_typeof(c.config -> 'measureMinCm') is distinct from 'number' or jsonb_typeof(c.config -> 'measureMaxCm') is distinct from 'number'
     or (c.config ->> 'measureMinCm')::numeric >= (c.config ->> 'measureMaxCm')::numeric
     or coalesce(c.config ->> 'wordingSha256', '') !~ '^[0-9a-f]{64}$'
     or exists (select 1 from jsonb_array_elements(c.config -> 'sizes') s
                 where jsonb_typeof(s -> 'key') is distinct from 'string' or jsonb_typeof(s -> 'minCm') is distinct from 'number'
                    or jsonb_typeof(s -> 'maxCm') is distinct from 'number' or (s ->> 'minCm')::numeric > (s ->> 'maxCm')::numeric)
     or exists (select 1 from jsonb_array_elements(c.config -> 'sizes') a, jsonb_array_elements(c.config -> 'sizes') b
                 where a <> b and (a ->> 'minCm')::numeric <= (b ->> 'maxCm')::numeric and (b ->> 'minCm')::numeric <= (a ->> 'maxCm')::numeric));
  if found then raise exception 'this version is malformed (a missing or non-numeric value, overlapping sizes, or no pinned wording) and cannot be signed'; end if;
  select cs.id into v_staff from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer' limit 1;
  if v_staff is null then raise exception 'not authorised: only the active Chief Medical Officer can sign the cuff guidance'; end if;
  update public.bp_cuff_guidance_signoffs set is_active = false where is_active and id <> p_id;
  update public.bp_cuff_guidance_signoffs set approved_by = v_staff, approved_at = now(), is_active = true where id = p_id;
  perform private.log_audit('bp_cuff_guidance.signed', 'bp_cuff_guidance_signoffs', p_id, '{}'::jsonb);
  return p_id;
end;
$$;
revoke all on function public.sign_bp_cuff_guidance(uuid) from public, anon;
grant execute on function public.sign_bp_cuff_guidance(uuid) to authenticated;

alter table public.bp_cuff_guidance_signoffs enable row level security;
create policy bp_cuff_guidance_signoffs_read on public.bp_cuff_guidance_signoffs for select to authenticated using (true);
revoke all on public.bp_cuff_guidance_signoffs from public, anon, authenticated;
grant select on public.bp_cuff_guidance_signoffs to authenticated;

create trigger refuse_superseded_activation before update of is_active on public.bp_cuff_guidance_signoffs
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();

-- The whole centimetre is looked up (round half up), so a 26.5 cm arm is read as 27. The TypeScript twin in packages/clinical does the same; a parity block
-- in the DB proof and in cuff-size.test.ts pins both.
create function private.bp_cuff_size_key(p_cm numeric, p_cfg jsonb) returns text
language sql immutable set search_path = ''
as $$
  select case
    when p_cm is null or p_cfg is null then null
    else coalesce(
      (select s ->> 'key' from jsonb_array_elements(p_cfg -> 'sizes') s
        where round(p_cm) between (s ->> 'minCm')::numeric and (s ->> 'maxCm')::numeric limit 1),
      case when round(p_cm) < (select min((s ->> 'minCm')::numeric) from jsonb_array_elements(p_cfg -> 'sizes') s) then 'below_range' else 'above_range' end)
  end
$$;
revoke all on function private.bp_cuff_size_key(numeric, jsonb) from public, anon, authenticated;

-- 3. Reads the S70a recommended-device list; invents nothing. 'list_empty' when no reviewed row exists (or the list module is off). The match is the whole
-- model name, spaces and punctuation ignored: a variant ('M2 Basic') or a wrist version is NOT the reviewed model, so it is not_listed.
create function private.bp_cuff_model_listing(p_model text) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare v_m text := replace(coalesce(private.normalise_term(p_model), ''), ' ', '');
begin
  if v_m = '' then return null; end if;
  if not private.module_enabled('device_recommended_list')
     or not exists (select 1 from public.device_catalog d where d.active and d.clinically_reviewed and d.category = 'blood_pressure' and d.fulfillment_type = 'recommend_only') then
    return 'list_empty';
  end if;
  if exists (select 1 from public.device_catalog d
              where d.active and d.clinically_reviewed and d.category = 'blood_pressure' and d.fulfillment_type = 'recommend_only'
                and v_m = replace(coalesce(private.normalise_term(d.device_name), ''), ' ', '')) then
    return 'listed';
  end if;
  return 'not_listed';
end $$;
revoke all on function private.bp_cuff_model_listing(text) from public, anon, authenticated;

-- 2. The patient's own cuff record ---------------------------------------------------------------------------------------------------------
create table public.patient_bp_cuffs (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  cuff_type             text not null,
  model_text            text,
  arm_circumference_cm  numeric(4,1),
  size_key              text,
  guidance_version      integer not null,
  is_test               boolean not null default false,
  created_at            timestamptz not null default clock_timestamp(),
  constraint patient_bp_cuffs_cuff_type_check check (cuff_type in ('upper_arm', 'wrist', 'not_sure')),
  constraint patient_bp_cuffs_model_len check (model_text is null or length(btrim(model_text)) between 2 and 80),
  constraint patient_bp_cuffs_arm_range check (arm_circumference_cm is null or arm_circumference_cm between 10 and 80)
);
create index patient_bp_cuffs_patient_idx on public.patient_bp_cuffs (patient_id, created_at desc);
comment on table public.patient_bp_cuffs is 'S07y: what the patient says she measures with. cuff_type uses the same three values as vitals_readings.cuff_type (S12b). Append-only; the newest row is current. Written only by record_my_bp_cuff(), which refuses until the cuff guidance is signed.';
create trigger patient_bp_cuffs_no_change before update or delete on public.patient_bp_cuffs for each row execute function private.home_bp_append_only();
create trigger patient_bp_cuffs_no_truncate before truncate on public.patient_bp_cuffs for each statement execute function private.home_bp_append_only();
alter table public.patient_bp_cuffs enable row level security;
revoke all on public.patient_bp_cuffs from public, anon, authenticated;
grant select on public.patient_bp_cuffs to authenticated;
create policy patient_bp_cuffs_read on public.patient_bp_cuffs for select to authenticated
  using (patient_id = (select auth.uid()) or private.staff_may_read(patient_id, organisation_id, 'medical_history'::public.care_access_category));

insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason) values
  ('patient_bp_cuffs', 'tied', 'patient_id', 'medical_history', null)
on conflict (table_name) do nothing;
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes) values
  ('patient_bp_cuffs', 'patient_id', 'clinical_record', 'review', true, 'S07y. PROPOSED class, to be confirmed by the CMO and DPO.')
on conflict (table_name) do nothing;

create function public.record_my_bp_cuff(p_cuff_type text, p_model text default null, p_arm_cm numeric default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_org uuid; v_test boolean; v_cfg jsonb; v_ver integer; v_size text; v_model text := nullif(btrim(coalesce(p_model, '')), '');
begin
  if v_me is null then raise exception 'not authorised' using errcode = '42501'; end if;
  select organisation_id, coalesce(is_test, false) into v_org, v_test from public.profiles where id = v_me;
  if v_org is null then raise exception 'not authorised' using errcode = '42501'; end if;
  select config, version into v_cfg, v_ver from public.bp_cuff_guidance_signoffs where is_active and approved_by is not null;
  if v_cfg is null then raise exception 'the cuff guidance is not open yet' using errcode = '55000'; end if;
  if p_cuff_type is null or p_cuff_type not in ('upper_arm', 'wrist', 'not_sure') then raise exception 'unknown cuff type' using errcode = '22023'; end if;
  if v_model is not null and length(v_model) not between 2 and 80 then raise exception 'the model name is too short or too long' using errcode = '22023'; end if;
  if p_arm_cm is not null and (p_arm_cm < (v_cfg ->> 'measureMinCm')::numeric or p_arm_cm > (v_cfg ->> 'measureMaxCm')::numeric) then
    raise exception 'that arm measurement does not look right' using errcode = '22023';
  end if;
  v_size := private.bp_cuff_size_key(p_arm_cm, v_cfg);
  insert into public.patient_bp_cuffs (organisation_id, patient_id, cuff_type, model_text, arm_circumference_cm, size_key, guidance_version, is_test)
  values (v_org, v_me, p_cuff_type, v_model, p_arm_cm, v_size, v_ver, v_test);
  perform private.log_audit('bp_cuff.recorded', 'patient_bp_cuffs', v_me, jsonb_build_object('cuff_type', p_cuff_type, 'version', v_ver));
  return jsonb_build_object('ok', true, 'size_key', v_size, 'device_list', private.bp_cuff_model_listing(v_model));
end $$;
revoke all on function public.record_my_bp_cuff(text, text, numeric) from public, anon;
grant execute on function public.record_my_bp_cuff(text, text, numeric) to authenticated;

-- One round trip for the phone and the web: null until the guidance is signed.
create function public.my_bp_cuff_guidance() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_cfg jsonb; v_ver integer; c public.patient_bp_cuffs%rowtype;
begin
  if v_me is null then return null; end if;
  select config, version into v_cfg, v_ver from public.bp_cuff_guidance_signoffs where is_active and approved_by is not null;
  if v_cfg is null then return null; end if;
  select * into c from public.patient_bp_cuffs where patient_id = v_me order by created_at desc, id desc limit 1;
  return jsonb_build_object(
    'version', v_ver, 'config', v_cfg,
    'cuff', case when c.id is null then null else jsonb_build_object(
      'cuff_type', c.cuff_type, 'model', c.model_text, 'arm_cm', c.arm_circumference_cm, 'size_key', c.size_key, 'recorded_at', c.created_at,
      'device_list', private.bp_cuff_model_listing(c.model_text)) end);
end $$;
revoke all on function public.my_bp_cuff_guidance() from public, anon;
grant execute on function public.my_bp_cuff_guidance() to authenticated;

-- 4. OQ-67 evidence: app band against the level the live trigger acts on --------------------------------------------------------------------
create function public.bp_band_divergence_report(p_days integer default 30)
returns table (app_band text, pipeline_level text, cause text, readings bigint, rule_set_approved boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare v_params jsonb;
begin
  if not (private.is_admin() or private.is_active_clinical_director()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_params := private.approved_bp_rule_params();
  return query
  with r as (
    select v.patient_id, v.systolic::int s, v.diastolic::int d, v.created_at, coalesce(p.is_pregnant, false) preg,
           private.classify_bp_level(v.systolic::int, v.diastolic::int) app
      from private.vitals_readings_current v join public.profiles p on p.id = v.patient_id
     where v.vital_type = 'blood_pressure' and v.systolic is not null and v.diastolic is not null and not coalesce(p.is_test, false)
       and not private.bp_reading_is_estimate(v.source::text)
       and v.created_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 90)))
  ), tg as (
    -- the personal target is worked out once per patient, not once per reading
    select pt.patient_id, t.systolic, t.diastolic from (select distinct patient_id from r) pt cross join lateral private.patient_home_bp_target(pt.patient_id) t
  ), l1 as (
    select r.*, case when r.app = 'green' and exists (select 1 from tg where tg.patient_id = r.patient_id and (r.s >= tg.systolic or r.d >= tg.diastolic)) then 'amber' else r.app end lvl1 from r
  ), l2 as (
    select l1.*, case when l1.preg and (l1.s >= 160 or l1.d >= 110) then 'emergency'
                      when l1.preg and (l1.s >= 140 or l1.d >= 90) and l1.lvl1 not in ('emergency', 'red') then 'red'
                      else l1.lvl1 end lvl2 from l1
  ), l3 as (
    select l2.*, case when v_params is not null and l2.lvl2 = 'emergency' and not l2.preg
                           and not private.bp_is_postpartum(l2.patient_id, l2.created_at, v_params)
                           and not private.bp_red_flag_symptom_near(l2.patient_id, l2.created_at, v_params) then 'red' else l2.lvl2 end lvl3 from l2
  )
  select l3.app, l3.lvl3,
         case when l3.lvl3 = l3.app then 'none'
              when l3.lvl3 <> l3.lvl2 then 'rule_set_no_symptom'
              when l3.lvl2 <> l3.lvl1 then 'pregnancy'
              else 'personal_target' end,
         count(*)::bigint, (v_params is not null)
    from l3 group by 1, 2, 3 order by 1, 2, 3;
end $$;
comment on function public.bp_band_divergence_report(integer) is 'S07y / OQ-67: counts of blood pressure readings by the app band (private.classify_bp_level) and the level the live trigger acts on, with the reason. Aggregates only; test accounts excluded. Changes no threshold. Counts only readings that are not corrected and not wearable estimates, up to 90 days. Limits: uses the current profile and personal target, not those of the day; does not model plan gating or alert merging.';
revoke all on function public.bp_band_divergence_report(integer) from public, anon;
grant execute on function public.bp_band_divergence_report(integer) to authenticated;

-- Closing assertions ---------------------------------------------------------------------------------------------------------------------------
do $$
declare v_mine text[]; v_vitals text[];
begin
  if exists (select 1 from public.bp_cuff_guidance_signoffs where is_active or approved_by is not null) then raise exception 'FAIL: cuff guidance must ship unsigned and inactive'; end if;
  if (select count(*) from public.bp_cuff_guidance_signoffs) <> 1 then raise exception 'FAIL: exactly one seed version expected'; end if;
  select array_agg(m[1] order by m[1]) into v_mine from regexp_matches((select pg_get_constraintdef(oid) from pg_constraint where conname = 'patient_bp_cuffs_cuff_type_check' and conrelid = 'public.patient_bp_cuffs'::regclass), '''([a-z_]+)''', 'g') m;
  select array_agg(m[1] order by m[1]) into v_vitals from regexp_matches((select pg_get_constraintdef(oid) from pg_constraint where conname = 'vitals_readings_cuff_type_check' and conrelid = 'public.vitals_readings'::regclass), '''([a-z_]+)''', 'g') m;
  if v_mine is distinct from v_vitals or v_mine is null then raise exception 'FAIL: patient_bp_cuffs.cuff_type values differ from vitals_readings.cuff_type'; end if;
  if has_function_privilege('anon', 'public.my_bp_cuff_guidance()', 'EXECUTE') or has_function_privilege('anon', 'public.record_my_bp_cuff(text,text,numeric)', 'EXECUTE')
     or has_function_privilege('anon', 'public.sign_bp_cuff_guidance(uuid)', 'EXECUTE') or has_function_privilege('anon', 'public.bp_band_divergence_report(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.bp_cuff_model_listing(text)', 'EXECUTE') then
    raise exception 'FAIL: S07y function grants are too wide';
  end if;
  if has_table_privilege('anon', 'public.patient_bp_cuffs', 'SELECT') or has_table_privilege('authenticated', 'public.patient_bp_cuffs', 'INSERT') then
    raise exception 'FAIL: patient_bp_cuffs grants are too wide';
  end if;
end $$;
