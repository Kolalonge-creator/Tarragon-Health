-- ---------------------------------------------------------------------------
-- private.sweep_dependent_majority_review() (20260829082711): a minor_child
-- dependent who has turned 18 gets flagged once and their manage grantee is
-- notified; a dependent still under 18, and an elder_proxy dependent of any
-- age, must never be touched.
--
-- Run inside a transaction that is ROLLED BACK. Nothing here persists.
--
--   parent          the caller who provisioned both dependents
--   matured_child   minor_child, born 19 years ago       -> flagged, notified
--   young_child     minor_child, born 10 years ago        -> control: untouched
--   elder           elder_proxy, born 90 years ago        -> control: untouched
--                   (proves the sweep keys on dependent_kind, not just age)
--
-- Usage:
--   npx supabase db query --linked -f packages/db/tests/dependent_majority_review_sweep.sql
-- ---------------------------------------------------------------------------

begin;

do $$
declare
  v_org           uuid := '00000000-0000-0000-0000-000000000001';
  v_parent        uuid := 'a1e20000-0000-4000-8000-000000000001';
  v_matured_child uuid := 'a1e20000-0000-4000-8000-000000000002';
  v_young_child   uuid := 'a1e20000-0000-4000-8000-000000000003';
  v_elder         uuid := 'a1e20000-0000-4000-8000-000000000004';
  v_n             int;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_parent,        'majority-test-parent@example.invalid',        'x', now(), '{}', '{}'),
    (v_matured_child,  'majority-test-matured-child@example.invalid', 'x', now(), '{}', '{}'),
    (v_young_child,    'majority-test-young-child@example.invalid',   'x', now(), '{}', '{}'),
    (v_elder,          'majority-test-elder@example.invalid',         'x', now(), '{}', '{}');

  update public.profiles
     set organisation_id = v_org, role = 'patient', full_name = 'Test Parent'
   where id = v_parent;

  update public.profiles
     set organisation_id = v_org, role = 'patient', full_name = 'Matured Child',
         is_dependent_account = true, dependent_kind = 'minor_child',
         date_of_birth = current_date - interval '19 years'
   where id = v_matured_child;

  update public.profiles
     set organisation_id = v_org, role = 'patient', full_name = 'Young Child',
         is_dependent_account = true, dependent_kind = 'minor_child',
         date_of_birth = current_date - interval '10 years'
   where id = v_young_child;

  update public.profiles
     set organisation_id = v_org, role = 'patient', full_name = 'Elder',
         is_dependent_account = true, dependent_kind = 'elder_proxy',
         date_of_birth = current_date - interval '90 years'
   where id = v_elder;

  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values
    (v_matured_child, v_parent, 'manage', v_parent),
    (v_young_child,   v_parent, 'manage', v_parent),
    (v_elder,         v_parent, 'manage', v_parent);

  -- ---- 1. First sweep: only the matured minor_child is flagged ---------------
  perform private.sweep_dependent_majority_review();

  if not exists (select 1 from public.profiles where id = v_matured_child and majority_review_at is not null) then
    raise exception 'FAIL: matured child was not flagged';
  end if;
  raise notice 'PASS  matured minor_child is flagged';

  if exists (select 1 from public.profiles where id = v_young_child and majority_review_at is not null) then
    raise exception 'FAIL: young child (under 18) was flagged';
  end if;
  raise notice 'PASS  young minor_child (under 18) untouched';

  if exists (select 1 from public.profiles where id = v_elder and majority_review_at is not null) then
    raise exception 'FAIL: elder_proxy dependent was flagged despite being 90';
  end if;
  raise notice 'PASS  elder_proxy dependent never swept regardless of age';

  select count(*) into v_n from public.notifications
   where recipient_id = v_parent and template = 'dependent_majority_review'
     and payload->>'dependent_id' = v_matured_child::text;
  if v_n <> 1 then
    raise exception 'FAIL: expected exactly 1 notification to the parent, found %', v_n;
  end if;
  raise notice 'PASS  parent notified exactly once';

  -- ---- 2. Second sweep: idempotent, no duplicate notification ----------------
  perform private.sweep_dependent_majority_review();

  select count(*) into v_n from public.notifications
   where recipient_id = v_parent and template = 'dependent_majority_review'
     and payload->>'dependent_id' = v_matured_child::text;
  if v_n <> 1 then
    raise exception 'FAIL: re-running the sweep produced % notifications, expected 1', v_n;
  end if;
  raise notice 'PASS  re-running the sweep is idempotent';

  raise notice '--- all checks passed ---';
end $$;

rollback;
