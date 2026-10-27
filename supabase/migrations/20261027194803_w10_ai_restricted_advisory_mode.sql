-- W-10 AI-001 restricted advisory mode (INNOVATION-BUILD-GAP.md W-10, founder decision D-08, 2026-10-27).
--
-- Why: AI-001 (the AI Health Coach) is live, and two of its required evaluation suites ran and failed (clinical accuracy 6/8, fairness 2/4,
-- both over-triage, the safe direction). The founder decided it stays on but RESTRICTED to advisory display, with a Chief Medical Officer
-- risk acceptance and a dated re-evaluation; if no acceptance is signed within 30 days it switches itself off.
--
-- What AI-001 decides (read from the live registry and the code before this was written):
--   * It answers a patient question and classifies the message into routine / clinician_review / emergency.
--   * clinician_review: opens a clinician_alerts row (logAiCoachReviewFlag). emergency: escalates (alert, escalation, care thread, page).
--   * A deterministic keyword guardrail and the fixed refusal screens (results, dose advice) run BEFORE the model and never need it.
--   In advisory_only mode the model's own clinician_review classification is shown to the patient as before but no longer opens a clinician
--   alert by itself (no automated action). The deterministic guardrail paths and the emergency path are unchanged (over-triage is the safe
--   direction, and an emergency must never wait for a person to notice). Whether the model's own emergency tier should also stop paging is
--   an open founder question, deliberately NOT decided here.
--
-- This migration is OFF by default: no system is restricted until the CMO or an admin calls set_ai_restricted_mode. Nothing is signed here.
--
--   1. ai_systems: restricted_mode ('none' | 'advisory_only', default 'none'), restricted_since, restriction_reason, reevaluation_due.
--   2. ai_risk_acceptances: append-only record the CMO signs (public.sign_ai_risk_acceptance, CMO only).
--   3. public.set_ai_restricted_mode: CMO or admin. advisory_only stamps restricted_since and sets reevaluation_due to 30 days out.
--   4. private.sweep_ai_restriction_expiry (daily): a restricted system with no valid acceptance signed after it was restricted, and 30 days
--      passed, is switched off (is_enabled false, with a reason). Its fallback behaviour then applies, as for any kill switch.
--   5. public.ai_runtime_config gains restricted_mode and reevaluation_due (additive keys; everything else unchanged).
--
-- ROLLBACK: restore ai_runtime_config from 20260829101733 or the live definition, unschedule the job, drop the table, then the columns.

alter table public.ai_systems
  add column restricted_mode text not null default 'none' check (restricted_mode in ('none', 'advisory_only')),
  add column restricted_since timestamptz,
  add column restriction_reason text,
  add column reevaluation_due date,
  add constraint ai_systems_restricted_needs_since check (restricted_mode = 'none' or (restricted_since is not null and reevaluation_due is not null));
comment on column public.ai_systems.restricted_mode is
  'W-10: advisory_only means the system may show its output but must not take an automated action on its own. A restricted system with no signed CMO risk acceptance after 30 days is switched off by private.sweep_ai_restriction_expiry.';

create table public.ai_risk_acceptances (
  id           uuid primary key default gen_random_uuid(),
  ai_system_id uuid not null references public.ai_systems (id) on delete cascade,
  summary      text not null check (char_length(btrim(summary)) >= 20),
  valid_until  date not null,
  accepted_by  uuid not null references public.profiles (id) on delete restrict,
  accepted_at  timestamptz not null default now(),
  is_test      boolean not null default false,
  check (valid_until > accepted_at::date and valid_until <= (accepted_at::date + 180))
);
create index ai_risk_acceptances_system_idx on public.ai_risk_acceptances (ai_system_id, accepted_at desc);
comment on table public.ai_risk_acceptances is
  'W-10: a Chief Medical Officer''s signed acceptance of a known AI risk (for AI-001, over-triage in two required suites) with a dated end. Append-only. Written only by sign_ai_risk_acceptance, never by an agent.';
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

create function public.sign_ai_risk_acceptance(p_system_code text, p_summary text, p_valid_until date)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  s record;
  v_id uuid;
begin
  if v_uid is null or not private.credential_is_cmo() then
    raise exception 'only the Chief Medical Officer can sign a risk acceptance' using errcode = '42501';
  end if;
  select id, restricted_mode into s from public.ai_systems where system_code = p_system_code;
  if s.id is null then raise exception 'AI system not found' using errcode = 'P0002'; end if;
  insert into public.ai_risk_acceptances (ai_system_id, summary, valid_until, accepted_by, is_test)
  values (s.id, p_summary, p_valid_until, v_uid, coalesce((select is_test from public.profiles where id = v_uid), false))
  returning id into v_id;
  perform private.log_audit('ai.risk_acceptance_signed', 'ai_systems', s.id, jsonb_build_object('system_code', p_system_code, 'valid_until', p_valid_until));
  return v_id;
