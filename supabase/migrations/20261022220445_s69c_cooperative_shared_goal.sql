-- S69c: cooperative framing for cohort challenges (shared goal, weeks active, rest check-in, skip a week, daily cap, day-level timestamps, kept history).
--
-- Everything here is born OFF behind the existing `cohorts` module and the `cohorts_enabled` guard (private.cohort_open); nothing is signed or approved.
-- The S69 tables hold no live rows (module off, guard off, no template approved), so the created_at conversion below is structural, not a data migration.
--
--   (a) the shared-goal path reads only the already-suppressed band in cohort_challenge_view; this migration adds no group-facing field
--   (b) weeks active: cumulative count of calendar weeks with any effort, derived from the member's OWN rows, never reduced by a skip
--   (c) rest check-in: an equal-weight alternative effort for people who are ill, disabled or on bed rest (per-template option on draft templates)
--   (d) skip this week: a private row, no notice, no group-facing field
--   (e) per-person per-day cap on a counted contribution (cohort_coop_config, PROPOSED)
--   (f) day-level only: challenge_participation.created_at becomes a DATE and challenge_skips holds dates only
--   (g) the retention purge is removed from the scheduled run: a member's own effort history stays after a challenge ends
--       (leaving the group or withdrawing totals consent still erases it, as before)

-- ---------------------------------------------------------------------------
-- 1. Versioned cooperative rules (PROPOSED, Founder owner). Mirrored as cohorts.cooperative in packages/shared/src/proposed-config.
-- ---------------------------------------------------------------------------
create table public.cohort_coop_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now(),
  constraint cohort_coop_rules_valid check (coalesce(
    (rules ->> 'daily_cap_days') ~ '^[0-9]{1,3}$' and (rules ->> 'daily_cap_lessons') ~ '^[0-9]{1,3}$'
    and (rules ->> 'daily_cap_minutes') ~ '^[0-9]{1,3}$' and (rules ->> 'rest_checkin_minutes') ~ '^[0-9]{1,3}$'
    and (rules ->> 'path_milestones') ~ '^[0-9]{1,2}$'
    and (rules ->> 'daily_cap_days')::integer >= 1 and (rules ->> 'daily_cap_lessons')::integer >= 1
    and (rules ->> 'daily_cap_minutes')::integer between 1 and 180 and (rules ->> 'rest_checkin_minutes')::integer between 1 and 180
    and (rules ->> 'path_milestones')::integer between 2 and 20, false))
);
create unique index cohort_coop_config_one_active on public.cohort_coop_config (is_active) where is_active;

-- coop-rules-begin
insert into public.cohort_coop_config (version, is_active, effective_from, rules) values (1, true, '2026-10-22', $json$
{
  "daily_cap_days": 1,
  "daily_cap_lessons": 3,
  "daily_cap_minutes": 180,
  "rest_checkin_minutes": 20,
  "path_milestones": 5
}
$json$::jsonb);
-- coop-rules-end

alter table public.cohort_coop_config enable row level security;
create policy cohort_coop_config_read on public.cohort_coop_config for select to authenticated using (true);
revoke all on public.cohort_coop_config from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.cohort_coop_config from authenticated;
grant select on public.cohort_coop_config to authenticated;

create function private.cohort_coop_rules() returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules from public.cohort_coop_config where is_active $$;
revoke all on function private.cohort_coop_rules() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Day-level only (f) and the rest check-in source (c)
-- ---------------------------------------------------------------------------
alter table public.challenge_participation alter column created_at drop default;
alter table public.challenge_participation
  alter column created_at type date using ((created_at at time zone 'Africa/Lagos')::date);
alter table public.challenge_participation alter column created_at set default private.cohort_today();
alter table public.challenge_participation drop constraint if exists challenge_participation_source_check;
alter table public.challenge_participation add constraint challenge_participation_source_check
  check (source in ('computed', 'self_report', 'rest_checkin'));

-- a template option on every (still proposed) template: the rest check-in counts the same as the day's effort. The CMO signs later.
alter table public.challenge_templates add column rest_alternative boolean not null default true;

