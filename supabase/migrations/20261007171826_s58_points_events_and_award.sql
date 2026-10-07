-- S58 migration 2 of 3: points are awarded from S10 outbox events, idempotently per event, by rule.
--
-- WHAT CHANGES
--  * Every legacy earning trigger (vitals, meals, medicine check-in, lifestyle task/goal, class, challenge) stops calling
--    private.award_wellness_points with a number typed into its body. It now emits a domain event (ids only) and nothing else.
--    The lesson and course events already exist (S55); lab_result.released, encounter.completed are the existing S27/S21 events.
--  * One subscriber per event type runs handler 'points.award', which calls public.points_award(event_id).
--  * public.points_award reads the rules (reward_rules), applies gates and caps, writes the ledger and emits points.awarded.
--    Idempotent per (event, rule) through points_award_decisions: replaying an event, or processing it twice, never awards twice,
--    even if the cap window has moved on since the first decision.
--  * Gates, in order: a decision already exists; the source is eligible (a body-only reading or an implausible reading earns
--    nothing); per_day / per_week / lifetime caps; a decay weight by how many times the person has earned this rule before; the
--    daily points cap across all rules. A red reading is never touched: awarding happens later, off the outbox, and the emitter
--    sorts last among the vitals triggers and can never raise into the patient's write.
--  * Yearly tiers that keep earned status (computed, never stored), badges tolerate a quiet day (grace), no leaderboard.
--
-- ROW COUNTS. No data is converted. The old daily-cap marker rows ('daily_cap' source) stay in the ledger as history.
-- Behaviour change on purpose: a weight-only reading used to pay 10 points and no longer pays anything (spec 11.3).

-- ---------------------------------------------------------------------------
-- 1. Event types (ids only)
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('vitals.logged', 'A person logged a reading (not a body-size one)', 'S58', false),
  ('meal.logged', 'A person logged a meal', 'S58', false),
  ('adherence.checkin_answered', 'A person answered a medicine check-in', 'S58', false),
  ('lifestyle.task_completed', 'A lifestyle task was marked done', 'S58', false),
  ('lifestyle.goal_achieved', 'A lifestyle goal was reached', 'S58', false),
  ('challenge.completed', 'A wellness challenge was completed', 'S58', false),
  ('class.attended', 'A wellness class was attended', 'S58', false),
  ('screening.completed', 'A screening result was recorded', 'S58', false),
  ('points.awarded', 'Health Points were credited for an action', 'S58', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys) values
  ('vitals.logged', 1, array['vitals_id']),
  ('meal.logged', 1, array['entry_id']),
  ('adherence.checkin_answered', 1, array['checkin_id']),
  ('lifestyle.task_completed', 1, array['task_id']),
  ('lifestyle.goal_achieved', 1, array['goal_id']),
  ('challenge.completed', 1, array['enrolment_id']),
  ('class.attended', 1, array['registration_id']),
  ('screening.completed', 1, array['screening_result_id']),
  ('points.awarded', 1, array['ledger_id', 'rule_code'])
on conflict (event_type, version) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Decisions (one per event and rule): the idempotency record and the "why no points" trail
-- ---------------------------------------------------------------------------
create table public.points_award_decisions (
  event_id     uuid not null references public.domain_events (id) on delete restrict,
  rule_code    text not null,
  rule_version integer not null,
  patient_id   uuid not null references public.profiles (id) on delete cascade,
  outcome      text not null check (outcome in ('awarded', 'capped', 'ineligible')),
  detail       text,
  points       integer not null default 0 check (points >= 0),
  ledger_id    uuid references public.wellness_points_ledger (id) on delete set null,
  decided_at   timestamptz not null default now(),
  primary key (event_id, rule_code)
);
create index points_award_decisions_patient_idx on public.points_award_decisions (patient_id, decided_at desc);
alter table public.points_award_decisions enable row level security;
revoke all on public.points_award_decisions from public, anon, authenticated;
comment on table public.points_award_decisions is
  'S58: one row per (event, rule) the awarder looked at. Makes replay a no-op and makes a skipped award explainable. No patient or staff grant: read through admin_rewards_summary().';

