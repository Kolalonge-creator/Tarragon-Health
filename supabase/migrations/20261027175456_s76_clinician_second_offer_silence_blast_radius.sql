-- S76 gap closure, clinician DB track (spec 23.2, 23.3, silence-as-signal, threshold blast-radius preview). ALL DARK.
--
-- WHAT THIS ADDS
--   * clinician_loop_config: versioned, PROPOSED, born INACTIVE and unsigned (INV-16). Only public.sign_clinician_loop_config() (CMO) can make a
--     version active; an active row is never edited. Every sweep below also sits behind its own go-live guard, seeded OFF, so nothing here
--     changes live behaviour: with no signed config each sweep returns {"skipped": ...} and writes nothing, and with a config but the guard off
--     it still touches only test patients (the same test-pair pass the other guards use).
--   * 23.3 second-clinician re-offer: private.reoffer_unacknowledged_tasks(). A task still unclaimed after the configured minutes for its class
--     is explicitly re-offered to ONE different qualifying clinician (not anyone who already had it, handed it back or claimed it; competency,
--     tier, leave, conflict and working hours all respected), recorded in clinical_task_reoffers, and the clinician is told in-app. The existing
--     priority promotion and the CMO escalation alert are NOT touched (sweep_clinical_tasks is unchanged). Class 1 (red) never goes through this:
--     red has its own paging ladder (INV-05). No second clinician available is recorded and audited, never silent.
--   * 23.2 producers: the audit found symptom_review (S60/S59/S63), therapy worsening (S63) and wellbeing follow-up (S56, guard
--     mental_health_follow_up_enabled) ALREADY create tasks, and device_rhythm_review has its own RPC. The one source with no producer is the device
--     fault report, so that gets a trigger (guard device_alert_task_enabled, task type device_alert_review). The task carries ids only, no text.
--   * Silence-as-signal: private.sweep_reading_silence(). An ENROLLED patient who was recording regularly and has now recorded nothing for
--     silence_days becomes a task of type silence_check at priority class 5 (amber at most; the sweep refuses to run if the type were ever set to
--     class 3 or lower). It NEVER contacts the patient: nothing is written to any notification channel.
--   * Threshold blast-radius preview: public.threshold_blast_radius_preview(). CMO or admin only, read-only, audited. Replays the last N days of
--     readings against a proposed threshold and returns aggregate counts of people flagged now / under the proposal, gained and lost, through
--     private.suppress_cell (the single min-cell rule). No identifiers; test accounts excluded unless asked.
--   Counts before writing (live, read-only 2026-10-27): task_types has no silence_check / device_alert_review; go_live_guards has none of the
--   three keys.
--   NOT done: go_live_conditions is not patched (an unknown key has no conditions), so the real second gate is the CMO signing a config version;
--   a sweep needs BOTH a signed config and (for real patients) the guard on. No pg_cron job is scheduled here.

-- 1. Config -----------------------------------------------------------------------------------------------------------
create table public.clinician_loop_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique check (version >= 1),
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  signed_by      uuid references public.profiles (id) on delete restrict,
  signed_at      timestamptz,
  sign_note      text,
  created_at     timestamptz not null default now(),
  constraint clinician_loop_config_active_is_signed check (not is_active or (signed_by is not null and signed_at is not null))
);
create unique index clinician_loop_config_one_active on public.clinician_loop_config (is_active) where is_active;
comment on table public.clinician_loop_config is
  'S76 gap closure (INV-16): PROPOSED re-offer minutes by class, silence window and blast-radius lookback. Active only after the CMO signs it.';

-- loop-config-begin
insert into public.clinician_loop_config (version, is_active, effective_from, rules) values (1, false, '2026-10-27', $json$
{
  "reoffer_after_minutes": {"2": 15, "3": 30, "4": 60, "5": 240, "6": 480, "7": 720, "8": 1440, "9": 1440},
  "reoffer_max": 1,
  "silence_days": 5,
  "silence_lookback_days": 30,
  "silence_min_prior_readings": 3,
  "silence_recheck_days": 7,
  "blast_lookback_days": 30
}
$json$::jsonb);
-- loop-config-end

