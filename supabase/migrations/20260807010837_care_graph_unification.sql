-- Tarragon Health — the care graph, part 2: one graph, one revoke.
--
-- The pieces of "who is around this person's care" were all built and all
-- shipped, and no single screen or query ever put them together:
--
--   profile_access          who holds a grant, at which level
--   .clinical_access        whether that grant may read health information
--   care_access_requests    proposals not yet accepted, in either direction
--   care_vouchers           who has actually paid for this person's care
--   subscriptions           .paid_by_profile_id, who funds the plan
--   care_team_assignment    the clinicians and coordinator on the case
--
-- A patient could see fragments of that across two pages and could not see
-- some of it at all. Most importantly: a person can FUND your care without
-- holding any grant over your record, and there was nowhere you would ever
-- learn that had happened. public.my_care_graph() below is the whole picture,
-- from the record owner's point of view, in one call.
--
-- Three real gaps are closed here, not just consolidated.
--
--   1. A 'manage' grant could not be revoked from the UI at all. Revocation
--      existed (revokeCareAccessAction) but was reachable only from the
--      next-of-kin card, which handles the single 'view' grant. The eldercare
--      grant — the most powerful one, the one that can order medication and
--      spend money — had no take-back anywhere. That is now
--      public.revoke_care_access, and part 4 of this build puts a button on
--      every row of the graph.
--
--   2. A grantee could not walk away. Only the owner could delete a grant
--      (profile_access_delete is scoped to profile_id = auth.uid()), so
--      someone who no longer wanted responsibility for a relative's record had
--      to ask that relative to remove them. Either party may now revoke.
--
--   3. care_vouchers_select admitted ANY profile_access grantee with no
--      consent check — the same shape of hole this codebase already found and
--      closed twice, in lab_analyte_readings and patient_timeline
--      (20260731185243). A voucher carries sku_name: 'Cervical Cancer
--      Screening', 'Diabetes Complete Care'. What care someone is receiving is
--      health information, so a next of kin who was nominated to be phoned in
--      an emergency should not read it. Re-pointed at the same consent
--      predicate as everything else. A purchaser always keeps sight of their
--      own purchase — that clause is untouched, so no sponsor loses their own
--      receipt.
--
-- Row counts before this migration: profile_access 0, care_vouchers 0,
-- subscriptions with a payer 0. Pure structural change, nothing to convert.

-- --- 1. the voucher hole -------------------------------------------------------
drop policy if exists care_vouchers_select on public.care_vouchers;
create policy care_vouchers_select on public.care_vouchers
  for select to authenticated
  using (
    beneficiary_profile_id = (select auth.uid())
    or purchaser_profile_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(beneficiary_profile_id)
  );

