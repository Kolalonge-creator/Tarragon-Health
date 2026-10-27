-- W-10 AI-001 restricted advisory mode (INNOVATION-BUILD-GAP.md W-10, founder decision D-08, 2026-10-27; revised after review).
--
-- Why: AI-001 (the AI Health Coach) is live, and two of its required evaluation suites ran and failed (clinical accuracy 6/8, fairness 2/4,
-- both over-triage, the safe direction). The founder decided it stays on but RESTRICTED, with a Chief Medical Officer risk acceptance and a
-- dated re-evaluation; if no acceptance is signed within 30 days it switches itself off.
--
-- What "restricted" means (founder answer, 2026-10-27): the ANSWERS are restricted, not the safety alerts. In advisory_only mode every
-- model-written coach answer carries a short fixed note, and a question asking for specific advice about the patient's own medicines, doses
-- or results is sent to the care-team message flow instead of the model. Clinician alerts, the emergency path and the keyword guardrails are
-- unchanged. The app reads restricted_mode from ai_runtime_config; this migration holds the state, the clock and the paper trail.
--
-- This migration restricts NOTHING. A system is restricted only when the CMO or an admin calls set_ai_restricted_mode. Nothing is signed here.
--
--   1. ai_systems: restricted_mode ('none' | 'advisory_only'), restricted_since, restriction_reason, reevaluation_due, restriction_resets.
--   2. ai_risk_acceptances: append-only, signed only by the CMO. At most 90 days (private.ai_acceptance_max_days, the one constant), and
--      30 days when no re-evaluation has been re-run yet (private.ai_acceptance_no_rerun_days). Records the evaluation run it relies on.
--   3. set_ai_restricted_mode: CMO or admin may lift or re-apply. EVERY transition is audit-logged (old and new state, actor), counted in
--      restriction_resets and notified to the CMO (in-app and email, never SMS), because re-applying restarts the 30-day clock.
--   4. private.sweep_ai_restriction_expiry (daily): notices to the CMO at 14, 7 and 2 days left (once each per restriction), and at 30 days
--      with no valid acceptance the system is switched off with the same effects as the kill switch public.set_ai_system_enabled
--      (is_enabled false, lifecycle suspended, disabled_at/by/reason, audit_log row, CMO and admin notices), actor null = the system.
--   5. public.ai_runtime_config gains restricted_mode and reevaluation_due. Derived from the LIVE definition read with pg_get_functiondef on
--      2026-10-27 (md5 eb0fb9a2b0cf0f3dde6b95eaf65f94a1), which has the same body as the last definition in
--      20260829101733_ai_governance_runtime_coverage_and_actor_check.sql. Every existing key is kept; the proof lists them.
--
-- ROLLBACK: restore ai_runtime_config from 20260829101733, unschedule ai-restriction-expiry-sweep, drop the functions and the two new
-- tables, then the ai_systems columns.

-- Constants (one place) -------------------------------------------------------------------------------------------------------
create function private.ai_acceptance_max_days() returns integer language sql immutable as $$ select 90 $$;
create function private.ai_acceptance_no_rerun_days() returns integer language sql immutable as $$ select 30 $$;
revoke all on function private.ai_acceptance_max_days() from public, anon;
revoke all on function private.ai_acceptance_no_rerun_days() from public, anon;
grant execute on function private.ai_acceptance_max_days() to authenticated;
grant execute on function private.ai_acceptance_no_rerun_days() to authenticated;

alter table public.ai_systems
  add column restricted_mode text not null default 'none' check (restricted_mode in ('none', 'advisory_only')),
  add column restricted_since timestamptz,
  add column restriction_reason text,
  add column reevaluation_due date,
  add column restriction_resets integer not null default 0 check (restriction_resets >= 0),
  add constraint ai_systems_restricted_needs_since check (restricted_mode = 'none' or (restricted_since is not null and reevaluation_due is not null));
