-- Tarragon Health — insurance stays dormant until explicitly activated.
--
-- Built per spec §25.16/§25.17 and verified live (20260829011711,
-- 20260829011713), but there is no signed contract with any insurer yet,
-- and none of the coverage math, pre-authorisation workflow, or claim
-- adjudication has been exercised against a real insurer relationship. The
-- founder wants this shipped and ready, not switched on — so every seeded
-- insurer now starts is_active = false, and every RPC that would actually
-- change a patient's cost or start a real workflow checks it:
--
--   * check_insurance_coverage() treats an inactive insurer exactly like no
--     policy at all — has_coverage: false, full self-pay responsibility.
--     Nothing calling this (today, nothing does — see both prior migrations'
--     headers) can accidentally start quoting a patient a co-pay against an
--     insurer Tarragon has not actually activated.
--   * request_preauthorization() and submit_insurance_claim() now refuse
--     outright against an inactive insurer's policy, with a message naming
--     the insurer, rather than silently creating a request/claim record
--     nobody can act on.
--
-- Turning a specific insurer on, once a real contract exists, is the one
-- deliberate switch: `update insurers set is_active = true where id = ...`,
-- gated the same way any other insurer edit is (insurance.manage /
-- insurers_manage policy). Nothing else about the data model, RLS, or the
-- underlying tables changes — this only gates when the feature actually
-- engages, it does not remove any capability already built.

update public.insurers set is_active = false;