-- --- 2. revocation, by either party --------------------------------------------
-- SECURITY DEFINER because the grantee side cannot be expressed as an RLS
-- DELETE without also letting a grantee delete a rival grantee's row: the
-- policy would have to admit grantee_user_id = auth.uid(), and a policy cannot
-- easily say "only your own row, and only to remove yourself". Doing it in a
-- function lets the rule be stated exactly, and re-verified in-body against
-- the row rather than trusted from the caller — the same pattern as
-- respond_to_care_access_request.
--
-- The care_access_events row is written by the profile_access lifecycle
-- trigger (20260807010452), not here, so the audit trail survives the deleted
-- grant and records WHICH party did the revoking.
create or replace function public.revoke_care_access(p_grant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_caller uuid := (select auth.uid());
  v_grant  public.profile_access;
  v_owner_name   text;
  v_grantee_name text;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_grant from public.profile_access where id = p_grant_id for update;
  if not found then
    -- Already gone. Idempotent rather than an error: two taps on a slow
    -- connection should not show the patient a failure for something that did
    -- in fact happen.
    return jsonb_build_object('revoked', false, 'reason', 'already_removed');
  end if;

  if v_caller <> v_grant.profile_id and v_caller <> v_grant.grantee_user_id then
    raise exception 'only the person whose record it is, or the person holding the access, may remove it'
      using errcode = '42501';
  end if;

  select full_name into v_owner_name   from public.profiles where id = v_grant.profile_id;
  select full_name into v_grantee_name from public.profiles where id = v_grant.grantee_user_id;

  delete from public.profile_access where id = p_grant_id;

  -- Tell the other party. Losing access to a relative's record without being
  -- told is how someone finds out days later, at the worst moment. in_app
  -- only: a family-consent action, not a clinical alert, same channel choice
  -- as care_access_requests.
  begin
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    select
      p.organisation_id,
      case when v_caller = v_grant.profile_id then v_grant.grantee_user_id else v_grant.profile_id end,
      'in_app', 'pending', 'care_access_revoked',
      jsonb_build_object(
        'by_owner', v_caller = v_grant.profile_id,
        'owner_name', coalesce(v_owner_name, 'Someone'),
        'grantee_name', coalesce(v_grantee_name, 'Someone'),
        'permission_level', v_grant.permission_level
      )
    from public.profiles p
    where p.id = case when v_caller = v_grant.profile_id
                      then v_grant.grantee_user_id else v_grant.profile_id end;
  exception
    when others then
      raise warning 'revocation notice failed for grant %: %', p_grant_id, sqlerrm;
  end;

  return jsonb_build_object(
    'revoked', true,
    'permission_level', v_grant.permission_level,
    'by_owner', v_caller = v_grant.profile_id,
    'grantee_name', v_grantee_name,
    'owner_name', v_owner_name
  );
end;
$$;

-- anon inherits EXECUTE through the PUBLIC pseudo-role, so `revoke from public`
-- is the revoke that actually does anything; the `from anon` line is defence in
-- depth and is a no-op on its own. See feedback_supabase_anon_execute_gotcha.
revoke all on function public.revoke_care_access(uuid) from public, anon;
revoke execute on function public.revoke_care_access(uuid) from anon;
grant execute on function public.revoke_care_access(uuid) to authenticated;

-- --- 3. the graph ---------------------------------------------------------------
-- No parameter, deliberately. This function only ever describes the caller's
-- own record, so there is no argument for a caller to point at somebody else.
--
-- SECURITY DEFINER for one reason: a person can fund your care while holding no
-- grant over your record, and profiles_select would not let you resolve their
-- name. Being told who is paying for your treatment is not a privacy loss to
-- you, it is the opposite — so the function reaches past RLS for exactly that,
-- and for nothing else.
create or replace function public.my_care_graph()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_me       uuid := (select auth.uid());
  v_grants   jsonb;
  v_requests jsonb;
  v_funders  jsonb;
  v_team     jsonb;
  v_others   jsonb;
begin
  if v_me is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- (a) People who hold access to MY record, with what they can actually do.
  -- last_active_at comes from the access log, so "she has never opened it" is
  -- a fact the patient can see rather than something they have to assume.
  select coalesce(jsonb_agg(g order by g->>'name'), '[]'::jsonb) into v_grants
  from (
    select jsonb_build_object(
      'grant_id',          pa.id,
      'profile_id',        pa.grantee_user_id,
      'name',              coalesce(nullif(trim(p.full_name), ''), 'Someone you added'),
      'permission_level',  pa.permission_level,
      'clinical_access',   pa.clinical_access,
      'since',             pa.created_at,
      'clinical_access_changed_at', pa.clinical_access_updated_at,
      'funds_me', exists (
        select 1 from public.care_vouchers cv
         where cv.beneficiary_profile_id = v_me
           and cv.purchaser_profile_id = pa.grantee_user_id
           and cv.amount_paid_kobo > 0
      ) or exists (
        select 1 from public.subscriptions s
         where s.subscriber_id = v_me and s.paid_by_profile_id = pa.grantee_user_id
      ),
      'last_active_at', (
        select max(e.occurred_at) from public.care_access_events e
         where e.patient_id = v_me
           and e.actor_profile_id = pa.grantee_user_id
           and e.kind in ('record_viewed', 'receipt_generated', 'acted_for')
      )
    ) as g
    from public.profile_access pa
    join public.profiles p on p.id = pa.grantee_user_id
    where pa.profile_id = v_me
  ) rows;

  -- (b) Proposals still open, either direction, with who has the next move.
  select coalesce(jsonb_agg(r order by r->>'created_at' desc), '[]'::jsonb) into v_requests
  from (
    select jsonb_build_object(
      'request_id',       car.id,
      'permission_level', car.permission_level,
      'relationship',     car.relationship,
      'created_at',       car.created_at,
      'about_my_record',  car.profile_id = v_me,
      'i_initiated',      car.initiated_by = v_me,
      'awaiting_me',      car.initiated_by <> v_me,
      'other_name', coalesce(nullif(trim(op.full_name), ''), 'Someone')
    ) as r
    from public.care_access_requests car
    join public.profiles op
      on op.id = case when car.profile_id = v_me then car.counterparty_user_id else car.profile_id end
    where car.status = 'pending'
      and (car.profile_id = v_me or car.counterparty_user_id = v_me)
  ) rows;

  -- (c) People paying for my care. Money only — an amount and a date, never
  -- what the money bought, because this list is about the relationship and a
  -- funder who holds no grant has been told nothing about my health.
  select coalesce(jsonb_agg(f order by (f->>'total_kobo')::bigint desc), '[]'::jsonb) into v_funders
  from (
    select jsonb_build_object(
      'profile_id', x.payer,
      'name', coalesce(nullif(trim(p.full_name), ''), 'Someone'),
      'total_kobo', x.total_kobo,
      'last_paid_at', x.last_paid_at,
      'funds_my_plan', x.funds_plan,
      'holds_access', exists (
        select 1 from public.profile_access pa
         where pa.profile_id = v_me and pa.grantee_user_id = x.payer
      )
    ) as f
    from (
      select payer,
             sum(total_kobo)::bigint as total_kobo,
             max(last_paid_at) as last_paid_at,
             bool_or(funds_plan) as funds_plan
      from (
        select cv.purchaser_profile_id as payer,
               sum(cv.amount_paid_kobo) as total_kobo,
               max(cv.created_at) as last_paid_at,
               false as funds_plan
          from public.care_vouchers cv
         where cv.beneficiary_profile_id = v_me
           and cv.purchaser_profile_id is not null
           and cv.purchaser_profile_id <> v_me
           and cv.amount_paid_kobo > 0
         group by cv.purchaser_profile_id
        union all
        select s.paid_by_profile_id, 0::bigint, max(s.started_at), true
          from public.subscriptions s
         where s.subscriber_id = v_me
           and s.paid_by_profile_id is not null
           and s.paid_by_profile_id <> v_me
         group by s.paid_by_profile_id
      ) u
      group by payer
    ) x
    join public.profiles p on p.id = x.payer
  ) rows;

  -- (d) The care team. Present as a node in the graph because it answers the
  -- same question the rest of the list answers — who can see this record — and
  -- leaving it out would imply the answer is only "the people I invited".
  --
  -- Deliberately NOT a list of named doctors: care here is delivered by a team
  -- with shared coverage, and naming one person as "your doctor" is the
  -- promise this platform retired on 2026-07-30. Per-case attribution is real
  -- and lives on the case — see the receipt, which names the actual doctor who
  -- actually reviewed each thing, from patient_timeline.actor_clinical_staff_id.
  select jsonb_build_object(
    'kind', 'care_team',
    'revocable', false,
    'assigned', exists (select 1 from public.care_team_assignment cta where cta.patient_id = v_me),
    'doctors_who_reviewed_me', (
      select count(distinct pt.actor_clinical_staff_id)
        from public.patient_timeline pt
       where pt.patient_id = v_me and pt.actor_clinical_staff_id is not null
    )
  ) into v_team;

  -- (e) The mirror: records I can see because someone else granted me access.
  -- Same page, opposite direction. A person is usually on both sides of this
  -- graph at once and should not need two screens to see that.
  select coalesce(jsonb_agg(o order by o->>'name'), '[]'::jsonb) into v_others
  from (
    select jsonb_build_object(
      'grant_id',         pa.id,
      'profile_id',       pa.profile_id,
      'name',             coalesce(nullif(trim(p.full_name), ''), 'Someone'),
      'permission_level', pa.permission_level,
      'clinical_access',  pa.clinical_access,
      'is_dependent_account', coalesce(p.is_dependent_account, false),
      'since',            pa.created_at
    ) as o
    from public.profile_access pa
    join public.profiles p on p.id = pa.profile_id
    where pa.grantee_user_id = v_me
  ) rows;

  return jsonb_build_object(
    'people_with_access', v_grants,
    'pending_requests',   v_requests,
    'people_funding_me',  v_funders,
    'care_team',          v_team,
    'records_i_can_see',  v_others
  );
end;
$$;

revoke all on function public.my_care_graph() from public, anon;
revoke execute on function public.my_care_graph() from anon;
grant execute on function public.my_care_graph() to authenticated;

-- --- 4. the migration is the test -------------------------------------------------
do $$
declare
  v_def text;
begin
  if has_function_privilege('anon', 'public.my_care_graph()', 'EXECUTE')
     or has_function_privilege('anon', 'public.revoke_care_access(uuid)', 'EXECUTE') then
    raise exception 'anon must not reach the care graph';
  end if;

  if not has_function_privilege('authenticated', 'public.my_care_graph()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.revoke_care_access(uuid)', 'EXECUTE') then
    raise exception 'authenticated must reach the care graph';
  end if;

  -- The voucher policy must be consent-gated, not grant-gated. If someone
  -- later re-widens it to a bare profile_access EXISTS, this fails.
  select qual::text into v_def
    from pg_policies
   where schemaname = 'public' and tablename = 'care_vouchers'
     and policyname = 'care_vouchers_select';

  if v_def is null or v_def not like '%can_read_clinical%' then
    raise exception 'care_vouchers_select must be gated on can_read_clinical, got: %', v_def;
  end if;

  if v_def like '%profile_access%' then
    raise exception 'care_vouchers_select still admits a bare profile_access grantee';
  end if;

  -- my_care_graph must take no argument. A parameterised version would let a
  -- caller ask about somebody else's record, and the whole safety of the
  -- function is that it cannot be pointed anywhere but at the caller.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'my_care_graph' and p.pronargs > 0
  ) then
    raise exception 'my_care_graph must take no arguments';
  end if;

  -- revoke_care_access must never be able to remove a grant for a third party.
  if pg_get_functiondef('public.revoke_care_access(uuid)'::regprocedure)
       not like '%v_caller <> v_grant.profile_id and v_caller <> v_grant.grantee_user_id%' then
    raise exception 'revoke_care_access has lost its two-party check';
  end if;
end $$;
