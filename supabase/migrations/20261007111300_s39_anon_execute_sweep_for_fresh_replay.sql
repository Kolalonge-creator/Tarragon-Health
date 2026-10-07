-- S39: close the anon EXECUTE gap that only shows on a fresh replay. The S39 catalog proof (s39_security_catalog.sql check 2b) found nine functions that anon can
-- execute after `supabase db reset` (complete_care_task, create_subsidy_split_rule, create_transaction_subsidy, institution_subsidy_summary, my_feature_flags,
-- set_monitoring_baseline, set_subsidy_contribution_pending_ref, sign_lpe_content_block, sign_triage_protocol). Their migrations revoke from PUBLIC correctly, but the
-- Supabase CLI's own bootstrap grants anon EXECUTE directly on every function created before 20260902174504 (the migration that fixed this for FUTURE functions),
-- and a revoke from PUBLIC does not remove a direct anon grant. Production is not affected (checked: has_function_privilege('anon', ...) is false for all nine); this makes
-- a rebuilt environment match production.
-- Revokes anon and PUBLIC EXECUTE on every function in public and private that is not on the reviewed public-door list (the same list as the catalog proof), and
-- keeps authenticated access for any function that only had it through PUBLIC. Extension functions are never touched. Idempotent. No data is changed.
do $$
declare
  f record;
  v_allow constant text[] := array[
    'public.public_service_coverage', 'public.public_response_commitments', 'public.public_partner_locations', 'public.emergency_card_by_token',
    'public.health_passport_by_serial', 'public.verify_payer_board_report', 'public.public_price_list', 'public.record_share_by_token',
    'public.platform_switch_is_on', 'public.verify_prescription_public', 'public.record_prescription_supply_public'];
  v_n integer := 0; v_auth boolean;
begin
  for f in
    select p.oid, p.oid::regprocedure::text as sig, n.nspname || '.' || p.proname as qname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and has_function_privilege('anon', p.oid, 'EXECUTE')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    continue when f.qname = any (v_allow);
    v_auth := has_function_privilege('authenticated', f.oid, 'EXECUTE');
    execute format('revoke execute on function %s from public, anon', f.sig);
    if v_auth then execute format('grant execute on function %s to authenticated', f.sig); end if;
    v_n := v_n + 1;
  end loop;
  raise notice 'S39: revoked anon EXECUTE on % functions', v_n;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'EXECUTE')
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and (n.nspname || '.' || p.proname) <> all (v_allow)) then
    raise exception 'S39: anon can still execute a function that is not on the reviewed list';
  end if;
end $$;