create function private.clinician_loop_config_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'a loop config version is never deleted' using errcode = '42501'; end if;
  if tg_op = 'INSERT' then
    if new.is_active or new.signed_by is not null then raise exception 'a loop config version is created unsigned and inactive' using errcode = '42501'; end if;
    return new;
  end if;
  if new.rules is distinct from old.rules or new.version is distinct from old.version then
    raise exception 'a loop config version is never edited: add a new version' using errcode = '42501';
  end if;
  if (new.is_active, new.signed_by, new.signed_at) is distinct from (old.is_active, old.signed_by, old.signed_at)
     and coalesce(current_setting('tarragon.loop_config_sign', true), '') <> 'on' then
    raise exception 'a loop config version changes only through sign_clinician_loop_config()' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.clinician_loop_config_guard() from public, anon, authenticated;
create trigger clinician_loop_config_guard before insert or update or delete on public.clinician_loop_config
  for each row execute function private.clinician_loop_config_guard();

alter table public.clinician_loop_config enable row level security;
revoke all on public.clinician_loop_config from public, anon, authenticated;
grant select on public.clinician_loop_config to authenticated;
create policy clinician_loop_config_read on public.clinician_loop_config for select to authenticated
  using (private.credential_is_cmo() or private.is_admin());

create function public.sign_clinician_loop_config(p_version integer, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.clinician_loop_config%rowtype;
begin
  if not private.credential_is_cmo() then raise exception 'only the Chief Medical Officer can sign the loop config' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'say what was checked, in a sentence' using errcode = '22023'; end if;
  select * into c from public.clinician_loop_config where version = p_version for update;
  if not found or c.is_active or c.signed_at is not null then raise exception 'only an unsigned version can be signed' using errcode = '22023'; end if;
  perform set_config('tarragon.loop_config_sign', 'on', true);
  update public.clinician_loop_config set is_active = false where is_active;
  update public.clinician_loop_config set is_active = true, signed_by = (select auth.uid()), signed_at = now(), sign_note = btrim(p_note) where id = c.id;
  perform set_config('tarragon.loop_config_sign', 'off', true);
  perform private.log_audit('clinician_loop_config.signed', 'clinician_loop_config', c.id, jsonb_build_object('version', p_version));
end $$;
revoke all on function public.sign_clinician_loop_config(integer, text) from public, anon;
grant execute on function public.sign_clinician_loop_config(integer, text) to authenticated;

-- read-only preview only: the signed value, else the newest proposed one
create function private.loop_setting_or_proposed(p_key text) returns jsonb language sql stable security definer set search_path = ''
as $$ select rules -> p_key from public.clinician_loop_config order by is_active desc, version desc limit 1; $$;
revoke all on function private.loop_setting_or_proposed(text) from public, anon, authenticated;

-- 2. Guards (all OFF) -------------------------------------------------------------------------------------------------
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('task_reoffer_enabled', 'Second-clinician re-offer', 'Re-offering an unclaimed task to a second clinician',
   'CMO has signed a clinician_loop_config version with the re-offer minutes', 'cmo', array['reoffer_unacknowledged_tasks'],
   'Red (class 1) tasks never use it. Priority promotion and the CMO escalation alert are unchanged.'),
  ('device_alert_task_enabled', 'Device fault tasks', 'Creating a queue task from a device fault report',
   'CMO has confirmed the device_alert_review task type', 'cmo', array['device_fault_report_task'],
   'The older fault-report handling is unchanged.'),
  ('silence_signal_enabled', 'Reading-silence queue signal', 'Raising an amber queue task when an enrolled patient stops recording',
   'CMO has signed a clinician_loop_config version with the silence window and confirmed silence_check', 'cmo', array['sweep_reading_silence'],
   'Never contacts the patient and never red.')
on conflict (key) do nothing;

-- 3. Task types (PROPOSED, need the CMO's confirmation) ---------------------------------------------------------------
insert into public.task_types
  (code, version, priority_class, default_due_minutes, min_doctor_tier, required_competencies, lead_window_minutes, claim_timeout_minutes,
   pushable, creatable, source_task_keys, needs_confirmation, note)
values
  ('silence_check', 1, 5, 2880, 'care_coordinator', '{}', 0, 60, false, true, '{}', true,
   'S76 gap closure: an enrolled patient who was recording has gone quiet. Amber at most. Never contacts the patient on its own. PROPOSED, awaiting CMO confirmation.'),
  ('device_alert_review', 1, 8, 2880, 'care_coordinator', '{}', 0, 60, false, true, '{}', true,
   'S76 gap closure: a patient reported a fault with a device that feeds their monitoring. Ids only, no text. PROPOSED, awaiting CMO confirmation.')
on conflict do nothing;

-- 4. Re-offer ---------------------------------------------------------------------------------------------------------
create table public.clinical_task_reoffers (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  task_id         uuid not null references public.clinical_tasks (id) on delete cascade,
  offered_to      uuid references public.profiles (id) on delete restrict,
  previous_ids    uuid[] not null default '{}',
  attempt         integer not null default 1,
  outcome         text not null check (outcome in ('offered', 'no_second_clinician')),
  config_version  integer,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint clinical_task_reoffers_offered_has_target check (outcome <> 'offered' or offered_to is not null)
);
create index clinical_task_reoffers_task on public.clinical_task_reoffers (task_id, created_at);
create index clinical_task_reoffers_to on public.clinical_task_reoffers (offered_to) where offered_to is not null;
alter table public.clinical_task_reoffers enable row level security;
revoke all on public.clinical_task_reoffers from public, anon, authenticated;
grant select on public.clinical_task_reoffers to authenticated;
-- no patient data in the row; the offeree and the CMO read it. Nobody writes it except the sweep.
create policy clinical_task_reoffers_read on public.clinical_task_reoffers for select to authenticated
  using (offered_to = (select auth.uid()) or private.credential_is_cmo());

create function private.reoffer_unacknowledged_tasks() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record; v_pick uuid; v_prev uuid[]; v_mins integer; v_max integer; v_n integer;
  v_ver integer; v_offered integer := 0; v_none integer := 0; v_errors integer := 0;
  v_rules jsonb;
begin
  select version, rules into v_ver, v_rules from public.clinician_loop_config where is_active;
  if v_rules is null then return jsonb_build_object('skipped', 'no signed config'); end if;
  v_max := coalesce((v_rules ->> 'reoffer_max')::integer, 1);
  for r in
    select ct.*, coalesce((select max(ro.created_at) from public.clinical_task_reoffers ro where ro.task_id = ct.id), ct.created_at) as base_at
      from public.clinical_tasks ct
     where ct.state in ('offered_to_lead', 'open', 'escalated')
       and ct.priority_class > 1 and ct.priority_class_original > 1
  loop
    begin
      continue when not private.go_live_open_patient('task_reoffer_enabled', r.patient_id);
      v_mins := (v_rules -> 'reoffer_after_minutes' ->> r.priority_class::text)::integer;
      continue when v_mins is null or r.base_at > now() - make_interval(mins => v_mins);
      select count(*) into v_n from public.clinical_task_reoffers where task_id = r.id and outcome = 'offered';
      continue when v_n >= v_max;
      v_prev := array(select distinct x from (
          select r.lead_clinician_id as x union all select r.pushed_to
          union all select actor_id from public.clinical_task_transitions where task_id = r.id and to_state = 'claimed'
          union all select h.clinician_id from public.task_handbacks h where h.task_id = r.id
          union all select ro.offered_to from public.clinical_task_reoffers ro where ro.task_id = r.id) s where x is not null);
      select cs.profile_id into v_pick
        from public.clinical_staff cs join public.profiles p on p.id = cs.profile_id
       where cs.organisation_id = r.organisation_id and cs.is_test = r.is_test and cs.active and cs.status = 'active'
         and cs.profile_id is not null and p.is_active
         and cs.profile_id <> r.patient_id and not (cs.profile_id = any (v_prev))
         and cs.doctor_tier is not null and private.doctor_tier_rank(cs.doctor_tier) >= private.doctor_tier_rank(r.min_tier)
         and private.clinician_is_eligible(cs.profile_id)
         and r.required_competencies <@ coalesce((select array_agg(cc.competency_code) from public.clinician_competencies cc
                                                   where cc.clinical_staff_id = cs.id and cc.revoked_at is null), '{}'::text[])
         and not private.has_conflict(cs.profile_id, r.patient_id)
         and not private.clinician_on_leave(cs.profile_id)
         and private.clinician_offerable(cs.profile_id, now(), now() + interval '2 hours')
       order by private.clinician_deprioritised_now(cs.profile_id),
                (select count(*) from public.clinical_task_reoffers ro where ro.offered_to = cs.profile_id and ro.created_at > now() - interval '1 day'),
                cs.profile_id
       limit 1;
      if v_pick is null then
        insert into public.clinical_task_reoffers (organisation_id, task_id, previous_ids, attempt, outcome, config_version, is_test)
          values (r.organisation_id, r.id, v_prev, v_n + 1, 'no_second_clinician', v_ver, r.is_test);
        insert into public.audit_log (organisation_id, action, entity_type, entity_id, event, subject_patient_id)
          values (r.organisation_id, 'clinical_task.reoffer_no_candidate', 'clinical_task', r.id, jsonb_build_object('class', r.priority_class), r.patient_id);
        v_none := v_none + 1;
      else
        insert into public.clinical_task_reoffers (organisation_id, task_id, offered_to, previous_ids, attempt, outcome, config_version, is_test)
          values (r.organisation_id, r.id, v_pick, v_prev, v_n + 1, 'offered', v_ver, r.is_test);
        insert into public.audit_log (organisation_id, action, entity_type, entity_id, event, subject_patient_id)
          values (r.organisation_id, 'clinical_task.reoffered', 'clinical_task', r.id, jsonb_build_object('class', r.priority_class, 'attempt', v_n + 1), r.patient_id);
        begin
          insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
          values (v_pick, r.organisation_id, 'in_app', 'queue_backlog_notice', jsonb_build_object('task_id', r.id), 'pending', 'non_clinical', 'routine', 'clinical_tasks', r.id);
        exception when others then
          insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
            values (r.organisation_id, 'clinical_task.reoffer_notify_failed', 'clinical_task', r.id, jsonb_build_object('error', sqlerrm));
        end;
        v_offered := v_offered + 1;
      end if;
    exception when others then
      v_errors := v_errors + 1;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (r.organisation_id, 'clinical_task_reoffer.error', 'clinical_task', r.id, jsonb_build_object('error', sqlerrm));
    end;
  end loop;
  if v_errors > 0 then
    perform private.page_incident(null, 'clinical_task_reoffer', 'Second-clinician re-offer failed for some tasks',
      format('%s task(s) could not be re-offered; see audit_log action clinical_task_reoffer.error. The CMO escalation alert is unaffected.', v_errors));
  end if;
  return jsonb_build_object('offered', v_offered, 'no_second_clinician', v_none, 'errors', v_errors);
end $$;
revoke all on function private.reoffer_unacknowledged_tasks() from public, anon, authenticated;

-- what has been re-offered to me and is still live (the queue screen can show it)
create function public.queue_my_reoffers() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('task_id', ct.id, 'type', ct.type, 'priority_class', ct.priority_class,
           'due_at', ct.due_at, 'offered_at', ro.created_at) order by ct.priority_class, ct.due_at), '[]'::jsonb)
    from public.clinical_task_reoffers ro join public.clinical_tasks ct on ct.id = ro.task_id
   where ro.offered_to = (select auth.uid()) and ro.outcome = 'offered' and ct.state in ('open', 'escalated', 'offered_to_lead');
