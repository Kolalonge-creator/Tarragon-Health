-- S80c (spec 25.10 AI monitoring; D.5): model cost in kobo and a clinician review sample.
--
-- ai_model_prices: what a model costs per million tokens, in integer kobo (INV-15), dated and versioned. It starts EMPTY on purpose: no price
-- is invented here. Until a price is entered for a model, the cost roll-up reports those calls as unpriced rather than as zero.
-- ai_cost_by_system_month(): calls, tokens, cost_kobo and unpriced_calls per AI system per month. Test accounts are excluded (INV-13).
-- ai_review_samples: a stratified monthly sample of interactions for a clinician to score (accurate, minor_issue, harmful, not_reviewable).
-- Every interaction flagged for review is always included. The sampling rate is a parameter supplied from PROPOSED configuration
-- (decision 6: 5 percent, awaiting CMO signature); this code holds no rate. A reviewer reads output_summary only, never the subject, and every
-- queue read is written to audit_log with the sample ids shown (INV-10). The queue is limited to the reviewer's own organisation. A harmful
-- verdict opens an ai_safety_incidents row (severity high, reporter clinician) so the clinical safety officer sees it, and marks needs_incident.
-- Deleting an interaction log row never deletes the reviewer's verdict (interaction_id is set null). ai_model_prices and ai_review's source
-- tables are platform config or derived: prices carry no organisation_id by design (global config, like health_education_content).

create table public.ai_model_prices (
  id uuid primary key default gen_random_uuid(),
  model_identifier text not null check (length(model_identifier) between 1 and 200),
  effective_from date not null,
  input_kobo_per_million bigint not null check (input_kobo_per_million >= 0),
  output_kobo_per_million bigint not null check (output_kobo_per_million >= 0),
  source_note text not null check (length(source_note) >= 10),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (model_identifier, effective_from)
);
alter table public.ai_model_prices enable row level security;
create policy ai_model_prices_staff_read on public.ai_model_prices for select to authenticated
  using (private.is_admin() or private.is_active_clinical_director());
revoke all on public.ai_model_prices from anon;
grant select on public.ai_model_prices to authenticated;

create table public.ai_review_samples (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  interaction_id uuid unique references public.ai_interaction_log(id) on delete set null,
  ai_system_id uuid not null references public.ai_systems(id),
  sample_month date not null check (sample_month = date_trunc('month', sample_month)::date),
  sampled_by_rule text not null check (sampled_by_rule in ('stratified', 'flagged')),
  verdict text check (verdict in ('accurate', 'minor_issue', 'harmful', 'not_reviewable')),
  notes text check (notes is null or length(notes) <= 1000),
  needs_incident boolean not null default false,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((verdict is null) = (reviewed_by is null)),
  check (needs_incident = false or verdict = 'harmful')
);
alter table public.ai_review_samples enable row level security;
revoke all on public.ai_review_samples from anon, authenticated;

create or replace function private.ai_reviewer_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_active_clinical_director()
      or exists (select 1 from public.clinical_staff where profile_id = (select auth.uid()) and active
                 and doctor_tier in ('senior_medical_officer', 'medical_officer'));
$$;
revoke all on function private.ai_reviewer_ok() from public, anon;
grant execute on function private.ai_reviewer_ok() to authenticated, service_role;

