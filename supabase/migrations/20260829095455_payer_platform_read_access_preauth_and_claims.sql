-- Tarragon Health — module 27, part 5: give a payer_admin read access to
-- their OWN insurer's pre-authorisation requests and claims.
--
-- insurance_preauthorizations/insurance_claims (20260829011713) only ever
-- granted select to private.is_org_staff(organisation_id) (Tarragon care
-- team) or the policy's own patient — deliberately, since payer_admin is
-- excluded from is_org_staff on purpose. That correctly stops an accidental
-- widen; it also means the insurer itself, once it has a login, could not
-- see its own queue of requests to decide on — the entire point of
-- payer_decide_preauthorization()/payer_adjudicate_claim() (20260829093550).
-- These two policies are the missing read path, scoped through the
-- policy's insurer via private.is_payer_admin_for() exactly like every
-- other payer-side check in this module.

create policy insurance_preauthorizations_payer_select on public.insurance_preauthorizations
  for select to authenticated
  using (
    exists (
      select 1 from public.insurance_policies ip
      where ip.id = policy_id and private.is_payer_admin_for(ip.insurer_id)
    )
  );

create policy insurance_claims_payer_select on public.insurance_claims
  for select to authenticated
  using (
    exists (
      select 1 from public.insurance_policies ip
      where ip.id = policy_id and private.is_payer_admin_for(ip.insurer_id)
    )
  );

do $$
begin
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'insurance_preauthorizations'
        and policyname = 'insurance_preauthorizations_payer_select') <> 1 then
    raise exception 'FAIL: insurance_preauthorizations_payer_select was not created';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'insurance_claims'
        and policyname = 'insurance_claims_payer_select') <> 1 then
    raise exception 'FAIL: insurance_claims_payer_select was not created';
  end if;
  raise notice 'PASS: payer read access to its own preauthorizations/claims in place';
end $$;
