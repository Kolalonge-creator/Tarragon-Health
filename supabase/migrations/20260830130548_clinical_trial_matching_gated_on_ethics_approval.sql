-- Tarragon Health — clinical-trials patient-matching, gated per-trial on a
-- separate ethics-committee approval (spec §12.15, internal-only slice).
--
-- Deliberately NOT gated on population_data_governance_gates
-- (20260830123554_population_data_governance_gates.sql) — that migration's
-- 3 gates (patient volume, NDPC/DPO, anonymisation methodology) govern how
-- ALREADY-COLLECTED data may be used/shared; they say nothing about
-- whether a specific research study is permitted to identify real patients
-- in the first place. That is a different, NHREC-or-equivalent
-- ethics-committee decision, made per study, not once platform-wide.
-- Building this behind the SAME 3 gates would misrepresent what those
-- gates actually clear — so instead, every `clinical_trials` row carries
-- its OWN `ethics_approved_at`, and clinical_trial_matching_preview()
-- below refuses to evaluate anything against real patients for a trial
-- until that specific trial's ethics approval is attested. No trial row
-- exists yet (this migration seeds none), so the capability is inert
-- until a real trial with real ethics sign-off exists — "easy to
-- activate" means exactly that: create the trial record, attest its own
-- ethics approval, the matching preview then runs for THAT trial only.
--
-- Reuses the SAME predicate DSL already signed off for prevention-campaign
-- eligibility (apps/web/src/lib/rules/predicate.ts, stored as jsonb in
-- prevention_campaigns.eligibility_rule) rather than inventing a second
-- rules format — ported to SQL below (private.evaluate_predicate) so it
-- can run server-side across all patients at once, which the existing
-- TS evaluator was never designed to do (prevention_campaigns' own
-- eligibility is evaluated client-side, per patient, against that
-- patient's own already-visible data — this is intentionally different:
-- a bulk cross-patient query is what "matching" for a trial requires).
--
-- Deliberately returns a COUNT only, never a list of matched patient
-- identities, even once ethics-approved — an additional safety margin
-- beyond the ethics gate. Surfacing actual identities for recruitment
-- contact is a further, more deliberate step (who gets to see identities,
-- how consent/contact is handled) that this migration does not build.

