-- ---------------------------------------------------------------------------
-- Removal 4 verification: individual enrolment, and what replaced the family
-- plan.
--
-- Run inside a transaction that is ROLLED BACK. Nothing here persists.
--
-- The claim being tested is the founder's, in their words: a next of kin
-- "should be able to view the activities on the elderly person account but not
-- edit it", and "each person should maintain their own account". A test that
-- only showed the next of kin being blocked would prove nothing — a broken
-- grant blocks everything — so every negative check is paired with a control
-- that must succeed in the same transaction.
--
--   owner        the person whose record it is
--   next of kin  profile_access at level 'view'   -> may read, must not write
--   guardian     profile_access at level 'manage' -> may read AND write (control)
--   stranger     no grant at all                  -> must see nothing
--
-- Usage:
--   npx supabase db query --linked -f packages/db/tests/individual_enrolment_and_next_of_kin.sql
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_owner    uuid := gen_random_uuid();  -- Ada Lovelace
  v_kin      uuid := gen_random_uuid();  -- next of kin, 'view'
  v_guardian uuid := gen_random_uuid();  -- control, 'manage'
  v_stranger uuid := gen_random_uuid();  -- no grant
  v_org      uuid := '00000000-0000-0000-0000-000000000001';
  v_vax      uuid;
  v_n        int;
  v_wrote    boolean;
begin
  -- Self-provisioned fixtures (fresh-database pattern) -- these four are pure
  -- relationship roles (owner/kin/guardian/stranger) for the profile_access
  -- grant checks below, so a plain patient profile is all each one needs; no
  -- demographic fields are asserted on anywhere in this file.
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_owner, 'individual-enrolment-ada-owner@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Ada Lovelace'
    where id = v_owner;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_kin, 'individual-enrolment-next-of-kin@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Individual Enrolment Test Next of Kin'
    where id = v_kin;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_guardian, 'individual-enrolment-guardian@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Individual Enrolment Test Guardian'
    where id = v_guardian;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_stranger, 'individual-enrolment-stranger@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Individual Enrolment Test Stranger'
    where id = v_stranger;

  select id into v_vax from public.vaccination_catalog limit 1;

  -- ---- 1. The billing construct is gone --------------------------------------
  if to_regclass('public.family_plan_members') is not null then
    raise exception 'FAIL: family_plan_members still exists';
  end if;
  select count(*) into v_n from public.subscription_plans
   where code like 'family%' or code like 'parentcare%';
  if v_n <> 0 then raise exception 'FAIL: % household plan rows remain', v_n; end if;
  raise notice 'PASS  household billing removed';

  -- ---- 2. And the consent model survived it ----------------------------------
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_owner, v_kin, 'view', v_owner),
         (v_owner, v_guardian, 'manage', v_owner);

  -- A dose to look at, written as the system rather than as any test persona.
  insert into public.vaccination_records
    (organisation_id, profile_id, vaccination_catalog_id, dose_number, date_administered)
  values (v_org, v_owner, v_vax, 1, current_date);

  -- ---- 3. The next of kin can see the record ---------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_kin, 'role', 'authenticated')::text, true);

  select count(*) into v_n from public.vaccination_records where profile_id = v_owner;
  if v_n < 1 then
    raise exception 'FAIL: next of kin sees % of the owner''s vaccination records', v_n;
  end if;
  raise notice 'PASS  next of kin reads the record (% row(s))', v_n;

  -- ---- 4. ...and cannot change it --------------------------------------------
  -- RLS refuses the row rather than raising, so assert on what landed, not on
  -- an exception being thrown.
  v_wrote := true;
  begin
    insert into public.vaccination_records
      (organisation_id, profile_id, vaccination_catalog_id, dose_number, date_administered)
    values (v_org, v_owner, v_vax, 99, current_date);
  exception when insufficient_privilege then
    v_wrote := false;
  end;
  select count(*) into v_n from public.vaccination_records
   where profile_id = v_owner and dose_number = 99;
  if v_wrote and v_n > 0 then
    raise exception 'FAIL: a view-only next of kin wrote to the record';
  end if;
  raise notice 'PASS  next of kin cannot write to the record';

  -- ---- 5. Control: the same write DOES work at 'manage' ----------------------
  -- Without this, check 4 could be passing because the grant is broken.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_guardian, 'role', 'authenticated')::text, true);
  insert into public.vaccination_records
    (organisation_id, profile_id, vaccination_catalog_id, dose_number, date_administered)
  values (v_org, v_owner, v_vax, 98, current_date);
  select count(*) into v_n from public.vaccination_records
   where profile_id = v_owner and dose_number = 98;
  if v_n <> 1 then
    raise exception 'FAIL: control failed — a manage grantee could not write either';
  end if;
  raise notice 'PASS  control: manage grantee writes, so check 4 tested the level';

  -- ---- 6. A stranger sees nothing --------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.vaccination_records where profile_id = v_owner;
  if v_n <> 0 then
    raise exception 'FAIL: a stranger sees % of the owner''s records', v_n;
  end if;
  raise notice 'PASS  stranger sees nothing';

  reset role;

  -- ---- 7. Funding still works, on consent alone ------------------------------
  -- can_fund_wallet used to accept a shared bill as authority. It now accepts
  -- only a profile_access grant, which is the stricter condition. The Health
  -- Wallet itself is retired (20260731215735_retire_health_wallet.sql); its
  -- direct successor for "who may fund this person's care" is
  -- private.can_purchase_voucher_for (added the same day, in
  -- 20260731215226_care_vouchers_purchase_and_layaway.sql), which the
  -- purchase_care_voucher/purchase_subscription_voucher RPCs both call for
  -- authorisation. It keeps exactly the same shape can_fund_wallet had: self,
  -- or ANY profile_access grant regardless of level -- so this still proves
  -- that even the view-only next of kin (not just a 'manage' grantee) may pay
  -- for care, because consent, not who can edit the record, is what funding
  -- has always turned on.
  if not private.can_purchase_voucher_for(v_owner, v_kin) then
    raise exception 'FAIL: next of kin cannot fund care for someone they are consented to';
  end if;
  if private.can_purchase_voucher_for(v_owner, v_stranger) then
    raise exception 'FAIL: a stranger can fund care for the owner';
  end if;
  raise notice 'PASS  care funding follows consent, not a shared bill';

  -- ---- 8. One price list, one diaspora currency ------------------------------
  select count(*) into v_n from public.subscription_plans where currency = 'GBP';
  if v_n <> 0 then raise exception 'FAIL: % GBP plan rows remain', v_n; end if;

  select count(*) into v_n
    from public.subscription_plans p
    join public.subscription_plans b on b.code = p.derived_from_code
   where p.price_minor <> round(b.price_minor / 1365.0);
  if v_n <> 0 then raise exception 'FAIL: % dollar rows are off the reference rate', v_n; end if;
  raise notice 'PASS  every dollar price is its naira price at 1365';

  raise notice '--- all checks passed ---';
end $$;

rollback;
