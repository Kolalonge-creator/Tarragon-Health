-- S80d (Module 25.10): a monthly scheduler for the AI review sample that stays INERT until the CMO signs, risk-weighted sampling, and a
-- monitoring overview.
--
-- WHAT THIS ADDS
--   1. ai_monitoring_config: versioned sampling rules, PROPOSED, born UNSIGNED and INACTIVE (same shape as outcome_cascade_config). Only the
--      Chief Medical Officer's sign_ai_monitoring_config() activates a version. Mirrored in the code registry as `ai.monitoring_rules`
--      (a drift test compares the two). The sample rate in it equals `ai.review_sample_rate` (decision 6, unsigned) and a test checks that too.
--   2. private.draw_ai_review_sample_core(): the S80c draw, now with three always-sampled risk groups, applied ONLY when signed rules are passed:
--        risk_emergency  conversations that touched an emergency or doctor-escalation grade
--        risk_reported   answers a patient reported as wrong (an ai_safety_incidents row from a patient), counted when the report was filed in
--                        the month even if the answer is older
--        risk_cost_spike an interaction whose tokens are at least `min_tokens` and more than `factor` times the median for that system that month
--      then the flagged answers, then the stratified random share at the signed rate. Test accounts are never drawn (INV-13). With no rules
--      (nothing signed) it behaves exactly as S80c did.
--   3. private.run_ai_review_sample_schedule() + a pg_cron job on the 1st of each month: draws LAST month's sample, once (ai_review_sample_runs
--      is unique per month), and does NOTHING until a signed active ai_monitoring_config exists. Applying this migration therefore changes nothing.
--   4. public.ai_monitoring_overview(): scheduler status, the month's sample counts by rule, and the answers patients reported (admin or CMO).
--      No model price is loaded here: ai_model_prices stays empty until the CMO or finance enters a price.
-- public.draw_ai_review_sample keeps its signature and its caller check; it now passes the active signed rules, when there are any.
--
-- Counts at write time: ai_review_samples rows keep their existing sampled_by_rule values ('stratified', 'flagged'); the check constraint only
-- gains the three new values, so no row is converted.

-- ---------------------------------------------------------------------------
-- 1. Configuration (versioned, PROPOSED, CMO owned, unsigned)
-- ---------------------------------------------------------------------------
create table public.ai_monitoring_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique check (version >= 1),
  is_active      boolean not null default false,
  owner          text not null default 'CMO',
  effective_from date not null,
  config         jsonb not null check (jsonb_typeof(config) = 'object'),
  note           text,
  approved_at    timestamptz,
  approved_by    uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint ai_monitoring_config_active_is_signed check (not is_active or (approved_at is not null and approved_by is not null))
);
create unique index ai_monitoring_config_one_active on public.ai_monitoring_config (is_active) where is_active;
create index ai_monitoring_config_approved_by_idx on public.ai_monitoring_config (approved_by) where approved_by is not null;
alter table public.ai_monitoring_config enable row level security;
revoke all on public.ai_monitoring_config from public, anon, authenticated;
grant select on public.ai_monitoring_config to authenticated;
create policy ai_monitoring_config_read on public.ai_monitoring_config for select to authenticated
  using (private.credential_is_cmo() or private.is_admin());

create function private.ai_monitoring_config_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'ai_monitoring_config version % is never deleted', old.version using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if new.is_active or new.approved_at is not null then
      raise exception 'an AI monitoring config is created unsigned and inactive' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.config is distinct from old.config or new.version is distinct from old.version then
    raise exception 'an AI monitoring config is never edited: add a new version' using errcode = '23514';
  end if;
  if old.approved_at is not null and (new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by) then
    raise exception 'a signed config keeps its signature' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.ai_monitoring_config_guard() from public, anon, authenticated;
create trigger ai_monitoring_config_guard before insert or update or delete on public.ai_monitoring_config
  for each row execute function private.ai_monitoring_config_guard();
create trigger refuse_superseded_activation before update of is_active on public.ai_monitoring_config
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();

-- ai-monitoring-v1-begin
insert into public.ai_monitoring_config (version, is_active, effective_from, config, note) values (1, false, '2026-10-27', $json${
  "sample_rate": 0.05,
  "always_sample": ["emergency_touching", "patient_reported", "cost_spike"],
  "cost_spike": { "factor": 3, "min_tokens": 4000 }
}$json$::jsonb, 'PROPOSED, v1, UNSIGNED, INACTIVE (S80d). Owner: CMO. Monthly AI review sample: the 5 percent random share (decision 6) plus always-sampled emergency-touching conversations, patient-reported wrong answers and cost spikes. The monthly draw does nothing until the CMO signs this on the sign-off hub.');
-- ai-monitoring-v1-end