$$;
revoke all on function public.queue_my_reoffers() from public, anon;
grant execute on function public.queue_my_reoffers() to authenticated;

-- 5. Device fault producer --------------------------------------------------------------------------------------------
create function private.device_fault_report_task() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.go_live_open_patient('device_alert_task_enabled', new.patient_id) then return new; end if;
  begin
    perform private.create_clinical_task(new.patient_id, 'device_alert_review', null, 'device_fault:' || new.id);
  exception when others then
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (new.organisation_id, 'device_fault_task.error', 'device_fault_report', new.id, jsonb_build_object('error', sqlerrm));
    perform private.page_incident(new.organisation_id, 'device_fault_task_failed:' || new.id, 'A device fault task could not be created',
      'A task for a device fault report failed; see audit_log action device_fault_task.error. The fault report itself is saved.');
  end;
  return new;
end $$;
revoke all on function private.device_fault_report_task() from public, anon, authenticated;
create trigger device_fault_reports_task after insert on public.device_fault_reports
  for each row execute function private.device_fault_report_task();

-- 6. Silence-as-signal ------------------------------------------------------------------------------------------------
create function private.sweep_reading_silence() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record; v_rules jsonb; v_days integer; v_look integer; v_prior integer; v_recheck integer; v_class smallint; v_made integer := 0; v_errors integer := 0;
begin
  select rules into v_rules from public.clinician_loop_config where is_active;
  if v_rules is null then return jsonb_build_object('skipped', 'no signed config'); end if;
  select priority_class into v_class from public.task_types where code = 'silence_check' and is_active;
  if v_class is null or v_class < 4 then
    -- never red, never even an urgent amber: refuse rather than raise a task above amber
    return jsonb_build_object('skipped', 'silence_check missing or above amber');
  end if;
  v_days := (v_rules ->> 'silence_days')::integer; v_look := (v_rules ->> 'silence_lookback_days')::integer;
  v_prior := (v_rules ->> 'silence_min_prior_readings')::integer; v_recheck := (v_rules ->> 'silence_recheck_days')::integer;
  if v_days is null or v_look is null or v_prior is null or v_recheck is null then return jsonb_build_object('skipped', 'config incomplete'); end if;
  for r in
    select distinct e.patient_id, p.organisation_id
      from public.chronic_programme_enrolments e join public.profiles p on p.id = e.patient_id
     where e.status = 'enrolled' and e.enrolled_at <= now() - make_interval(days => v_days)
       and p.role = 'patient' and p.is_active
       and not exists (select 1 from private.vitals_readings_current v where v.patient_id = e.patient_id
                        and v.taken_at >= now() - make_interval(days => v_days))
       and (select count(*) from private.vitals_readings_current v where v.patient_id = e.patient_id
                and v.taken_at >= now() - make_interval(days => v_look) and v.taken_at < now() - make_interval(days => v_days)) >= v_prior
       and not exists (select 1 from public.clinical_tasks t where t.patient_id = e.patient_id and t.type = 'silence_check' and t.state not in ('completed', 'cancelled'))
       and not exists (select 1 from public.clinical_tasks t where t.patient_id = e.patient_id and t.type = 'silence_check'
                        and t.created_at > now() - make_interval(days => v_recheck))
  loop
    begin
      continue when not private.go_live_open_patient('silence_signal_enabled', r.patient_id);
      perform private.create_clinical_task(r.patient_id, 'silence_check', null, 'silence:' || r.patient_id);
      v_made := v_made + 1;
    exception when others then
      v_errors := v_errors + 1;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (r.organisation_id, 'silence_sweep.error', 'profile', r.patient_id, jsonb_build_object('error', sqlerrm));
    end;
  end loop;
  return jsonb_build_object('created', v_made, 'errors', v_errors);
