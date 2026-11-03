-- ===========================================================================
-- Verification: 20261103013846_catalog_items_readable_by_signed_in_people
--
-- The defect: catalog_items had RLS on, no policy and no grant for
-- `authenticated`, so the patient's refund list (orders -> catalog_items for
-- the item's name) and the admin's pending refund list both returned 403.
--
-- This script proves, as a simulated signed-in patient:
--   * the descriptive columns of a catalogue item can be read, including an
--     inactive one (an old order must still be nameable);
--   * the internal `note` column is still refused (column-level grant, not a
--     table grant);
--   * sabotage: revoking the grant inside the transaction brings the refusal
--     back, so the check is standing on the grant and nothing else.
--
-- Wrapped in BEGIN/ROLLBACK.
-- ===========================================================================

begin;

create temporary table cir_result(check_name text, observed text, expected text, verdict text) on commit drop;
grant select, insert on cir_result to authenticated;

do $$
declare
  v_patient uuid := gen_random_uuid();
  v_org uuid := gen_random_uuid();
  v_item uuid := gen_random_uuid();
  v_name text;
  v_refused boolean := false;
begin
  insert into public.organisations (id, name, type) values (v_org, 'CIR Test Org', 'direct_consumer');
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_patient, 'cir-patient@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name) values (v_patient, v_org, 'patient', 'CIR Patient')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;
  -- A withdrawn item: the kind of row an old order points at.
  insert into public.catalog_items (id, organisation_id, code, kind, name_key, description_key, included_keys, duration_days, uses, active, note)
  values (v_item, v_org, 'cir_test_item', 'membership', 'catalog.membership_annual.name', 'catalog.membership_annual.description', '{}', 365, null, false, 'internal note');

  perform set_config('request.jwt.claim.sub', v_patient::text, true);
  perform set_config('role', 'authenticated', true);

  select name_key into v_name from public.catalog_items where id = v_item;
  insert into cir_result values ('a signed-in patient can read a withdrawn item''s name_key', coalesce(v_name, 'null'), 'catalog.membership_annual.name',
    case when v_name = 'catalog.membership_annual.name' then 'PASS' else 'FAIL' end);
  if v_name is distinct from 'catalog.membership_annual.name' then
    raise exception 'HOLE OPEN: a signed-in patient cannot read catalog_items.name_key';
  end if;

  begin
    perform note from public.catalog_items where id = v_item;
  exception when insufficient_privilege then
    v_refused := true;
  end;
  insert into cir_result values ('the internal note column stays unreadable', v_refused::text, 'true', case when v_refused then 'PASS' else 'FAIL' end);
  if not v_refused then
    raise exception 'HOLE OPEN: catalog_items.note is readable by a patient';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'postgres', true);
end $$;

-- SABOTAGE: without the grant the read must fail again.
do $$
declare
  v_refused boolean := false;
  v_n int;
begin
  revoke select on public.catalog_items from authenticated;
  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    select count(*) into v_n from public.catalog_items;
  exception when insufficient_privilege then
    v_refused := true;
  end;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'postgres', true);
  insert into cir_result values ('SABOTAGE: revoking the grant brings the refusal back', v_refused::text, 'true', case when v_refused then 'PASS' else 'FAIL' end);
  if not v_refused then
    raise exception 'PROOF DOES NOT DISCRIMINATE: catalog_items was readable without the grant';
  end if;
end $$;

select check_name, observed, expected, verdict from cir_result order by verdict desc, check_name;

rollback;