create or replace function public.set_ai_model_price(
  p_model text, p_effective_from date, p_input_kobo_per_million bigint, p_output_kobo_per_million bigint, p_source_note text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not private.is_admin() then raise exception 'not authorised: only an admin may set a model price' using errcode = '42501'; end if;
  if p_effective_from < current_date then raise exception 'a price cannot be backdated: it would rewrite the cost of months already reviewed'; end if;
  insert into public.ai_model_prices (model_identifier, effective_from, input_kobo_per_million, output_kobo_per_million, source_note, created_by)
  values (p_model, p_effective_from, p_input_kobo_per_million, p_output_kobo_per_million, p_source_note, (select auth.uid()))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.ai_cost_by_system_month(p_months integer default 6)
returns table (system_code text, month date, calls bigint, input_tokens bigint, output_tokens bigint, cost_kobo bigint, unpriced_calls bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_admin() or private.is_active_clinical_director()) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  return query
  select s.system_code, date_trunc('month', l.created_at)::date, count(*),
         coalesce(sum(l.input_token_count), 0)::bigint, coalesce(sum(l.output_token_count), 0)::bigint,
         round(sum(coalesce(l.input_token_count, 0)::numeric * pr.input_kobo_per_million / 1000000
                 + coalesce(l.output_token_count, 0)::numeric * pr.output_kobo_per_million / 1000000)
               filter (where pr.id is not null))::bigint,
         count(*) filter (where pr.id is null)
  from public.ai_interaction_log l
  join public.ai_systems s on s.id = l.ai_system_id
  left join public.profiles sp on sp.id = l.subject_profile_id
  left join lateral (
    select p.* from public.ai_model_prices p
    where p.model_identifier = l.model_identifier and p.effective_from <= l.created_at::date
    order by p.effective_from desc limit 1
  ) pr on true
  where coalesce(sp.is_test, false) = false
    and l.created_at >= date_trunc('month', now()) - make_interval(months => greatest(p_months, 1) - 1)
  group by 1, 2
  order by 2 desc, 1;
end $$;

create or replace function public.draw_ai_review_sample(p_month date, p_rate numeric)
returns integer
language plpgsql security definer set search_path = '' as $$
declare v_start date := date_trunc('month', p_month)::date; v_n integer := 0; v_m integer;
begin
  if not (private.is_admin() or private.is_active_clinical_director()) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if p_rate is null or p_rate <= 0 or p_rate > 1 then raise exception 'the sampling rate must be above 0 and at most 1 and comes from signed configuration'; end if;
  -- everything flagged for review is always included
  insert into public.ai_review_samples (organisation_id, interaction_id, ai_system_id, sample_month, sampled_by_rule)
  select l.organisation_id, l.id, l.ai_system_id, v_start, 'flagged'
  from public.ai_interaction_log l left join public.profiles sp on sp.id = l.subject_profile_id
  where l.flagged_for_review and coalesce(sp.is_test, false) = false
    and l.created_at >= v_start and l.created_at < v_start + interval '1 month'
  on conflict (interaction_id) do nothing;
  get diagnostics v_m = row_count; v_n := v_n + v_m;
  -- the rest: ceil(rate x count) per system, stratified by safety class, chosen at random
  insert into public.ai_review_samples (organisation_id, interaction_id, ai_system_id, sample_month, sampled_by_rule)
  select organisation_id, id, ai_system_id, v_start, 'stratified' from (
    select l.id, l.ai_system_id, l.organisation_id,
           row_number() over (partition by l.ai_system_id, l.safety_classification order by random()) rn,
           count(*) over (partition by l.ai_system_id, l.safety_classification) cnt
    from public.ai_interaction_log l left join public.profiles sp on sp.id = l.subject_profile_id
    where coalesce(sp.is_test, false) = false and not l.flagged_for_review
      and l.created_at >= v_start and l.created_at < v_start + interval '1 month'
      and not exists (select 1 from public.ai_review_samples d where d.ai_system_id = l.ai_system_id
                      and d.sample_month = v_start and d.sampled_by_rule = 'stratified')
  ) x where rn <= ceil(cnt * p_rate)
  on conflict (interaction_id) do nothing;
  get diagnostics v_m = row_count; v_n := v_n + v_m;
  return v_n;
end $$;

create or replace function public.ai_review_queue(p_limit integer default 25)
returns table (sample_id uuid, system_code text, sample_month date, sampled_by_rule text, output_summary text, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_org uuid;
  v_n integer := least(greatest(p_limit, 1), 100);
  v_ids uuid[];
begin
  if not private.ai_reviewer_ok() then raise exception 'not authorised' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = v_actor;
  select array_agg(x.id) into v_ids from (
    select r.id from public.ai_review_samples r join public.ai_interaction_log l on l.id = r.interaction_id
    where r.verdict is null and r.organisation_id = v_org order by r.sampled_by_rule, l.created_at limit v_n
  ) x;
  insert into public.audit_log (actor_id, action, entity_type, entity_id, event)
  values (v_actor, 'ai_review_samples.queue_read', 'ai_review_samples', null,
          jsonb_build_object('limit', v_n, 'sample_ids', coalesce(to_jsonb(v_ids), '[]'::jsonb)));
  return query
  select r.id, s.system_code, r.sample_month, r.sampled_by_rule, l.output_summary, l.created_at
  from public.ai_review_samples r join public.ai_interaction_log l on l.id = r.interaction_id join public.ai_systems s on s.id = r.ai_system_id
  where r.id = any (coalesce(v_ids, '{}'::uuid[])) order by r.sampled_by_rule, l.created_at;
end $$;

create or replace function public.review_ai_sample(p_id uuid, p_verdict text, p_notes text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_org uuid;
  v_row public.ai_review_samples%rowtype;
begin
  if not private.ai_reviewer_ok() then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_verdict not in ('accurate', 'minor_issue', 'harmful', 'not_reviewable') then raise exception 'unknown verdict'; end if;
  if p_verdict in ('harmful', 'minor_issue') and coalesce(length(trim(p_notes)), 0) < 10 then
    raise exception 'a note of at least 10 characters is required for a minor_issue or harmful verdict';
  end if;
  select organisation_id into v_org from public.profiles where id = v_actor;
  update public.ai_review_samples set verdict = p_verdict, notes = p_notes, needs_incident = (p_verdict = 'harmful'),
    reviewed_by = v_actor, reviewed_at = now()
  where id = p_id and verdict is null and organisation_id = v_org
  returning * into v_row;
  if not found then raise exception 'sample not found, not in your organisation, or already reviewed'; end if;
  if p_verdict = 'harmful' then
    insert into public.ai_safety_incidents (organisation_id, ai_system_id, interaction_id, reported_by, reporter_kind, category, severity, description)
    values (v_row.organisation_id, v_row.ai_system_id, v_row.interaction_id, v_actor, 'clinician', 'other', 'high',
            'Found harmful in the monthly clinician review sample. Reviewer note: ' || p_notes);
  end if;
end $$;

revoke execute on function public.set_ai_model_price(text, date, bigint, bigint, text) from public;
revoke execute on function public.ai_cost_by_system_month(integer) from public;
revoke execute on function public.draw_ai_review_sample(date, numeric) from public;
revoke execute on function public.ai_review_queue(integer) from public;
revoke execute on function public.review_ai_sample(uuid, text, text) from public;
grant execute on function public.set_ai_model_price(text, date, bigint, bigint, text) to authenticated;
grant execute on function public.ai_cost_by_system_month(integer) to authenticated;
grant execute on function public.draw_ai_review_sample(date, numeric) to authenticated;
grant execute on function public.ai_review_queue(integer) to authenticated;
grant execute on function public.review_ai_sample(uuid, text, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.ai_review_queue(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.ai_cost_by_system_month(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.draw_ai_review_sample(date, numeric)', 'EXECUTE')
     or has_function_privilege('anon', 'public.review_ai_sample(uuid, text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_ai_model_price(text, date, bigint, bigint, text)', 'EXECUTE')
     or has_function_privilege('anon', 'private.ai_reviewer_ok()', 'EXECUTE') then
    raise exception 'anon must not execute the S80c functions';
  end if;
end $$;