-- (e) the daily cap: whichever path wrote the row, one person's day never counts for more than the configured cap
create function private.challenge_participation_daily_cap() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_metric text; v_rules jsonb := coalesce(private.cohort_coop_rules(), '{}'::jsonb); v_cap integer;
begin
  select metric into v_metric from public.challenges where id = new.challenge_id;
  -- a missing key or no active row never means "no cap": fall back to the safe defaults (1 day, 3 lessons, 180 minutes)
  v_cap := case v_metric when 'lessons_completed' then coalesce((v_rules ->> 'daily_cap_lessons')::integer, 3)
                         when 'activity_minutes' then coalesce((v_rules ->> 'daily_cap_minutes')::integer, 180)
                         else coalesce((v_rules ->> 'daily_cap_days')::integer, 1) end;
  if new.value > v_cap then new.value := v_cap; end if;
  return new;
end $$;
revoke all on function private.challenge_participation_daily_cap() from public, anon, authenticated;
create trigger challenge_participation_daily_cap before insert or update of value on public.challenge_participation
  for each row execute function private.challenge_participation_daily_cap();

-- ---------------------------------------------------------------------------
-- 3. Skip this week (d): a private, dated row. No notice, no group-facing field, no effect on weeks active.
-- ---------------------------------------------------------------------------
create table public.challenge_skips (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  challenge_id    uuid not null references public.challenges (id) on delete cascade,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  week_start      date not null,
  created_on      date not null default private.cohort_today(),
  unique (challenge_id, patient_id, week_start)
);
create index challenge_skips_patient_idx on public.challenge_skips (patient_id);
alter table public.challenge_skips enable row level security;
create policy challenge_skips_own on public.challenge_skips for select to authenticated using (patient_id = (select auth.uid()));
revoke all on public.challenge_skips from public, anon, authenticated;
grant select on public.challenge_skips to authenticated;

-- leaving or withdrawing erases a member's skip rows together with their effort rows
create or replace function private.cohort_forget_effort(p_patient uuid, p_cohort uuid default null) returns void
language sql security definer set search_path = ''
as $$
  with a as (
    delete from public.challenge_participation cp using public.challenges ch
     where cp.challenge_id = ch.id and cp.patient_id = p_patient and (p_cohort is null or ch.cohort_id = p_cohort) returning 1)
  delete from public.challenge_skips s using public.challenges ch
   where s.challenge_id = ch.id and s.patient_id = p_patient and (p_cohort is null or ch.cohort_id = p_cohort)
$$;
revoke all on function private.cohort_forget_effort(uuid, uuid) from public, anon, authenticated;