comment on column public.ai_systems.restricted_mode is
  'W-10: advisory_only means every model answer carries the fixed note and personal medicine, dose and result questions go to the care team. A restricted system with no signed CMO risk acceptance after 30 days is switched off by private.sweep_ai_restriction_expiry.';
comment on column public.ai_systems.restriction_resets is
  'W-10: how many times the restriction was lifted or re-applied. Each re-apply restarts the 30-day clock, so the CMO sees the count.';

-- Acceptances ------------------------------------------------------------------------------------------------------------
create table public.ai_risk_acceptances (
  id                uuid primary key default gen_random_uuid(),
  ai_system_id      uuid not null references public.ai_systems (id) on delete cascade,
  summary           text not null check (char_length(btrim(summary)) >= 20),
  valid_until       date not null,
  evaluation_run_id uuid references public.ai_evaluation_runs (id) on delete restrict,
  no_rerun_yet      boolean not null default false,
  accepted_by       uuid not null references public.profiles (id) on delete restrict,
  accepted_at       timestamptz not null default now(),
  is_test           boolean not null default false,
  constraint ai_risk_acceptances_window check (valid_until > accepted_at::date and valid_until <= accepted_at::date + private.ai_acceptance_max_days()),
  constraint ai_risk_acceptances_rerun_link check ((evaluation_run_id is not null) <> no_rerun_yet)
);
create index ai_risk_acceptances_system_idx on public.ai_risk_acceptances (ai_system_id, accepted_at desc);
comment on table public.ai_risk_acceptances is
  'W-10: a Chief Medical Officer''s signed acceptance of a known AI risk with a dated end. Ties to the re-evaluation run it relies on, or says no re-run has happened yet (shorter validity). Append-only. Written only by sign_ai_risk_acceptance, never by an agent.';
alter table public.ai_risk_acceptances enable row level security;
create policy ai_risk_acceptances_read on public.ai_risk_acceptances for select to authenticated
  using (private.credential_is_cmo() or private.is_admin());
grant select on public.ai_risk_acceptances to authenticated;
revoke insert, update, delete, truncate on public.ai_risk_acceptances from authenticated, anon;

create function private.ai_risk_acceptances_append_only() returns trigger
language plpgsql security definer set search_path = ''
as $$ begin raise exception 'ai_risk_acceptances is append-only' using errcode = '42501'; end $$;
revoke all on function private.ai_risk_acceptances_append_only() from public, anon, authenticated;
create trigger ai_risk_acceptances_no_change before update or delete on public.ai_risk_acceptances
  for each row execute function private.ai_risk_acceptances_append_only();

-- Notices sent, once each per restriction (idempotent) -------------------------------------------------------------------
create table public.ai_restriction_notices (
  id               uuid primary key default gen_random_uuid(),
  ai_system_id     uuid not null references public.ai_systems (id) on delete cascade,
  restricted_since timestamptz not null,
  kind             text not null check (kind in ('days_14', 'days_7', 'days_2', 'switched_off')),
  created_at       timestamptz not null default now(),
  constraint ai_restriction_notices_once unique (ai_system_id, restricted_since, kind)
);
alter table public.ai_restriction_notices enable row level security;
create policy ai_restriction_notices_read on public.ai_restriction_notices for select to authenticated
  using (private.credential_is_cmo() or private.is_admin());
grant select on public.ai_restriction_notices to authenticated;
revoke insert, update, delete, truncate on public.ai_restriction_notices from authenticated, anon;

