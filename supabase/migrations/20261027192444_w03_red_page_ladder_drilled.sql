-- W-03: the red-page ladder, watched every three minutes and ending in a named human.
--
-- WHAT THIS ADDS (all additive; nothing patient-facing changes, red guidance is untouched on every plan):
--   1. chain-canary-red: a SEPARATE job, every 3 MINUTES (founder decision 2026-10-27; the first draft ran every minute). Each tick judges
--      every run that is at least eval_after_seconds old (graded red, bus deliveries done, page made to the synthetic on-call clinician,
--      acknowledged) and then injects the red fixture through the real insert path. A failure opens a sev1 incident. The existing
--      30-minute full canary (minutes 11 and 41) is not touched and the red lane writes to its OWN table, so chain_health, the reliability
--      report and the heartbeat keep reading only the full canary.
--      HONEST DETECTION BUDGET: a failure that starts just after an injection is first exercised by the NEXT injection (up to one interval
--      later). One failed run is only a blip (see DEBOUNCE below), so a page needs a SECOND failing injection one interval after that, judged on
--      the next tick: worst case 3 x 3 minutes = 540 seconds, a failed run shows on the card after about 3 to 6 minutes. It is NOT inside three
--      minutes. The budget is stored (detection_budget_seconds = 540), a CHECK refuses a cadence whose worst case exceeds it, and the proof
--      asserts the real figure. Ships OFF (red_lane_enabled = false); the cron job exists but does nothing. About 480 injections a day.
--      Why pg_cron and not a new sub-daily vercel.json cron: Vercel refuses deploys with sub-daily crons on this plan (see the repo's
--      "Vercel cron frequency limit" note) and every other per-minute job on this project (sweep-pages, paging-health, ops-desk-sweep,
--      triage-recheck-sweep) already runs in pg_cron next to the data it reads.
--   2. A dead letter on a red-class event subscriber (default paging.on_red, queue.create_from_triage, triage.grade_observation) opens a
--      sev1 incident and assigns the named ops person through the EXISTING ops desk (private.ops_desk_assign: primary, then deputy after
--      deputy_after_seconds, then an uncovered alarm). The ops person gets a push, in-app and email notice (never SMS: the ops desk
--      trigger refuses it) with a new neutral template on_call_ops_desk_dead_letter. Decision recorded in the PR: this is NOT a row in
--      public.pages, because pages.patient_id and pages.triage_event_id are NOT NULL and sweep_pages/page_task assume a clinical case;
--      forcing a "system" kind into that table would put a patient-less row in front of every paging function. Ships OFF
--      (dead_letter_paging_enabled = false).
--   3. rota_coverage_report(): do five credentialed clinicians cover the next 28 days of the rota, with hours uncovered and hours with
--      no credentialed backup. The numbers (5, 28) are PROPOSED values in rota_cover_policy, not constants in code.
--   4. The sole-CMO on-call exception gets a hard DATED expiry (rota_cover_policy.sole_cmo_exception_sunset, PROPOSED 2027-01-31, end of
--      that day in Lagos). New exceptions are capped to it, none can be signed after it, private.sole_cmo_exception_active refuses after
--      it, and a daily sweep closes lapsed exceptions and raises an incident while cover is still below the minimum. A competency
--      already granted is NOT auto-removed (that could drop the only CMO off a live rota; same reasoning as the exception's own design).
--      Test rows (is_test) are exempt so the existing proofs cannot rot when the date passes.
--   5. page_phone_fallbacks: the log of the final fallback phone call (the in-console alarm plus a named person phoning). Written by
--      log_page_phone_fallback() and mirrored automatically from ops_desk_call_log for an expired-page incident.
--   6. red_ladder_status(): one read for /clinician/chain-health.
--
-- REVIEW FIXES (code review, high, 2026-10-27):
--   * Dead letters are GROUPED: one incident per subscriber per hour (the count is updated in its summary), at most
--     dead_letter_max_incidents_per_hour (3) new incidents per organisation per hour (further ones are appended to the newest open one), only
--     deliveries that went dead AFTER paging was switched on are considered, oldest first, limit 50 per sweep.
--   * DEBOUNCE: one failed red lane run is a 'blip' (recorded, shown on the card, no incident). Only a second consecutive failed run raises sev1.
--     This lengthens the honest worst-case detection budget to 540 seconds (see the config CHECK). eval_after_seconds is 150: the full canary
--     measured over 568 runs in 14 days a p95 of 6 s to grade, 2 s to page and 0 s to acknowledge, and tolerates 180 s for grading
--     (gradedSeconds); 150 s is 15x the measured p95, still under the 180 s tick so a run is judged by the very next tick.
--   * The stale alarm is measured from the later of the last judged run and the moment the lane was switched on, so enabling it never alarms.
--   * The two switches change only through CMO-only RPCs (set_red_lane_enabled, set_dead_letter_paging_enabled), which write the audit log and a
--     history table; a trigger refuses any other path.
--   * The dated expiry BITES: after the sunset date a competency the clinician granted to THEMSELVES (the sole-CMO exception) no longer counts
--     towards rota coverage (meets_minimum goes false) and the card says "exception ended". A competency already granted is not removed.
--   * Phone log: fixed outcome list, optional short note (never copied from the ops desk), callee must belong to the organisation and be
--     clinical staff or an ops contact.
--   * A partial index on domain_event_deliveries (updated_at) where status = 'dead' keeps the dead letter sweep cheap if a flood builds up.
-- FUNCTION REPLACEMENTS, checked against the LIVE definitions read through the Supabase MCP on 2026-10-27: the md5 of prosrc live equals the md5 of the
-- body in the repo migrations (private.ops_desk_assign ed1bece2fef273a910e3622625d03beb = 20261020173800; private.sole_cmo_exception_active
-- a431fa1a30f50f05710b2b927b4bf46a = 20261014235005). The copies below differ from those bodies only where marked "W-03".
-- NOT TOUCHED: drill_enabled and the fire-drill switches, any go_live_guards key, platform_modules, patient-facing red guidance,
-- escalate_unconfirmed_critical_notifications, sweep_pages, create_red_page, chain_canary_tick, chain_health.
-- ROWS AFFECTED ON APPLY: 0 existing rows changed (new tables get one singleton config row each; one function is replaced:
-- private.ops_desk_assign gets a template switch, everything else in it is the live body, read 2026-10-27).
-- Replaces: private.ops_desk_assign (template choice), private.sole_cmo_exception_active (sunset check).
-- Nothing here is destructive.

-- 1. Policy (PROPOSED values, CMO owned) ----------------------------------------------------------------------------------------
create table public.rota_cover_policy (
  id                         boolean primary key default true check (id),
  required_clinicians        integer not null default 5 check (required_clinicians between 1 and 50),
  window_days                integer not null default 28 check (window_days between 7 and 90),
  sole_cmo_exception_sunset  date,
  note                       text,
  updated_at                 timestamptz not null default now()
);
alter table public.rota_cover_policy enable row level security;
create policy rota_cover_policy_read on public.rota_cover_policy for select to authenticated
  using (private.is_admin() or private.credential_is_cmo());
revoke all on public.rota_cover_policy from public, anon, authenticated;
grant select on public.rota_cover_policy to authenticated;
insert into public.rota_cover_policy (required_clinicians, window_days, sole_cmo_exception_sunset, note)
values (5, 28, date '2027-01-31', 'W-03 PROPOSED (founder/CMO to confirm): five credentialed on-call clinicians cover a 28-day rota; the sole-CMO on-call exception ends after 2027-01-31 (Lagos).');
comment on table public.rota_cover_policy is 'W-03: PROPOSED rota cover minimum and the dated end of the sole-CMO on-call exception. One row. Changed only by a migration or by the CMO through SQL, never by a client.';

-- 2. Red lane config and runs ---------------------------------------------------------------------------------------------------
create table public.chain_canary_red_config (
  id                          boolean primary key default true check (id),
  red_lane_enabled            boolean not null default false,
  red_lane_enabled_at         timestamptz,
  dead_letter_paging_enabled  boolean not null default false,
  dead_letter_paging_started_at timestamptz,
  dead_letter_max_incidents_per_hour integer not null default 3 check (dead_letter_max_incidents_per_hour between 1 and 20),
  -- the cron job ticks every 3 minutes, so the cadence is a multiple of 3
  inject_every_minutes        integer not null default 3 check (inject_every_minutes between 3 and 60 and inject_every_minutes % 3 = 0),
  -- under one tick (180 s) so a run is judged by the very next tick; 150 s = 15x the measured p95 of the full canary (see the header)
  eval_after_seconds          integer not null default 150 check (eval_after_seconds between 30 and 170),
  red_class_subscribers       text[] not null default array['paging.on_red', 'queue.create_from_triage', 'triage.grade_observation'],
  detection_budget_seconds    integer not null default 540 check (detection_budget_seconds > 0),
  note                        text,
  updated_at                  timestamptz not null default now(),
  -- worst case for a PAGING failure (two consecutive failed runs are required): the wait for the first failing injection (one interval), the
  -- second failing injection (one more interval) and the first judging tick at least eval_after_seconds after it
  constraint chain_canary_red_budget_holds
    check (inject_every_minutes * 60 * 2 + (((eval_after_seconds + 179) / 180) * 180) <= detection_budget_seconds)
);
alter table public.chain_canary_red_config enable row level security;
create policy chain_canary_red_config_read on public.chain_canary_red_config for select to authenticated
  using (private.is_admin() or private.credential_is_cmo());
revoke all on public.chain_canary_red_config from public, anon, authenticated;
grant select on public.chain_canary_red_config to authenticated;
insert into public.chain_canary_red_config (note) values ('W-03 first version, PROPOSED (CMO). Both switches ship OFF; turning them on is a deliberate act by the CMO through set_red_lane_enabled / set_dead_letter_paging_enabled.');

-- The switches change only through the CMO-only RPCs below (they set tarragon.red_switch_write), so every change has a who, a when and a why.
create function private.red_config_switch_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (new.red_lane_enabled is distinct from old.red_lane_enabled or new.dead_letter_paging_enabled is distinct from old.dead_letter_paging_enabled)
     and coalesce(current_setting('tarragon.red_switch_write', true), '') <> 'on' then
    raise exception 'the red ladder switches change only through set_red_lane_enabled / set_dead_letter_paging_enabled (chief medical officer)' using errcode = '42501';
  end if;
  if new.red_lane_enabled and not old.red_lane_enabled then new.red_lane_enabled_at := now(); end if;
  if new.dead_letter_paging_enabled and not old.dead_letter_paging_enabled then new.dead_letter_paging_started_at := now(); end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function private.red_config_switch_guard() from public, anon, authenticated;
create trigger chain_canary_red_config_switch_guard before update on public.chain_canary_red_config
  for each row execute function private.red_config_switch_guard();

create table public.red_ladder_switch_history (
  id          uuid primary key default gen_random_uuid(),
  switch_key  text not null check (switch_key in ('red_lane', 'dead_letter_paging')),
  old_value   boolean not null,
  new_value   boolean not null,
  reason      text not null check (char_length(btrim(reason)) >= 20),
  changed_by  uuid not null,
  changed_at  timestamptz not null default now()
);
alter table public.red_ladder_switch_history enable row level security;
create policy red_ladder_switch_history_read on public.red_ladder_switch_history for select to authenticated
  using (private.is_admin() or private.credential_is_cmo());
revoke all on public.red_ladder_switch_history from public, anon, authenticated;
grant select on public.red_ladder_switch_history to authenticated;
comment on table public.red_ladder_switch_history is 'W-03: who switched the red lane or dead letter paging on or off, when, and why. Written only by the CMO-only RPCs.';

create function private.set_red_switch(p_key text, p_value boolean, p_reason text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_old boolean; v_id uuid; v_reason text := btrim(coalesce(p_reason, ''));
begin
  -- the chief medical officer only: an admin, an agent or any other account cannot flip the red ladder
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can change this switch' using errcode = '42501'; end if;
  if p_key not in ('red_lane', 'dead_letter_paging') then raise exception 'unknown switch' using errcode = '22023'; end if;
  if char_length(v_reason) < 20 then raise exception 'write the reason in at least 20 characters' using errcode = '23514'; end if;
  select case p_key when 'red_lane' then red_lane_enabled else dead_letter_paging_enabled end into v_old from public.chain_canary_red_config for update;
  if v_old is not distinct from p_value then raise exception 'the switch is already %', case when p_value then 'on' else 'off' end using errcode = '23514'; end if;
  perform set_config('tarragon.red_switch_write', 'on', true);
  if p_key = 'red_lane' then update public.chain_canary_red_config set red_lane_enabled = p_value;
  else update public.chain_canary_red_config set dead_letter_paging_enabled = p_value; end if;
  perform set_config('tarragon.red_switch_write', 'off', true);
  insert into public.red_ladder_switch_history (switch_key, old_value, new_value, reason, changed_by) values (p_key, v_old, p_value, v_reason, auth.uid()) returning id into v_id;
  perform private.log_audit('red_ladder.switch_changed', 'red_ladder_switch', v_id, jsonb_build_object('switch', p_key, 'old', v_old, 'new', p_value, 'reason', v_reason));
  return v_id;
end $$;
revoke all on function private.set_red_switch(text, boolean, text) from public, anon, authenticated;

create function public.set_red_lane_enabled(p_enabled boolean, p_reason text) returns uuid
language sql security definer set search_path = ''
as $$ select private.set_red_switch('red_lane', p_enabled, p_reason) $$;
create function public.set_dead_letter_paging_enabled(p_enabled boolean, p_reason text) returns uuid
language sql security definer set search_path = ''
as $$ select private.set_red_switch('dead_letter_paging', p_enabled, p_reason) $$;
revoke all on function public.set_red_lane_enabled(boolean, text) from public, anon;
revoke all on function public.set_dead_letter_paging_enabled(boolean, text) from public, anon;
grant execute on function public.set_red_lane_enabled(boolean, text) to authenticated;
grant execute on function public.set_dead_letter_paging_enabled(boolean, text) to authenticated;

create table public.chain_canary_red_runs (
  id            uuid primary key default gen_random_uuid(),
  injected_at   timestamptz not null default clock_timestamp(),
  fixture_code  text not null,
  reading_id    uuid,
  symptom_id    uuid,
  judged_at     timestamptz,
  passed        boolean,
  failed_stage  text,
  details       jsonb not null default '{}'::jsonb,
  check ((judged_at is null) = (passed is null)),
  check (passed is distinct from false or failed_stage is not null)
);
create index chain_canary_red_runs_injected_idx on public.chain_canary_red_runs (injected_at desc);
alter table public.chain_canary_red_runs enable row level security;
create policy chain_canary_red_runs_read on public.chain_canary_red_runs for select to authenticated
  using (private.is_admin() or private.credential_is_cmo());
revoke all on public.chain_canary_red_runs from public, anon, authenticated;
grant select on public.chain_canary_red_runs to authenticated;

create function private.chain_canary_start_red() returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  s public.chain_canary_subjects;
  f public.chain_canary_fixtures;
  v_id uuid := gen_random_uuid();
  v_rid uuid; v_sym uuid;
begin
  select * into f from public.chain_canary_fixtures where is_enabled and expect_page and vital_type = 'blood_pressure' order by code limit 1;
  if not found then raise exception 'no enabled red blood pressure fixture'; end if;
  s := private.chain_canary_ensure();
  perform private.chain_canary_ensure_rota(s);
  if not private.patient_is_member(s.patient_id) then
    insert into public.patient_memberships (organisation_id, patient_id, source, state, is_test) values (s.organisation_id, s.patient_id, 'purchase', 'active', true);
  end if;
  -- the synthetic reading must not carry a clicking admin or CMO as its actor
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  if f.symptom_type is not null then
    insert into public.symptoms (organisation_id, patient_id, symptom_type, severity) values (s.organisation_id, s.patient_id, f.symptom_type::public.symptom_type, 3) returning id into v_sym;
  end if;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
  values (s.organisation_id, s.patient_id, 'blood_pressure', f.systolic, f.diastolic, 'manual', now()) returning id into v_rid;
  insert into public.chain_canary_red_runs (id, fixture_code, reading_id, symptom_id) values (v_id, f.code, v_rid, v_sym);
  return v_id;
end $$;
revoke all on function private.chain_canary_start_red() from public, anon, authenticated;

create function private.chain_canary_evaluate_red(p_run uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  r public.chain_canary_red_runs;
  s public.chain_canary_subjects;
  te public.triage_events;
  pg public.pages;
  v_stage text; v_msg text; v_n integer; v_row record; v_task_row record; v_errs jsonb := '[]'::jsonb;
begin
  select * into r from public.chain_canary_red_runs where id = p_run and judged_at is null for update;
  if not found then return null; end if;
  select * into s from public.chain_canary_subjects;

  begin
    select * into te from public.triage_events where trigger_type = 'observation' and trigger_id = r.reading_id order by shadow, created_at limit 1;
    if te.id is null then
      v_stage := 'graded'; v_msg := 'no triage event for the red reading: the event bus processor, the observation subscriber or the engine did not run';
    elsif te.grade <> 'red' then
      v_stage := 'graded_wrong_grade'; v_msg := format('the red fixture was graded %s (rule %s v%s). If the rule set was deliberately changed, update the fixture.', te.grade, te.rule_set_code, te.rule_set_version);
    elsif te.shadow then
      v_stage := 'graded_shadow'; v_msg := 'graded by a rule set that is not approved (shadow): no page would be made';
    end if;

    if v_stage is null then
      select count(*) into v_n from public.domain_events e where e.event_type = 'triage.graded' and e.aggregate_id = te.id;
      if v_n = 0 then
        v_stage := 'event_emitted'; v_msg := 'triage.graded was not emitted for the graded event';
      else
        for v_row in
          select d.subscriber_key, d.status, d.last_error
            from public.domain_event_deliveries d join public.domain_events e on e.id = d.event_id
           where e.event_type = 'triage.graded' and e.aggregate_id = te.id and d.subscriber_key = 'paging.on_red'
        loop
          if v_row.status <> 'done' then
            v_stage := 'event_delivered'; v_msg := format('subscriber %s is %s%s', v_row.subscriber_key, v_row.status, coalesce(': ' || left(v_row.last_error, 160), ''));
          end if;
        end loop;
        if v_stage is null and not exists (select 1 from public.domain_event_deliveries d join public.domain_events e on e.id = d.event_id
                                            where e.event_type = 'triage.graded' and e.aggregate_id = te.id and d.subscriber_key = 'paging.on_red') then
          v_stage := 'event_delivered'; v_msg := 'the paging subscriber has no delivery for the graded event';
        end if;
      end if;
    end if;

    if v_stage is null then
      select * into pg from public.pages where triage_event_id = te.id and parent_page_id is null;
      if pg.id is null then
        v_stage := 'page'; v_msg := 'a red event made no page for the on-call clinician';
      elsif pg.to_clinician_id is distinct from s.clinician_id then
        v_stage := 'page'; v_msg := 'the page went to someone other than the synthetic on-call clinician';
      elsif pg.acknowledged_at is null then
        v_stage := 'ack'; v_msg := 'the synthetic clinician did not acknowledge the page (public.acknowledge_page or the page write guard is broken)';
      end if;
    end if;
  exception when others then
    v_stage := 'evaluate'; v_msg := 'the red lane check itself failed: ' || sqlerrm;
  end;

  -- clean up so the lane does not leave work behind. Same scope and rules as the full canary's clean-up (the synthetic organisation only).
  begin
    for v_task_row in select id from public.clinical_tasks where organisation_id = s.organisation_id and state in ('created', 'offered_to_lead', 'open', 'escalated', 'claimed') loop
      begin
        perform private.apply_task_transition(v_task_row.id, 'cancelled', 'lead', null, 'chain canary clean-up');
      exception when others then v_errs := v_errs || to_jsonb('task: ' || sqlerrm); end;
    end loop;
    begin
      perform set_config('tarragon.paging_write', 'on', true);
      update public.pages set closed_at = now(), close_note = 'chain canary clean-up' where organisation_id = s.organisation_id and closed_at is null;
      perform set_config('tarragon.paging_write', 'off', true);
    exception when others then perform set_config('tarragon.paging_write', 'off', true); v_errs := v_errs || to_jsonb('page: ' || sqlerrm); end;
    begin
      update public.clinician_alerts set status = 'resolved', resolution_action = 'chain canary clean-up', resolution_outcome = 'no_action_needed'
         where organisation_id = s.organisation_id and status not in ('resolved', 'closed');
    exception when others then v_errs := v_errs || to_jsonb('alerts: ' || sqlerrm); end;
    begin
      update public.emergency_events set status = 'resolved' where organisation_id = s.organisation_id and status = 'active';
    exception when others then v_errs := v_errs || to_jsonb('emergency: ' || sqlerrm); end;
  exception when others then v_errs := v_errs || to_jsonb('cleanup: ' || sqlerrm);
  end;

  update public.chain_canary_red_runs
     set judged_at = clock_timestamp(), passed = v_stage is null, failed_stage = v_stage,
         details = jsonb_build_object('message', v_msg, 'cleanup_errors', v_errs, 'judged_after_seconds', round(extract(epoch from clock_timestamp() - r.injected_at))::int)
   where id = p_run;

  if v_stage is not null then
    perform private.red_lane_note_failure(p_run, v_stage, v_msg);
  end if;
  return v_stage is null;
end $$;
revoke all on function private.chain_canary_evaluate_red(uuid) from public, anon, authenticated;

-- DEBOUNCE: a single failed run is a blip (kept on the run, shown on the card, nobody is paged). A failed run right after another failed run
-- (within three cadence intervals, so a lane that was off for hours does not count) is real: sev1. Returns true when it paged.
create function private.red_lane_note_failure(p_run uuid, p_stage text, p_msg text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  r public.chain_canary_red_runs; c public.chain_canary_red_config; v_prev boolean; v_page boolean;
begin
  select * into r from public.chain_canary_red_runs where id = p_run;
  select * into c from public.chain_canary_red_config;
  select x.passed into v_prev from public.chain_canary_red_runs x
   where x.judged_at is not null and x.id <> p_run and x.injected_at < r.injected_at and x.injected_at > r.injected_at - make_interval(mins => c.inject_every_minutes * 3)
   order by x.injected_at desc limit 1;
  v_page := v_prev is false;
  update public.chain_canary_red_runs set details = details || jsonb_build_object('paged', v_page) where id = p_run;
  if v_page then
    perform private.ops_alert_incident('chain_canary_red:' || p_stage,
      'Red page chain canary failed twice in a row at stage: ' || p_stage,
      format('Two consecutive three-minute checks of the red event chain failed, the latest at stage "%s". %s Open the chain health page (/clinician/chain-health) for the timeline. A real red event could be stuck the same way: phone the on-call clinician for any open case.', p_stage, coalesce(p_msg, '')),
      'sev1');
  end if;
  return v_page;
end $$;
revoke all on function private.red_lane_note_failure(uuid, text, text) from public, anon, authenticated;

create function private.chain_canary_evaluate_red_safe(p_run uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.chain_canary_evaluate_red(p_run);
exception when others then
  declare v_err text := sqlerrm;
  begin
    update public.chain_canary_red_runs set judged_at = clock_timestamp(), passed = false, failed_stage = 'evaluate', details = jsonb_build_object('error', v_err)
     where id = p_run and judged_at is null;
    perform private.red_lane_note_failure(p_run, 'evaluate', 'The run could not be judged: ' || v_err);
  exception when others then raise warning 'red canary: could not record the evaluate failure: %', sqlerrm; end;
end $$;
revoke all on function private.chain_canary_evaluate_red_safe(uuid) from public, anon, authenticated;

create function private.chain_canary_red_tick() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  c public.chain_canary_red_config;
  r record;
  v_eval integer := 0; v_started uuid; v_ref timestamptz; v_window interval;
begin
  select * into c from public.chain_canary_red_config;
  if not found or not c.red_lane_enabled then return jsonb_build_object('skipped', 'disabled'); end if;
  if not pg_try_advisory_xact_lock(hashtext('chain_canary_red_tick')) then return jsonb_build_object('skipped', 'busy'); end if;

  -- the lane must not die quietly. Measured from the LATER of the last judged run and the moment the lane was switched on, so enabling it (or
  -- re-enabling it after weeks) never alarms until one full window has passed with no run judged. Judged BEFORE this tick writes anything.
  begin
    v_window := make_interval(mins => c.inject_every_minutes * 2 + 2);
    select greatest(coalesce(max(judged_at), c.red_lane_enabled_at), coalesce(c.red_lane_enabled_at, max(judged_at))) into v_ref from public.chain_canary_red_runs;
    if v_ref is not null and v_ref < now() - v_window then
      perform private.ops_alert_incident('chain_canary_red:stale', 'Red page chain canary has stopped reporting',
        format('No red lane run has been judged since %s although the three-minute job is running.', v_ref), 'sev1');
    end if;
  exception when others then raise warning 'red canary stale check failed: %', sqlerrm; end;

  for r in select id from public.chain_canary_red_runs
            where judged_at is null and injected_at <= clock_timestamp() - make_interval(secs => c.eval_after_seconds) order by injected_at loop
    perform private.chain_canary_evaluate_red_safe(r.id);
    v_eval := v_eval + 1;
  end loop;

  if not exists (select 1 from public.chain_canary_red_runs where injected_at > clock_timestamp() - make_interval(secs => c.inject_every_minutes * 60 - 5)) then
    begin
      v_started := private.chain_canary_start_red();
    exception when others then
      declare v_err text := sqlerrm; v_id uuid;
      begin
        insert into public.chain_canary_red_runs (fixture_code, judged_at, passed, failed_stage, details)
          values ('start', clock_timestamp(), false, 'start', jsonb_build_object('error', v_err)) returning id into v_id;
        perform private.red_lane_note_failure(v_id, 'start', 'The synthetic red reading could not be inserted: ' || v_err);
      exception when others then raise warning 'red canary start failure could not be recorded: %', sqlerrm; end;
    end;
  end if;

  -- retention: about 480 runs a day, 7 days is about 3,400 small rows
  delete from public.chain_canary_red_runs where injected_at < now() - interval '7 days';
  return jsonb_build_object('evaluated', v_eval, 'started', v_started);
end $$;
revoke all on function private.chain_canary_red_tick() from public, anon, authenticated;

-- the same gate as the full canary: nothing to check while the platform holds no real patient
select cron.schedule('chain-canary-red', '*/3 * * * *',
  $$select private.chain_canary_red_tick() where exists (select 1 from public.profiles where role = 'patient' and not is_test);$$);

-- 3. Dead letters on red-class subscribers reach a named human --------------------------------------------------------------
create table public.red_dead_letter_pages (
  delivery_id      uuid primary key,
  organisation_id  uuid not null,
  subscriber_key   text not null,
  event_type       text not null,
  incident_id      uuid,
  assigned_to      uuid,
  paged_at         timestamptz not null default now(),
  resolved_at      timestamptz,
  is_test          boolean not null default false
);
create index red_dead_letter_pages_open_idx on public.red_dead_letter_pages (paged_at) where resolved_at is null;
alter table public.red_dead_letter_pages enable row level security;
create policy red_dead_letter_pages_read on public.red_dead_letter_pages for select to authenticated
  using (private.is_admin() or private.credential_is_cmo());
revoke all on public.red_dead_letter_pages from public, anon, authenticated;
grant select on public.red_dead_letter_pages to authenticated;
comment on table public.red_dead_letter_pages is 'W-03: one row per dead-lettered delivery on a red-class subscriber that was handed to the ops desk. No patient data: ids, subscriber and event type only.';

-- ops_desk_assign: the live body (read 2026-10-27) with ONE change, the template. A dead letter must not tell the ops person that "nobody
-- reachable may be on call" (the roster wording); it gets its own neutral notice.
create or replace function private.ops_desk_assign(p_incident uuid, p_mode text default 'first', p_exclude uuid default null) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  i public.ops_incidents%rowtype;
  v_page uuid;
  v_test boolean := false;
  v_ref uuid;
  c record;
  v_reason text;
  v_asg uuid;
begin
  select * into i from public.ops_incidents where id = p_incident;
  if not found or i.organisation_id is null then return null; end if;
  if i.external_reference ~ '^page_expired:[0-9a-f-]{36}$' then
    v_page := substring(i.external_reference from 14)::uuid;
    select p.is_test into v_test from public.pages p where p.id = v_page;
  end if;
  v_test := coalesce(v_test, false);
  v_ref := coalesce(v_page, i.id);

  if p_mode = 'first' then
    select * into c from private.ops_desk_on_duty(i.organisation_id, v_test) d where d.role = 'primary' and d.profile_id is distinct from p_exclude order by d.contact_id limit 1;
    v_reason := 'first_choice';
    if not found then
      select * into c from private.ops_desk_on_duty(i.organisation_id, v_test) d where d.role = 'deputy' and d.profile_id is distinct from p_exclude order by d.contact_id limit 1;
      v_reason := 'primary_not_on_duty';
    end if;
  else
    select * into c from private.ops_desk_on_duty(i.organisation_id, v_test) d where d.role = 'deputy' and d.profile_id is distinct from p_exclude order by d.contact_id limit 1;
    v_reason := 'primary_unacknowledged';
  end if;

  if c.contact_id is null and p_mode <> 'first' then return null; end if;
  if c.contact_id is null then
    -- a drill (test page) is never a real emergency: no sev1 and no notice, only the audit row
    if v_test then
      insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
        values (i.organisation_id, null, 'ops_desk.uncovered_test', 'ops_incident', i.id, jsonb_build_object('mode', p_mode));
      return null;
    end if;
    -- nobody named is on duty: say so loudly, and tell the clinical lead and administrators. The expired-page notice has already gone to them.
    perform private.page_incident(i.organisation_id, 'ops_desk_uncovered:' || i.id, 'No named ops person for this hour: phone the on-call clinician now',
      'A red event page needs a phone call and no ops contact is on duty for this hour (or none is named). Phone the on-call clinician and the chief medical officer yourself and record the calls on the Ops desk page. Name and activate ops contacts so this does not happen again.');
    -- a standing "nobody reachable" condition already sits in the incident queue; only an expired page needs the extra notice
    if v_page is not null then
      perform private.page_notify_leadership(i.organisation_id, v_ref, v_test, 'on_call_ops_desk_uncovered');
    end if;
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
      values (i.organisation_id, null, 'ops_desk.uncovered', 'ops_incident', i.id, jsonb_build_object('mode', p_mode));
    return null;
  end if;

  insert into public.ops_desk_assignments (organisation_id, incident_id, contact_id, profile_id, role, reason, is_test)
  values (i.organisation_id, i.id, c.contact_id, c.profile_id, c.role, v_reason, v_test)
  on conflict (incident_id, contact_id) do nothing
  returning id into v_asg;
  if v_asg is null then return null; end if;
  update public.ops_incidents set owner_id = c.profile_id where id = i.id;
  if v_page is not null then
    perform private.page_notify_ref(c.profile_id, i.organisation_id, 'on_call_ops_desk', v_page, 'pages', array['push', 'in_app', 'email'], true);
  -- W-03: the only change to this function; a dead letter incident gets its own neutral notice instead of the roster wording
  elsif i.external_reference like 'page\_dead\_letter:%' then
    perform private.ops_desk_notify_incident(c.profile_id, i.organisation_id, 'on_call_ops_desk_dead_letter', i.id);
  else
    -- a standing "nobody reachable" condition has no page: the notice points at the incident it is about, not at a page that does not exist
    perform private.ops_desk_notify_incident(c.profile_id, i.organisation_id, 'on_call_ops_desk_roster', i.id);
  end if;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (i.organisation_id, null, 'ops_desk.assigned', 'ops_incident', i.id, jsonb_build_object('assigned_to', c.profile_id, 'role', c.role, 'reason', v_reason));
  return v_asg;
end;
$$;
revoke all on function private.ops_desk_assign(uuid, text, uuid) from public, anon, authenticated;

-- the sweep reads dead deliveries of a few subscribers, oldest first; this keeps it cheap if a flood of dead letters builds up
create index domain_event_deliveries_dead_updated_idx on public.domain_event_deliveries (updated_at, subscriber_key) where status = 'dead';

create function private.sweep_red_dead_letters() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  c public.chain_canary_red_config;
  d record; x record;
  v_ref text; v_inc uuid; v_asg uuid; v_hour text; v_recent integer; v_new boolean; v_n integer; v_subs text;
  v_paged integer := 0; v_groups integer := 0; v_capped integer := 0; v_late integer := 0; v_resolved integer := 0; v_errors integer := 0;
begin
  select * into c from public.chain_canary_red_config;
  if not found or not c.dead_letter_paging_enabled or c.dead_letter_paging_started_at is null then return jsonb_build_object('skipped', 'disabled'); end if;
  v_hour := to_char(date_trunc('hour', now() at time zone 'utc'), 'YYYYMMDD"T"HH24');

  -- only deliveries that went dead after paging was switched on, oldest first (a backlog from before is never dumped on the ops person)
  for d in
    select dl.id, dl.subscriber_key, dl.organisation_id, e.event_type, e.is_test
      from public.domain_event_deliveries dl join public.domain_events e on e.id = dl.event_id
     where dl.status = 'dead' and not e.is_test and dl.subscriber_key = any (c.red_class_subscribers)
       and dl.updated_at >= c.dead_letter_paging_started_at and dl.updated_at > now() - interval '7 days'
       and not exists (select 1 from public.red_dead_letter_pages p where p.delivery_id = dl.id)
     order by dl.updated_at, dl.id limit 50
  loop
    begin
      v_new := false; v_inc := null;
      -- one incident per subscriber per hour
      v_ref := 'page_dead_letter:' || d.subscriber_key || ':' || v_hour;
      select id into v_inc from public.ops_incidents where external_reference = v_ref and status not in ('resolved', 'closed') order by created_at desc limit 1;
      if v_inc is null then
        -- at most dead_letter_max_incidents_per_hour new incidents (so new assignments) per organisation per hour: beyond that, append to the newest open one
        select count(distinct p.incident_id) into v_recent from public.red_dead_letter_pages p where p.organisation_id = d.organisation_id and not p.is_test and p.paged_at > now() - interval '1 hour';
        if v_recent >= c.dead_letter_max_incidents_per_hour then
          select p.incident_id into v_inc from public.red_dead_letter_pages p
            join public.ops_incidents i on i.id = p.incident_id and i.status not in ('resolved', 'closed')
           where p.organisation_id = d.organisation_id and not p.is_test order by p.paged_at desc limit 1;
          if v_inc is not null then v_capped := v_capped + 1; end if;
        end if;
      end if;
      if v_inc is null then
        perform private.page_incident(d.organisation_id, v_ref, 'A red event step failed for good: phone the on-call clinician', 'A step of the red event chain failed permanently.');
        select id into v_inc from public.ops_incidents where external_reference = v_ref order by created_at desc limit 1;
        v_new := true; v_groups := v_groups + 1;
      end if;
      insert into public.red_dead_letter_pages (delivery_id, organisation_id, subscriber_key, event_type, incident_id, is_test)
        values (d.id, d.organisation_id, d.subscriber_key, d.event_type, v_inc, d.is_test);
      select count(*), string_agg(distinct subscriber_key, ', ') into v_n, v_subs from public.red_dead_letter_pages where incident_id = v_inc;
      update public.ops_incidents set summary = format('%s step(s) of the red event chain (%s) failed permanently and are in the dead letter, grouped into this one incident. A red event may not have reached the on-call clinician. Phone the on-call clinician and the chief medical officer, ask whether any case is open, and record the call. Latest delivery %s.', v_n, v_subs, d.id)
       where id = v_inc;
      if v_new then
        v_asg := private.ops_desk_assign(v_inc, 'first', null);
        if v_asg is not null then
          update public.red_dead_letter_pages set assigned_to = (select profile_id from public.ops_desk_assignments where id = v_asg) where incident_id = v_inc;
        end if;
      end if;
      insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
        values (d.organisation_id, null, 'red_dead_letter.paged', 'domain_event_delivery', d.id, jsonb_build_object('subscriber', d.subscriber_key, 'new_incident', v_new));
      v_paged := v_paged + 1;
    exception when others then
      v_errors := v_errors + 1;
      begin
        insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
          values (d.organisation_id, 'red_dead_letter.sweep_error', 'domain_event_delivery', d.id, jsonb_build_object('error', sqlerrm));
        perform private.page_incident(d.organisation_id, 'red_dead_letter_sweep_failed', 'Paging the ops desk about a dead letter failed',
          'A dead-lettered red chain step could not be handed to the ops desk (see audit_log red_dead_letter.sweep_error). Phone the on-call clinician and the chief medical officer now.');
      exception when others then raise warning 'red dead letter sweep: % failed and so did the fallback: %', d.id, sqlerrm; end;
    end;
  end loop;

  -- an incident opened while nobody was on duty gets its owner as soon as someone is (the ops desk sweep only retries the expired-page and roster incidents)
  for x in
    select distinct p.incident_id, p.organisation_id from public.red_dead_letter_pages p
      join public.ops_incidents i on i.id = p.incident_id and i.status not in ('resolved', 'closed')
     where p.resolved_at is null and p.assigned_to is null and not p.is_test
       and not exists (select 1 from public.ops_desk_assignments a where a.incident_id = p.incident_id)
  loop
    begin
      if exists (select 1 from private.ops_desk_on_duty(x.organisation_id, false)) then
        v_asg := private.ops_desk_assign(x.incident_id, 'first', null);
        if v_asg is not null then
          update public.red_dead_letter_pages set assigned_to = (select profile_id from public.ops_desk_assignments where id = v_asg) where incident_id = x.incident_id;
          v_late := v_late + 1;
        end if;
      end if;
    exception when others then
      v_errors := v_errors + 1;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (x.organisation_id, 'red_dead_letter.sweep_error', 'ops_incident', x.incident_id, jsonb_build_object('error', sqlerrm, 'step', 'late_assign'));
    end;
  end loop;

  -- a delivery that was requeued and no longer fails is settled; an incident whose every delivery is settled closes itself (a person can still reopen it)
  update public.red_dead_letter_pages p set resolved_at = now()
   where p.resolved_at is null and not exists (select 1 from public.domain_event_deliveries dl where dl.id = p.delivery_id and dl.status = 'dead');
  for x in
    select i.id from public.ops_incidents i
     where i.external_reference like 'page\_dead\_letter:%' and i.status not in ('resolved', 'closed')
       and exists (select 1 from public.red_dead_letter_pages p where p.incident_id = i.id)
       and not exists (select 1 from public.red_dead_letter_pages p where p.incident_id = i.id and p.resolved_at is null)
  loop
    update public.ops_incidents set status = 'resolved', root_cause = coalesce(root_cause, 'Every dead-lettered delivery in this group was requeued and no longer fails (closed automatically).') where id = x.id;
    v_resolved := v_resolved + 1;
  end loop;
  return jsonb_build_object('paged', v_paged, 'incidents', v_groups, 'appended_over_cap', v_capped, 'late', v_late, 'resolved', v_resolved, 'errors', v_errors);
end $$;
revoke all on function private.sweep_red_dead_letters() from public, anon, authenticated;

select cron.schedule('red-dead-letter-sweep', '* * * * *', $$select private.sweep_red_dead_letters();$$);

-- 4. Rota coverage ---------------------------------------------------------------------------------------------------------------
create function private.rota_coverage(p_org uuid, p_test boolean, p_from timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  pol public.rota_cover_policy;
  v_to timestamptz;
  v_out jsonb;
  v_elig integer;
  v_exc public.sole_cmo_exceptions;
begin
  select * into pol from public.rota_cover_policy;
  v_to := p_from + make_interval(days => pol.window_days);
  select count(*) into v_elig from public.clinical_staff cs
   where cs.organisation_id = p_org and cs.is_test = p_test and cs.active and cs.status = 'active'
     and private.clinician_is_eligible(cs.profile_id, now()) and private.rota_on_call_competent(cs.profile_id, p_test);
  select * into v_exc from public.sole_cmo_exceptions where organisation_id = p_org and is_test = p_test and revoked_at is null order by signed_at desc limit 1;

  with win as (
    select r.* from public.on_call_rota r
     where r.organisation_id = p_org and r.is_test = p_test and r.cancelled_at is null and r.starts_at < v_to and r.ends_at > p_from
  ), pp as (
    select x.pid, count(*) as shifts, max(x.ends_at) as last_end,
           sum(extract(epoch from (least(x.ends_at, v_to) - greatest(x.starts_at, p_from))) / 3600.0) as hours
      from (select primary_clinician_id as pid, starts_at, ends_at from win
            union all select backup_clinician_id, starts_at, ends_at from win where backup_clinician_id is not null) x
     group by x.pid
  ), ppl as (
    -- credentialed through the END of their last shift in the window, so a licence that runs out mid-window counts as a gap
    select pp.*, private.clinician_is_eligible(pp.pid, least(pp.last_end, v_to - interval '1 second')) as elig, private.rota_on_call_competent(pp.pid, p_test) as comp,
           private.has_competency(pp.pid, 'on_call') as comp_any
      from pp
  ), hrs as (
    select g as h from generate_series(date_trunc('hour', p_from), v_to - interval '1 hour', interval '1 hour') g
  ), hc as (
    select hrs.h,
           exists (select 1 from win w join ppl a on a.pid = w.primary_clinician_id where a.elig and a.comp and w.starts_at <= hrs.h and w.ends_at > hrs.h) as prim,
           exists (select 1 from win w join ppl a on a.pid = w.backup_clinician_id where a.elig and a.comp and w.starts_at <= hrs.h and w.ends_at > hrs.h) as back
      from hrs
  )
  select jsonb_build_object(
    'required_clinicians', pol.required_clinicians,
    'window_days', pol.window_days,
    'window_from', p_from, 'window_to', v_to,
    'distinct_on_rota', (select count(*) from ppl),
    'distinct_credentialed_on_rota', (select count(*) from ppl where elig and comp),
    'eligible_on_call_staff', v_elig,
    -- clinicians who hold on_call only because they granted it to themselves under the sole-CMO exception, and the date has passed
    'self_granted_not_counted', (select count(*) from ppl where elig and comp_any and not comp),
    'hours_total', (select count(*) from hc),
    'hours_covered', (select count(*) from hc where prim),
    'hours_uncovered', (select count(*) from hc where not prim),
    'hours_without_backup', (select count(*) from hc where prim and not back),
    'meets_minimum', ((select count(*) from ppl where elig and comp) >= pol.required_clinicians and not exists (select 1 from hc where not prim)),
    'clinicians', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce(cs.full_name, 'Unnamed'), 'shifts', ppl.shifts, 'hours', round(ppl.hours::numeric, 1), 'credentialed', ppl.elig and ppl.comp)
                                          order by ppl.hours desc)
                              from ppl left join public.clinical_staff cs on cs.profile_id = ppl.pid), '[]'::jsonb),
    'sole_cmo_exception', jsonb_build_object(
       'sunset', pol.sole_cmo_exception_sunset,
       'days_to_sunset', case when pol.sole_cmo_exception_sunset is null then null else pol.sole_cmo_exception_sunset - (now() at time zone 'Africa/Lagos')::date end,
       'in_force', v_exc.id is not null and v_exc.expires_at > now() and (p_test or private.sole_cmo_sunset_end() is null or now() < private.sole_cmo_sunset_end()),
       'exception_ended', not p_test and private.sole_cmo_sunset_end() is not null and now() >= private.sole_cmo_sunset_end(),
       'expires_at', v_exc.expires_at)
  ) into v_out
  from (select 1) one;
  return v_out;
end $$;
revoke all on function private.rota_coverage(uuid, boolean, timestamptz) from public, anon, authenticated;

create function public.rota_coverage_report() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid; v_test boolean;
begin
  if not (private.is_admin() or private.credential_is_cmo()) then raise exception 'not allowed' using errcode = '42501'; end if;
  select organisation_id, coalesce(is_test, false) into v_org, v_test from public.profiles where id = auth.uid();
  if v_org is null then raise exception 'not allowed' using errcode = '42501'; end if;
  return private.rota_coverage(v_org, v_test, now());
end $$;
revoke all on function public.rota_coverage_report() from public, anon;
grant execute on function public.rota_coverage_report() to authenticated;

-- 5. The sole-CMO exception gets a dated end ----------------------------------------------------------------------------------------
create function private.sole_cmo_sunset_end() returns timestamptz
language sql stable security definer set search_path = ''
as $$ select ((sole_cmo_exception_sunset + 1)::timestamp at time zone 'Africa/Lagos') from public.rota_cover_policy $$;
revoke all on function private.sole_cmo_sunset_end() from public, anon, authenticated;

-- W-03: the on_call competency counts unless it is a SELF grant (granted_by is the clinician) and the sole-CMO exception's dated end has passed.
-- Test rows are exempt, like the exception's own cap. Nothing is removed: this only changes what the coverage report counts.
create function private.rota_on_call_competent(p_profile uuid, p_exempt boolean) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.clinical_staff cs
      join public.clinician_competencies cc on cc.clinical_staff_id = cs.id and cc.revoked_at is null and cc.competency_code = 'on_call'
     where cs.profile_id = p_profile
       and (p_exempt or private.sole_cmo_sunset_end() is null or now() < private.sole_cmo_sunset_end() or cc.granted_by is distinct from cs.profile_id))
$$;
revoke all on function private.rota_on_call_competent(uuid, boolean) from public, anon, authenticated;

create function private.sole_cmo_exception_cap_to_sunset() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_end timestamptz := private.sole_cmo_sunset_end();
begin
  if new.is_test or v_end is null then return new; end if;
  if now() >= v_end then
    raise exception 'the sole chief medical officer exception ended on its fixed date; add credentialed on-call cover instead' using errcode = '23514';
  end if;
  new.expires_at := least(new.expires_at, v_end);
  return new;
end $$;
revoke all on function private.sole_cmo_exception_cap_to_sunset() from public, anon, authenticated;
create trigger sole_cmo_exceptions_cap_to_sunset before insert on public.sole_cmo_exceptions
  for each row execute function private.sole_cmo_exception_cap_to_sunset();

-- live body (read 2026-10-27) plus the dated end
create or replace function private.sole_cmo_exception_active(p_org uuid, p_code text, p_signer uuid) returns uuid
language sql stable security definer set search_path = ''
as $$
  select e.id from public.sole_cmo_exceptions e
  join public.clinical_staff cs on cs.profile_id = p_signer and cs.organisation_id = p_org
  where e.organisation_id = p_org and e.competency_code = p_code and e.signed_by = p_signer
    and e.revoked_at is null and e.expires_at > now()
    -- W-03: the only change to this function; the dated end of the exception (test rows exempt)
    and (e.is_test or private.sole_cmo_sunset_end() is null or now() < private.sole_cmo_sunset_end())
    and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer'
    and private.sole_cmo_count(p_org, cs.is_test) = 1
  limit 1
$$;
revoke all on function private.sole_cmo_exception_active(uuid, text, uuid) from public, anon, authenticated;

create function private.sole_cmo_sunset_sweep() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  pol public.rota_cover_policy;
  e record; o record;
  v_closed integer := 0; v_warned integer := 0; v_cov jsonb; v_days integer;
begin
  select * into pol from public.rota_cover_policy;
  if pol.sole_cmo_exception_sunset is null then return jsonb_build_object('skipped', 'no sunset date'); end if;
  v_days := pol.sole_cmo_exception_sunset - (now() at time zone 'Africa/Lagos')::date;

  for e in select id, organisation_id, signed_by from public.sole_cmo_exceptions where revoked_at is null and not is_test and expires_at <= now() loop
    -- the table requires revoked_at, revoked_by and revoke_reason together; the system has no profile, so the signer is recorded and the reason says it was automatic
    update public.sole_cmo_exceptions set revoked_at = now(), revoked_by = e.signed_by, revoke_reason = 'dated expiry reached (closed automatically)' where id = e.id;
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
      values (e.organisation_id, null, 'sole_cmo_exception.expired', 'sole_cmo_exception', e.id, jsonb_build_object('sunset', pol.sole_cmo_exception_sunset));
    v_closed := v_closed + 1;
  end loop;

  -- from 30 days before the date until cover meets the minimum: one incident per organisation that has (or had) a live exception
  if v_days <= 30 then
    for o in select distinct organisation_id from public.sole_cmo_exceptions where not is_test loop
      begin
        v_cov := private.rota_coverage(o.organisation_id, false, now());
        if not coalesce((v_cov ->> 'meets_minimum')::boolean, false) then
          perform private.ops_alert_incident('sole_cmo_sunset:' || o.organisation_id,
            case when v_days < 0 then 'The sole chief medical officer on-call exception has ended and cover is below the minimum'
                 else 'The sole chief medical officer on-call exception ends soon and cover is below the minimum' end,
            format('The exception ends after %s (%s day(s) left). The rota has %s credentialed on-call clinician(s) of the %s required for the next %s days. Add credentialed cover, or decide in writing what happens next. A competency already granted is not removed automatically.',
                   pol.sole_cmo_exception_sunset, v_days, v_cov ->> 'distinct_credentialed_on_rota', pol.required_clinicians, pol.window_days),
            case when v_days <= 7 then 'sev2' else 'sev3' end::public.ops_incident_severity);
          v_warned := v_warned + 1;
        end if;
      exception when others then
        insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
          values (o.organisation_id, 'sole_cmo_sunset.sweep_error', 'organisation', o.organisation_id, jsonb_build_object('error', sqlerrm));
      end;
    end loop;
  end if;
  return jsonb_build_object('closed', v_closed, 'warned', v_warned, 'days_to_sunset', v_days);
end $$;
revoke all on function private.sole_cmo_sunset_sweep() from public, anon, authenticated;
select cron.schedule('sole-cmo-sunset-sweep', '7 4 * * *', $$select private.sole_cmo_sunset_sweep();$$);

-- 6. The final fallback: a phone call, logged ------------------------------------------------------------------------------------
create table public.page_phone_fallbacks (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null,
  page_id            uuid,
  incident_id        uuid,
  called_by          uuid not null,
  callee_profile_id  uuid,
  callee_kind        text not null check (callee_kind in ('on_call_clinician', 'chief_medical_officer', 'clinical_lead', 'other')),
  outcome            text not null check (outcome in ('reached_acknowledged', 'reached_no_action', 'not_reached', 'left_message', 'other')),
  note               text check (note is null or char_length(note) <= 200),
  source             text not null default 'rpc' check (source in ('rpc', 'ops_desk')),
  source_call_id     uuid unique,
  called_at          timestamptz not null default now(),
  is_test            boolean not null default false,
  check (page_id is not null or incident_id is not null)
);
create index page_phone_fallbacks_page_idx on public.page_phone_fallbacks (page_id);
create index page_phone_fallbacks_called_idx on public.page_phone_fallbacks (called_at desc);
alter table public.page_phone_fallbacks enable row level security;
create policy page_phone_fallbacks_read on public.page_phone_fallbacks for select to authenticated
  using (organisation_id = (select organisation_id from public.profiles where id = auth.uid()) and (private.is_admin() or private.credential_is_cmo()));
revoke all on public.page_phone_fallbacks from public, anon, authenticated;
grant select on public.page_phone_fallbacks to authenticated;
comment on table public.page_phone_fallbacks is 'W-03: the log of the final fallback phone call for a red page (in-console alarm, then a named person phones). Stores: the page or incident id, who called, whom (a profile id in the same organisation: clinical staff or an ops contact), a fixed outcome (reached_acknowledged, reached_no_action, not_reached, left_message, other), the time, and an OPTIONAL short note of at most 200 characters typed by the caller through the RPC (staff are told not to put patient details in it; calls mirrored from the ops desk carry NO note). No phone numbers and no patient data.';

create function public.log_page_phone_fallback(p_page uuid, p_callee uuid, p_callee_kind text, p_outcome text, p_note text default null) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid; v_pg public.pages%rowtype; v_id uuid; v_outcome text := btrim(coalesce(p_outcome, ''));
begin
  select organisation_id into v_org from public.profiles where id = auth.uid();
  if v_org is null or not (private.is_admin() or private.credential_is_cmo()
       or exists (select 1 from public.ops_desk_contacts c where c.profile_id = auth.uid() and c.is_active)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_pg from public.pages where id = p_page and organisation_id = v_org;
  if not found then raise exception 'page not found' using errcode = 'P0002'; end if;
  if v_outcome not in ('reached_acknowledged', 'reached_no_action', 'not_reached', 'left_message', 'other') then
    raise exception 'outcome must be one of reached_acknowledged, reached_no_action, not_reached, left_message, other' using errcode = '23514';
  end if;
  -- the person phoned must belong to this organisation and be clinical staff or an ops contact
  if p_callee is not null and not exists (
       select 1 from public.profiles pr where pr.id = p_callee and pr.organisation_id = v_org
          and (exists (select 1 from public.clinical_staff cs where cs.profile_id = pr.id) or exists (select 1 from public.ops_desk_contacts oc where oc.profile_id = pr.id))) then
    raise exception 'the person phoned must be clinical staff or an ops contact of this organisation' using errcode = '23514';
  end if;
  insert into public.page_phone_fallbacks (organisation_id, page_id, called_by, callee_profile_id, callee_kind, outcome, note, is_test)
    values (v_org, coalesce(v_pg.parent_page_id, v_pg.id), auth.uid(), p_callee, p_callee_kind, v_outcome, nullif(btrim(left(p_note, 200)), ''), v_pg.is_test)
    returning id into v_id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (v_org, auth.uid(), 'page.phone_fallback_logged', 'page', coalesce(v_pg.parent_page_id, v_pg.id), jsonb_build_object('callee_kind', p_callee_kind, 'outcome', v_outcome));
  return v_id;
end $$;
revoke all on function public.log_page_phone_fallback(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.log_page_phone_fallback(uuid, uuid, text, text, text) to authenticated;

-- every call recorded on the ops desk for an expired page is mirrored (outcome mapped to the fixed list, free-text note NOT copied); a failure
-- here must never stop the call from being logged
create function private.mirror_ops_call_to_phone_fallbacks() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_ref text; v_page uuid;
begin
  begin
    select external_reference into v_ref from public.ops_incidents where id = new.incident_id;
    if v_ref ~ '^page_expired:[0-9a-f-]{36}$' then v_page := substring(v_ref from 14)::uuid; end if;
    insert into public.page_phone_fallbacks (organisation_id, page_id, incident_id, called_by, callee_profile_id, callee_kind, outcome, note, source, source_call_id, called_at, is_test)
      values (new.organisation_id, v_page, new.incident_id, new.called_by, new.callee_profile_id,
              case new.callee_kind when 'on_call_primary' then 'on_call_clinician' when 'on_call_backup' then 'on_call_clinician' when 'chief_medical_officer' then 'chief_medical_officer' else 'other' end,
              case new.outcome when 'answered_acknowledged' then 'reached_acknowledged' when 'answered_will_acknowledge' then 'reached_no_action'
                               when 'no_answer' then 'not_reached' when 'busy_or_off' then 'not_reached' when 'wrong_or_no_number' then 'not_reached'
                               when 'voicemail_left' then 'left_message' else 'other' end,
              null, 'ops_desk', new.id, new.called_at, new.is_test)
      on conflict (source_call_id) do nothing;
  exception when others then
    raise warning 'phone fallback mirror failed for call %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke all on function private.mirror_ops_call_to_phone_fallbacks() from public, anon, authenticated;
create trigger ops_desk_call_log_mirror_phone_fallbacks after insert on public.ops_desk_call_log
  for each row execute function private.mirror_ops_call_to_phone_fallbacks();

-- 7. One read for /clinician/chain-health -----------------------------------------------------------------------------------------
create function public.red_ladder_status() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  c public.chain_canary_red_config;
  v_org uuid; v_test boolean;
  v_last record;
begin
  if not (private.is_admin() or private.credential_is_cmo()) then raise exception 'not allowed' using errcode = '42501'; end if;
  select organisation_id, coalesce(is_test, false) into v_org, v_test from public.profiles where id = auth.uid();
  select * into c from public.chain_canary_red_config;
  select * into v_last from public.chain_canary_red_runs where judged_at is not null order by judged_at desc limit 1;
  return jsonb_build_object(
    'red_lane', jsonb_build_object(
      'enabled', c.red_lane_enabled,
      'detection_budget_seconds', c.detection_budget_seconds,
      'inject_every_minutes', c.inject_every_minutes,
      'last_judged_at', v_last.judged_at, 'last_passed', v_last.passed, 'last_stage', v_last.failed_stage,
      'runs_24h', (select count(*) from public.chain_canary_red_runs where judged_at > now() - interval '24 hours'),
      -- failures that paged (two in a row) and single blips that did not
      'failures_24h', (select count(*) from public.chain_canary_red_runs where judged_at > now() - interval '24 hours' and not passed and (details ->> 'paged') = 'true'),
      'blips_24h', (select count(*) from public.chain_canary_red_runs where judged_at > now() - interval '24 hours' and not passed and coalesce(details ->> 'paged', 'false') <> 'true')),
    'dead_letters', jsonb_build_object(
      'paging_enabled', c.dead_letter_paging_enabled,
      'subscribers', to_jsonb(c.red_class_subscribers),
      'open', (select count(*) from public.red_dead_letter_pages where organisation_id = v_org and resolved_at is null and not is_test),
      'unassigned', (select count(*) from public.red_dead_letter_pages where organisation_id = v_org and resolved_at is null and assigned_to is null and not is_test),
      'paged_30d', (select count(*) from public.red_dead_letter_pages where organisation_id = v_org and paged_at > now() - interval '30 days' and not is_test)),
    'rota', private.rota_coverage(v_org, v_test, now()),
    'phone_fallbacks', jsonb_build_object(
      'expired_pages_30d', (select count(*) from public.pages p where p.organisation_id = v_org and p.is_test = v_test and p.parent_page_id is null and p.expired_at > now() - interval '30 days'),
      'expired_pages_without_call_30d', (select count(*) from public.pages p where p.organisation_id = v_org and p.is_test = v_test and p.parent_page_id is null
                                           and p.expired_at > now() - interval '30 days'
                                           and not exists (select 1 from public.page_phone_fallbacks f where f.page_id = p.id)),
      'calls_30d', (select count(*) from public.page_phone_fallbacks where organisation_id = v_org and called_at > now() - interval '30 days' and not is_test),
      'last_call_at', (select max(called_at) from public.page_phone_fallbacks where organisation_id = v_org and not is_test)),
    'switch_changes', jsonb_build_object(
      'red_lane', (select to_jsonb(h2) from (select h.changed_at, coalesce(pr.full_name, 'Unknown') as changed_by, h.new_value, h.reason
                                               from public.red_ladder_switch_history h left join public.profiles pr on pr.id = h.changed_by
                                              where h.switch_key = 'red_lane' order by h.changed_at desc limit 1) h2),
      'dead_letter_paging', (select to_jsonb(h2) from (select h.changed_at, coalesce(pr.full_name, 'Unknown') as changed_by, h.new_value, h.reason
                                               from public.red_ladder_switch_history h left join public.profiles pr on pr.id = h.changed_by
                                              where h.switch_key = 'dead_letter_paging' order by h.changed_at desc limit 1) h2))
  );
end $$;
revoke all on function public.red_ladder_status() from public, anon;
grant execute on function public.red_ladder_status() to authenticated;

-- 8. Assertions ----------------------------------------------------------------------------------------------------------------------
do $$
declare v_fn text;
begin
  foreach v_fn in array array[
    'private.chain_canary_red_tick()', 'private.chain_canary_start_red()', 'private.chain_canary_evaluate_red(uuid)', 'private.chain_canary_evaluate_red_safe(uuid)',
    'private.sweep_red_dead_letters()', 'private.rota_coverage(uuid, boolean, timestamptz)', 'private.sole_cmo_sunset_sweep()', 'private.sole_cmo_sunset_end()',
    'private.sole_cmo_exception_active(uuid, text, uuid)', 'private.ops_desk_assign(uuid, text, uuid)', 'private.mirror_ops_call_to_phone_fallbacks()',
    'public.rota_coverage_report()', 'public.log_page_phone_fallback(uuid, uuid, text, text, text)', 'public.red_ladder_status()',
    'public.set_red_lane_enabled(boolean, text)', 'public.set_dead_letter_paging_enabled(boolean, text)', 'private.set_red_switch(text, boolean, text)',
    'private.red_lane_note_failure(uuid, text, text)', 'private.rota_on_call_competent(uuid, boolean)'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then raise exception 'W-03: anon can execute %', v_fn; end if;
  end loop;
  foreach v_fn in array array[
    'private.chain_canary_red_tick()', 'private.chain_canary_start_red()', 'private.chain_canary_evaluate_red(uuid)', 'private.sweep_red_dead_letters()',
    'private.rota_coverage(uuid, boolean, timestamptz)', 'private.sole_cmo_sunset_sweep()', 'private.ops_desk_assign(uuid, text, uuid)',
    'private.set_red_switch(text, boolean, text)', 'private.red_lane_note_failure(uuid, text, text)'] loop
    if has_function_privilege('authenticated', v_fn, 'EXECUTE') then raise exception 'W-03: authenticated can execute %', v_fn; end if;
  end loop;
  if has_table_privilege('authenticated', 'public.chain_canary_red_runs', 'INSERT') or has_table_privilege('authenticated', 'public.page_phone_fallbacks', 'INSERT')
     or has_table_privilege('authenticated', 'public.red_dead_letter_pages', 'UPDATE') or has_table_privilege('authenticated', 'public.chain_canary_red_config', 'UPDATE')
     or has_table_privilege('authenticated', 'public.red_ladder_switch_history', 'INSERT') or has_table_privilege('anon', 'public.rota_cover_policy', 'SELECT') then
    raise exception 'W-03: table grants are too wide';
  end if;
  if (select count(*) from cron.job where jobname = 'chain-canary-red' and schedule = '*/3 * * * *') <> 1
     or (select count(*) from cron.job where jobname = 'chain-canary' and schedule = '11,41 * * * *') <> 1
     or (select count(*) from cron.job where jobname = 'red-dead-letter-sweep') <> 1 then
    raise exception 'W-03: cron jobs are not as expected';
  end if;
  if (select red_lane_enabled or dead_letter_paging_enabled from public.chain_canary_red_config) then raise exception 'W-03: must ship OFF'; end if;
  if pg_get_functiondef('private.ops_desk_assign(uuid, text, uuid)'::regprocedure) not like '%on_call_ops_desk_dead_letter%' then raise exception 'W-03: ops_desk_assign was not replaced'; end if;
  if pg_get_functiondef('private.sole_cmo_exception_active(uuid, text, uuid)'::regprocedure) not like '%sole_cmo_sunset_end%' then raise exception 'W-03: sole_cmo_exception_active was not replaced'; end if;
end $$;
