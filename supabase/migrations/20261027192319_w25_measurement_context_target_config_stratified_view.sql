-- W-25 (T4 measurement quality): where a blood pressure was measured, the home and clinic targets, a reading grade, and a stratified outcome view.
-- Everything here is additive and dark. No S75 / cascade-of-care / bp_control definition is edited (founder decision D-09, 2026-10-27).
--
--   1. vitals_readings.measurement_context (nullable, frozen after insert like entry_origin): home_self, home_assisted, pharmacy, diary. No backfill, no default:
--      null = "not labelled". The stratified view derives pharmacy / diary from entry_origin when the new column is null, so existing labelled readings stratify correctly.
--      A clinic reading stays in its own table (clinic_bp_readings, S07x, deliberate: no home engine ever sees it) and is joined only in the read view below.
--   2. bp_target_config: the governed target row (home 135/85, clinic 140/90) plus the reading-grade thresholds. Ships UNSIGNED and INACTIVE (D-09): nothing may treat
--      it as signed. There is no signer in this migration; the sign-off RPC (Chief Medical Officer plus the external clinician) is a separate, later change.
--      private.bp_target_config_active() returns null until a row is signed, so any consumer that asks for "the signed target" gets nothing.
--   3. private.v_bp_readings_all: ONE read view over vitals_readings (manual and device blood pressure only; a wearable or cuffless estimate NEVER enters) and clinic_bp_readings.
--   4. private.bp_reading_grade(): grade A / B / C by protocol adherence (seated, rested, repeat reading, plausible). Clinician and analytics only; never shown to the patient.
--      Rest time is not captured anywhere in the database yet, so the view labels a reading C, unknown (position never recorded) or rest_not_recorded; never A or B.
--   5. private.bp_outcome_stratified(): a NEW aggregate by tier, context, grade and source. Home and clinic are never blended: each context is judged on its own line,
--      and a control figure is returned ONLY when a signed target exists. Not granted to anyone and not read by any screen, report or sponsor surface.
--
-- COUNTS (live, read-only, 2026-10-27): vitals_readings.measurement_context did not exist; bp_target_config did not exist; analytics_clean_view_sources has no vitals_readings
-- view (the rebuild call below is guarded and idempotent).

-- 1. the column -----------------------------------------------------------------------------------------------------------------------
-- LOCKING: add column (nullable, no default) is metadata only, and ADD CONSTRAINT ... NOT VALID takes its lock briefly without scanning. The two VALIDATE steps are
-- deliberately NOT in this file: validating inside the same transaction would hold the ACCESS EXCLUSIVE lock of the ALTER across two full scans of vitals_readings.
-- They live in the follow-up migration 20261027200107_w25b_validate_measurement_context_constraints.sql (VALIDATE takes only SHARE UPDATE EXCLUSIVE, in its own transaction).
-- A NOT VALID check is still enforced for every new or changed row from the moment it is added; only the proof about OLD rows is deferred, and the column is all null.
set local lock_timeout = '15s';
alter table public.vitals_readings add column if not exists measurement_context text;

alter table public.vitals_readings
  add constraint vitals_readings_measurement_context_check
  check (measurement_context is null
         or (vital_type = 'blood_pressure' and measurement_context in ('home_self', 'home_assisted', 'pharmacy', 'diary'))) not valid;
alter table public.vitals_readings
  add constraint vitals_readings_measurement_context_origin_check
  check (measurement_context is null or entry_origin is null
         or (entry_origin = 'pharmacy_machine' and measurement_context = 'pharmacy')
         or (entry_origin = 'paper_diary' and measurement_context = 'diary')) not valid;

comment on column public.vitals_readings.measurement_context is 'W-25: where a blood pressure was measured: home_self, home_assisted (someone helped at home), pharmacy, diary (copied from the person''s own diary). Null = not labelled. Frozen after insert (a correction is a supersede). Never used for a red-flag decision.';

-- frozen like the value: append the column to the live frozen list (read from the live trigger, not restated, so a list another migration changed is kept)
do $freeze$
declare
  v_def  text;
  v_list text;