create function public.sign_ai_monitoring_config(p_version integer) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.ai_monitoring_config%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can sign the AI monitoring rules' using errcode = '42501'; end if;
  select * into c from public.ai_monitoring_config where version = p_version for update;
  if not found then raise exception 'no such AI monitoring configuration version' using errcode = 'P0002'; end if;
  if c.approved_at is not null then raise exception 'that version is already signed' using errcode = '23514'; end if;
  update public.ai_monitoring_config set is_active = false where is_active and version <> p_version;
  update public.ai_monitoring_config set approved_at = now(), approved_by = (select auth.uid()), is_active = true where version = p_version;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values ((select organisation_id from public.profiles where id = (select auth.uid())), (select auth.uid()), 'ai_monitoring_config.signed',
            'ai_monitoring_config', c.id, jsonb_build_object('version', p_version));
end $$;
revoke all on function public.sign_ai_monitoring_config(integer) from public, anon, authenticated;
grant execute on function public.sign_ai_monitoring_config(integer) to authenticated;

-- The signed rules in force, or NULL. NULL is what keeps the scheduler inert.
create function private.ai_monitoring_rules() returns jsonb
language sql stable security definer set search_path = '' as $$
  select config || jsonb_build_object('_version', version)
    from public.ai_monitoring_config where is_active and approved_at is not null order by version desc limit 1
$$;
revoke all on function private.ai_monitoring_rules() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The draw
-- ---------------------------------------------------------------------------
do $$
declare v_con text;
begin
  select conname into v_con from pg_constraint
   where conrelid = 'public.ai_review_samples'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%sampled_by_rule%';
  if v_con is null then raise exception 'S80d: the sampled_by_rule check was not found'; end if;
  execute format('alter table public.ai_review_samples drop constraint %I', v_con);
  alter table public.ai_review_samples add constraint ai_review_samples_sampled_by_rule_check
    check (sampled_by_rule in ('stratified', 'flagged', 'risk_emergency', 'risk_reported', 'risk_cost_spike'));
end $$;

create function private.draw_ai_review_sample_core(p_month date, p_rate numeric, p_rules jsonb) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_n integer := 0;
  v_m integer;
  v_always jsonb := coalesce(p_rules -> 'always_sample', '[]'::jsonb);