end $$;
revoke all on function public.sign_ai_risk_acceptance(text, text, date) from public, anon;
grant execute on function public.sign_ai_risk_acceptance(text, text, date) to authenticated;

create function public.set_ai_restricted_mode(p_system_code text, p_mode text, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not (private.credential_is_cmo() or private.is_admin()) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_mode not in ('none', 'advisory_only') then raise exception 'mode not allowed' using errcode = '22023'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 then raise exception 'a reason of 10 characters or more is required' using errcode = '22023'; end if;
  if p_mode = 'advisory_only' then
    update public.ai_systems
       set restricted_mode = 'advisory_only', restricted_since = now(), restriction_reason = btrim(p_reason), reevaluation_due = current_date + 30, updated_at = now()
     where system_code = p_system_code and restricted_mode = 'none';
  else
    update public.ai_systems
       set restricted_mode = 'none', restricted_since = null, restriction_reason = null, reevaluation_due = null, updated_at = now()
     where system_code = p_system_code;
  end if;
  if not found then raise exception 'no change made (unknown system, or already in that mode)' using errcode = 'P0002'; end if;
  perform private.log_audit('ai.restricted_mode_set', 'ai_systems', (select id from public.ai_systems where system_code = p_system_code),
    jsonb_build_object('system_code', p_system_code, 'mode', p_mode));
end $$;
revoke all on function public.set_ai_restricted_mode(text, text, text) from public, anon;
grant execute on function public.set_ai_restricted_mode(text, text, text) to authenticated;

-- Daily: restricted for 30 days with no acceptance signed since it was restricted (and still in date) means switch it off.
create function private.sweep_ai_restriction_expiry() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  with due as (
    select s.id from public.ai_systems s
     where s.restricted_mode = 'advisory_only' and s.is_enabled
       and s.restricted_since + interval '30 days' <= now()
       and not exists (
         select 1 from public.ai_risk_acceptances a
          where a.ai_system_id = s.id and a.accepted_at >= s.restricted_since and a.valid_until >= current_date)
  )
  update public.ai_systems s
     set is_enabled = false, disabled_at = now(),
         disabled_reason = 'Switched off automatically: restricted to advisory display for 30 days with no signed risk acceptance (W-10).',
         updated_at = now()
    from due where s.id = due.id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;
revoke all on function private.sweep_ai_restriction_expiry() from public, anon, authenticated;
select cron.schedule('ai-restriction-expiry-sweep', '10 3 * * *', $$ select private.sweep_ai_restriction_expiry(); $$);

-- What the CMO page shows: restriction state, the dated re-evaluation, days left, and the latest acceptance (no patient data anywhere).
create function public.ai_restriction_status(p_system_code text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  s record;
  a record;
begin
  if not (private.credential_is_cmo() or private.is_admin()) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select id, system_code, name, is_enabled, restricted_mode, restricted_since, restriction_reason, reevaluation_due, disabled_reason
    into s from public.ai_systems where system_code = p_system_code;
  if s.id is null then return null; end if;
  select accepted_at, valid_until, summary into a from public.ai_risk_acceptances where ai_system_id = s.id order by accepted_at desc limit 1;
  return jsonb_build_object(
    'system_code', s.system_code, 'name', s.name, 'enabled', s.is_enabled, 'restricted_mode', s.restricted_mode,
    'restricted_since', s.restricted_since, 'restriction_reason', s.restriction_reason, 'reevaluation_due', s.reevaluation_due,
    'disabled_reason', s.disabled_reason,
    'acceptance', case when a.accepted_at is null then null
      else jsonb_build_object('accepted_at', a.accepted_at, 'valid_until', a.valid_until, 'summary', a.summary) end);
end $$;
revoke all on function public.ai_restriction_status(text) from public, anon;
grant execute on function public.ai_restriction_status(text) to authenticated;

-- ai_runtime_config: the live definition plus two additive keys.
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
begin
  if has_function_privilege('anon', 'public.sign_ai_risk_acceptance(text,text,date)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_ai_restricted_mode(text,text,text)', 'EXECUTE') then
    raise exception 'self-check: anon can execute a W-10 function';
  end if;
  if has_table_privilege('anon', 'public.ai_risk_acceptances', 'SELECT') or has_table_privilege('authenticated', 'public.ai_risk_acceptances', 'INSERT') then
    raise exception 'self-check: ai_risk_acceptances grants are wrong';
  end if;
  -- nothing may be restricted by this migration
  if exists (select 1 from public.ai_systems where restricted_mode <> 'none') then
    raise exception 'self-check: a system was restricted by the migration';
  end if;
  if not (public.ai_runtime_config('AI-001') ? 'restricted_mode') then
    raise exception 'self-check: ai_runtime_config lacks restricted_mode';
  end if;
  if (public.ai_runtime_config('AI-001')->>'enabled')::boolean is distinct from (select is_enabled from public.ai_systems where system_code = 'AI-001') then
    raise exception 'self-check: ai_runtime_config enabled flag changed';
  end if;
end $$;