begin
  select pg_get_triggerdef(g.oid) into v_def
    from pg_trigger g
   where g.tgrelid = 'public.vitals_readings'::regclass and g.tgname = 'a_clinical_value_supersession' and not g.tgisinternal;
  if v_def is null then raise exception 'W25: a_clinical_value_supersession is missing on vitals_readings'; end if;
  v_list := (regexp_match(v_def, 'enforce_clinical_value_supersession\(''([^'']*)''\)'))[1];
  if v_list is null then raise exception 'W25: could not read the frozen column list'; end if;
  if not ('measurement_context' = any (string_to_array(v_list, ','))) then
    execute 'drop trigger a_clinical_value_supersession on public.vitals_readings';
    execute replace(v_def, 'enforce_clinical_value_supersession(''' || v_list || ''')',
                           'enforce_clinical_value_supersession(''' || v_list || ',measurement_context'')');
  end if;
end
$freeze$;

-- views that expand vitals_readings.* pick up the new column (idempotent, a no-op when nothing is registered)
do $rebuild$
begin
  if to_regprocedure('private.rebuild_analytics_clean_views()') is not null then
    perform private.rebuild_analytics_clean_views();
  end if;
end
$rebuild$;

-- the two private row views mirror every column of vitals_readings (a proof, s05b_d, fails when they drift). Append the new column the same way
-- s07y did for entry_origin: read the live definition, add the column last, keep the owner-rights option. Idempotent.
do $views$
declare
  v_cur text;
  v_dia text;
begin
  if not exists (select 1 from pg_attribute where attrelid = 'private.vitals_readings_current'::regclass and attname = 'measurement_context' and not attisdropped) then
    v_cur := regexp_replace(rtrim(pg_get_viewdef('private.vitals_readings_current'::regclass, true), E' ;\n'), '\sFROM\s', ', measurement_context FROM ');
    execute 'create or replace view private.vitals_readings_current with (security_invoker = false) as ' || v_cur;
  end if;
  if not exists (select 1 from pg_attribute where attrelid = 'private.vitals_readings_diagnostic'::regclass and attname = 'measurement_context' and not attisdropped) then
    v_dia := regexp_replace(rtrim(pg_get_viewdef('private.vitals_readings_diagnostic'::regclass, true), E' ;\n'), '\sFROM\s', ', measurement_context FROM ');
    execute 'create or replace view private.vitals_readings_diagnostic with (security_invoker = false) as ' || v_dia;
  end if;
end
$views$;

-- 2. the governed target row ---------------------------------------------------------------------------------------------------------
create table public.bp_target_config (
  id          uuid primary key default gen_random_uuid(),
  version     integer not null unique check (version >= 1),
  is_active   boolean not null default false,
  config      jsonb not null,
  notes       text,
  approved_by uuid references public.clinical_staff (id),
  approved_at timestamptz,
  created_at  timestamptz not null default now(),
  check ((approved_by is null) = (approved_at is null)),
  check (not is_active or approved_by is not null),
  check (jsonb_typeof(config -> 'targets') = 'object' and jsonb_typeof(config -> 'grade') = 'object' and jsonb_typeof(config -> 'contextToTarget') = 'object')
);
create unique index bp_target_config_one_active on public.bp_target_config (is_active) where is_active;
comment on table public.bp_target_config is 'Platform-level governed configuration, so it has no organisation_id (the same shape as home_bp_programme_signoffs, escalation_slas and the other signed single-active-row tables). W-25 / D-09: home and clinic blood pressure targets and the reading-grade thresholds. Born unsigned and inactive. There is no signer yet; a row can be active only if approved_by is set (check). Read it through private.bp_target_config_active() (signed only) or public.get_bp_target_config() (latest, with a signed flag).';

