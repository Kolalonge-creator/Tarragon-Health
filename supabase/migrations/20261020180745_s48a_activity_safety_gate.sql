-- S48a: activity safety gate (v5 Module 5: 5.1 weekly goal, 5.2 activity kinds, 5.5 condition-safe guidance; structure only for 5.3/5.4/5.7).
-- Design: docs/design/S48a.md. Decision S48-1 (private routes and emergency location are two separate features; emergency location is NOT here).
--
-- LIVE COUNTS BEFORE (2026-10-20): activity_log_entries 0 rows, patient_activity_goals 0, exercise_programmes 6, so every new column is
-- backfilled by its default and no data-conversion step exists.
--
-- What this adds:
--   1. activity_safety_config: versioned, PROPOSED, UNSIGNED rules (same shape as my_health_config). The gate only ever RESTRICTS, so enforcing
--      the unsigned rows errs toward rest; the CMO's signature records review, it is not what switches the gate on. sign_activity_safety_config().
--   2. private.activity_gate_for(): the enforcing twin of packages/clinical activity-gate.ts. rest | restrict | allow from recent triage events
--      (red inside red_hours = rest), conditions and pregnancy. Pregnancy is read here inside the function; the PUBLIC door (public.activity_gate())
--      answers only the signed-in person about themselves, so a pregnancy-driven answer never reaches anyone the category-scoped path would refuse.
--   3. The same gate on programme enrolment: private.enforce_exercise_readiness() now refuses a rest decision for every programme and a programme
--      above the allowed intensity under a restrict decision. The trigger also fires when a past enrolment is re-activated by UPDATE (a hole in
--      the original insert-only trigger: a patient could flip an abandoned row back to active and skip the screen).
--   4. Activity kinds (enum activity_kind) and distance_m on the live activity_log_entries; v5-named views activity_sessions and activity_goals
--      (S05 precedent: views over live tables, no second store). A weekly active-minutes goal beside the daily step goal.
--   5. Events activity.recorded and activity.goal_met through the S10 outbox (ids and counts only, nothing clinical).
--   6. workout_plans: structure and a small starter set, ALL clinician_reviewed = false and inactive, no audio. Patients read them only through
--      public.my_workout_plans(), which applies the gate (a direct table read is admin-only so the gate cannot be bypassed).
--   7. activity_routes: private route recording. Owner-only read, insert and delete; no staff policy, no update, no share or export function;
--      go-live guard private_route_recording born OFF and a per-person switch born OFF.
--
-- Deliberately NOT here: any recorded or fabricated audio, any approved workout, any emergency-location capture, any challenge or leaderboard.

