-- Specialist booking and commission suspended; the referral LETTER kept.
--
-- The letter is the clinically meaningful half of a referral: without it a
-- patient turns up at a specialist with nothing but their own account of why
-- they came. So this pins that the clinical act still works while the booking
-- and the fee are refused.
--
-- Rolled back. Run from the MAIN checkout:
--   npx supabase db query --linked -f packages/db/tests/self_arranged_referrals.sql

begin;
create temp table r(step text, verdict text) on commit drop;

do $$
declare
  v_org uuid; v_pt uuid; v_spec uuid; v_staff_profile uuid; v_ref uuid; v_row public.specialist_referrals%rowtype;
begin
  select id, organisation_id into v_pt, v_org from public.profiles
   where role='patient' and organisation_id is not null order by created_at limit 1;
  select id into v_spec from public.specialist_providers limit 1;
  -- Since 20260829160522_specialist_referral_create_gate.sql, creating a
  -- specialist_referrals row requires a clinical-tier caller
  -- (private.is_clinical_tier, reading auth.uid()) — simulate one the same
  -- way tier_authority_monotonicity.sql does, via request.jwt.claims.
  --
  -- Note on case 5 below: 20260828233653_activate_partner_specialist_booking.sql
  -- (concurrent work, recovered into git the same day as this edit)
  -- reactivated set_referral_specialist_provider for a genuinely active,
  -- specialty-matched partner — it no longer hard-blocks on fulfilment at
  -- all. Case 5 still passes today because every specialist_providers row
  -- is is_active=false (confirmed live), so it still raises check_violation
  -- — just "not on file as an active partner" rather than "nobody to assign
  -- here". If a real partner is ever activated, this case would need a
  -- fresh look at what it's actually proving.
  select cs.profile_id into v_staff_profile
  from public.clinical_staff cs
  where cs.organisation_id = v_org and cs.active
    and (cs.is_clinical_director or cs.doctor_tier in
      ('tier_1','tier_2','tier_3','tier_4_senior_registrar','tier_5_partner_specialist'))
  limit 1;
  if v_pt is null or v_spec is null or v_staff_profile is null then
    raise exception 'fixture lookup failed - test would be vacuous';
  end if;
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_staff_profile, 'role', 'authenticated')::text,
    true
  );

  insert into public.specialist_referrals
    (organisation_id, patient_id, specialist_type, referral_reason, status, referral_fee_kobo, urgency)
  values (v_org, v_pt, 'cardiology', 'Persistently raised BP despite two agents', 'pending', 0, 'urgent')
  returning id into v_ref;
  insert into r values ('1 a referral can still be written', 'PASS');

  select * into v_row from public.specialist_referrals where id = v_ref;
  insert into r values ('2 it is self-arranged, no specialist, no fee',
    case when v_row.fulfilment='self_arranged' and v_row.specialist_provider_id is null
          and v_row.referral_fee_kobo=0 then 'PASS' else 'FAIL' end);

  begin
    insert into public.specialist_referrals
      (organisation_id, patient_id, specialist_type, status, referral_fee_kobo, specialist_provider_id)
    values (v_org, v_pt, 'cardiology', 'pending', 0, v_spec);
    insert into r values ('3 naming a partner specialist blocked','FAIL - accepted');
  exception when check_violation then insert into r values ('3 naming a partner specialist blocked','PASS'); end;

  begin
    insert into public.specialist_referrals
      (organisation_id, patient_id, specialist_type, status, referral_fee_kobo)
    values (v_org, v_pt, 'cardiology', 'pending', 2500000);
    insert into r values ('4 charging a referral fee blocked','FAIL - accepted');
  exception when check_violation then insert into r values ('4 charging a referral fee blocked','PASS'); end;

  begin
    perform public.set_referral_specialist_provider(v_ref, v_spec);
    insert into r values ('5 assigning a specialist refused with an explanation','FAIL - accepted');
  exception when check_violation then insert into r values ('5 assigning a specialist refused with an explanation','PASS'); end;

  -- CONTROL: suspending the booking must not have cost the letter its content.
  insert into r values ('6 CONTROL the letter still has its content',
    case when v_row.referral_reason is not null and v_row.urgency='urgent'
          and v_row.specialist_type='cardiology' then 'PASS' else 'FAIL' end);
end $$;

select step, verdict from r order by step;
rollback;