-- bp-target-config-begin
insert into public.bp_target_config (version, is_active, config, notes)
values (1, false, $json${
 "targets": {
  "home": { "systolic": 135, "diastolic": 85 },
  "clinic": { "systolic": 140, "diastolic": 90 }
 },
 "contextToTarget": {
  "home_self": "home",
  "home_assisted": "home",
  "diary": "home",
  "pharmacy": "clinic",
  "clinic": "clinic"
 },
 "grade": {
  "restMinutes": 5,
  "repeatWindowMinutes": 10,
  "minGapMinutes": 1,
  "plausible": { "systolicMin": 60, "systolicMax": 260, "diastolicMin": 30, "diastolicMax": 160 },
  "minReadingsPerPerson": 3
 }
}$json$::jsonb,
        'W-25 / D-09. PROPOSED, unsigned and inactive. Home 135/85 and clinic 140/90 are the figures in the plan (FD5) and in the home programme bands; the grade thresholds are engineering proposals. To be signed by the Chief Medical Officer and an external clinician (separate signer, not built here). Until then no outcome or sponsor surface may use a home target.');
-- bp-target-config-end

create trigger refuse_superseded_activation before update of is_active on public.bp_target_config
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();

-- RLS on, no policy and no grant: a user role reads nothing from the table. public.get_bp_target_config() is the only read path.
alter table public.bp_target_config enable row level security;
revoke all on public.bp_target_config from public, anon, authenticated;

-- 9. an approved row never changes: a change is a new version
create function private.bp_target_config_immutable() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.approved_by is not null then raise exception 'a signed bp_target_config version cannot be deleted' using errcode = '42501'; end if;
    return old;
  end if;
  if old.approved_by is not null
     and (new.config is distinct from old.config or new.approved_by is distinct from old.approved_by
          or new.approved_at is distinct from old.approved_at or new.version is distinct from old.version) then
    raise exception 'a signed bp_target_config version cannot be changed: make a new version' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.bp_target_config_immutable() from public, anon, authenticated;
create trigger bp_target_config_immutable before update or delete on public.bp_target_config
  for each row execute function private.bp_target_config_immutable();

create function private.bp_target_config_active() returns jsonb
language sql stable security definer set search_path = ''
as $$ select config from public.bp_target_config where is_active and approved_by is not null $$;
revoke all on function private.bp_target_config_active() from public, anon, authenticated;

-- the newest row, signed or not, with a flag that says which. Grade thresholds are read from here; a control figure never is.
create function private.bp_target_config_latest() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('version', c.version, 'signed', c.approved_by is not null, 'is_active', c.is_active, 'config', c.config)
    from public.bp_target_config c
   order by c.is_active desc, c.version desc
   limit 1
$$;
revoke all on function private.bp_target_config_latest() from public, anon, authenticated;

create function public.get_bp_target_config() returns jsonb
language sql stable security definer set search_path = ''
as $$ select private.bp_target_config_latest() where (select auth.uid()) is not null $$;
revoke all on function public.get_bp_target_config() from public, anon;
grant execute on function public.get_bp_target_config() to authenticated;