-- ---------------------------------------------------------------------------
-- 1. Governed configuration
-- ---------------------------------------------------------------------------
create function private.activity_config_valid(p_config jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  v_valid text[] := array['gentle', 'moderate', 'vigorous'];
  v_rule_names text[] := array['amber', 'pregnancy', 'pregnancy_high_risk', 'hypertension_unsettled', 'arthritis', 'back_pain'];
  v_match_names text[] := array['hypertension', 'arthritis', 'back_pain'];
  v_name text;
  v_kind record;
  v_rule jsonb;
  v_kinds jsonb := p_config #> '{safety,kinds}';
begin
  -- Every test below is written so that a missing key makes it FALSE, never NULL: a NULL would fall through an IF and let a broken config through.
  if p_config is null or jsonb_typeof(p_config) <> 'object' then return false; end if;
  if coalesce(jsonb_typeof(p_config -> 'safety'), '') <> 'object' or coalesce(jsonb_typeof(p_config -> 'goals'), '') <> 'object' then return false; end if;
  if coalesce((p_config #>> '{safety,lookback,red_hours}')::numeric, 0) <= 0
     or coalesce((p_config #>> '{safety,lookback,amber_hours}')::numeric, 0) <= 0
     or coalesce((p_config #>> '{safety,lookback,unsettled_bp_days}')::numeric, 0) <= 0 then
    return false;
  end if;
  if coalesce(jsonb_typeof(v_kinds), '') <> 'object' or (select count(*) from jsonb_object_keys(v_kinds)) < 1 then return false; end if;
  for v_kind in select key, value from jsonb_each(v_kinds) loop
    if not coalesce((v_kind.value ->> 'intensity') = any (v_valid), false) or coalesce((v_kind.value ->> 'effort_met')::numeric, 0) <= 0 then return false; end if;
  end loop;
  -- exactly the six named rules, each with a valid ceiling and a list of known kinds
  if (select count(*) from jsonb_object_keys(coalesce(p_config #> '{safety,rules}', '{}'::jsonb))) <> array_length(v_rule_names, 1) then return false; end if;
  foreach v_name in array v_rule_names loop
    v_rule := p_config #> array['safety', 'rules', v_name];
    if coalesce(jsonb_typeof(v_rule), '') <> 'object' then return false; end if;
    if not coalesce((v_rule ->> 'max_intensity') = any (v_valid), false) then return false; end if;
    if coalesce(jsonb_typeof(v_rule -> 'blocked_kinds'), '') <> 'array' then return false; end if;
    if exists (select 1 from jsonb_array_elements(v_rule -> 'blocked_kinds') b where jsonb_typeof(b) <> 'string' or not (v_kinds ? (b #>> '{}'))) then return false; end if;
  end loop;
  foreach v_name in array v_match_names loop
    if coalesce(jsonb_typeof(p_config #> array['safety', 'condition_match', v_name, 'name_patterns']), '') <> 'array'
       or coalesce(jsonb_typeof(p_config #> array['safety', 'condition_match', v_name, 'icd10_prefixes']), '') <> 'array' then
      return false;
    end if;
  end loop;
  if coalesce((p_config #>> '{goals,weekly_active_minutes_default}')::numeric, 0) <= 0
     or coalesce((p_config #>> '{goals,daily_steps_default}')::numeric, 0) <= 0 then
    return false;
  end if;
  return true;
exception when others then
  return false;
end;
$$;
revoke all on function private.activity_config_valid(jsonb) from public, anon, authenticated;

create table public.activity_safety_config (
  id          uuid primary key default gen_random_uuid(),
  version     integer not null unique check (version >= 1),
  is_active   boolean not null default false,
  config      jsonb not null check (private.activity_config_valid(config)),
  notes       text,
  approved_by uuid references public.clinical_staff (id),
  approved_at timestamptz,
  created_at  timestamptz not null default now(),
  check ((approved_by is null) = (approved_at is null))
);
create unique index activity_safety_config_one_active on public.activity_safety_config (is_active) where is_active;
alter table public.activity_safety_config enable row level security;
revoke all on public.activity_safety_config from public, anon, authenticated;
grant select on public.activity_safety_config to authenticated;
create policy activity_safety_config_read on public.activity_safety_config for select to authenticated using (true);
create trigger refuse_superseded_activation before update of is_active on public.activity_safety_config
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();

-- activity-safety-config-begin
insert into public.activity_safety_config (version, is_active, config, notes)
values (1, true, $json${
 "safety": {
  "lookback": {"red_hours": 48, "amber_hours": 48, "unsettled_bp_days": 7},
  "kinds": {
   "walking": {"effort_met": 3.5, "intensity": "gentle"},
   "chair_based": {"effort_met": 2.5, "intensity": "gentle"},
   "cycling": {"effort_met": 6, "intensity": "moderate"},
   "dancing": {"effort_met": 5, "intensity": "moderate"},
   "farm_manual_work": {"effort_met": 5, "intensity": "moderate"},
   "running": {"effort_met": 8, "intensity": "vigorous"},
   "football": {"effort_met": 8, "intensity": "vigorous"}
  },
  "condition_match": {
   "hypertension": {"name_patterns": ["hypertens", "high blood pressure"], "icd10_prefixes": ["I10", "I11", "I12", "I13", "I15"]},
   "arthritis": {"name_patterns": ["arthrit"], "icd10_prefixes": ["M05", "M06", "M15", "M16", "M17", "M18", "M19"]},
   "back_pain": {"name_patterns": ["back pain", "lumbago", "sciatica", "slipped disc"], "icd10_prefixes": ["M54"]}
  },
  "rules": {
   "amber": {"max_intensity": "gentle", "blocked_kinds": []},
   "pregnancy": {"max_intensity": "moderate", "blocked_kinds": ["football"]},
   "pregnancy_high_risk": {"max_intensity": "gentle", "blocked_kinds": ["football", "running"]},
   "hypertension_unsettled": {"max_intensity": "gentle", "blocked_kinds": []},
   "arthritis": {"max_intensity": "moderate", "blocked_kinds": ["running", "football"]},
   "back_pain": {"max_intensity": "moderate", "blocked_kinds": ["football", "farm_manual_work"]}
  }
 },
 "goals": {"weekly_active_minutes_default": 150, "daily_steps_default": 7500}
}$json$::jsonb,
        'PROPOSED, unsigned. Every number, blocked kind and condition match below is the CMO''s to confirm (sign_activity_safety_config). The gate enforces these rows as they stand because it only restricts.');
-- activity-safety-config-end

create function private.activity_cfg(p_section text) returns jsonb
language sql stable security definer set search_path = ''
as $$ select config -> p_section from public.activity_safety_config where is_active; $$;
revoke all on function private.activity_cfg(text) from public, anon, authenticated;

create function public.sign_activity_safety_config(p_id uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_staff uuid;
begin
  if not exists (select 1 from public.activity_safety_config where id = p_id) then raise exception 'Activity safety config version not found'; end if;
  select cs.id into v_staff from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer' limit 1;
  if v_staff is null then raise exception 'not authorised: only the active Chief Medical Officer can sign the activity safety config'; end if;
  update public.activity_safety_config set is_active = false where is_active and id <> p_id;
  update public.activity_safety_config set approved_by = v_staff, approved_at = now(), is_active = true where id = p_id;
  perform private.log_audit('activity_safety_config.signed', 'activity_safety_config', p_id, '{}'::jsonb);
  return p_id;
end;
$$;
revoke all on function public.sign_activity_safety_config(uuid) from public, anon;
grant execute on function public.sign_activity_safety_config(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The gate
-- ---------------------------------------------------------------------------
create function private.activity_condition_matches(p_name text, p_icd10 text, p_match jsonb) returns boolean
language sql immutable set search_path = ''
as $$
  select exists (select 1 from jsonb_array_elements_text(p_match -> 'name_patterns') p
                  where p <> '' and position(lower(p) in lower(coalesce(p_name, ''))) > 0)
      or (coalesce(p_icd10, '') <> ''
          and exists (select 1 from jsonb_array_elements_text(p_match -> 'icd10_prefixes') p
                       where left(upper(p_icd10), length(p)) = upper(p)));
$$;
revoke all on function private.activity_condition_matches(text, text, jsonb) from public, anon, authenticated;

create function private.activity_gate_for(p_patient uuid, p_include_pregnancy boolean default true, p_now timestamptz default now())
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_cfg      jsonb;
  v_signed   boolean;
  v_rank     text[] := array['gentle', 'moderate', 'vigorous'];
  v_red_h    numeric;
  v_amber_h  numeric;
  v_unsettled_d numeric;
  v_reasons  text[] := '{}';
  v_rules    jsonb[] := '{}';
  v_hyp      boolean;
  v_hyp_unc  boolean;
  v_preg     record;
  v_max      text;
  v_blocked  text[];
begin
  select c.config -> 'safety', c.approved_by is not null into v_cfg, v_signed from public.activity_safety_config c where c.is_active;
  if v_cfg is null then
    return jsonb_build_object('decision', 'restrict', 'reason', 'rules_unavailable', 'reasons', jsonb_build_array('rules_unavailable'),
                              'max_intensity', 'gentle', 'blocked_kinds', '[]'::jsonb, 'signed', false);
  end if;
  v_red_h := (v_cfg #>> '{lookback,red_hours}')::numeric;
  v_amber_h := (v_cfg #>> '{lookback,amber_hours}')::numeric;
  v_unsettled_d := (v_cfg #>> '{lookback,unsettled_bp_days}')::numeric;

  if exists (select 1 from public.triage_events te
              where te.patient_id = p_patient and te.grade = 'red'
                and te.created_at <= p_now and te.created_at >= p_now - v_red_h * interval '1 hour') then
    return jsonb_build_object('decision', 'rest', 'reason', 'recent_red_event', 'reasons', jsonb_build_array('recent_red_event'),
                              'max_intensity', 'none', 'blocked_kinds', '[]'::jsonb, 'signed', coalesce(v_signed, false));
  end if;

  if exists (select 1 from public.triage_events te
              where te.patient_id = p_patient and te.grade = 'amber'
                and te.created_at <= p_now and te.created_at >= p_now - v_amber_h * interval '1 hour') then
    v_reasons := array_append(v_reasons, 'recent_amber_event');
    v_rules := array_append(v_rules, v_cfg #> '{rules,amber}');
  end if;

  if p_include_pregnancy then
    select pp.is_pregnant, pp.high_risk into v_preg from public.patient_pregnancy pp
     where pp.patient_id = p_patient order by pp.updated_at desc limit 1;
    if found and v_preg.is_pregnant then
      if v_preg.high_risk then
        v_reasons := array_append(v_reasons, 'pregnancy_high_risk');
        v_rules := array_append(v_rules, v_cfg #> '{rules,pregnancy_high_risk}');
      else
        v_reasons := array_append(v_reasons, 'pregnancy');
        v_rules := array_append(v_rules, v_cfg #> '{rules,pregnancy}');
      end if;
    end if;
  end if;

  select count(*) > 0, coalesce(bool_or(pc.status::text = 'uncontrolled'), false) into v_hyp, v_hyp_unc
    from public.patient_conditions pc
   where pc.patient_id = p_patient and pc.status::text not in ('resolved', 'historical')
     and private.activity_condition_matches(pc.condition_name, pc.icd10_code, v_cfg #> '{condition_match,hypertension}');
  if v_hyp and (v_hyp_unc or exists (
        select 1 from public.triage_events te
         where te.patient_id = p_patient and te.trigger_type = 'observation' and te.grade in ('amber', 'red')
           and te.created_at <= p_now and te.created_at >= p_now - v_unsettled_d * interval '1 day')) then
    v_reasons := array_append(v_reasons, 'hypertension_unsettled');
    v_rules := array_append(v_rules, v_cfg #> '{rules,hypertension_unsettled}');
  end if;

  if exists (select 1 from public.patient_conditions pc where pc.patient_id = p_patient and pc.status::text not in ('resolved', 'historical')
              and private.activity_condition_matches(pc.condition_name, pc.icd10_code, v_cfg #> '{condition_match,arthritis}')) then
    v_reasons := array_append(v_reasons, 'arthritis');
    v_rules := array_append(v_rules, v_cfg #> '{rules,arthritis}');
  end if;
  if exists (select 1 from public.patient_conditions pc where pc.patient_id = p_patient and pc.status::text not in ('resolved', 'historical')
              and private.activity_condition_matches(pc.condition_name, pc.icd10_code, v_cfg #> '{condition_match,back_pain}')) then
    v_reasons := array_append(v_reasons, 'back_pain');
    v_rules := array_append(v_rules, v_cfg #> '{rules,back_pain}');
  end if;

  if cardinality(v_reasons) = 0 then
    return jsonb_build_object('decision', 'allow', 'reason', 'none', 'reasons', jsonb_build_array('none'),
                              'max_intensity', 'vigorous', 'blocked_kinds', '[]'::jsonb, 'signed', coalesce(v_signed, false));
  end if;

  select v_rank[min(array_position(v_rank, r ->> 'max_intensity'))] into v_max from unnest(v_rules) r;
  select coalesce(array_agg(distinct b order by b), '{}') into v_blocked
    from unnest(v_rules) r, jsonb_array_elements_text(r -> 'blocked_kinds') b;

  return jsonb_build_object('decision', 'restrict', 'reason', v_reasons[1], 'reasons', to_jsonb(v_reasons),
                            'max_intensity', v_max, 'blocked_kinds', to_jsonb(v_blocked), 'signed', coalesce(v_signed, false));
end;
$$;
revoke all on function private.activity_gate_for(uuid, boolean, timestamptz) from public, anon, authenticated;

-- The public door: the signed-in person about themselves, nobody else (a caregiver or staff reading a pregnancy-driven answer would bypass the
-- category-scoped path that guards patient_pregnancy).
create function public.activity_gate() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  declare v jsonb;
  begin
    if (select auth.uid()) is null then raise exception 'not signed in'; end if;
    v := private.activity_gate_for((select auth.uid()), true, now());
    -- The client is told WHY only in coarse terms: a condition or pregnancy is never named in the payload (the screen shows care-team words anyway).
    return v || jsonb_build_object(
      'reasons', (select coalesce(jsonb_agg(distinct case when r in ('pregnancy', 'pregnancy_high_risk', 'hypertension_unsettled', 'arthritis', 'back_pain') then 'health_condition' else r end), '[]'::jsonb)
                    from jsonb_array_elements_text(v -> 'reasons') r),
      'reason', case when v ->> 'reason' in ('pregnancy', 'pregnancy_high_risk', 'hypertension_unsettled', 'arthritis', 'back_pain') then 'health_condition' else v ->> 'reason' end);
  end;
end;
$$;
revoke all on function public.activity_gate() from public, anon;
grant execute on function public.activity_gate() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Enrolment enforcement (web, mobile and any staff path all reach this trigger)
-- ---------------------------------------------------------------------------
create or replace function private.enforce_exercise_readiness()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intensity public.exercise_intensity_level;
  v_clear_moderate boolean;
  v_clear_vigorous boolean;
  v_gate jsonb;
  v_rank text[] := array['gentle', 'moderate', 'vigorous'];
  v_uid uuid := (select auth.uid());
begin
  -- Only becoming active (or moving an active enrolment to another programme) is gated. (WHEN cannot reference OLD in an INSERT trigger.)
  if new.status <> 'active' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'active' and old.programme_id is not distinct from new.programme_id then
    return new;
  end if;

  select intensity_level into v_intensity
  from public.exercise_programmes
  where id = new.programme_id;

  if v_intensity is null then
    return new;
  end if;

  -- S48a: the activity safety gate comes first. Pregnancy is part of the answer only for the patient, for staff the category-scoped path entitles to
  -- reproductive_health, or for a system actor with no signed-in user; otherwise an untied staff member could learn it from which refusal they get.
  -- The wording never names a reading, a condition or a pregnancy.
  v_gate := private.activity_gate_for(
    new.patient_id,
    v_uid is null or v_uid = new.patient_id or coalesce(private.staff_may_read(new.patient_id, new.organisation_id, 'reproductive_health'::public.care_access_category), false),
    now());
  if v_gate ->> 'decision' = 'rest' then
    raise exception 'Structured exercise is paused for now. Gentle everyday movement is fine, and you can ask your care team in the app.';
  end if;
  -- A NULL ceiling (which a valid config cannot produce) counts as position 0, so it refuses rather than allows.
  if v_gate ->> 'decision' = 'restrict'
     and array_position(v_rank, case v_intensity when 'beginner' then 'gentle' else v_intensity::text end)
         > coalesce(array_position(v_rank, v_gate ->> 'max_intensity'), 0) then
    raise exception 'Only gentler activity is suggested for now. Please choose a gentle programme, or ask your care team in the app.';
  end if;

  if v_intensity = 'beginner' then
    return new;
  end if;

  select
    exists (
      select 1 from public.exercise_readiness_screens
      where patient_id = new.patient_id and (not any_flag or cleared_for_intensive)
    ),
    exists (
      select 1 from public.exercise_readiness_screens
      where patient_id = new.patient_id and cleared_for_intensive
    )
  into v_clear_moderate, v_clear_vigorous;

  if v_intensity = 'moderate' and not v_clear_moderate then
    raise exception
      'Complete an exercise readiness screen before starting a moderate-intensity programme (or, if it flags a concern, wait for your care team to clear it).';
  end if;

  if v_intensity = 'vigorous' and not v_clear_vigorous then
    raise exception
      'A vigorous-intensity programme needs your care team''s clearance first. Complete the exercise readiness screen and a clinician will review it.';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_exercise_readiness_trg on public.patient_exercise_enrollments;
create trigger enforce_exercise_readiness_trg
  before insert or update of status, programme_id on public.patient_exercise_enrollments
  for each row execute function private.enforce_exercise_readiness();

-- ---------------------------------------------------------------------------
-- 4. Activity kinds, distance, weekly goal; v5-named views
-- ---------------------------------------------------------------------------
create type public.activity_kind as enum ('walking', 'running', 'cycling', 'dancing', 'football', 'farm_manual_work', 'chair_based');

alter table public.activity_log_entries
  add column activity_kind public.activity_kind,
  add column distance_m integer check (distance_m is null or distance_m >= 0);
alter table public.activity_log_entries add constraint activity_log_entries_kind_shape_chk
  check (activity_kind is null or entry_type = 'workout');
alter table public.activity_log_entries add constraint activity_log_entries_distance_shape_chk
  check (distance_m is null or entry_type = 'workout');

create function private.activity_name_from_kind() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.entry_type = 'workout' and new.activity_name is null and new.activity_kind is not null then
    new.activity_name := case new.activity_kind
      when 'farm_manual_work' then 'Farm and manual work'
      when 'chair_based' then 'Chair-based exercise'
      else initcap(new.activity_kind::text)
    end;
  end if;
  return new;
end;
$$;
create trigger activity_name_from_kind before insert or update on public.activity_log_entries
  for each row execute function private.activity_name_from_kind();

alter table public.patient_activity_goals
  add column weekly_active_minutes_goal integer not null default 150 check (weekly_active_minutes_goal between 1 and 10080),
  add column route_recording_enabled boolean not null default false;
comment on column public.patient_activity_goals.route_recording_enabled is
  'Per-person switch for private route recording (5.7). Born off. Also needs the go-live guard private_route_recording.';

-- Only the person themself may change their route-recording switch; the goals update policy also lets organisation staff edit a goal row.
create function private.guard_route_recording_switch() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' and new.route_recording_enabled) or (tg_op = 'UPDATE' and new.route_recording_enabled is distinct from old.route_recording_enabled) then
    if (select auth.uid()) is not null and (select auth.uid()) is distinct from new.patient_id then
      raise exception 'Only the person themself can turn private route recording on or off';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_route_recording_switch() from public, anon, authenticated;
create trigger guard_route_recording_switch before insert or update on public.patient_activity_goals
  for each row execute function private.guard_route_recording_switch();

create view public.activity_sessions with (security_invoker = true) as
select
  a.id,
  a.organisation_id,
  a.patient_id,
  coalesce(a.activity_kind::text, case when a.entry_type = 'steps' then 'steps' else 'other' end) as kind,
  a.logged_at as started_at,
  coalesce(a.duration_minutes, 0) * 60 as duration_s,
  a.step_count as steps,
  a.distance_m,
  a.source::text as source,
  a.logged_on
from public.activity_log_entries a;
comment on view public.activity_sessions is 'v5 activity_sessions over activity_log_entries (S05 precedent). route_geojson is deliberately NOT here: routes live in activity_routes, owner-only.';

create view public.activity_goals with (security_invoker = true) as
select g.patient_id, g.organisation_id, 'daily_steps'::text as metric, g.daily_step_goal::numeric as target, g.patient_id as set_by
  from public.patient_activity_goals g
union all
select g.patient_id, g.organisation_id, 'weekly_active_minutes'::text, g.weekly_active_minutes_goal::numeric, g.patient_id
  from public.patient_activity_goals g;
comment on view public.activity_goals is 'v5 activity_goals over patient_activity_goals. Goals are self-set, so set_by is the patient.';

revoke all on public.activity_sessions, public.activity_goals from anon;
grant select on public.activity_sessions, public.activity_goals to authenticated;

-- One week summary for web and mobile (Lagos Monday-start week; logged_on is already a Lagos date).
create function public.activity_week_progress(p_week_start date default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_start date;
  v_goal record;
  v_steps bigint;
  v_minutes bigint;
  v_days integer;
  v_cfg jsonb := private.activity_cfg('goals');
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  v_start := date_trunc('week', coalesce(p_week_start, (now() at time zone 'Africa/Lagos')::date))::date;
  select daily_step_goal, weekly_active_minutes_goal into v_goal from public.patient_activity_goals where patient_id = v_uid;
  select coalesce(sum(step_count) filter (where entry_type = 'steps'), 0),
         coalesce(sum(duration_minutes) filter (where entry_type = 'workout'), 0)
    into v_steps, v_minutes
    from public.activity_log_entries where patient_id = v_uid and logged_on >= v_start and logged_on < v_start + 7;
  select count(*) into v_days from public.activity_log_entries
   where patient_id = v_uid and entry_type = 'steps' and logged_on >= v_start and logged_on < v_start + 7
     and step_count >= coalesce(v_goal.daily_step_goal, (v_cfg ->> 'daily_steps_default')::integer);
  return jsonb_build_object(
    'week_start', v_start,
    'steps', v_steps,
    'active_minutes', v_minutes,
    'days_step_goal_met', v_days,
    'daily_steps_goal', coalesce(v_goal.daily_step_goal, (v_cfg ->> 'daily_steps_default')::integer),
    'weekly_active_minutes_goal', coalesce(v_goal.weekly_active_minutes_goal, (v_cfg ->> 'weekly_active_minutes_default')::integer)
  );
end;
$$;
revoke all on function public.activity_week_progress(date) from public, anon;
grant execute on function public.activity_week_progress(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Events through the S10 outbox (ids and counts only)
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('activity.recorded', 'A patient recorded an activity (steps or a workout)', 'S48a', false),
  ('activity.goal_met', 'A patient met a daily step goal or a weekly active-minutes goal', 'S48a', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys) values
  ('activity.recorded', 1, array['activity_id']),
  ('activity.goal_met', 1, array['goal_metric', 'period'])
on conflict (event_type, version) do nothing;

create function private.emit_activity_events() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_goals jsonb := private.activity_cfg('goals');
  v_daily integer;
  v_weekly integer;
  v_week date;
  v_total bigint;
begin
  -- Like the S12 observation trigger: a person's activity is never refused because the event bus is unhappy. The failure is a WARNING in the log, not silence.
  begin
  if tg_op = 'INSERT' or new.step_count is distinct from old.step_count or new.duration_minutes is distinct from old.duration_minutes
     or new.activity_kind is distinct from old.activity_kind then
    perform private.emit_domain_event(
      'activity.recorded', new.organisation_id,
      jsonb_build_object('activity_id', new.id, 'entry_type', new.entry_type, 'kind', new.activity_kind),
      'recorded:' || new.id || ':' || coalesce(new.step_count::text, new.duration_minutes::text, '0'),
      new.patient_id, 'activity_log_entry', new.id);
  end if;

  select g.daily_step_goal, g.weekly_active_minutes_goal into v_daily, v_weekly from public.patient_activity_goals g where g.patient_id = new.patient_id;
  v_daily := coalesce(v_daily, (v_goals ->> 'daily_steps_default')::integer);
  v_weekly := coalesce(v_weekly, (v_goals ->> 'weekly_active_minutes_default')::integer);

  if new.entry_type = 'steps' and new.step_count >= v_daily then
    perform private.emit_domain_event(
      'activity.goal_met', new.organisation_id,
      jsonb_build_object('goal_metric', 'daily_steps', 'period', new.logged_on),
      'daily:' || new.patient_id || ':' || new.logged_on, new.patient_id, 'activity_log_entry', new.id);
  end if;

  if new.entry_type = 'workout' then
    v_week := date_trunc('week', new.logged_on)::date;
    select coalesce(sum(duration_minutes), 0) into v_total from public.activity_log_entries
     where patient_id = new.patient_id and entry_type = 'workout' and logged_on >= v_week and logged_on < v_week + 7;
    if v_total >= v_weekly then
      perform private.emit_domain_event(
        'activity.goal_met', new.organisation_id,
        jsonb_build_object('goal_metric', 'weekly_active_minutes', 'period', v_week),
        'weekly:' || new.patient_id || ':' || v_week, new.patient_id, 'activity_log_entry', new.id);
    end if;
  end if;
  exception when others then
    raise warning 'emit_activity_events: event not emitted for activity entry % (%)', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function private.emit_activity_events() from public, anon, authenticated;
create trigger emit_activity_events after insert or update of step_count, duration_minutes, activity_kind, logged_on on public.activity_log_entries
  for each row execute function private.emit_activity_events();

-- ---------------------------------------------------------------------------
-- 6. Workout plans (structure and a small unreviewed starter set; no audio)
-- ---------------------------------------------------------------------------
create table public.workout_plans (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null unique check (code ~ '^[a-z0-9_]+$'),
  title              text not null,
  level              text not null check (level in ('gentle', 'moderate', 'vigorous')),
  format             text not null check (format in ('home', 'chair_class')),
  conditions_safe_for text[] not null default '{}',
  sessions           jsonb not null default '[]' check (jsonb_typeof(sessions) = 'array'),
  -- DRAFT and empty until a clinician-reviewed recording exists (content workstream); nothing is fabricated here.
  audio_clip_ids     text[] not null default '{}',
  clinician_reviewed boolean not null default false,
  reviewed_by        uuid references public.clinical_staff (id) on delete restrict,
  reviewed_at        timestamptz,
  is_active          boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (not clinician_reviewed or (reviewed_by is not null and reviewed_at is not null)),
  check (not is_active or clinician_reviewed),
  check (conditions_safe_for <@ array['pregnancy', 'hypertension', 'arthritis', 'back_pain', 'diabetes'])
);
create trigger set_updated_at before update on public.workout_plans for each row execute function private.set_updated_at();
alter table public.workout_plans enable row level security;
revoke all on public.workout_plans from public, anon, authenticated;
grant select, insert, update, delete on public.workout_plans to authenticated;
create policy workout_plans_admin_all on public.workout_plans for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

insert into public.workout_plans (code, title, level, format, conditions_safe_for, sessions) values
  ('starter_gentle_home_10', 'Gentle 10 minute home routine', 'gentle', 'home', '{hypertension,arthritis,back_pain,diabetes}',
   '[{"minutes":10,"steps":["March on the spot, 2 minutes, easy pace","Shoulder rolls and arm circles, 2 minutes","Slow side steps, 3 minutes","Gentle calf raises holding a chair, 2 minutes","Slow breathing, 1 minute"]}]'::jsonb),
  ('starter_chair_class_15', 'Chair-based class, 15 minutes', 'gentle', 'chair_class', '{hypertension,arthritis,back_pain,diabetes,pregnancy}',
   '[{"minutes":15,"steps":["Seated marching, 3 minutes","Seated arm raises, 3 minutes","Seated knee extensions, 3 minutes","Seated trunk turns, 3 minutes","Ankle circles and slow breathing, 3 minutes"]}]'::jsonb),
  ('starter_moderate_home_20', 'Steady 20 minute home routine', 'moderate', 'home', '{diabetes}',
   '[{"minutes":20,"steps":["Brisk march on the spot, 5 minutes","Bodyweight squats to a chair, 5 minutes","Step-ups on a low step, 5 minutes","Cool down and stretch, 5 minutes"]}]'::jsonb);

create function public.my_workout_plans() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_gate jsonb;
  v_flags text[];
  v_rank text[] := array['gentle', 'moderate', 'vigorous'];
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  v_gate := private.activity_gate_for(v_uid, true, now());
  if v_gate ->> 'decision' = 'rest' then return '[]'::jsonb; end if;
  select coalesce(array_agg(distinct case r when 'pregnancy_high_risk' then 'pregnancy' when 'hypertension_unsettled' then 'hypertension' else r end), '{}')
    into v_flags
    from jsonb_array_elements_text(v_gate -> 'reasons') r
   where r in ('pregnancy', 'pregnancy_high_risk', 'hypertension_unsettled', 'arthritis', 'back_pain');
  return coalesce((
    select jsonb_agg(jsonb_build_object('code', p.code, 'title', p.title, 'level', p.level, 'format', p.format,
                                         'conditions_safe_for', p.conditions_safe_for, 'sessions', p.sessions, 'audio_clip_ids', p.audio_clip_ids)
                     order by p.code)
      from public.workout_plans p
     where p.is_active and p.clinician_reviewed
       and array_position(v_rank, p.level) <= array_position(v_rank, v_gate ->> 'max_intensity')
       and v_flags <@ p.conditions_safe_for
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.my_workout_plans() from public, anon;
grant execute on function public.my_workout_plans() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Private route recording (5.7). Owner only; no staff policy; no share or export function exists.
-- ---------------------------------------------------------------------------
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('private_route_recording', 'Private GPS route recording', 'Storing a route a patient recorded on their own phone',
   'Privacy review done (DPO and counsel); a retention period is agreed; the patient-facing consent text is approved',
   'admin', array['activity_routes insert policy (database)'],
   'Emergency location (decision S48-1) is a separate feature and is not behind this guard.')
on conflict (key) do nothing;

-- A policy helper runs as the reader and needs EXECUTE (S77 lesson); this one only answers about the caller.
create function private.route_recording_open() returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.go_live_guard_on('private_route_recording')
     and exists (select 1 from public.patient_activity_goals g where g.patient_id = (select auth.uid()) and g.route_recording_enabled);
$$;
revoke all on function private.route_recording_open() from public, anon;
grant execute on function private.route_recording_open() to authenticated;

create table public.activity_routes (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  patient_id              uuid not null references public.profiles (id) on delete cascade,
  activity_log_entry_id   uuid references public.activity_log_entries (id) on delete cascade,
  route_geojson           jsonb not null check (jsonb_typeof(route_geojson) = 'object' and pg_column_size(route_geojson) <= 1048576),
  source                  public.record_source not null default 'patient',
  recorded_by             uuid references public.profiles (id) on delete set null,
  created_at              timestamptz not null default now()
);
create index activity_routes_patient_idx on public.activity_routes (patient_id, created_at desc);
alter table public.activity_routes enable row level security;
revoke all on public.activity_routes from public, anon, authenticated;
grant select, insert, delete on public.activity_routes to authenticated;
create policy activity_routes_owner_select on public.activity_routes for select to authenticated
  using (patient_id = (select auth.uid()));
create policy activity_routes_owner_insert on public.activity_routes for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    and organisation_id = private.current_org_id()
    and private.route_recording_open()
    and source = 'patient'
    and (recorded_by is null or recorded_by = (select auth.uid()))
    and (activity_log_entry_id is null
         or exists (select 1 from public.activity_log_entries e where e.id = activity_log_entry_id and e.patient_id = (select auth.uid())))
  );
create policy activity_routes_owner_delete on public.activity_routes for delete to authenticated
  using (patient_id = (select auth.uid()));
comment on table public.activity_routes is
  'S48a / 5.7: private GPS routes. Owner-only. There is deliberately no staff policy, no update policy, and no share, export or FHIR path; a test scans the codebase for one.';

-- ---------------------------------------------------------------------------
-- 8. Registry (S39d). Routes are NOT in the patient export: acceptance test "routes are never shared".
-- ---------------------------------------------------------------------------
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
select t.table_name, 'patient_id', private.retention_class_for(t.table_name),
       case when private.retention_class_for(t.table_name) = 'operational' then 'delete' else 'review' end,
       t.in_export,
       'S48a 2026-10-20: PROPOSED classification, awaiting CMO and DPO review.' || t.note
  from (values ('activity_routes', false, ' Routes are excluded from the export on purpose (owner-only, never shared); the DPO decides whether an owner-only download is wanted.')) as t(table_name, in_export, note)
on conflict (table_name) do nothing;

-- ---------------------------------------------------------------------------
-- 9. Self-checks
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from public.activity_safety_config where is_active) <> 1 then raise exception 'S48a: exactly one active activity_safety_config expected'; end if;
  if has_function_privilege('anon', 'public.activity_gate()', 'EXECUTE') then raise exception 'S48a: anon can call activity_gate'; end if;
  if has_function_privilege('anon', 'public.my_workout_plans()', 'EXECUTE') then raise exception 'S48a: anon can list plans'; end if;
  if has_function_privilege('anon', 'public.activity_week_progress(date)', 'EXECUTE') then raise exception 'S48a: anon can read progress'; end if;
  if has_function_privilege('anon', 'public.sign_activity_safety_config(uuid)', 'EXECUTE') then raise exception 'S48a: anon can sign'; end if;
  if has_function_privilege('authenticated', 'private.activity_gate_for(uuid,boolean,timestamptz)', 'EXECUTE') then raise exception 'S48a: the unscoped gate is callable by a client'; end if;
  if has_table_privilege('anon', 'public.activity_routes', 'SELECT') then raise exception 'S48a: anon can read routes'; end if;
  if has_table_privilege('authenticated', 'public.activity_routes', 'UPDATE') then raise exception 'S48a: routes are updatable'; end if;
  if (select is_on from public.go_live_guards where key = 'private_route_recording') is distinct from false then raise exception 'S48a: private_route_recording must be born off'; end if;
  if exists (select 1 from public.workout_plans where is_active or clinician_reviewed) then raise exception 'S48a: starter plans must ship unreviewed and inactive'; end if;
  if exists (select 1 from pg_policies where tablename = 'activity_routes' and policyname <> all (array['activity_routes_owner_select', 'activity_routes_owner_insert', 'activity_routes_owner_delete'])) then
    raise exception 'S48a: activity_routes has a policy beyond the three owner policies';
  end if;
end $$;