end $$;
revoke all on function private.sweep_reading_silence() from public, anon, authenticated;

-- 7. Threshold blast-radius preview -----------------------------------------------------------------------------------
create function public.threshold_blast_radius_preview(p_metric text, p_direction text, p_current numeric, p_proposed numeric, p_include_test boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := private.caller_org(); v_days integer; v_n bigint; v_cur bigint; v_prop bigint; v_gain bigint; v_lost bigint;
  v_sup text; v_op text;
begin
  if (select auth.uid()) is null or not (private.credential_is_cmo() or private.is_admin()) then
    raise exception 'only the Chief Medical Officer or an admin can preview a threshold' using errcode = '42501';
  end if;
  if p_metric not in ('systolic', 'diastolic', 'glucose_mmol_l', 'pulse_bpm', 'spo2_pct', 'temperature_c') then
    raise exception 'unknown metric' using errcode = '22023';
  end if;
  if p_direction not in ('gte', 'lte') or p_current is null or p_proposed is null then
    raise exception 'direction gte or lte and both values are required' using errcode = '22023';
  end if;
  v_days := coalesce((private.loop_setting_or_proposed('blast_lookback_days') #>> '{}')::integer, 30);
  v_op := case p_direction when 'gte' then '>=' else '<=' end;
  -- the metric name is checked against the fixed list above, then quoted as an identifier
  execute format($q$
    with w as (
      select v.patient_id,
             bool_or(v.%1$I %2$s $1) as cur_flag,
             bool_or(v.%1$I %2$s $2) as prop_flag
        from private.vitals_readings_current v join public.profiles p on p.id = v.patient_id
       where p.organisation_id = $3 and v.%1$I is not null
         and v.taken_at >= now() - make_interval(days => $4)
         and ($5 or not p.is_test)
       group by v.patient_id)
    select count(*), count(*) filter (where cur_flag), count(*) filter (where prop_flag),
           count(*) filter (where prop_flag and not cur_flag), count(*) filter (where cur_flag and not prop_flag) from w$q$,
    p_metric, v_op)
    into v_n, v_cur, v_prop, v_gain, v_lost
    using p_current, p_proposed, v_org, v_days, p_include_test;
  v_sup := private.suppress_cell(v_n, array[v_cur, v_prop, v_gain, v_lost]);
  perform private.log_audit('threshold_blast_radius.previewed', 'clinician_loop_config', null,
    jsonb_build_object('metric', p_metric, 'direction', p_direction, 'suppressed', v_sup is not null));
  if v_sup is not null then
    return jsonb_build_object('suppressed', true, 'reason', v_sup, 'lookback_days', v_days);
  end if;
  return jsonb_build_object('suppressed', false, 'lookback_days', v_days, 'people_with_readings', v_n, 'flagged_now', v_cur,
    'flagged_proposed', v_prop, 'newly_flagged', v_gain, 'no_longer_flagged', v_lost);
end $$;
revoke all on function public.threshold_blast_radius_preview(text, text, numeric, numeric, boolean) from public, anon;
grant execute on function public.threshold_blast_radius_preview(text, text, numeric, numeric, boolean) to authenticated;

-- 8. Self-check ---------------------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.go_live_guards where key in ('task_reoffer_enabled', 'device_alert_task_enabled', 'silence_signal_enabled') and is_on) then
    raise exception 'S76: a guard was born on';
  end if;
  if has_function_privilege('anon', 'public.threshold_blast_radius_preview(text,text,numeric,numeric,boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.queue_my_reoffers()', 'EXECUTE')
     or has_function_privilege('anon', 'public.sign_clinician_loop_config(integer,text)', 'EXECUTE') then
    raise exception 'S76: anon can execute a new function';
  end if;
  if exists (select 1 from public.clinician_loop_config where is_active) then raise exception 'S76: a config was born active'; end if;
end $$;