-- shared gate: a member of an active cohort, community open and not switched off. One neutral answer for everything else.
create function private.cohort_member_gate(p_challenge uuid, p_patient uuid, out o_ch public.challenges, out o_m public.cohort_members, out o_ok boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare co public.cohorts%rowtype;
begin
  o_ok := false;
  select * into o_ch from public.challenges where id = p_challenge and cancelled_at is null;
  if not found or not private.cohort_open(p_patient) then return; end if;
  select * into co from public.cohorts where id = o_ch.cohort_id;
  o_m := private.cohort_member(o_ch.cohort_id, p_patient);
  if o_m.id is null or co.state <> 'active' or private.cohort_is_off(p_patient) then return; end if;
  o_ok := true;
end $$;
revoke all on function private.cohort_member_gate(uuid, uuid) from public, anon, authenticated;

create function public.skip_challenge_week(p_challenge uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare pr public.profiles; g record; v_week date := date_trunc('week', private.cohort_today()::timestamp)::date;
begin
  pr := private.cohort_patient();
  select * into g from private.cohort_member_gate(p_challenge, pr.id);
  if not g.o_ok or private.cohort_phase((g.o_ch).starts_on, (g.o_ch).ends_on, (g.o_ch).cancelled_at) not in ('scheduled', 'active') then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;
  insert into public.challenge_skips (organisation_id, challenge_id, patient_id, week_start)
  values (pr.organisation_id, p_challenge, pr.id, v_week) on conflict (challenge_id, patient_id, week_start) do nothing;
  -- deliberately no notification, no audit entry and no group-facing field: a skip is nobody else's business
  return jsonb_build_object('ok', true);
end $$;

create function public.undo_skip_challenge_week(p_challenge uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare pr public.profiles;
begin
  pr := private.cohort_patient();
  delete from public.challenge_skips
   where challenge_id = p_challenge and patient_id = pr.id and week_start = date_trunc('week', private.cohort_today()::timestamp)::date;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Rest check-in (c): counts the same as the day's effort. Allowed under the effort-only rule, because it asks nothing of the body.
-- ---------------------------------------------------------------------------
create function public.rest_checkin_for_challenge(p_challenge uuid, p_day date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  pr public.profiles; g record; v_day date; v_val integer; v_rules jsonb := coalesce(private.cohort_coop_rules(), '{}'::jsonb); v_tpl boolean; v_unit text;
begin
  pr := private.cohort_patient();
  select * into g from private.cohort_member_gate(p_challenge, pr.id);
  if not g.o_ok or private.cohort_phase((g.o_ch).starts_on, (g.o_ch).ends_on, (g.o_ch).cancelled_at) <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;
  select t.rest_alternative, t.unit into v_tpl, v_unit from public.challenge_templates t where t.code = (g.o_ch).template_code;
  if not coalesce(v_tpl, false) then return jsonb_build_object('ok', false, 'reason', 'not_available'); end if;
  if (g.o_m).consent_totals_at is null then return jsonb_build_object('ok', false, 'reason', 'consent_needed'); end if;
  v_day := coalesce(p_day, private.cohort_today());
  if v_day < private.cohort_today() - 1 or v_day > private.cohort_today() or v_day < (g.o_ch).starts_on or v_day > (g.o_ch).ends_on then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;
  v_val := case v_unit when 'minutes' then coalesce((v_rules ->> 'rest_checkin_minutes')::integer, 20) else 1 end;
  -- never overwrites a day that already carries effort: a day counts once
  insert into public.challenge_participation (organisation_id, challenge_id, patient_id, day, value, source)
  values (pr.organisation_id, p_challenge, pr.id, v_day, v_val, 'rest_checkin') on conflict (challenge_id, patient_id, day) do nothing;
  return jsonb_build_object('ok', true, 'counted', true);
end $$;

-- ---------------------------------------------------------------------------
-- 5. The member's own summary and own history. Own figures only. Never a group-facing field.
-- ---------------------------------------------------------------------------
create function private.member_weeks_active(p_patient uuid) returns integer
language sql stable security definer set search_path = ''
as $$ select count(distinct date_trunc('week', cp.day::timestamp))::integer from public.challenge_participation cp where cp.patient_id = p_patient $$;
revoke all on function private.member_weeks_active(uuid) from public, anon, authenticated;

create function public.my_challenge_summary(p_challenge uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare pr public.profiles; g record;
begin
  pr := private.cohort_patient();
  select * into g from private.cohort_member_gate(p_challenge, pr.id);
  if not g.o_ok then return jsonb_build_object('available', false); end if;
  return jsonb_build_object(
    'available', true,
    'contributing', (g.o_m).consent_totals_at is not null,
    'did_today', exists (select 1 from public.challenge_participation where challenge_id = p_challenge and patient_id = pr.id and day = private.cohort_today()),
    'skipped_this_week', exists (select 1 from public.challenge_skips where challenge_id = p_challenge and patient_id = pr.id
                                   and week_start = date_trunc('week', private.cohort_today()::timestamp)::date),
    'rest_available', coalesce((select t.rest_alternative from public.challenge_templates t where t.code = (g.o_ch).template_code), false),
    'weeks_active', private.member_weeks_active(pr.id));
end $$;

-- (g) the member's own record view: every challenge they took part in, ended or not. Their own rows only.
create function public.my_effort_history() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare pr public.profiles;
begin
  pr := private.cohort_patient();
  return jsonb_build_object(
    'weeks_active', private.member_weeks_active(pr.id),
    'challenges', coalesce((
      select jsonb_agg(jsonb_build_object('label', t.label, 'unit', t.unit, 'starts_on', ch.starts_on, 'ends_on', ch.ends_on,
               'phase', private.cohort_phase(ch.starts_on, ch.ends_on, ch.cancelled_at), 'days_with_effort', x.days, 'total_effort', x.total,
               'rest_days', x.rest_days) order by ch.starts_on desc)
        from public.challenges ch
        join public.challenge_templates t on t.code = ch.template_code
        join lateral (select count(*)::integer days, coalesce(sum(cp.value), 0)::integer total,
                             (count(*) filter (where cp.source = 'rest_checkin'))::integer rest_days
                        from public.challenge_participation cp where cp.challenge_id = ch.id and cp.patient_id = pr.id) x on x.days > 0
       where private.cohort_open(pr.id)), '[]'::jsonb));
end $$;

-- (S69c) closing a cohort erases the members' skip rows together with their effort rows, as leaving does (the original left challenge_skips behind)
create or replace function public.cohort_close(p_cohort uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare pr public.profiles;
begin
  pr := private.cohort_patient();
  if not private.cohort_is_moderator(p_cohort, pr.id) then raise exception 'community_not_authorised' using errcode = '42501'; end if;
  update public.cohorts set state = 'closed', closed_at = now() where id = p_cohort and state <> 'closed';
  update public.challenges set cancelled_at = now() where cohort_id = p_cohort and cancelled_at is null;
  delete from public.challenge_participation cp using public.challenges ch where cp.challenge_id = ch.id and ch.cohort_id = p_cohort;
  delete from public.challenge_skips s using public.challenges ch where s.challenge_id = ch.id and ch.cohort_id = p_cohort;
  update public.cohort_invites set state = 'cancelled' where cohort_id = p_cohort and state = 'pending';
  perform private.log_audit('community.cohort_closed', 'community_cohort', p_cohort, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

-- (S69c) a real self-report or computed count that overwrites a rest check-in on the same day now takes over its source too, so rest_days and the weekly cap stay honest
create or replace function public.contribute_to_challenge(p_challenge uuid, p_day date default null, p_minutes integer default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  pr public.profiles; ch public.challenges%rowtype; co public.cohorts%rowtype; m public.cohort_members%rowtype; cfg jsonb := private.cohort_rules();
  v_from date; v_to date; v_day date; v_val integer; v_week_used integer;
begin
  pr := private.cohort_patient();
  select * into ch from public.challenges where id = p_challenge and cancelled_at is null;
  if not found or not private.cohort_open(pr.id) then return jsonb_build_object('ok', false, 'reason', 'not_available'); end if;
  select * into co from public.cohorts where id = ch.cohort_id;
  m := private.cohort_member(ch.cohort_id, pr.id);
  -- one neutral answer for: not in the cohort, frozen or closed, challenge not running, or the effort-only rule (never says which)
  if m.id is null or co.state <> 'active' or private.cohort_phase(ch.starts_on, ch.ends_on, ch.cancelled_at) <> 'active'
     or not private.cohort_metric_allowed(pr.id, ch.metric) or private.cohort_is_off(pr.id) then
    return jsonb_build_object('ok', false, 'reason', 'not_available');
  end if;
  if m.consent_totals_at is null then return jsonb_build_object('ok', false, 'reason', 'consent_needed'); end if;
  v_from := ch.starts_on; v_to := least(ch.ends_on, private.cohort_today());

  if ch.metric = 'log_days' then
    insert into public.challenge_participation (organisation_id, challenge_id, patient_id, day, value, source)
    select pr.organisation_id, ch.id, pr.id, d, 1, 'computed' from (
      select (v.taken_at at time zone 'Africa/Lagos')::date d from private.vitals_readings_current v where v.patient_id = pr.id
        and (v.taken_at at time zone 'Africa/Lagos')::date between v_from and v_to
      union select (n.logged_at at time zone 'Africa/Lagos')::date from public.nutrition_log_entries n where n.patient_id = pr.id
        and (n.logged_at at time zone 'Africa/Lagos')::date between v_from and v_to) x
    on conflict (challenge_id, patient_id, day) do nothing;
  elsif ch.metric = 'medicine_checkin_days' then
    insert into public.challenge_participation (organisation_id, challenge_id, patient_id, day, value, source)
    select pr.organisation_id, ch.id, pr.id, d, 1, 'computed' from (
      select distinct (a.responded_at at time zone 'Africa/Lagos')::date d from public.medication_adherence_checkins a
       where a.patient_id = pr.id and a.status = 'responded' and (a.responded_at at time zone 'Africa/Lagos')::date between v_from and v_to) x
    on conflict (challenge_id, patient_id, day) do nothing;
  elsif ch.metric = 'lessons_completed' then
    insert into public.challenge_participation (organisation_id, challenge_id, patient_id, day, value, source)
    select pr.organisation_id, ch.id, pr.id, (e.updated_at at time zone 'Africa/Lagos')::date, least(count(*), 5)::integer, 'computed'
      from public.health_education_progress e
     where e.patient_id = pr.id and e.status = 'understood' and (e.updated_at at time zone 'Africa/Lagos')::date between v_from and v_to
     group by (e.updated_at at time zone 'Africa/Lagos')::date
    on conflict (challenge_id, patient_id, day) do update set value = excluded.value, source = excluded.source;
  else
    -- self-reported: today or yesterday only, one row a day
    v_day := coalesce(p_day, private.cohort_today());
    if v_day < private.cohort_today() - 1 or v_day > private.cohort_today() or v_day < ch.starts_on or v_day > ch.ends_on then
      return jsonb_build_object('ok', false, 'reason', 'not_available');
    end if;
    if ch.metric = 'activity_minutes' then
      if p_minutes is null or p_minutes < 1 or p_minutes > (cfg ->> 'activity_minutes_day_max')::integer then raise exception 'minutes_invalid' using errcode = '22023'; end if;
      select coalesce(sum(value), 0) into v_week_used from public.challenge_participation
       where challenge_id = ch.id and patient_id = pr.id and day <> v_day and date_trunc('week', day::timestamp) = date_trunc('week', v_day::timestamp);
      v_val := least(p_minutes, greatest((cfg ->> 'activity_minutes_week_cap')::integer - v_week_used, 0));
      if v_val < 1 then return jsonb_build_object('ok', true, 'capped', true); end if;
    else
      v_val := 1;
    end if;
    insert into public.challenge_participation (organisation_id, challenge_id, patient_id, day, value, source)
    values (pr.organisation_id, ch.id, pr.id, v_day, v_val, 'self_report')
    on conflict (challenge_id, patient_id, day) do update set value = excluded.value, source = excluded.source;
  end if;
  -- "counted" is a yes or no about the caller's own effort so a logged metric with nothing to count is never reported as counted
  return jsonb_build_object('ok', true, 'counted', exists (select 1 from public.challenge_participation where challenge_id = ch.id and patient_id = pr.id));
end $$;

-- ---------------------------------------------------------------------------
-- 6. Scheduled run without the retention purge (g). Identical to the S69 function except step 3.
-- ---------------------------------------------------------------------------
create or replace function private.cohort_run() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  cfg jsonb := private.cohort_rules(); ch public.challenges%rowtype; s public.challenge_totals%rowtype; v_made integer := 0; v_announced integer := 0; v_errors integer := 0; v_purged integer; v_phase text; v_member record;
  v_on boolean := private.module_enabled('cohorts');
begin
  -- 1. snapshots: one every snapshot_every_hours while a challenge runs, and exactly one final one after it ends. One bad challenge never
  --    stops the others: its error is written to the audit log (a silent skip would look like "no total yet") and counted in the result.
  for ch in select h.* from public.challenges h join public.cohorts c on c.id = h.cohort_id
             where h.cancelled_at is null and c.state = 'active' and (c.is_test or v_on)
               and h.starts_on <= private.cohort_today() and h.ends_on >= private.cohort_today() - 3 loop
    begin
      v_phase := private.cohort_phase(ch.starts_on, ch.ends_on, ch.cancelled_at);
      if v_phase = 'active' then
        if not exists (select 1 from public.challenge_totals where challenge_id = ch.id and as_of > now() - make_interval(hours => (cfg ->> 'snapshot_every_hours')::integer)) then
          perform private.challenge_aggregate(ch.id, false); v_made := v_made + 1;
        end if;
      elsif v_phase = 'ended' and not exists (select 1 from public.challenge_totals where challenge_id = ch.id and is_final) then
        perform private.challenge_aggregate(ch.id, true); v_made := v_made + 1;
      end if;
    exception when others then
      v_errors := v_errors + 1;
      perform private.log_audit('community.run_error', 'challenge', ch.id, jsonb_build_object('stage', 'snapshot', 'sqlstate', sqlstate));
    end;
  end loop;

  -- 2. announce milestones only once their snapshot is PUBLISHED, so a notice never arrives before the figure it is about
  for s in select t.* from public.challenge_totals t where t.announced_at is null and t.published_after <= now() and (t.goal_reached or t.is_final) loop
    begin
      select * into ch from public.challenges where id = s.challenge_id;
      if s.goal_reached and not exists (select 1 from public.challenge_totals e where e.challenge_id = s.challenge_id and e.goal_reached and e.announced_at is not null) then
        perform private.emit_domain_event('challenge.progress', ch.organisation_id,
          jsonb_build_object('challenge_id', ch.id, 'cohort_id', ch.cohort_id, 'kind', 'goal_reached'), 'challenge.progress:' || s.id,
          case when ch.is_test then ch.created_by end, 'challenge', ch.id);
        for v_member in select m.patient_id, m.organisation_id from public.cohort_members m
                         where m.cohort_id = ch.cohort_id and m.state = 'active' and not m.muted and not private.cohort_is_off(m.patient_id) loop
          perform private.cohort_notify(v_member.patient_id, v_member.organisation_id, 'challenge_totals', s.id);
        end loop;
        v_announced := v_announced + 1;
      end if;
      if s.is_final and ch.ended_announced_at is null then
        perform private.emit_domain_event('challenge.progress', ch.organisation_id,
          jsonb_build_object('challenge_id', ch.id, 'cohort_id', ch.cohort_id, 'kind', 'ended'), 'challenge.progress:ended:' || ch.id,
          case when ch.is_test then ch.created_by end, 'challenge', ch.id);
        for v_member in select m.patient_id, m.organisation_id from public.cohort_members m
                         where m.cohort_id = ch.cohort_id and m.state = 'active' and not m.muted and not private.cohort_is_off(m.patient_id) loop
          perform private.cohort_notify(v_member.patient_id, v_member.organisation_id, 'challenges', ch.id);
        end loop;
        update public.challenges set ended_announced_at = now() where id = ch.id;
        v_announced := v_announced + 1;
      end if;
      update public.challenge_totals set announced_at = now() where id = s.id;
    exception when others then
      v_errors := v_errors + 1;
      perform private.log_audit('community.run_error', 'challenge', s.challenge_id, jsonb_build_object('stage', 'announce', 'sqlstate', sqlstate));
    end;
  end loop;

  -- 3. (S69c) no retention purge: a member's own effort history survives the end of a challenge, in their own record view only
  v_purged := 0;
  return jsonb_build_object('snapshots', v_made, 'announced', v_announced, 'purged', v_purged, 'errors', v_errors);
end $$;
revoke all on function private.cohort_run() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Grants, registry, and the migration proves what it claims
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['public.skip_challenge_week(uuid)', 'public.undo_skip_challenge_week(uuid)', 'public.rest_checkin_for_challenge(uuid,date)',
                           'public.my_challenge_summary(uuid)', 'public.my_effort_history()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- the new patient-keyed table follows the same registry and under-18 rules as the other cohort tables
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
select 'challenge_skips', 'patient_id', private.retention_class_for('challenge_skips'),
       case when private.retention_class_for('challenge_skips') = 'operational' then 'delete' else 'review' end,
       private.retention_class_for('challenge_skips') <> 'audit',
       'Registered with the default S39d classification when challenge_skips was added (S69c); awaiting review.'
 where to_regclass('public.challenge_skips') is not null and to_regprocedure('private.retention_class_for(text)') is not null
on conflict (table_name) do nothing;

do $$
begin
  if to_regprocedure('private.guard_minor_dependant_table(text,text)') is not null then
    perform private.guard_minor_dependant_table('challenge_skips', 'patient_id');
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.skip_challenge_week(uuid)', 'public.rest_checkin_for_challenge(uuid,date)', 'public.my_challenge_summary(uuid)', 'public.my_effort_history()'] loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon can execute %', f; end if;
    if not has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'authenticated cannot execute %', f; end if;
  end loop;
  if has_table_privilege('anon', 'public.challenge_skips', 'SELECT') or has_table_privilege('authenticated', 'public.challenge_skips', 'INSERT') then
    raise exception 'challenge_skips is reachable outside its functions';
  end if;
  -- day-level only: no timestamp column on a member's effort or skip rows
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('challenge_participation', 'challenge_skips')
                and data_type like 'timestamp%') then
    raise exception 'a member effort table still holds a time of day';
  end if;
  if exists (select 1 from public.challenge_templates where status <> 'proposed') then raise exception 'a template was born approved'; end if;
  if (select count(*) from public.platform_modules where key in ('cohorts', 'group_sessions') and not is_enabled) <> 2 then raise exception 'a community module is not off'; end if;
end $$;