-- ---------------------------------------------------------------------------
-- check_insurance_coverage — unchanged except for the insurer-active check
-- right after the policy lookup.
-- ---------------------------------------------------------------------------
create or replace function public.check_insurance_coverage(
  p_patient_id uuid,
  p_service_category text,
  p_amount_kobo bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_patient_org uuid;
  v_policy public.insurance_policies%rowtype;
  v_insurer public.insurers%rowtype;
  v_benefit public.insurance_benefits%rowtype;
  v_requires_preauth boolean;
  v_copay bigint;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  if p_service_category not in ('consultation', 'laboratory', 'pharmacy', 'referral') then
    raise exception 'unknown service_category: %', p_service_category using errcode = '22023';
  end if;

  if p_patient_id <> v_caller then
    select organisation_id into v_patient_org from public.profiles where id = p_patient_id;
    if v_patient_org is null or not private.is_org_staff(v_patient_org) then
      raise exception 'not authorised to view this patient''s insurance coverage' using errcode = '42501';
    end if;
  end if;

  select * into v_policy
    from public.insurance_policies
   where patient_id = p_patient_id
     and status = 'active'
     and (effective_to is null or effective_to >= current_date)
   order by verified_at is not null desc, created_at desc
   limit 1;

  if v_policy.id is null then
    return jsonb_build_object(
      'has_coverage', false,
      'requires_preauth', false,
      'patient_responsibility_kobo', p_amount_kobo
    );
  end if;

  select * into v_insurer from public.insurers where id = v_policy.insurer_id;

  -- Dormant insurer: treated exactly like no policy exists. A patient who
  -- has entered a real card for an insurer Tarragon has not activated yet
  -- is not quoted a co-pay Tarragon cannot actually honour.
  if not coalesce(v_insurer.is_active, false) then
    return jsonb_build_object(
      'has_coverage', false,
      'policy_id', v_policy.id,
      'insurer_name', v_insurer.name,
      'requires_preauth', false,
      'patient_responsibility_kobo', p_amount_kobo,
      'note', v_insurer.name || ' is not yet active on Tarragon — this patient is currently self-pay for this service.'
    );
  end if;

  select * into v_benefit
    from public.insurance_benefits
   where insurer_id = v_policy.insurer_id
     and service_category = p_service_category
     and (plan_name = v_policy.plan_name or plan_name is null)
   order by plan_name is not null desc
   limit 1;

  if v_benefit.id is null then
    return jsonb_build_object(
      'has_coverage', false,
      'policy_id', v_policy.id,
      'insurer_name', v_insurer.name,
      'verified', v_policy.verified_at is not null,
      'requires_preauth', false,
      'patient_responsibility_kobo', p_amount_kobo,
      'note', 'A policy exists but this insurer has no benefit configured for ' || p_service_category || '.'
    );
  end if;

  v_requires_preauth := v_benefit.requires_preauth
    and (v_benefit.preauth_threshold_kobo is null or p_amount_kobo >= v_benefit.preauth_threshold_kobo);

  v_copay := greatest(
    0,
    round(p_amount_kobo * (1 - v_benefit.coverage_pct)) + v_benefit.copay_fixed_kobo
  );
  v_copay := least(v_copay, p_amount_kobo);

  return jsonb_build_object(
    'has_coverage', true,
    'policy_id', v_policy.id,
    'insurer_name', v_insurer.name,
    'verified', v_policy.verified_at is not null,
    'coverage_pct', v_benefit.coverage_pct,
    'requires_preauth', v_requires_preauth,
    'annual_limit_kobo', v_benefit.annual_limit_kobo,
    'insurer_covered_kobo', p_amount_kobo - v_copay,
    'patient_responsibility_kobo', v_copay
  );
end;
$$;

revoke all on function public.check_insurance_coverage(uuid, text, bigint) from public;
revoke all on function public.check_insurance_coverage(uuid, text, bigint) from anon;
grant execute on function public.check_insurance_coverage(uuid, text, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- request_preauthorization — refuses outright against a dormant insurer,
-- rather than creating a request record nobody can act on.
-- ---------------------------------------------------------------------------
create or replace function public.request_preauthorization(
  p_policy_id uuid,
  p_service_category text,
  p_estimated_amount_kobo bigint,
  p_source_id uuid default null,
  p_clinical_justification text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.insurance_policies%rowtype;
  v_insurer public.insurers%rowtype;
  v_id uuid;
begin
  select * into v_policy from public.insurance_policies where id = p_policy_id;
  if v_policy.id is null then
    raise exception 'no such policy' using errcode = '42501';
  end if;
  if not private.is_org_staff(v_policy.organisation_id) then
    raise exception 'only care-team staff can request pre-authorisation' using errcode = '42501';
  end if;
  if p_service_category not in ('consultation', 'laboratory', 'pharmacy', 'referral') then
    raise exception 'unknown service_category: %', p_service_category using errcode = '22023';
  end if;

  select * into v_insurer from public.insurers where id = v_policy.insurer_id;
  if not coalesce(v_insurer.is_active, false) then
    raise exception '% is not yet active on Tarragon — activate it before requesting pre-authorisation', v_insurer.name
      using errcode = '23514';
  end if;

  insert into public.insurance_preauthorizations
    (organisation_id, policy_id, service_category, source_id, estimated_amount_kobo,
     clinical_justification, requested_by)
  values
    (v_policy.organisation_id, p_policy_id, p_service_category, p_source_id, p_estimated_amount_kobo,
     p_clinical_justification, (select auth.uid()))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'preauthorization_id', v_id, 'status', 'pending');
end;
$$;

revoke all on function public.request_preauthorization(uuid, text, bigint, uuid, text) from public;
revoke all on function public.request_preauthorization(uuid, text, bigint, uuid, text) from anon;
grant execute on function public.request_preauthorization(uuid, text, bigint, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- submit_insurance_claim — same refusal, same reason.
-- ---------------------------------------------------------------------------
create or replace function public.submit_insurance_claim(
  p_policy_id uuid,
  p_service_category text,
  p_source_id uuid,
  p_billed_amount_kobo bigint,
  p_preauthorization_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.insurance_policies%rowtype;
  v_insurer public.insurers%rowtype;
  v_coverage jsonb;
  v_copay bigint;
  v_id uuid;
begin
  select * into v_policy from public.insurance_policies where id = p_policy_id;
  if v_policy.id is null then
    raise exception 'no such policy' using errcode = '42501';
  end if;
  if not private.is_org_staff(v_policy.organisation_id) then
    raise exception 'only care-team staff can submit a claim' using errcode = '42501';
  end if;
  if p_service_category not in ('consultation', 'laboratory', 'pharmacy', 'referral') then
    raise exception 'unknown service_category: %', p_service_category using errcode = '22023';
  end if;

  select * into v_insurer from public.insurers where id = v_policy.insurer_id;
  if not coalesce(v_insurer.is_active, false) then
    raise exception '% is not yet active on Tarragon — activate it before submitting a claim', v_insurer.name
      using errcode = '23514';
  end if;

  v_coverage := public.check_insurance_coverage(v_policy.patient_id, p_service_category, p_billed_amount_kobo);
  v_copay := coalesce((v_coverage ->> 'patient_responsibility_kobo')::bigint, p_billed_amount_kobo);

  insert into public.insurance_claims
    (organisation_id, policy_id, preauthorization_id, service_category, source_id,
     billed_amount_kobo, patient_copay_kobo, submitted_by)
  values
    (v_policy.organisation_id, p_policy_id, p_preauthorization_id, p_service_category, p_source_id,
     p_billed_amount_kobo, v_copay, (select auth.uid()))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'claim_id', v_id, 'estimated_patient_copay_kobo', v_copay);
end;
$$;

revoke all on function public.submit_insurance_claim(uuid, text, uuid, bigint, uuid) from public;
revoke all on function public.submit_insurance_claim(uuid, text, uuid, bigint, uuid) from anon;
grant execute on function public.submit_insurance_claim(uuid, text, uuid, bigint, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Assertions.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.insurers where is_active) then
    raise exception 'FAIL: at least one insurer is still active — insurance must ship dormant';
  end if;

  if (select count(*) from public.insurers) < 4 then
    raise exception 'FAIL: the reference insurers are missing';
  end if;

  if pg_get_functiondef('public.check_insurance_coverage(uuid,text,bigint)'::regprocedure)
       not like '%is not yet active on Tarragon%' then
    raise exception 'FAIL: check_insurance_coverage does not gate on insurer activation';
  end if;
  if pg_get_functiondef('public.request_preauthorization(uuid,text,bigint,uuid,text)'::regprocedure)
       not like '%is not yet active on Tarragon%' then
    raise exception 'FAIL: request_preauthorization does not gate on insurer activation';
  end if;
  if pg_get_functiondef('public.submit_insurance_claim(uuid,text,uuid,bigint,uuid)'::regprocedure)
       not like '%is not yet active on Tarragon%' then
    raise exception 'FAIL: submit_insurance_claim does not gate on insurer activation';
  end if;

  raise notice 'PASS: insurance ships dormant — every seeded insurer inactive, every write/coverage RPC gated on activation';
end $$;