-- 3. the grade -----------------------------------------------------------------------------------------------------------------------
-- C: implausible, or a recorded position that is not seated.
-- unknown: plausible but the position was never recorded (NOT the same as "not seated", so it is not graded C).
-- rest_not_recorded: plausible and seated, but rest minutes are not known. Rest minutes are stored NOWHERE in the database today, so this is what every stored reading gets;
--   the view never labels a reading A or B on rest it does not have.
-- A: seated, rested for the configured minutes, and a repeat reading in the same sitting. B: seated, rest known, but too short or no repeat reading.
-- The thresholds come in as p_cfg (the grade object of the latest bp_target_config row); with no configuration the function returns null: no number is hard-coded here.
-- The rule is also written in TypeScript (packages/clinical/src/reading-grade.ts); one shared case table (reading-grade-cases.json) runs through both.
create function private.bp_reading_grade(p_position text, p_rest_minutes numeric, p_repeat_count integer, p_systolic integer, p_diastolic integer, p_cfg jsonb)
returns text
language plpgsql immutable set search_path = ''
as $$
declare
  v_rest    numeric := (p_cfg ->> 'restMinutes')::numeric;
  v_sys_min integer := (p_cfg #>> '{plausible,systolicMin}')::integer;
  v_sys_max integer := (p_cfg #>> '{plausible,systolicMax}')::integer;
  v_dia_min integer := (p_cfg #>> '{plausible,diastolicMin}')::integer;
  v_dia_max integer := (p_cfg #>> '{plausible,diastolicMax}')::integer;
begin
  if v_rest is null or v_sys_min is null or v_sys_max is null or v_dia_min is null or v_dia_max is null then return null; end if;
  if p_systolic is null or p_diastolic is null
     or p_systolic < v_sys_min or p_systolic > v_sys_max
     or p_diastolic < v_dia_min or p_diastolic > v_dia_max
     or p_systolic <= p_diastolic then
    return 'C';
  end if;
  if p_position is null then return 'unknown'; end if;
  if p_position <> 'seated' then return 'C'; end if;
  if p_rest_minutes is null then return 'rest_not_recorded'; end if;
  if p_rest_minutes >= v_rest and coalesce(p_repeat_count, 0) >= 1 then return 'A'; end if;
  return 'B';
end $$;
revoke all on function private.bp_reading_grade(text, numeric, integer, integer, integer, jsonb) from public, anon, authenticated;

-- 4. ONE read view over both tables --------------------------------------------------------------------------------------------------
-- Vitals side: the diagnostic view (a wearable or cuffless estimate is already out of it) joined to the base row for measurement_context, and only manual / device readings.
-- Clinic side: clinic_bp_readings as a clinic context, ungraded. security_invoker is off on purpose (private schema, no grant to any role), like the S75 cohort views.
-- The grade thresholds are read once (cross join), not per row. No repeat-reading count is computed: with rest never stored the count cannot change any label.
create view private.v_bp_readings_all with (security_invoker = off) as
  select 'vitals'::text as origin_table,
         d.id as reading_id, d.patient_id, d.organisation_id, d.taken_at,
         d.systolic::integer as systolic, d.diastolic::integer as diastolic,
         d.source::text as source,
         coalesce(b.measurement_context,
                  case d.entry_origin when 'pharmacy_machine' then 'pharmacy' when 'paper_diary' then 'diary' end,
                  'unlabelled') as context,
         d."position" as reading_position, d.arm, d.cuff_type,
         d.validation_status, d.validation_flags,
         private.bp_reading_grade(d."position", null::numeric, null::integer, d.systolic::integer, d.diastolic::integer, cfg.g) as reading_grade
    from private.vitals_readings_diagnostic d
    join public.vitals_readings b on b.id = d.id
    cross join (select private.bp_target_config_latest() #> '{config,grade}' as g) cfg
   where b.correction_status is null
     and d.vital_type = 'blood_pressure' and d.systolic is not null and d.diastolic is not null
     and d.source::text in ('manual', 'device')
  union all
  select 'clinic'::text, c.id, c.patient_id, c.organisation_id, c.measured_at,
         c.systolic::integer, c.diastolic::integer,
         'clinic'::text, 'clinic'::text,
         null::text, null::text, null::text,
         null::public.vitals_validation_status, null::text[],
         null::text
    from public.clinic_bp_readings c;
revoke all on private.v_bp_readings_all from public, anon, authenticated;
comment on view private.v_bp_readings_all is 'W-25: one row per blood pressure reading that may feed a statistic: manual and device readings (never a wearable estimate, never a superseded reading) and care-team clinic readings. context is the stored measurement_context, else derived from entry_origin, else unlabelled; clinic rows are context clinic and ungraded. reading_grade is never A or B today (rest minutes are not stored): it is C, unknown or rest_not_recorded.';

-- 5. the stratified outcome (aggregate, small numbers withheld, home and clinic never blended) ----------------------------------------
-- STAYS UNGRANTED. Strata overlap (a person can sit in several), so a reader holding two strata could difference a small cell out. The complementary-suppression pass the
-- S75 doorway applies (suppress_difference across overlapping cells) is NOT built here; until it is, nobody may execute this function, and the migration asserts that.
-- Tier is the person's membership tier AS OF their latest reading in the stratum (patient_memberships dates; the grace period is not applied).
create function private.bp_outcome_stratified(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_min     integer := private.min_cell_floor();
  v_latest  jsonb   := private.bp_target_config_latest();
  v_active  jsonb   := private.bp_target_config_active();
  v_from    date    := coalesce(p_from, (now() at time zone 'Africa/Lagos')::date - 90);
  v_to      date    := coalesce(p_to, (now() at time zone 'Africa/Lagos')::date);
  v_lo      timestamptz := (coalesce(p_from, (now() at time zone 'Africa/Lagos')::date - 90))::timestamp at time zone 'Africa/Lagos';
  v_hi      timestamptz := (coalesce(p_to, (now() at time zone 'Africa/Lagos')::date) + 1)::timestamp at time zone 'Africa/Lagos';
  v_minread integer := (v_latest #>> '{config,grade,minReadingsPerPerson}')::integer;
  v_rows    jsonb;
begin
  if v_minread is null then raise exception 'bp_target_config_missing' using errcode = 'P0002'; end if;
  with r as (
    select v.patient_id, v.context, coalesce(v.reading_grade, 'n/a') as grade, v.source, v.systolic, v.diastolic, v.taken_at
      from private.v_bp_readings_all v
      join public.profiles p on p.id = v.patient_id and not coalesce(p.is_test, false)
     where v.taken_at >= v_lo and v.taken_at < v_hi
  ), pp as (
    select patient_id, context, grade, source, count(*) as n, avg(systolic) as s, avg(diastolic) as d, max(taken_at) as last_at
      from r group by patient_id, context, grade, source
  ), st as (
    select coalesce(t.tier, 'free') as tier, pp.context, pp.grade, pp.source, pp.s, pp.d,
           (v_active #>> array['targets', v_active #>> array['contextToTarget', pp.context], 'systolic'])::numeric as t_sys,
           (v_active #>> array['targets', v_active #>> array['contextToTarget', pp.context], 'diastolic'])::numeric as t_dia
      from pp
      left join lateral (
        select m.tier from public.patient_memberships m
         where m.patient_id = pp.patient_id and m.starts_at <= pp.last_at
           and (coalesce(m.ends_at, m.ended_at) is null or coalesce(m.ends_at, m.ended_at) > pp.last_at)
         order by (m.tier = 'plus') desc, m.starts_at desc limit 1) t on true
     where pp.n >= v_minread
  ), agg as (
    select tier, context, grade, source,
           count(*) as people,
           count(*) filter (where t_sys is not null and s < t_sys and d < t_dia) as controlled,
           count(*) filter (where t_sys is not null and not (s < t_sys and d < t_dia)) as uncontrolled
      from st group by tier, context, grade, source
  )
  select coalesce(jsonb_agg(
           case
             when private.suppress_cell(a.people, case when v_active is not null and a.context <> 'unlabelled' then array[a.controlled, a.uncontrolled] end, v_min) is not null
               then jsonb_build_object('tier', a.tier, 'context', a.context, 'grade', a.grade, 'source', a.source, 'suppressed', true, 'minimum', v_min)
             else jsonb_build_object('tier', a.tier, 'context', a.context, 'grade', a.grade, 'source', a.source, 'people', a.people)
                  || case when v_active is not null and a.context <> 'unlabelled'
                          then jsonb_build_object('controlled', a.controlled, 'uncontrolled', a.uncontrolled)
                          else '{}'::jsonb end
           end order by a.tier, a.context, a.grade, a.source), '[]'::jsonb)
    into v_rows from agg a;

  return jsonb_build_object(
    'measure', 'bp_stratified',
    'range', jsonb_build_object('from', v_from, 'to', v_to),
    'minimum_cell', v_min,
    'min_readings_per_person', v_minread,
    'target_config_version', v_latest ->> 'version',
    'target_signed', v_active is not null,
    'control_withheld_reason', case when v_active is null then 'target_unsigned' end,
    'tier_basis', 'as_of_latest_reading_in_stratum',
    'strata', v_rows,
    'note', 'Internal and descriptive only. A person can appear in more than one stratum, so strata do not add up to a total and must not be differenced. Home, diary and clinic-type readings are judged on their own targets and never blended (pharmacy readings use the clinic line). Unlabelled readings are counted but never judged. The grade is never A or B because rest minutes are not stored. Tier is the membership tier on the date of the latest reading in the stratum.',
    'not_a_causal_claim', true,
    'generated_at', now());
end $$;
revoke all on function private.bp_outcome_stratified(date, date) from public, anon, authenticated;

-- 6. assertions -----------------------------------------------------------------------------------------------------------------------
do $assert$
declare v_list text;
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vitals_readings' and column_name = 'measurement_context') then
    raise exception 'W25: measurement_context is missing';
  end if;
  select (regexp_match(pg_get_triggerdef(g.oid), 'enforce_clinical_value_supersession\(''([^'']*)''\)'))[1] into v_list
    from pg_trigger g where g.tgrelid = 'public.vitals_readings'::regclass and g.tgname = 'a_clinical_value_supersession';
  if v_list is null or not ('measurement_context' = any (string_to_array(v_list, ','))) then raise exception 'W25: measurement_context is not frozen'; end if;
  if (select count(*) from public.vitals_readings where measurement_context is not null) <> 0 then raise exception 'W25: existing readings were relabelled'; end if;
  if (select count(*) from public.bp_target_config where approved_by is not null or is_active) <> 0 then raise exception 'W25: the target row must ship unsigned and inactive'; end if;
  if private.bp_target_config_active() is not null then raise exception 'W25: an unsigned target is being served as signed'; end if;
  if (select (config #>> '{targets,home,systolic}') || '/' || (config #>> '{targets,home,diastolic}') || ' ' || (config #>> '{targets,clinic,systolic}') || '/' || (config #>> '{targets,clinic,diastolic}')
        from public.bp_target_config where version = 1) <> '135/85 140/90' then raise exception 'W25: seed targets changed'; end if;
  if has_table_privilege('authenticated', 'public.bp_target_config', 'SELECT') or has_table_privilege('authenticated', 'public.bp_target_config', 'INSERT')
     or has_table_privilege('authenticated', 'public.bp_target_config', 'UPDATE') then
    raise exception 'W25: authenticated has direct access to the target config';
  end if;
  if has_table_privilege('anon', 'public.bp_target_config', 'SELECT') then raise exception 'W25: anon can read the target config'; end if;
  if has_function_privilege('anon', 'public.get_bp_target_config()', 'EXECUTE') then raise exception 'W25: anon can read the target config through the function'; end if;
  if has_function_privilege('anon', 'private.bp_outcome_stratified(date, date)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.bp_outcome_stratified(date, date)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.bp_target_config_active()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.bp_reading_grade(text, numeric, integer, integer, integer, jsonb)', 'EXECUTE') then
    raise exception 'W25: a private function is open to a user role';
  end if;
  if has_table_privilege('authenticated', 'private.v_bp_readings_all', 'SELECT') or has_table_privilege('anon', 'private.v_bp_readings_all', 'SELECT') then
    raise exception 'W25: the read view is open to a user role';
  end if;
  if private.bp_reading_grade('seated', 5, 1, 120, 80, (private.bp_target_config_latest() #> '{config,grade}')) <> 'A'
     or private.bp_reading_grade(null, 5, 1, 120, 80, (private.bp_target_config_latest() #> '{config,grade}')) <> 'unknown'
     or private.bp_reading_grade('seated', null, 1, 120, 80, (private.bp_target_config_latest() #> '{config,grade}')) <> 'rest_not_recorded'
     or private.bp_reading_grade('standing', 5, 1, 120, 80, (private.bp_target_config_latest() #> '{config,grade}')) <> 'C'
     or private.bp_reading_grade('seated', 5, 1, 120, 80, null) is not null then
    raise exception 'W25: grade truth table';
  end if;
end
$assert$;
