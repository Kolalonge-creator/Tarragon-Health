-- Tarragon Health: functions in public that anon can run are a reviewed list, not an accident.
--
-- The Supabase advisor (anon_security_definer_function_executable) reports 17 functions in public that an anonymous caller can run through
-- the API. Each was read and justified on 2026-10-30 (docs/security/ANON-EXECUTABLE-FUNCTIONS.md, Stage 2 criterion E4). This proof turns
-- that review into a gate: a new anonymous-callable function in public that is not on the list fails the run, so adding one needs a
-- human decision and a written reason.
-- The check is run once on the real database, then again after a deliberately bad function is added in the same rolled-back
-- transaction, which must be caught, so the check is proven able to fail.
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/anon_executable_functions_allowlist.sql

begin;

create function pg_temp.unlisted_anon_functions() returns text language sql as
$f$
  select nullif(string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ' order by p.proname), '')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and has_function_privilege('anon', p.oid, 'EXECUTE')
     and p.proname <> all (array[
       'emergency_card_by_token', 'health_passport_by_serial', 'record_share_peek', 'record_share_by_token', 'pharmacy_snapshot_by_token',
       'verify_prescription_public', 'record_prescription_supply_public', 'learn_shared_article', 'verify_payer_board_report',
       'public_price_list', 'public_service_coverage', 'public_response_commitments', 'public_partner_locations',
       'platform_switch_is_on', 'membership_auto_renew_enabled',
       -- extension event-trigger helpers (present where pgaudit is installed)
       'pgaudit_ddl_command_end', 'pgaudit_sql_drop'
     ]);
$f$;

do $$
declare v_problems text;
begin
  v_problems := pg_temp.unlisted_anon_functions();
  if v_problems is not null then
    raise exception 'FAIL: anon can run function(s) not on the reviewed list (add a reason in docs/security/ANON-EXECUTABLE-FUNCTIONS.md and here): %', v_problems;
  end if;

  -- sabotage: a new function anon can run must be caught
  create function public.zz_proof_anon_open() returns integer language sql as 'select 1';
  grant execute on function public.zz_proof_anon_open() to anon;
  v_problems := pg_temp.unlisted_anon_functions();
  if v_problems is null or v_problems not like '%zz_proof_anon_open%' then
    raise exception 'FAIL sabotage: an unlisted anon-callable function was not caught (got %)', v_problems;
  end if;
  drop function public.zz_proof_anon_open();

  if pg_temp.unlisted_anon_functions() is not null then raise exception 'FAIL: fixture was not cleaned up'; end if;
  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