-- ---------------------------------------------------------------------------
-- 3. Emitters. Loud on failure (audit row and one open incident), never raising into the patient's write.
-- ---------------------------------------------------------------------------
create or replace function private.rewards_emit(
  p_type text, p_patient uuid, p_payload jsonb, p_key text, p_agg_type text, p_agg_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  begin
    select organisation_id into v_org from public.profiles where id = p_patient;
    if v_org is null then return; end if;
    perform private.emit_domain_event(p_type, v_org, p_payload, p_type || ':' || p_key, p_patient, p_agg_type, p_agg_id);
  exception when others then
    begin
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (v_org, 'rewards_event.error', p_agg_type, p_agg_id, jsonb_build_object('event_type', p_type, 'error', sqlerrm));
      if v_org is not null then
        perform private.page_incident(v_org, 'rewards_event_failed', 'A rewards event could not be written',
          'A Health Points event failed to write; see audit_log action rewards_event.error (one open incident covers all of them). The person''s own record was saved.');
      end if;
    exception when others then
      raise warning 'rewards_emit failed for % and could not be audited: %', p_type, sqlerrm;
    end;
  end;
end;
$$;
revoke all on function private.rewards_emit(text, uuid, jsonb, text, text, uuid) from public, anon, authenticated;

-- vitals: body-size readings (weight, waist) and passive streams (CGM, wearable, imports) emit nothing. Trigger name sorts last on purpose (a test pins it).
create or replace function private.wellness_points_on_vitals_logged()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only readings a person (or their own paired device) logs earn: a CGM or wearable stream would otherwise write hundreds of
  -- events a day per person, and passive collection is not "consistent logging". Body-size readings never earn.
  if new.vital_type::text not in ('weight', 'waist_circumference') and new.source::text in ('manual', 'device') then
    perform private.rewards_emit('vitals.logged', new.patient_id, jsonb_build_object('vitals_id', new.id), new.id::text, 'vitals_readings', new.id);
  end if;
  return new;
end;
$$;

create or replace function private.wellness_points_on_meal_logged()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.rewards_emit('meal.logged', new.patient_id, jsonb_build_object('entry_id', new.id), new.id::text, 'nutrition_log_entries', new.id);
  return new;
end;
$$;

create or replace function private.wellness_points_on_adherence_checkin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'responded' and old.status is distinct from 'responded' then
    perform private.rewards_emit('adherence.checkin_answered', new.patient_id, jsonb_build_object('checkin_id', new.id), new.id::text, 'medication_adherence_checkins', new.id);
  end if;
  return new;
end;
$$;

create or replace function private.wellness_points_on_lpe_task_done()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' then
    perform private.rewards_emit('lifestyle.task_completed', new.patient_id, jsonb_build_object('task_id', new.id), new.id::text, 'lpe_task_instances', new.id);
  end if;
  return new;
end;
$$;

create or replace function private.wellness_points_on_lpe_goal_achieved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient uuid;
begin
  if new.status = 'achieved' and old.status is distinct from 'achieved' then
    select e.patient_id into v_patient
      from public.lpe_programme_instances pi
      join public.lpe_enrollments e on e.id = pi.enrollment_id
     where pi.id = new.programme_instance_id;
    if v_patient is not null then
      perform private.rewards_emit('lifestyle.goal_achieved', v_patient, jsonb_build_object('goal_id', new.id), new.id::text, 'lpe_goal_instances', new.id);
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.wellness_points_on_class_attended()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'attended' and old.status is distinct from 'attended' then
    perform private.rewards_emit('class.attended', new.patient_id, jsonb_build_object('registration_id', new.id), new.id::text, 'wellness_class_registrations', new.id);
  end if;
  return new;
end;
$$;

-- screening result recorded: a verified action (a result row exists), rewarded whatever it found.
create or replace function private.wellness_points_on_screening_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.rewards_emit('screening.completed', new.patient_id, jsonb_build_object('screening_result_id', new.id), new.id::text, 'screening_results', new.id);
  return new;
end;
$$;
drop trigger if exists screening_results_wellness_points on public.screening_results;
create trigger screening_results_wellness_points
  after insert on public.screening_results
  for each row execute function private.wellness_points_on_screening_result();

-- The lesson and lifestyle-goal paths of the old triggers are now the S55 events, so the lesson trigger goes.
drop trigger if exists health_education_progress_wellness_points on public.health_education_progress;
drop function if exists private.wellness_points_on_lesson_understood();
drop function if exists private.wellness_daily_dedupe_id(uuid, text);

-- challenge completion: same evaluator, but it emits an event instead of paying.
create or replace function private.evaluate_wellness_challenges()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer;
begin
  for v_row in
    select e.*, c.metric, c.target_count, c.badge_id
    from public.patient_challenge_enrolments e
    join public.wellness_challenges c on c.id = e.challenge_id
    where e.status = 'active'
  loop
    v_count := private.wellness_challenge_metric_count(
      v_row.patient_id, v_row.metric, v_row.started_at, least(now(), v_row.target_end_at));

    if v_count >= v_row.target_count then
      update public.patient_challenge_enrolments
        set status = 'completed', completed_at = now()
        where id = v_row.id;

      perform private.rewards_emit('challenge.completed', v_row.patient_id, jsonb_build_object('enrolment_id', v_row.id), v_row.id::text, 'patient_challenge_enrolments', v_row.id);

      if v_row.badge_id is not null then
        insert into public.patient_wellness_badges (organisation_id, patient_id, badge_id)
        values (v_row.organisation_id, v_row.patient_id, v_row.badge_id)
        on conflict (patient_id, badge_id) do nothing;
      end if;
    elsif now() > v_row.target_end_at then
      update public.patient_challenge_enrolments
        set status = 'expired'
        where id = v_row.id;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Eligibility of one event for one rule (plausible, not body-size)
-- ---------------------------------------------------------------------------
create or replace function private.points_event_eligible(p_event public.domain_events, p_rule public.reward_rules)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_ranges jsonb := private.reward_config('plausible_ranges');
  v_key text;
  v_bounds jsonb;
  v_val numeric;
  v_measured integer := 0;
  v_type text;
begin
  if p_event.event_type = 'vitals.logged' then
    select to_jsonb(v), v.vital_type::text into v_row, v_type
      from public.vitals_readings v
     where v.id = (p_event.payload ->> 'vitals_id')::uuid and v.patient_id = p_event.patient_id;
    if v_row is null then return 'source_missing'; end if;
    if v_type in ('weight', 'waist_circumference') then return 'body_metric'; end if;
    if v_ranges is null then return 'no_plausibility_config'; end if;
    for v_key, v_bounds in select key, value from jsonb_each(v_ranges) loop
      if v_row ->> v_key is not null then
        v_val := (v_row ->> v_key)::numeric;
        v_measured := v_measured + 1;
        if v_val < (v_bounds ->> 0)::numeric or v_val > (v_bounds ->> 1)::numeric then
          return 'implausible';
        end if;
      end if;
    end loop;
    if v_measured = 0 then return 'no_measurement'; end if;
  end if;
  return 'ok';
end;
$$;
revoke all on function private.points_event_eligible(public.domain_events, public.reward_rules) from public, anon, authenticated;

create or replace function private.points_catalogue_value(p_event public.domain_events, p_rule public.reward_rules)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select least(1000, greatest(0, coalesce(
    case p_event.event_type
      when 'challenge.completed' then
        (select c.points_reward from public.patient_challenge_enrolments e
           join public.wellness_challenges c on c.id = e.challenge_id
          where e.id = (p_event.payload ->> 'enrolment_id')::uuid and e.patient_id = p_event.patient_id)
      when 'class.attended' then
        (select c.points_reward from public.wellness_class_registrations r
           join public.wellness_classes c on c.id = r.class_id
          where r.id = (p_event.payload ->> 'registration_id')::uuid and r.patient_id = p_event.patient_id)
    end, 0)));
$$;
revoke all on function private.points_catalogue_value(public.domain_events, public.reward_rules) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The awarder
-- ---------------------------------------------------------------------------
create or replace function private.points_award_event(p_event uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.domain_events%rowtype;
  r public.reward_rules%rowtype;
  v_bal public.wellness_points_balances%rowtype;
  v_cap integer := coalesce((private.reward_config('daily_points_cap') ->> 'points')::integer, 0);
  v_day timestamptz := date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
  v_week timestamptz := date_trunc('week', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
  v_remaining integer;
  v_pts integer;
  v_pct integer;
  v_n_life integer;
  v_n integer;
  v_why text;
  v_step jsonb;
  v_ledger uuid;
  v_total integer := 0;
begin
  select * into e from public.domain_events where id = p_event;
  if not found then raise exception 'points_award: unknown event %', p_event using errcode = '22023'; end if;
  if e.patient_id is null then return 0; end if;

  perform private.ensure_wellness_points_balance(e.patient_id);
  -- The balance row lock serialises every award for this person, so caps cannot be raced.
  select * into v_bal from public.wellness_points_balances where patient_id = e.patient_id for update;
  if not found then return 0; end if;

  select greatest(0, v_cap - coalesce(sum(points), 0)) into v_remaining
    from public.wellness_points_ledger where patient_id = e.patient_id and points > 0 and kind = 'earn' and created_at >= v_day;

  for r in
    select distinct on (code) * from public.reward_rules
     where is_active and trigger_event = e.event_type
     order by code, version desc
  loop
    if exists (select 1 from public.points_award_decisions d where d.event_id = e.id and d.rule_code = r.code) then
      continue; -- replay: already decided
    end if;

    v_why := private.points_event_eligible(e, r);
    v_pts := 0;
    if v_why <> 'ok' then
      insert into public.points_award_decisions (event_id, rule_code, rule_version, patient_id, outcome, detail)
        values (e.id, r.code, r.version, e.patient_id, 'ineligible', v_why);
      continue;
    end if;

    v_pts := case when r.points_source = 'catalogue' then private.points_catalogue_value(e, r) else r.points end;

    select count(*) into v_n_life from public.wellness_points_ledger where patient_id = e.patient_id and reason = r.code and points > 0 and kind = 'earn';
    if r.caps ? 'lifetime' and v_n_life >= (r.caps ->> 'lifetime')::integer then v_why := 'lifetime_cap'; end if;
    if v_why = 'ok' and r.caps ? 'per_day' then
      select count(*) into v_n from public.wellness_points_ledger where patient_id = e.patient_id and reason = r.code and points > 0 and kind = 'earn' and created_at >= v_day;
      if v_n >= (r.caps ->> 'per_day')::integer then v_why := 'day_cap'; end if;
    end if;
    if v_why = 'ok' and r.caps ? 'per_week' then
      select count(*) into v_n from public.wellness_points_ledger where patient_id = e.patient_id and reason = r.code and points > 0 and kind = 'earn' and created_at >= v_week;
      if v_n >= (r.caps ->> 'per_week')::integer then v_why := 'week_cap'; end if;
    end if;

    if v_why = 'ok' and r.caps ? 'decay' then
      v_pct := 100;
      for v_step in select value from jsonb_array_elements(r.caps -> 'decay') loop
        if not (v_step ? 'upto') or v_n_life + 1 <= (v_step ->> 'upto')::integer then
          v_pct := (v_step ->> 'pct')::integer;
          exit;
        end if;
      end loop;
      v_pts := (v_pts * v_pct) / 100;
    end if;

    if v_why = 'ok' then
      v_pts := least(v_pts, v_remaining);
      if v_pts <= 0 then v_why := 'points_cap'; end if;
    end if;

    if v_why <> 'ok' then
      insert into public.points_award_decisions (event_id, rule_code, rule_version, patient_id, outcome, detail)
        values (e.id, r.code, r.version, e.patient_id, 'capped', v_why);
      continue;
    end if;

    v_bal.balance := v_bal.balance + v_pts;
    insert into public.wellness_points_ledger
      (organisation_id, patient_id, points, balance_after, reason, source_table, source_id, rule_code, rule_version, event_id)
    values (e.organisation_id, e.patient_id, v_pts, v_bal.balance, r.code, 'domain_events', e.id, r.code, r.version, e.id)
    on conflict (patient_id, source_table, source_id, reason) where source_table is not null and source_id is not null do nothing
    returning id into v_ledger;
    if v_ledger is null then
      v_bal.balance := v_bal.balance - v_pts;
      insert into public.points_award_decisions (event_id, rule_code, rule_version, patient_id, outcome, detail)
        values (e.id, r.code, r.version, e.patient_id, 'capped', 'already_in_ledger');
      continue;
    end if;
    update public.wellness_points_balances
       set balance = v_bal.balance, lifetime_earned = lifetime_earned + v_pts, updated_at = now()
     where patient_id = e.patient_id;
    insert into public.points_award_decisions (event_id, rule_code, rule_version, patient_id, outcome, points, ledger_id)
      values (e.id, r.code, r.version, e.patient_id, 'awarded', v_pts, v_ledger);
    v_remaining := v_remaining - v_pts;
    v_total := v_total + v_pts;
    perform private.emit_domain_event('points.awarded', e.organisation_id,
      jsonb_build_object('ledger_id', v_ledger, 'rule_code', r.code), 'points.awarded:' || v_ledger, e.patient_id,
      'wellness_points_ledger', v_ledger, 'normal', null, e.id);
  end loop;

  if v_total > 0 then perform private.check_and_award_wellness_badges(e.patient_id); end if;
  return v_total;
end;
$$;
revoke all on function private.points_award_event(uuid) from public, anon, authenticated;

create or replace function public.points_award(p_event_id uuid)
returns integer
language sql
security definer
set search_path = ''
as $$
  select private.points_award_event(p_event_id);
$$;
revoke execute on function public.points_award(uuid) from public;
revoke execute on function public.points_award(uuid) from anon, authenticated;
grant execute on function public.points_award(uuid) to service_role;

-- One subscriber per event type that has an active rule.
insert into public.event_subscribers (subscriber_key, event_type, handler_key, note)
select 'points.award.' || replace(t.trigger_event, '.', '_'), t.trigger_event, 'points.award',
       'S58: awards Health Points by rule, idempotent per event'
  from (select distinct trigger_event from public.reward_rules) t
on conflict (subscriber_key) do nothing;

-- ---------------------------------------------------------------------------
-- 6. Badges: Lagos days and a missed-day grace; a failed evaluation is a warning, not silence
-- ---------------------------------------------------------------------------
create or replace function private.check_and_award_wellness_badges(p_patient uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_badge record;
  v_org uuid;
  v_qualifies boolean;
  v_lifetime integer;
  v_entries integer;
  v_grace jsonb := private.reward_config('streak_grace');
  v_allowed integer;
  v_missing integer;
begin
  select organisation_id into v_org from public.profiles where id = p_patient;
  if v_org is null then return; end if;

  select lifetime_earned into v_lifetime from public.wellness_points_balances where patient_id = p_patient;
  select count(*) into v_entries from public.wellness_points_ledger where patient_id = p_patient and points > 0 and kind = 'earn';

  for v_badge in select * from public.wellness_badges where is_active loop
    if exists (select 1 from public.patient_wellness_badges where patient_id = p_patient and badge_id = v_badge.id) then
      continue;
    end if;

    v_qualifies := false;
    if v_badge.criteria_type = 'points_total' then
      v_qualifies := coalesce(v_lifetime, 0) >= v_badge.criteria_threshold;
    elsif v_badge.criteria_type = 'entries_total' then
      v_qualifies := coalesce(v_entries, 0) >= v_badge.criteria_threshold;
    elsif v_badge.criteria_type = 'reason_count' then
      v_qualifies := (
        select count(*) from public.wellness_points_ledger
        where patient_id = p_patient and points > 0 and kind = 'earn' and reason = v_badge.criteria_reason
      ) >= v_badge.criteria_threshold;
    elsif v_badge.criteria_type = 'challenge_completions' then
      v_qualifies := (
        select count(*) from public.patient_challenge_enrolments where patient_id = p_patient and status = 'completed'
      ) >= v_badge.criteria_threshold;
    elsif v_badge.criteria_type = 'streak_days' then
      -- Consistency, with grace: the window may contain a few quiet days (scaled from the configured allowance). A quiet
      -- day never resets anything a person can see; this only decides whether a badge is earned now or a little later.
      v_allowed := floor(v_badge.criteria_threshold::numeric / greatest(1, coalesce((v_grace ->> 'window_days')::integer, 7))
                         * coalesce((v_grace ->> 'missed_days_allowed')::integer, 0));
      select count(*) into v_missing
        from generate_series(0, v_badge.criteria_threshold - 1) as gs (n)
       where not exists (
         select 1 from public.wellness_points_ledger l
          where l.patient_id = p_patient and l.points > 0 and l.kind = 'earn'
            and (l.created_at at time zone 'Africa/Lagos')::date = (now() at time zone 'Africa/Lagos')::date - gs.n);
      v_qualifies := v_missing <= v_allowed and v_missing < v_badge.criteria_threshold;
    end if;

    if v_qualifies then
      insert into public.patient_wellness_badges (organisation_id, patient_id, badge_id)
      values (v_org, p_patient, v_badge.id)
      on conflict (patient_id, badge_id) do nothing;
    end if;
  end loop;
exception when others then
  raise warning 'badge evaluation failed for %: %', p_patient, sqlerrm;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Status for the person: balance, how far this year, tier (computed, never stored)
-- ---------------------------------------------------------------------------
create or replace function private.points_status_for(p_patient uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg jsonb := private.reward_config('tiers');
  v_minor_years integer := coalesce((private.reward_config('minor_age_years') ->> 'years')::integer, 18);
  v_tz text := coalesce(v_cfg ->> 'timezone', 'Africa/Lagos');
  v_year integer := extract(year from now() at time zone v_tz)::integer;
  v_start timestamptz := make_timestamptz(v_year, 1, 1, 0, 0, 0, v_tz);
  v_prev_start timestamptz := make_timestamptz(v_year - 1, 1, 1, 0, 0, 0, v_tz);
  v_bal integer;
  v_life integer;
  v_dob date;
  v_this integer;
  v_prev integer;
  v_idx_this integer := 0;
  v_idx_prev integer := 0;
  v_idx integer;
  v_tiers jsonb := coalesce(v_cfg -> 'tiers', '[]'::jsonb);
  v_carry boolean := coalesce((v_cfg ->> 'carry_status_next_year')::boolean, true);
  v_i integer;
  v_next jsonb;
  v_minor boolean;
begin
  select balance, lifetime_earned into v_bal, v_life from public.wellness_points_balances where patient_id = p_patient;
  select date_of_birth into v_dob from public.profiles where id = p_patient;
  v_minor := v_dob is not null and v_dob > (current_date - make_interval(years => v_minor_years));
  if v_minor then
    return jsonb_build_object('balance', coalesce(v_bal, 0), 'lifetime_earned', coalesce(v_life, 0), 'is_minor', true,
      'tier', null, 'leaderboards', false);
  end if;
  select coalesce(sum(points), 0) into v_this from public.wellness_points_ledger
    where patient_id = p_patient and points > 0 and kind = 'earn' and created_at >= v_start;
  select coalesce(sum(points), 0) into v_prev from public.wellness_points_ledger
    where patient_id = p_patient and points > 0 and kind = 'earn' and created_at >= v_prev_start and created_at < v_start;
  for v_i in 0 .. jsonb_array_length(v_tiers) - 1 loop
    if v_this >= (v_tiers -> v_i ->> 'min')::integer then v_idx_this := v_i; end if;
    if v_prev >= (v_tiers -> v_i ->> 'min')::integer then v_idx_prev := v_i; end if;
  end loop;
  v_idx := case when v_carry then greatest(v_idx_this, v_idx_prev) else v_idx_this end;
  v_next := case when v_idx_this + 1 < jsonb_array_length(v_tiers) then v_tiers -> (v_idx_this + 1) else null end;
  return jsonb_build_object(
    'balance', coalesce(v_bal, 0), 'lifetime_earned', coalesce(v_life, 0), 'is_minor', false,
    'year', v_year, 'year_points', v_this,
    'tier', v_tiers -> v_idx ->> 'key',
    'tier_from', case when v_idx > v_idx_this then 'last_year' else 'this_year' end,
    'next_tier', case when v_next is null then null else v_next ->> 'key' end,
    'points_to_next', case when v_next is null then null else (v_next ->> 'min')::integer - v_this end,
    'leaderboards', coalesce((private.reward_config('leaderboards') ->> 'enabled')::boolean, false));
end;
$$;
revoke all on function private.points_status_for(uuid) from public, anon, authenticated;

create or replace function public.my_points_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  return private.points_status_for(auth.uid());
end;
$$;
revoke execute on function public.my_points_status() from public, anon;
grant execute on function public.my_points_status() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Admin: change a rule (a new version, always 'proposed'), and an aggregate-only summary
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_reward_rule(p_code text, p_points integer, p_caps jsonb, p_active boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.reward_rules%rowtype;
  v_ver integer;
  v_org uuid;
begin
  if not private.is_admin() then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into v_old from public.reward_rules where code = p_code order by version desc limit 1;
  if not found then raise exception 'unknown reward rule %', p_code using errcode = '22023'; end if;
  v_ver := v_old.version + 1;
  insert into public.reward_rules (code, version, trigger_event, points, points_source, caps, verified_action, description, is_active, status)
  values (p_code, v_ver, v_old.trigger_event,
          case when v_old.points_source = 'catalogue' then 0 else p_points end,
          v_old.points_source, coalesce(p_caps, '{}'::jsonb), v_old.verified_action, v_old.description, coalesce(p_active, false), 'proposed');
  update public.reward_rules set is_active = false where code = p_code and version < v_ver;
  select organisation_id into v_org from public.profiles where id = auth.uid();
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, event)
    values (v_org, auth.uid(), 'reward_rule.changed', 'reward_rules',
            jsonb_build_object('code', p_code, 'version', v_ver, 'points', p_points, 'active', coalesce(p_active, false)));
  return v_ver;
end;
$$;
revoke execute on function public.admin_set_reward_rule(text, integer, jsonb, boolean) from public, anon;
grant execute on function public.admin_set_reward_rule(text, integer, jsonb, boolean) to authenticated;

create or replace function public.admin_rewards_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'not authorised' using errcode = '42501'; end if;
  return jsonb_build_object(
    'by_outcome', coalesce((select jsonb_object_agg(outcome || ':' || coalesce(detail, ''), n) from (
        select d.outcome, d.detail, count(*) n from public.points_award_decisions d
          join public.profiles p on p.id = d.patient_id and not coalesce(p.is_test, false)
         where d.decided_at > now() - interval '30 days' group by 1, 2) x), '{}'::jsonb),
    'points_30d', coalesce((select sum(l.points) from public.wellness_points_ledger l
        join public.profiles p on p.id = l.patient_id and not coalesce(p.is_test, false)
        where l.points > 0 and l.kind = 'earn' and l.created_at > now() - interval '30 days'), 0));
end;
$$;
revoke execute on function public.admin_rewards_summary() from public, anon;
grant execute on function public.admin_rewards_summary() to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Self-check
-- ---------------------------------------------------------------------------
do $$
declare v_src text;
begin
  if (select count(*) from public.event_subscribers where handler_key = 'points.award') <> 12 then
    raise exception 'expected 12 points.award subscribers';
  end if;
  -- no earning trigger still carries a typed-in points number or the old award call
  select string_agg(p.proname, ', ') into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname like 'wellness_points_on_%' and p.prosrc ilike '%award_wellness_points%';
  if v_src is not null then raise exception 'still calling award_wellness_points: %', v_src; end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'private' and p.proname = 'evaluate_wellness_challenges' and p.prosrc ilike '%award_wellness_points%') then
    raise exception 'challenge evaluator still pays directly';
  end if;
end $$;