-- Notify the CMO (and, for a switch-off, admins as the kill switch does): in-app and email, never SMS ---------------------------
create function private.ai_restriction_notify(p_system uuid, p_kind text, p_subject text, p_message text, p_include_admins boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  s record;
  r record;
  c text;
begin
  select id, system_code, name into s from public.ai_systems where id = p_system;
  if s.id is null then return; end if;
  for r in
    select distinct x.pid, p.organisation_id
      from (
        select cs.profile_id as pid from public.clinical_staff cs
         where cs.active and cs.doctor_tier = 'chief_medical_officer' and cs.profile_id is not null
        union
        select pr.id from public.profiles pr where p_include_admins and pr.role = 'admin'
      ) x
      join public.profiles p on p.id = x.pid
  loop
    foreach c in array array['in_app', 'email'] loop
      insert into public.notifications
        (organisation_id, recipient_id, channel, status, template, payload, content_class, priority, source_table, source_id)
      values (r.organisation_id, r.pid, c::public.notification_channel, 'pending', 'ai_restriction_notice',
        jsonb_build_object('subject', p_subject, 'message', p_message, 'kind', p_kind, 'system_code', s.system_code, 'ai_system', s.name),
        'non_clinical', 'routine', 'ai_systems', s.id);
    end loop;
  end loop;
end $$;
revoke all on function private.ai_restriction_notify(uuid, text, text, text, boolean) from public, anon, authenticated;

-- Acceptance signing -----------------------------------------------------------------------------------------------------
create function public.sign_ai_risk_acceptance(
  p_system_code text, p_summary text, p_valid_until date, p_evaluation_run uuid default null, p_no_rerun_yet boolean default false)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  s record;
  v_max integer := private.ai_acceptance_max_days();
  v_short integer := private.ai_acceptance_no_rerun_days();
  v_id uuid;
begin
  if v_uid is null or not private.credential_is_cmo() then
    raise exception 'only the Chief Medical Officer can sign a risk acceptance' using errcode = '42501';
  end if;
  select id, restricted_since into s from public.ai_systems where system_code = p_system_code;
  if s.id is null then raise exception 'AI system not found' using errcode = 'P0002'; end if;
  if p_valid_until is null or p_valid_until <= current_date then
    raise exception 'acceptance_date_not_future: the end date must be after today' using errcode = '22023';
  end if;
  if p_valid_until > current_date + v_max then
    raise exception 'acceptance_too_long: an acceptance can last at most % days', v_max using errcode = '22023';
  end if;
  if (p_evaluation_run is not null) = coalesce(p_no_rerun_yet, false) then
    raise exception 'acceptance_needs_rerun_link: choose a re-evaluation run, or say none has been re-run yet' using errcode = '22023';
  end if;
  if p_evaluation_run is not null then
    if not exists (select 1 from public.ai_evaluation_runs e
                    where e.id = p_evaluation_run and e.ai_system_id = s.id and e.completed_at is not null) then
      raise exception 'acceptance_run_not_found: that is not a completed evaluation run for this system' using errcode = '22023';
    end if;
  elsif p_valid_until > current_date + v_short then
    raise exception 'acceptance_too_long_without_rerun: with no re-evaluation re-run yet an acceptance can last at most % days', v_short using errcode = '22023';
  end if;
  insert into public.ai_risk_acceptances (ai_system_id, summary, valid_until, evaluation_run_id, no_rerun_yet, accepted_by, is_test)
  values (s.id, p_summary, p_valid_until, p_evaluation_run, coalesce(p_no_rerun_yet, false), v_uid,
          coalesce((select is_test from public.profiles where id = v_uid), false))
  returning id into v_id;
  perform private.log_audit('ai.risk_acceptance_signed', 'ai_systems', s.id,
    jsonb_build_object('system_code', p_system_code, 'valid_until', p_valid_until, 'evaluation_run_id', p_evaluation_run, 'no_rerun_yet', coalesce(p_no_rerun_yet, false)));
  return v_id;
end $$;
revoke all on function public.sign_ai_risk_acceptance(text, text, date, uuid, boolean) from public, anon;
grant execute on function public.sign_ai_risk_acceptance(text, text, date, uuid, boolean) to authenticated;

-- Lift or re-apply -------------------------------------------------------------------------------------------------------
create function public.set_ai_restricted_mode(p_system_code text, p_mode text, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  s record;
  v_new record;
begin
  if v_uid is null or not (private.credential_is_cmo() or private.is_admin()) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_mode not in ('none', 'advisory_only') then raise exception 'mode not allowed' using errcode = '22023'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 then raise exception 'a reason of 10 characters or more is required' using errcode = '22023'; end if;
  select * into s from public.ai_systems where system_code = p_system_code for update;
  if s.id is null then raise exception 'AI system not found' using errcode = 'P0002'; end if;
  if s.restricted_mode = p_mode then raise exception 'already in that mode' using errcode = 'P0002'; end if;

  if p_mode = 'advisory_only' then
    update public.ai_systems
       set restricted_mode = 'advisory_only', restricted_since = now(), restriction_reason = btrim(p_reason),
           reevaluation_due = current_date + 30, restriction_resets = restriction_resets + 1, updated_at = now()
     where id = s.id;
  else
    update public.ai_systems
       set restricted_mode = 'none', restricted_since = null, restriction_reason = null, reevaluation_due = null,
           restriction_resets = restriction_resets + 1, updated_at = now()
     where id = s.id;
  end if;
  select restricted_mode, restricted_since, reevaluation_due, restriction_resets into v_new from public.ai_systems where id = s.id;

  perform private.log_audit('ai.restricted_mode_set', 'ai_systems', s.id, jsonb_build_object(
    'system_code', p_system_code,
    'old', jsonb_build_object('mode', s.restricted_mode, 'since', s.restricted_since, 'reevaluation_due', s.reevaluation_due, 'resets', s.restriction_resets),
    'new', jsonb_build_object('mode', v_new.restricted_mode, 'since', v_new.restricted_since, 'reevaluation_due', v_new.reevaluation_due, 'resets', v_new.restriction_resets),
    'reason', btrim(p_reason), 'actor', v_uid));
  perform private.ai_restriction_notify(s.id, 'mode_changed',
    case when p_mode = 'advisory_only' then 'The AI Health Coach restriction was applied' else 'The AI Health Coach restriction was lifted' end,
    case when p_mode = 'advisory_only'
      then 'The AI Health Coach was restricted again. The 30-day clock restarted. This has now happened ' || v_new.restriction_resets || ' time(s). Open the risk acceptance page to see the date.'
      else 'The AI Health Coach restriction was lifted. This has now changed ' || v_new.restriction_resets || ' time(s).' end,
    false);
end $$;
revoke all on function public.set_ai_restricted_mode(text, text, text) from public, anon;
grant execute on function public.set_ai_restricted_mode(text, text, text) to authenticated;

-- Daily sweep ------------------------------------------------------------------------------------------------------------
create function private.sweep_ai_restriction_expiry() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  s record;
  v_switched integer := 0;
  v_left integer;
  v_kind text;
  v_org uuid;
  v_inserted uuid;
  v_reason text;
begin
  select cs.organisation_id into v_org from public.clinical_staff cs
   where cs.active and cs.doctor_tier = 'chief_medical_officer' limit 1;

  for s in
    select * from public.ai_systems x
     where x.restricted_mode = 'advisory_only' and x.is_enabled
       and not exists (
         select 1 from public.ai_risk_acceptances a
          where a.ai_system_id = x.id and a.accepted_at >= x.restricted_since and a.valid_until >= current_date)
  loop
    if s.restricted_since + interval '30 days' <= now() then
      v_reason := 'Switched off automatically: restricted for 30 days with no signed CMO risk acceptance (W-10).';
      -- same effects as public.set_ai_system_enabled(..., false, reason); the actor is the system, so disabled_by stays null
      update public.ai_systems
         set is_enabled = false, lifecycle_status = 'suspended', disabled_at = now(), disabled_by = null, disabled_reason = v_reason, updated_at = now()
       where id = s.id;
      insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
      values (v_org, null, 'ai_system.disabled', 'ai_systems', s.id,
              jsonb_build_object('system_code', s.system_code, 'reason', v_reason, 'by_clinical_staff', null, 'automatic', true, 'restricted_since', s.restricted_since));
      perform private.log_audit('ai.restriction_expired', 'ai_systems', s.id,
        jsonb_build_object('system_code', s.system_code, 'restricted_since', s.restricted_since, 'resets', s.restriction_resets));
      v_inserted := null;
      insert into public.ai_restriction_notices (ai_system_id, restricted_since, kind) values (s.id, s.restricted_since, 'switched_off')
        on conflict do nothing returning id into v_inserted;
      if v_inserted is not null then
        perform private.ai_restriction_notify(s.id, 'switched_off', 'The AI Health Coach was switched off',
          'The AI Health Coach was switched off because it was restricted for 30 days with no signed risk acceptance. Members now see the care-team fallback. Review it on the risk acceptance page.',
          true);
      end if;
      v_switched := v_switched + 1;
    else
      v_left := (s.restricted_since::date + 30) - current_date;
      v_kind := case when v_left <= 2 then 'days_2' when v_left <= 7 then 'days_7' when v_left <= 14 then 'days_14' else null end;
      if v_kind is not null then
        v_inserted := null;
        insert into public.ai_restriction_notices (ai_system_id, restricted_since, kind) values (s.id, s.restricted_since, v_kind)
          on conflict do nothing returning id into v_inserted;
        if v_inserted is not null then
          perform private.ai_restriction_notify(s.id, v_kind, 'The AI Health Coach will switch off in ' || greatest(v_left, 0) || ' days',
            'The AI Health Coach is restricted and will switch itself off in ' || greatest(v_left, 0) || ' days unless you sign a risk acceptance. Open the risk acceptance page to review it.',
            false);
        end if;
      end if;
    end if;
  end loop;
  return v_switched;
end $$;
revoke all on function private.sweep_ai_restriction_expiry() from public, anon, authenticated;
select cron.schedule('ai-restriction-expiry-sweep', '10 3 * * *', $$ select private.sweep_ai_restriction_expiry(); $$);

-- CMO page status: countdown, resets, whether the re-evaluation is overdue, whether this caller may sign -------------------
create function public.ai_restriction_status(p_system_code text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  s record;
  a record;
  v_eval timestamptz;
  v_can_sign boolean := private.credential_is_cmo();
begin
  if not (v_can_sign or private.is_admin()) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select * into s from public.ai_systems where system_code = p_system_code;
  if s.id is null then return null; end if;
  select max(e.completed_at) into v_eval from public.ai_evaluation_runs e
   where e.ai_system_id = s.id and e.completed_at is not null and (s.restricted_since is null or e.completed_at >= s.restricted_since);
  select accepted_at, valid_until, summary, evaluation_run_id, no_rerun_yet into a
    from public.ai_risk_acceptances where ai_system_id = s.id order by accepted_at desc limit 1;
  return jsonb_build_object(
    'system_code', s.system_code, 'name', s.name, 'enabled', s.is_enabled, 'restricted_mode', s.restricted_mode,
    'restricted_since', s.restricted_since, 'restriction_reason', s.restriction_reason, 'reevaluation_due', s.reevaluation_due,
    'restriction_resets', s.restriction_resets, 'disabled_reason', s.disabled_reason,
    'switch_off_on', case when s.restricted_since is null then null else (s.restricted_since::date + 30) end,
    'days_until_switch_off', case when s.restricted_since is null then null else (s.restricted_since::date + 30) - current_date end,
    'latest_evaluation_completed_at', v_eval,
    'reevaluation_overdue', s.restricted_mode = 'advisory_only' and s.reevaluation_due < current_date and v_eval is null,
    'can_sign', v_can_sign,
    'max_acceptance_days', private.ai_acceptance_max_days(),
    'no_rerun_acceptance_days', private.ai_acceptance_no_rerun_days(),
    'acceptance', case when a.accepted_at is null then null
      else jsonb_build_object('accepted_at', a.accepted_at, 'valid_until', a.valid_until, 'summary', a.summary,
                              'evaluation_run_id', a.evaluation_run_id, 'no_rerun_yet', a.no_rerun_yet) end);
end $$;
revoke all on function public.ai_restriction_status(text) from public, anon;
grant execute on function public.ai_restriction_status(text) to authenticated;

-- ai_runtime_config: the live definition (see header) plus two additive keys ------------------------------------------------
create or replace function public.ai_runtime_config(p_system_code text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  s        record;
  v_expect text;
begin
  select * into s from public.ai_systems where system_code = p_system_code;

  if s.id is null then
    return jsonb_build_object('registered', false, 'system_code', p_system_code);
  end if;

  select v.model_identifier into v_expect
  from public.ai_system_versions v
  where v.ai_system_id = s.id and v.approved_at is not null and v.retired_at is null
  order by v.deployed_at desc nulls last, v.approved_at desc
  limit 1;

  return jsonb_build_object(
    'registered', true,
    'system_code', s.system_code,
    'system_id', s.id,
    'name', s.name,
    'enabled', s.is_enabled,
    'runtime_governed', s.runtime_governed,
    'lifecycle_status', s.lifecycle_status,
    'risk_class', s.risk_class,
    'autonomy_level', s.autonomy_level,
    'clinically_meaningful', s.clinically_meaningful,
    'fallback_behaviour', s.fallback_behaviour,
    'disabled_reason', s.disabled_reason,
    'expected_model_identifier', v_expect,
    'prompt', private.active_ai_prompt(p_system_code),
    'guardrails', private.ai_guardrails_for(p_system_code),
    'knowledge_sources', private.approved_ai_knowledge_sources(p_system_code),
    'restricted_mode', s.restricted_mode,
    'reevaluation_due', s.reevaluation_due
  );
end;
$$;

do $$
declare
  k text;
  v_cfg jsonb;
begin
  if has_function_privilege('anon', 'public.sign_ai_risk_acceptance(text,text,date,uuid,boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_ai_restricted_mode(text,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.ai_restriction_status(text)', 'EXECUTE')
     or has_function_privilege('anon', 'private.ai_restriction_notify(uuid,text,text,text,boolean)', 'EXECUTE') then
    raise exception 'self-check: anon can execute a W-10 function';
  end if;
  if has_table_privilege('anon', 'public.ai_risk_acceptances', 'SELECT') or has_table_privilege('authenticated', 'public.ai_risk_acceptances', 'INSERT')
     or has_table_privilege('anon', 'public.ai_restriction_notices', 'SELECT') or has_table_privilege('authenticated', 'public.ai_restriction_notices', 'INSERT') then
    raise exception 'self-check: W-10 table grants are wrong';
  end if;
  if exists (select 1 from public.ai_systems where restricted_mode <> 'none') then
    raise exception 'self-check: a system was restricted by the migration';
  end if;
  v_cfg := public.ai_runtime_config('AI-001');
  foreach k in array array['registered','system_code','system_id','name','enabled','runtime_governed','lifecycle_status','risk_class','autonomy_level',
                           'clinically_meaningful','fallback_behaviour','disabled_reason','expected_model_identifier','prompt','guardrails','knowledge_sources',
                           'restricted_mode','reevaluation_due'] loop
    if not (v_cfg ? k) then raise exception 'self-check: ai_runtime_config lost or lacks key %', k; end if;
  end loop;
  if (v_cfg->>'enabled')::boolean is distinct from (select is_enabled from public.ai_systems where system_code = 'AI-001') then
    raise exception 'self-check: ai_runtime_config enabled flag changed';
  end if;
end $$;