begin
  if p_rate is null or p_rate <= 0 or p_rate > 1 then
    raise exception 'the sampling rate must be above 0 and at most 1 and comes from signed configuration';
  end if;

  if p_rules is not null then
    -- risk group 1: conversations that touched an emergency or doctor-escalation grade
    if v_always ? 'emergency_touching' then
      insert into public.ai_review_samples (organisation_id, interaction_id, ai_system_id, sample_month, sampled_by_rule)
      select l.organisation_id, l.id, l.ai_system_id, v_start, 'risk_emergency'
        from public.ai_interaction_log l left join public.profiles sp on sp.id = l.subject_profile_id
       where l.safety_classification::text in ('emergency', 'doctor_escalation', 'urgent_escalation')
         and coalesce(sp.is_test, false) = false and l.created_at >= v_start and l.created_at < v_end
      on conflict (interaction_id) do nothing;
      get diagnostics v_m = row_count; v_n := v_n + v_m;
    end if;
    -- risk group 2: answers a patient reported as wrong, counted by when the report was filed
    if v_always ? 'patient_reported' then
      insert into public.ai_review_samples (organisation_id, interaction_id, ai_system_id, sample_month, sampled_by_rule)
      select l.organisation_id, l.id, l.ai_system_id, v_start, 'risk_reported'
        from public.ai_interaction_log l left join public.profiles sp on sp.id = l.subject_profile_id
       where coalesce(sp.is_test, false) = false
         and exists (select 1 from public.ai_safety_incidents i
                      where i.interaction_id = l.id and i.reporter_kind = 'patient' and i.created_at >= v_start and i.created_at < v_end)
      on conflict (interaction_id) do nothing;
      get diagnostics v_m = row_count; v_n := v_n + v_m;
    end if;
    -- risk group 3: cost spikes, judged against the same system's median that month
    if v_always ? 'cost_spike' then
      insert into public.ai_review_samples (organisation_id, interaction_id, ai_system_id, sample_month, sampled_by_rule)
      with t as (
        select l.id, l.organisation_id, l.ai_system_id,
               coalesce(l.input_token_count, 0) + coalesce(l.output_token_count, 0) as tokens
          from public.ai_interaction_log l left join public.profiles sp on sp.id = l.subject_profile_id
         where coalesce(sp.is_test, false) = false and l.created_at >= v_start and l.created_at < v_end
      ), med as (
        select ai_system_id, percentile_cont(0.5) within group (order by tokens) as m from t group by ai_system_id
      )
      select t.organisation_id, t.id, t.ai_system_id, v_start, 'risk_cost_spike'
        from t join med on med.ai_system_id = t.ai_system_id
       where t.tokens >= (p_rules #>> '{cost_spike,min_tokens}')::integer
         and t.tokens > med.m * (p_rules #>> '{cost_spike,factor}')::numeric
      on conflict (interaction_id) do nothing;
      get diagnostics v_m = row_count; v_n := v_n + v_m;
    end if;
  end if;

  -- everything flagged for review is always included
  insert into public.ai_review_samples (organisation_id, interaction_id, ai_system_id, sample_month, sampled_by_rule)
  select l.organisation_id, l.id, l.ai_system_id, v_start, 'flagged'
    from public.ai_interaction_log l left join public.profiles sp on sp.id = l.subject_profile_id
   where l.flagged_for_review and coalesce(sp.is_test, false) = false and l.created_at >= v_start and l.created_at < v_end
  on conflict (interaction_id) do nothing;
  get diagnostics v_m = row_count; v_n := v_n + v_m;

  -- the random share: ceil(rate x count) per system, stratified by safety class, once per system per month
  insert into public.ai_review_samples (organisation_id, interaction_id, ai_system_id, sample_month, sampled_by_rule)
  select organisation_id, id, ai_system_id, v_start, 'stratified' from (
    select l.id, l.ai_system_id, l.organisation_id,
           row_number() over (partition by l.ai_system_id, l.safety_classification order by random()) rn,
           count(*) over (partition by l.ai_system_id, l.safety_classification) cnt
      from public.ai_interaction_log l left join public.profiles sp on sp.id = l.subject_profile_id
     where coalesce(sp.is_test, false) = false and not l.flagged_for_review
       and l.created_at >= v_start and l.created_at < v_end
       and not exists (select 1 from public.ai_review_samples d where d.interaction_id = l.id)
       and not exists (select 1 from public.ai_review_samples d where d.ai_system_id = l.ai_system_id
                        and d.sample_month = v_start and d.sampled_by_rule = 'stratified')
  ) x where rn <= ceil(cnt * p_rate)
  on conflict (interaction_id) do nothing;
  get diagnostics v_m = row_count; v_n := v_n + v_m;
  return v_n;
end $$;
revoke all on function private.draw_ai_review_sample_core(date, numeric, jsonb) from public, anon, authenticated;

-- The manual draw keeps its signature and its caller check; with signed rules in force it applies them.
create or replace function public.draw_ai_review_sample(p_month date, p_rate numeric)
returns integer
language plpgsql security definer set search_path = '' as $$
begin
  if not (private.is_admin() or private.is_active_clinical_director()) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  return private.draw_ai_review_sample_core(p_month, p_rate, private.ai_monitoring_rules());
end $$;

-- ---------------------------------------------------------------------------
-- 3. The scheduler: one draw per month, and nothing at all until the rules are signed
-- ---------------------------------------------------------------------------
create table public.ai_review_sample_runs (
  sample_month   date primary key check (sample_month = date_trunc('month', sample_month)::date),
  config_version integer not null references public.ai_monitoring_config (version) on delete restrict,
  drawn          integer not null check (drawn >= 0),
  ran_at         timestamptz not null default now()
);
alter table public.ai_review_sample_runs enable row level security;
revoke all on public.ai_review_sample_runs from public, anon, authenticated;
grant select on public.ai_review_sample_runs to authenticated;
create policy ai_review_sample_runs_read on public.ai_review_sample_runs for select to authenticated
  using (private.credential_is_cmo() or private.is_admin());
create index ai_review_sample_runs_config_idx on public.ai_review_sample_runs (config_version);

create function private.run_ai_review_sample_schedule() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_rules jsonb := private.ai_monitoring_rules();
  v_month date := date_trunc('month', (now() at time zone 'Africa/Lagos') - interval '1 month')::date;
  v_drawn integer;
begin
  if v_rules is null then
    return jsonb_build_object('status', 'inert', 'reason', 'no signed AI monitoring configuration');
  end if;
  if exists (select 1 from public.ai_review_sample_runs where sample_month = v_month) then
    return jsonb_build_object('status', 'already_drawn', 'month', v_month);
  end if;
  v_drawn := private.draw_ai_review_sample_core(v_month, (v_rules ->> 'sample_rate')::numeric, v_rules);
  insert into public.ai_review_sample_runs (sample_month, config_version, drawn) values (v_month, (v_rules ->> '_version')::integer, v_drawn);
  return jsonb_build_object('status', 'drawn', 'month', v_month, 'drawn', v_drawn);
end $$;
revoke all on function private.run_ai_review_sample_schedule() from public, anon, authenticated;

select cron.schedule('ai-review-sample-monthly', '0 3 1 * *', $$ select private.run_ai_review_sample_schedule(); $$);

-- ---------------------------------------------------------------------------
-- 4. The monitoring overview (admin or CMO). Ids, counts, categories and dates: never an answer's text and never a patient name.
-- ---------------------------------------------------------------------------
create function public.ai_monitoring_overview() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_org uuid;
  v_active jsonb;
  v_waiting integer;
begin
  if v_actor is null or not (private.is_admin() or private.credential_is_cmo()) then raise exception 'not authorised' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = v_actor;
  v_active := private.ai_monitoring_rules();
  select max(version) into v_waiting from public.ai_monitoring_config where not is_active and approved_at is null
     and version > coalesce((select max(version) from public.ai_monitoring_config where is_active), 0);
  perform private.log_audit('ai_monitoring.overview_read', 'ai_monitoring_config', null, '{}'::jsonb);
  return jsonb_build_object(
    'scheduler', jsonb_build_object(
      'armed', v_active is not null,
      'signed_version', v_active ->> '_version',
      'waiting_for_signature_version', v_waiting,
      'sample_rate', v_active ->> 'sample_rate',
      'last_run', (select jsonb_build_object('month', r.sample_month, 'drawn', r.drawn, 'ran_at', r.ran_at) from public.ai_review_sample_runs r order by r.sample_month desc limit 1)),
    'samples', coalesce((
      select jsonb_agg(jsonb_build_object('month', m, 'rule', rule, 'drawn', n, 'reviewed', done) order by m desc, rule)
        from (select s.sample_month m, s.sampled_by_rule rule, count(*) n, count(*) filter (where s.verdict is not null) done
                from public.ai_review_samples s
               where s.organisation_id = v_org and s.sample_month >= date_trunc('month', now())::date - interval '3 months'
               group by 1, 2) q), '[]'::jsonb),
    'reported', coalesce((
      select jsonb_agg(jsonb_build_object('incident_id', i.id, 'system_code', s.system_code, 'category', i.category, 'severity', i.severity,
                                          'status', i.status, 'created_at', i.created_at,
                                          'in_review_sample', exists (select 1 from public.ai_review_samples r where r.interaction_id = i.interaction_id))
                       order by i.created_at desc)
        from (select * from public.ai_safety_incidents where organisation_id = v_org and reporter_kind = 'patient'
               order by created_at desc limit 25) i join public.ai_systems s on s.id = i.ai_system_id), '[]'::jsonb),
    'reported_last_30_days', (select count(*) from public.ai_safety_incidents where organisation_id = v_org and reporter_kind = 'patient' and created_at >= now() - interval '30 days'));
end $$;
revoke all on function public.ai_monitoring_overview() from public, anon;
grant execute on function public.ai_monitoring_overview() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.ai_monitoring_overview()', 'EXECUTE')
     or has_function_privilege('anon', 'public.sign_ai_monitoring_config(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.draw_ai_review_sample(date, numeric)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.run_ai_review_sample_schedule()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.draw_ai_review_sample_core(date, numeric, jsonb)', 'EXECUTE') then
    raise exception 'S80d AI monitoring function privileges are wrong';
  end if;
  if exists (select 1 from public.ai_monitoring_config where is_active or approved_at is not null) then raise exception 'the AI monitoring config must be born unsigned and inactive'; end if;
  if private.ai_monitoring_rules() is not null then raise exception 'the scheduler must be inert until a signature'; end if;
  if (private.run_ai_review_sample_schedule() ->> 'status') <> 'inert' then raise exception 'the scheduler is not inert'; end if;
  if not exists (select 1 from cron.job where jobname = 'ai-review-sample-monthly') then raise exception 'the monthly job is not scheduled'; end if;
end $$;