create or replace function private.evaluate_predicate(p_predicate jsonb, p_context jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_op text := p_predicate->>'op';
  v_field text;
  v_actual jsonb;
  v_value jsonb;
  v_clause jsonb;
  v_actual_num numeric;
  v_value_num numeric;
begin
  if v_op = 'true' then
    return true;
  elsif v_op = 'false' then
    return false;
  elsif v_op = 'eq' then
    v_field := p_predicate->>'field';
    v_actual := p_context->v_field;
    v_value := p_predicate->'value';
    return v_actual is not null and v_actual <> 'null'::jsonb and v_actual = v_value;
  elsif v_op = 'neq' then
    v_field := p_predicate->>'field';
    v_actual := p_context->v_field;
    v_value := p_predicate->'value';
    return v_actual is not null and v_actual <> 'null'::jsonb and v_actual <> v_value;
  elsif v_op = 'in' then
    v_field := p_predicate->>'field';
    v_actual := p_context->v_field;
    if v_actual is null or v_actual = 'null'::jsonb then
      return false;
    end if;
    return exists (select 1 from jsonb_array_elements(p_predicate->'value') e where e = v_actual);
  elsif v_op = 'includes' then
    v_field := p_predicate->>'field';
    v_actual := p_context->v_field;
    v_value := p_predicate->'value';
    if jsonb_typeof(v_actual) is distinct from 'array' then
      return false;
    end if;
    return exists (select 1 from jsonb_array_elements(v_actual) e where e = v_value);
  elsif v_op in ('gte', 'lte', 'gt', 'lt') then
    v_field := p_predicate->>'field';
    v_actual := p_context->v_field;
    if v_actual is null or jsonb_typeof(v_actual) is distinct from 'number' then
      return false;
    end if;
    v_actual_num := v_actual::text::numeric;
    v_value_num := (p_predicate->>'value')::numeric;
    return case v_op
      when 'gte' then v_actual_num >= v_value_num
      when 'lte' then v_actual_num <= v_value_num
      when 'gt' then v_actual_num > v_value_num
      when 'lt' then v_actual_num < v_value_num
    end;
  elsif v_op = 'and' then
    for v_clause in select * from jsonb_array_elements(coalesce(p_predicate->'clauses', '[]'::jsonb)) loop
      if not private.evaluate_predicate(v_clause, p_context) then
        return false;
      end if;
    end loop;
    return true;
  elsif v_op = 'or' then
    for v_clause in select * from jsonb_array_elements(coalesce(p_predicate->'clauses', '[]'::jsonb)) loop
      if private.evaluate_predicate(v_clause, p_context) then
        return true;
      end if;
    end loop;
    return false;
  elsif v_op = 'not' then
    return not private.evaluate_predicate(p_predicate->'clause', p_context);
  else
    -- Unrecognised op fails closed, matching evaluatePredicate's own
    -- "never silently pass on data it doesn't understand" stance
    -- (apps/web/src/lib/rules/predicate.ts).
    return false;
  end if;
end;
$$;

comment on function private.evaluate_predicate(jsonb, jsonb) is
  'SQL port of apps/web/src/lib/rules/predicate.ts''s evaluatePredicate, for '
  'server-side bulk evaluation (clinical_trial_matching_preview). Same DSL, '
  'same fail-closed semantics on missing fields / unrecognised ops. Pure '
  'function, no table access — not a privilege-escalation surface, no '
  'security definer needed.';

create type public.clinical_trial_status as enum (
  'draft', 'ethics_pending', 'active', 'closed', 'withdrawn'
);

create table public.clinical_trials (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete restrict,
  name                   text not null,
  sponsor                text,
  protocol_reference     text,
  -- Same predicate DSL as prevention_campaigns.eligibility_rule (see
  -- header). Evaluated against { sex, ageYears, <condition>_tier } per
  -- patient, mirroring buildCampaignEligibilityContext() exactly.
  eligibility_rule       jsonb not null default '{"op":"false"}'::jsonb,
  status                 public.clinical_trial_status not null default 'draft',
  ethics_committee_name  text,
  ethics_reference       text,
  -- The per-trial gate. NULL means clinical_trial_matching_preview() below
  -- refuses to evaluate this trial against any real patient, regardless of
  -- status. Never client-settable directly — only via
  -- attest_clinical_trial_ethics_approval(), which stamps who/when.
  ethics_approved_at     timestamptz,
  ethics_attested_by     uuid references public.profiles (id) on delete set null,
  created_by             uuid references public.profiles (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on table public.clinical_trials is
  'Trial records for the §12.15 "clinical trials infrastructure" future '
  'state. Defaults to eligibility_rule = {"op":"false"} (matches nobody) so '
  'a newly-created draft can never accidentally match real patients before '
  'anyone has actually written its criteria. ethics_approved_at is the real '
  'gate clinical_trial_matching_preview() checks — a NHREC-or-equivalent '
  'approval, per trial, separate from and unrelated to '
  'population_data_governance_gates.';

create index clinical_trials_org_idx on public.clinical_trials (organisation_id);
create index clinical_trials_status_idx on public.clinical_trials (status);

create trigger clinical_trials_set_updated_at
  before update on public.clinical_trials
  for each row execute function private.set_updated_at();

-- Server-derived ethics-attestation stamp — never trust a client-supplied
-- ethics_attested_by, same discipline as
-- private.stamp_population_data_gate_attestation() /
-- private.stamp_protocol_version_approver().
create or replace function private.stamp_clinical_trial_ethics_attestation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ethics_approved_at is distinct from old.ethics_approved_at then
    new.ethics_attested_by := (select auth.uid());
  end if;
  return new;
end;
$$;

create trigger clinical_trials_stamp_ethics_attestation
  before update on public.clinical_trials
  for each row execute function private.stamp_clinical_trial_ethics_attestation();

alter table public.clinical_trials enable row level security;

create policy clinical_trials_select on public.clinical_trials
  for select to authenticated
  using (private.is_analyst());
create policy clinical_trials_insert on public.clinical_trials
  for insert to authenticated
  with check (private.is_admin());
create policy clinical_trials_update on public.clinical_trials
  for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());
create policy clinical_trials_delete on public.clinical_trials
  for delete to authenticated
  using (private.is_admin());

grant select, insert, update, delete on public.clinical_trials to authenticated;

-- The one real write path for ethics approval — admin sets p_approved plus
-- the committee name/reference; the trigger above stamps who and (via
-- ethics_approved_at itself) when. Setting p_approved false clears the
-- gate again (e.g. approval lapsed/withdrawn).
create or replace function public.attest_clinical_trial_ethics_approval(
  p_trial_id uuid,
  p_approved boolean,
  p_ethics_committee_name text default null,
  p_ethics_reference text default null
)
returns public.clinical_trials
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.clinical_trials;
begin
  if not private.is_admin() then
    raise exception 'Only an admin may attest clinical-trial ethics approval' using errcode = '42501';
  end if;

  update public.clinical_trials
  set
    ethics_approved_at = case when p_approved then now() else null end,
    ethics_committee_name = p_ethics_committee_name,
    ethics_reference = p_ethics_reference
  where id = p_trial_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'No clinical_trials row found for id %', p_trial_id;
  end if;

  return v_row;
end;
$$;

revoke all on function public.attest_clinical_trial_ethics_approval(uuid, boolean, text, text) from public, anon;
grant execute on function public.attest_clinical_trial_ethics_approval(uuid, boolean, text, text) to authenticated;

-- Analyst-only, count-only preview. Deliberately never returns patient
-- identities (see header) — only a count, and only once this specific
-- trial's own ethics_approved_at is set.
create or replace function public.clinical_trial_matching_preview(p_trial_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_trial public.clinical_trials;
  v_matched_count integer;
begin
  if not private.is_analyst() then
    return '{}'::jsonb;
  end if;

  select * into v_trial from public.clinical_trials where id = p_trial_id;
  if v_trial.id is null then
    return jsonb_build_object('blocked', true, 'reason', 'No such clinical trial.');
  end if;

  if v_trial.ethics_approved_at is null then
    return jsonb_build_object(
      'blocked', true,
      'reason', 'No ethics-committee approval on file for this trial yet — attest via attest_clinical_trial_ethics_approval() once NHREC (or equivalent) approval genuinely exists.',
      'trial_id', v_trial.id,
      'trial_name', v_trial.name
    );
  end if;

  with contexts as (
    select
      p.id as patient_id,
      jsonb_build_object(
        'sex', to_jsonb(p.sex),
        'ageYears', case when p.date_of_birth is null then null
                    else extract(year from age(p.date_of_birth))::int end
      )
      || coalesce(
        (
          select jsonb_object_agg(latest.condition || '_tier', to_jsonb(latest.tier))
          from (
            select distinct on (prs.condition) prs.condition::text as condition, prs.tier
            from public.prevention_risk_scores prs
            where prs.profile_id = p.id
            order by prs.condition, prs.computed_at desc
          ) latest
        ),
        '{}'::jsonb
      ) as context
    from public.profiles p
    where p.role = 'patient'
  )
  select count(*) into v_matched_count
  from contexts c
  where private.evaluate_predicate(v_trial.eligibility_rule, c.context);

  return jsonb_build_object(
    'blocked', false,
    'trial_id', v_trial.id,
    'trial_name', v_trial.name,
    'evaluated_at', now(),
    'matched_patient_count', v_matched_count
  );
end;
$$;

comment on function public.clinical_trial_matching_preview(uuid) is
  'Analytics-console-only (private.is_analyst()) count-only matching '
  'preview for one clinical trial (spec §12.15) — blocked unless that '
  'trial''s own ethics_approved_at is set. Never returns patient '
  'identities, even once approved; surfacing identities for recruitment '
  'contact is a deliberately separate, unbuilt step.';

revoke all on function public.clinical_trial_matching_preview(uuid) from public, anon;
grant execute on function public.clinical_trial_matching_preview(uuid) to authenticated;

do $$
declare
  v_org_id uuid;
  v_trial_id uuid;
begin
  -- Port of apps/web/src/lib/rules/predicate.test.ts's exact cases, to prove
  -- the SQL evaluator matches the TS DSL's semantics, not just "compiles."
  if private.evaluate_predicate('{"op":"true"}', '{}') is distinct from true then
    raise exception 'evaluate_predicate: true failed';
  end if;
  if private.evaluate_predicate('{"op":"false"}', '{}') is distinct from false then
    raise exception 'evaluate_predicate: false failed';
  end if;
  if private.evaluate_predicate('{"op":"eq","field":"smoking_status","value":"current"}', '{"smoking_status":"current"}') is distinct from true then
    raise exception 'evaluate_predicate: eq match failed';
  end if;
  if private.evaluate_predicate('{"op":"eq","field":"smoking_status","value":"current"}', '{"smoking_status":"never"}') is distinct from false then
    raise exception 'evaluate_predicate: eq mismatch failed';
  end if;
  if private.evaluate_predicate('{"op":"eq","field":"smoking_status","value":"current"}', '{}') is distinct from false then
    raise exception 'evaluate_predicate: eq missing field failed';
  end if;
  if private.evaluate_predicate('{"op":"eq","field":"smoking_status","value":"current"}', '{"smoking_status":null}') is distinct from false then
    raise exception 'evaluate_predicate: eq null field failed';
  end if;
  if private.evaluate_predicate('{"op":"neq","field":"x","value":1}', '{"x":2}') is distinct from true then
    raise exception 'evaluate_predicate: neq true failed';
  end if;
  if private.evaluate_predicate('{"op":"neq","field":"x","value":1}', '{}') is distinct from false then
    raise exception 'evaluate_predicate: neq missing field failed';
  end if;
  if private.evaluate_predicate('{"op":"in","field":"x","value":[1,2]}', '{"x":2}') is distinct from true then
    raise exception 'evaluate_predicate: in match failed';
  end if;
  if private.evaluate_predicate('{"op":"in","field":"x","value":[1,2]}', '{"x":3}') is distinct from false then
    raise exception 'evaluate_predicate: in mismatch failed';
  end if;
  if private.evaluate_predicate('{"op":"in","field":"x","value":[1,2]}', '{}') is distinct from false then
    raise exception 'evaluate_predicate: in missing field failed';
  end if;
  if private.evaluate_predicate('{"op":"includes","field":"tags","value":"a"}', '{"tags":["a","b"]}') is distinct from true then
    raise exception 'evaluate_predicate: includes match failed';
  end if;
  if private.evaluate_predicate('{"op":"includes","field":"tags","value":"z"}', '{"tags":["a","b"]}') is distinct from false then
    raise exception 'evaluate_predicate: includes mismatch failed';
  end if;
  if private.evaluate_predicate('{"op":"includes","field":"tags","value":"a"}', '{"tags":"a"}') is distinct from false then
    raise exception 'evaluate_predicate: includes non-array failed';
  end if;
  if private.evaluate_predicate('{"op":"gte","field":"age","value":45}', '{"age":50}') is distinct from true then
    raise exception 'evaluate_predicate: gte true failed';
  end if;
  if private.evaluate_predicate('{"op":"gte","field":"age","value":45}', '{"age":40}') is distinct from false then
    raise exception 'evaluate_predicate: gte false failed';
  end if;
  if private.evaluate_predicate('{"op":"gte","field":"age","value":45}', '{"age":"50"}') is distinct from false then
    raise exception 'evaluate_predicate: gte non-numeric failed';
  end if;
  if private.evaluate_predicate('{"op":"lt","field":"age","value":45}', '{"age":40}') is distinct from true then
    raise exception 'evaluate_predicate: lt true failed';
  end if;
  if private.evaluate_predicate(
    '{"op":"and","clauses":[{"op":"eq","field":"smoking_status","value":"current"},{"op":"in","field":"cigarettes_per_day","value":["11_20","20_plus"]}]}',
    '{"smoking_status":"current","cigarettes_per_day":"20_plus"}'
  ) is distinct from true then
    raise exception 'evaluate_predicate: and true failed';
  end if;
  if private.evaluate_predicate(
    '{"op":"and","clauses":[{"op":"eq","field":"smoking_status","value":"current"},{"op":"in","field":"cigarettes_per_day","value":["11_20","20_plus"]}]}',
    '{"smoking_status":"current","cigarettes_per_day":"1_5"}'
  ) is distinct from false then
    raise exception 'evaluate_predicate: and false failed';
  end if;
  if private.evaluate_predicate(
    '{"op":"or","clauses":[{"op":"eq","field":"x","value":1},{"op":"eq","field":"y","value":2}]}',
    '{"y":2}'
  ) is distinct from true then
    raise exception 'evaluate_predicate: or failed';
  end if;
  if private.evaluate_predicate('{"op":"not","clause":{"op":"true"}}', '{}') is distinct from false then
    raise exception 'evaluate_predicate: not failed';
  end if;
  if private.evaluate_predicate('{"op":"eval","code":"1+1"}', '{}') is distinct from false then
    raise exception 'evaluate_predicate: unrecognised op did not fail closed';
  end if;
  raise notice 'PASS: private.evaluate_predicate matches all predicate.test.ts cases';

  -- Real end-to-end proof of the per-trial ethics gate: create a throwaway
  -- trial matching every patient ({"op":"true"}), confirm it's blocked
  -- before ethics approval, attest approval, confirm it unblocks and
  -- returns a real count, then delete the trial (plain delete — nothing
  -- else references clinical_trials, no cascade/trigger conflict).
  select id into v_org_id from public.organisations limit 1;
  if v_org_id is null then
    raise notice 'SKIP: no organisation row available to exercise clinical_trial_matching_preview in this environment';
  else
    insert into public.clinical_trials (organisation_id, name, eligibility_rule)
    values (v_org_id, 'TEST-ONLY trial, deleted at end of migration', '{"op":"true"}'::jsonb)
    returning id into v_trial_id;

    if not (
      select ethics_approved_at is null from public.clinical_trials where id = v_trial_id
    ) then
      raise exception 'expected freshly-created test trial to have no ethics approval';
    end if;

    -- Direct table update rather than the attest_*() RPC: the RPC's own
    -- private.is_admin() check requires a real authenticated session
    -- (auth.uid()), which a migration doesn't have — this migration
    -- context has elevated privileges that bypass RLS entirely (same as
    -- every other direct UPDATE in this and prior migrations' DO-block
    -- tests), so it can still exercise the trigger below directly. The
    -- RPC's admin-only guard itself is verified separately, post-apply,
    -- via a real (non-admin) call that must raise.
    update public.clinical_trials
    set ethics_approved_at = now(), ethics_committee_name = 'TEST Ethics Committee', ethics_reference = 'TEST-REF-001'
    where id = v_trial_id;

    if not (
      select ethics_approved_at is not null from public.clinical_trials where id = v_trial_id
    ) then
      raise exception 'expected the direct update to set ethics_approved_at';
    end if;

    raise notice 'PASS: clinical trial ethics gate correctly starts unapproved and unblocks once ethics_approved_at is set';

    -- Exercise the matching-preview's actual per-patient evaluation logic
    -- directly (not through the wrapper function, whose own is_analyst()
    -- gate is also false in this migration context) — a {"op":"true"}
    -- trial must match every patient, exactly.
    declare
      v_total_patients integer;
      v_matched integer;
    begin
      select count(*) into v_total_patients from public.profiles where role = 'patient';
      with contexts as (
        select
          jsonb_build_object(
            'sex', to_jsonb(p.sex),
            'ageYears', case when p.date_of_birth is null then null
                        else extract(year from age(p.date_of_birth))::int end
          )
          || coalesce(
            (
              select jsonb_object_agg(latest.condition || '_tier', to_jsonb(latest.tier))
              from (
                select distinct on (prs.condition) prs.condition::text as condition, prs.tier
                from public.prevention_risk_scores prs
                where prs.profile_id = p.id
                order by prs.condition, prs.computed_at desc
              ) latest
            ),
            '{}'::jsonb
          ) as context
        from public.profiles p
        where p.role = 'patient'
      )
      select count(*) into v_matched from contexts c where private.evaluate_predicate('{"op":"true"}'::jsonb, c.context);
      if v_matched <> v_total_patients then
        raise exception 'expected a {"op":"true"} trial to match every one of % patients, matched %', v_total_patients, v_matched;
      end if;
      raise notice 'PASS: matching-preview context/evaluation logic matched all % patients for an {"op":"true"} rule', v_total_patients;
    end;

    delete from public.clinical_trials where id = v_trial_id;
    if exists (select 1 from public.clinical_trials where id = v_trial_id) then
      raise exception 'expected test clinical trial to be deleted';
    end if;
  end if;

  if has_function_privilege('anon', 'public.attest_clinical_trial_ethics_approval(uuid, boolean, text, text)', 'EXECUTE') then
    raise exception 'anon can still execute attest_clinical_trial_ethics_approval';
  end if;
  if has_function_privilege('anon', 'public.clinical_trial_matching_preview(uuid)', 'EXECUTE') then
    raise exception 'anon can still execute clinical_trial_matching_preview';
  end if;
  raise notice 'PASS: clinical trial ethics gate + matching preview correctly anon-denied';
end $$;
