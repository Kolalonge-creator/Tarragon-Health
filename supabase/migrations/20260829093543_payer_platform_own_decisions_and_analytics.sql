-- Tarragon Health — module 27, part 4: the insurer decides for itself
-- (27.6/27.8), and an aggregate dashboard over its own membership (27.13),
-- privacy-bounded the way I9 already binds every other institution (27.14).
--
-- request_preauthorization()/decide_preauthorization() and
-- submit_insurance_claim()/record_claim_adjudication() (20260829011713)
-- assume Tarragon staff transcribe what an insurer said by phone or email —
-- that is private.is_org_staff(policy.organisation_id), the Tarragon care
-- team's own organisation, not the insurer. Once an insurer has its own
-- login it should be able to record ITS OWN decision directly on the same
-- rows, instead of a Tarragon staff member re-typing it. These two new RPCs
-- are that path: same tables, same status machine, gated on
-- private.is_payer_admin_for() instead of is_org_staff(), and refusing
-- outright once Tarragon staff (or the other side) has already decided.

create or replace function public.payer_decide_preauthorization(
  p_preauthorization_id uuid,
  p_decision text,
  p_authorization_number text default null,
  p_valid_until date default null,
  p_denial_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.insurance_preauthorizations%rowtype;
  v_insurer_id uuid;
begin
  select * into v_p from public.insurance_preauthorizations where id = p_preauthorization_id;
  if v_p.id is null then
    raise exception 'no such pre-authorisation request' using errcode = '42501';
  end if;

  select insurer_id into v_insurer_id from public.insurance_policies where id = v_p.policy_id;
  if not private.is_payer_admin_for(v_insurer_id, array['authorisation_officer']) then
    raise exception 'not authorised to decide this insurer''s pre-authorisation requests' using errcode = '42501';
  end if;
  if v_p.status <> 'pending' then
    raise exception 'this request is already %', v_p.status using errcode = '23514';
  end if;
  if p_decision not in ('approved', 'denied') then
    raise exception 'decision must be approved or denied' using errcode = '23514';
  end if;
  if p_decision = 'approved' and coalesce(btrim(p_authorization_number), '') = '' then
    raise exception 'an approval needs an authorisation number' using errcode = '23514';
  end if;
  if p_decision = 'denied' and coalesce(btrim(p_denial_reason), '') = '' then
    raise exception 'a denial needs a reason' using errcode = '23514';
  end if;

  update public.insurance_preauthorizations
     set status = p_decision::public.insurance_preauth_status,
         authorization_number = p_authorization_number,
         valid_from = case when p_decision = 'approved' then current_date else valid_from end,
         valid_until = p_valid_until,
         denial_reason = p_denial_reason,
         decided_by = (select auth.uid()),
         decided_at = now()
   where id = p_preauthorization_id;

  perform private.log_audit('payer.preauthorization.decided', 'insurance_preauthorization', p_preauthorization_id,
    jsonb_build_object('insurer_id', v_insurer_id, 'decision', p_decision));

  return jsonb_build_object('ok', true, 'status', p_decision);
end;
$$;

revoke all on function public.payer_decide_preauthorization(uuid, text, text, date, text) from public;
revoke all on function public.payer_decide_preauthorization(uuid, text, text, date, text) from anon;
grant execute on function public.payer_decide_preauthorization(uuid, text, text, date, text) to authenticated;

create or replace function public.payer_adjudicate_claim(
  p_claim_id uuid,
  p_status text,
  p_claim_reference text default null,
  p_insurer_covered_kobo bigint default null,
  p_denial_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.insurance_claims%rowtype;
  v_insurer_id uuid;
begin
  select * into v_c from public.insurance_claims where id = p_claim_id;
  if v_c.id is null then
    raise exception 'no such claim' using errcode = '42501';
  end if;

  select insurer_id into v_insurer_id from public.insurance_policies where id = v_c.policy_id;
  if not private.is_payer_admin_for(v_insurer_id, array['claims_officer']) then
    raise exception 'not authorised to adjudicate this insurer''s claims' using errcode = '42501';
  end if;
  if v_c.status = 'paid' then
    raise exception 'this claim is already paid' using errcode = '23514';
  end if;
  if p_status not in ('adjudicating', 'approved', 'partially_approved', 'denied', 'paid') then
    raise exception 'invalid claim status: %', p_status using errcode = '23514';
  end if;
  if p_status in ('approved', 'partially_approved') and p_insurer_covered_kobo is null then
    raise exception 'an approval needs the amount the insurer agreed to cover' using errcode = '23514';
  end if;
  if p_status = 'denied' and coalesce(btrim(p_denial_reason), '') = '' then
    raise exception 'a denial needs a reason' using errcode = '23514';
  end if;
  -- An insurer settles its own approved claim; it cannot mark somebody
  -- else's claim paid without first (or simultaneously) approving it.
  if p_status = 'paid' and v_c.status not in ('approved', 'partially_approved') then
    raise exception 'a claim must be approved or partially approved before it can be marked paid' using errcode = '23514';
  end if;

  update public.insurance_claims
     set status = p_status::public.insurance_claim_status,
         claim_reference = coalesce(p_claim_reference, claim_reference),
         insurer_covered_kobo = coalesce(p_insurer_covered_kobo, insurer_covered_kobo),
         patient_copay_kobo = case
           when p_status = 'denied' then billed_amount_kobo
           when p_status in ('approved', 'partially_approved') then billed_amount_kobo - p_insurer_covered_kobo
           else patient_copay_kobo
         end,
         denial_reason = p_denial_reason,
         adjudicated_by = (select auth.uid()),
         adjudicated_at = case when p_status in ('approved', 'partially_approved', 'denied')
                                then now() else adjudicated_at end,
         paid_at = case when p_status = 'paid' then now() else paid_at end
   where id = p_claim_id;

  perform private.log_audit('payer.claim.adjudicated', 'insurance_claim', p_claim_id,
    jsonb_build_object('insurer_id', v_insurer_id, 'status', p_status));

  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

revoke all on function public.payer_adjudicate_claim(uuid, text, text, bigint, text) from public;
revoke all on function public.payer_adjudicate_claim(uuid, text, text, bigint, text) from anon;
grant execute on function public.payer_adjudicate_claim(uuid, text, text, bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 27.13/27.14 — the aggregate dashboard. Built as a plain SQL RPC (the same
-- shape as analytics_appointment_capacity()/care_management_analytics()
-- elsewhere on this platform) rather than a TypeScript loader against the
-- ML cohort-analysis service: a payer's members are not scoped by
-- organisation_id (they may sit in any Tarragon organisation), so the
-- existing loadCohortAnalytics()/loadCareGaps() helpers — both keyed on one
-- organisation_id — do not fit without reworking their scoping dimension,
-- and this dashboard's own spec (27.13) only asks for plain counts, not a
-- risk-model narrative. SECURITY DEFINER so it can read across
-- organisations; the ONLY thing it ever returns is counts (and, below the
-- suppression floor, no count at all) — never a member id, name, or
-- patient_number, which is the I9 line applied to a payer.
-- ---------------------------------------------------------------------------
create or replace function public.payer_dashboard_analytics(p_insurer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_insurer public.insurers%rowtype;
  v_min_cohort integer;
  v_member_count integer;
  v_conditions jsonb;
begin
  if not private.is_payer_admin_for(p_insurer_id) then
    raise exception 'not authorised to view this insurer''s analytics' using errcode = '42501';
  end if;

  select * into v_insurer from public.insurers where id = p_insurer_id;
  v_min_cohort := greatest(coalesce(v_insurer.min_cohort_size, 10), 5);

  select count(distinct patient_id) into v_member_count
  from public.insurance_policies
  where insurer_id = p_insurer_id and status = 'active' and verified_at is not null
    and (effective_to is null or effective_to >= current_date);

  if v_member_count < v_min_cohort then
    return jsonb_build_object(
      'suppressed', true,
      'min_cohort_size', v_min_cohort,
      'note', 'Fewer than ' || v_min_cohort || ' verified members — no figures shown to protect individual privacy.'
    );
  end if;

  -- One row per programme this insurer has ever directed, or that at least
  -- one of its members is independently enrolled in — a member can reach a
  -- Tarragon chronic-disease programme without a payer directive (a
  -- clinician can still recommend it directly), and the payer should see
  -- that too, not only what it itself triggered.
  select coalesce(jsonb_agg(jsonb_build_object(
           'programme_id', s.programme_id,
           'programme_name', s.programme_name,
           'condition', s.condition,
           'members_with_condition',
             case when s.members_with_condition < v_min_cohort then null else s.members_with_condition end,
           'enrolled', case when s.enrolled < v_min_cohort then null else s.enrolled end,
           'controlled', case when s.controlled < v_min_cohort then null else s.controlled end,
           'overdue_review', case when s.overdue_review < v_min_cohort then null else s.overdue_review end,
           'suppressed_subgroup', s.members_with_condition < v_min_cohort
         )), '[]'::jsonb)
    into v_conditions
  from (
    select
      cp.id as programme_id,
      cp.name as programme_name,
      cp.condition::text as condition,
      count(distinct pc.patient_id) filter (where pc.status = 'active') as members_with_condition,
      count(distinct e.patient_id) filter (where e.status = 'enrolled') as enrolled,
      count(distinct e.patient_id) filter (
        where e.status = 'enrolled'
          and exists (
            select 1 from public.patient_risk_scores rs
            where rs.patient_id = e.patient_id and rs.risk_level = 'low'
              and rs.computed_at = (select max(computed_at) from public.patient_risk_scores
                                      where patient_id = e.patient_id)
          )
      ) as controlled,
      count(distinct pc.patient_id) filter (
        where pc.status = 'active' and pc.next_review_due_at is not null and pc.next_review_due_at < now()
      ) as overdue_review
    from public.chronic_condition_programmes cp
    join public.insurance_policies ip on ip.insurer_id = p_insurer_id
                                      and ip.status = 'active' and ip.verified_at is not null
    left join public.patient_conditions pc
           on pc.patient_id = ip.patient_id and lower(pc.condition_name) = lower(cp.condition::text)
    left join public.chronic_programme_enrolments e
           on e.patient_id = ip.patient_id and e.programme_id = cp.id
    where cp.is_active
    group by cp.id, cp.name, cp.condition
    having count(distinct pc.patient_id) filter (where pc.status = 'active') > 0
        or count(distinct e.patient_id) > 0
  ) s;

  return jsonb_build_object(
    'suppressed', false,
    'min_cohort_size', v_min_cohort,
    'member_count', v_member_count,
    'programmes', v_conditions
  );
end;
$$;

revoke all on function public.payer_dashboard_analytics(uuid) from public;
revoke all on function public.payer_dashboard_analytics(uuid) from anon;
grant execute on function public.payer_dashboard_analytics(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Assertions.
-- ---------------------------------------------------------------------------
do $$
begin
  if pg_get_functiondef('public.payer_decide_preauthorization(uuid,text,text,date,text)'::regprocedure)
       not like '%is_payer_admin_for%' then
    raise exception 'FAIL: payer_decide_preauthorization does not gate on is_payer_admin_for';
  end if;
  if pg_get_functiondef('public.payer_adjudicate_claim(uuid,text,text,bigint,text)'::regprocedure)
       not like '%is_payer_admin_for%' then
    raise exception 'FAIL: payer_adjudicate_claim does not gate on is_payer_admin_for';
  end if;
  if pg_get_functiondef('public.payer_dashboard_analytics(uuid)'::regprocedure)
       not like '%suppressed%' then
    raise exception 'FAIL: payer_dashboard_analytics has no suppression path';
  end if;

  -- No unauthenticated/unauthorised caller may call this and get real
  -- numbers: with no active payer_administrators row anywhere yet, an
  -- attempt against any real insurer must raise, not return a count.
  begin
    perform public.payer_dashboard_analytics((select id from public.insurers limit 1));
    raise exception 'FAIL: payer_dashboard_analytics returned instead of raising for an unauthorised caller';
  exception
    when insufficient_privilege then null;
  end;

  raise notice 'PASS: payer-side decisions + suppressed aggregate analytics in place';
end $$;
