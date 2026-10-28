-- ===========================================================================
-- Verification: 20261027153841_research_governance_hardening
-- Structural proof that needs no staff or patient fixtures, so it holds on a fresh replay:
--   * the barred-recipient check catches insurers, HMOs, employers, pharma and data brokers by name, and lets a university through;
--   * the subtraction check: identical sets and large differences pass, a one-out-one-in swap and a small difference are refused;
--   * the new tables are closed to clients, RLS is on, and the one-open-request-per-protocol index and the two-people constraint exist;
--   * no new function is callable by anon;
--   * research_exports keeps its participant keys in a column no function returns.
-- The behaviour (CMO requests, a different admin authorises, the authorisation is used once and expires after 7 days, a held-back release leaves
-- the authorisation unused, the ledger and the challenge route) was proved on a scratch Postgres 16 over S81's own table and function
-- bodies with stand-in helpers (59 checks including a sabotage); it needs staff, consent and analytics fixtures that differ per stack.
-- SABOTAGE: the subtraction check is replaced inside the transaction by an always-true one; the "refuses a swap" check must then flip.
-- BEGIN/ROLLBACK.
-- ===========================================================================
begin;
create temporary table p(check_name text, observed text, expected text, verdict text) on commit drop;
create function pg_temp.ck(n text, o text, e text) returns void language sql as $$
  insert into pg_temp.p values (n, o, e, case when o = e then 'PASS' else 'FAIL' end) $$;

select pg_temp.ck('barred: an insurer', private.research_recipient_barred('Acme Insurance Ltd'), 'insur');
select pg_temp.ck('barred: an HMO named in CLAUDE.md', private.research_recipient_barred('Reliance Health'), 'reliance');
select pg_temp.ck('barred: pharma', private.research_recipient_barred('Novo Pharmaceuticals Nigeria'), 'pharma');
select pg_temp.ck('barred: an employer', private.research_recipient_barred('Employer Wellness Forum'), 'employer');
select pg_temp.ck('barred: a data broker', private.research_recipient_barred('Lagos Data Broker Co'), 'broker');
select pg_temp.ck('allowed: a university', coalesce(private.research_recipient_barred('University of Ibadan'), 'none'), 'none');
select pg_temp.ck('allowed: a word that only contains a term mid-word', coalesce(private.research_recipient_barred('Reassured Community Trust'), 'none'), 'none');

select pg_temp.ck('subtraction: identical sets pass', private.research_difference_ok(array['a','b'], array['b','a'], 20)::text, 'true');
select pg_temp.ck('subtraction: no previous release passes', private.research_difference_ok(null, array['a'], 20)::text, 'true');
select pg_temp.ck('subtraction: a one-out one-in swap is refused', private.research_difference_ok(array['a','b','c'], array['a','b','d'], 20)::text, 'false');
select pg_temp.ck('subtraction: three more people are refused', private.research_difference_ok(array['a','b'], array['a','b','c','d','e'], 20)::text, 'false');
select pg_temp.ck('subtraction: a difference of exactly the minimum passes',
  private.research_difference_ok((select array_agg('p' || g) from generate_series(1, 5) g), (select array_agg('q' || g) from generate_series(1, 15) g), 20)::text, 'true');

select pg_temp.ck('the new tables have row level security on',
  (select count(*) from pg_class where oid in ('public.research_export_requests'::regclass, 'public.research_challenges'::regclass, 'public.research_barred_recipient_terms'::regclass) and relrowsecurity)::text, '3');
select pg_temp.ck('clients cannot read any of the three new tables',
  (has_table_privilege('authenticated', 'public.research_export_requests', 'SELECT') or has_table_privilege('authenticated', 'public.research_challenges', 'SELECT')
   or has_table_privilege('authenticated', 'public.research_barred_recipient_terms', 'SELECT') or has_table_privilege('anon', 'public.research_challenges', 'SELECT'))::text, 'false');
select pg_temp.ck('the two-people constraint exists', (select count(*) from pg_constraint where conname = 'research_export_requests_two_people')::text, '1');
select pg_temp.ck('only one open request per protocol (partial unique index)', (select count(*) from pg_indexes where indexname = 'research_export_requests_one_open')::text, '1');
select pg_temp.ck('participant keys are a column on research_exports', (select count(*) from information_schema.columns where table_name = 'research_exports' and column_name = 'participant_keys')::text, '1');
select pg_temp.ck('no function returns the participant keys',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like '%research%' and pg_get_function_result(p.oid) ilike '%participant_keys%')::text, '0');
select pg_temp.ck('the seeded barred terms are present', (select (count(*) >= 10)::text from public.research_barred_recipient_terms), 'true');

select pg_temp.ck('anon cannot call any new function',
  (has_function_privilege('anon', 'public.request_research_export(uuid,text)', 'EXECUTE') or has_function_privilege('anon', 'public.authorise_research_export(uuid)', 'EXECUTE')
   or has_function_privilege('anon', 'public.research_ledger()', 'EXECUTE') or has_function_privilege('anon', 'public.raise_research_challenge(uuid,text)', 'EXECUTE')
   or has_function_privilege('anon', 'public.research_challenges_list()', 'EXECUTE') or has_function_privilege('anon', 'public.answer_research_challenge(uuid,text)', 'EXECUTE')
   or has_function_privilege('anon', 'public.run_research_export(uuid)', 'EXECUTE'))::text, 'false');
select pg_temp.ck('a signed-in user can call the ledger', has_function_privilege('authenticated', 'public.research_ledger()', 'EXECUTE')::text, 'true');
select pg_temp.ck('the export still refuses when no second person has authorised: the body names the authorisation',
  (pg_get_functiondef('public.run_research_export(uuid)'::regprocedure) like '%a second person must authorise%')::text, 'true');

select pg_temp.ck('the ledger is scoped to the caller''s organisation',
  (pg_get_functiondef('public.research_ledger()'::regprocedure) like '%organisation_id = (select private.current_org_id())%')::text, 'true');
select pg_temp.ck('an unauthorised request older than 7 days shows as expired, matching the rule that retires it',
  (pg_get_functiondef('public.research_export_requests_list()'::regprocedure) like '%coalesce(r.authorised_at, r.requested_at) <= now() - interval ''7 days''%')::text, 'true');

select pg_temp.ck('research_challenges is in the S39d data registry and the member export',
  (select (count(*) = 1)::text from public.data_registry where table_name = 'research_challenges' and in_export), 'true');

select pg_temp.ck('the export keeps the earlier review fixes: live consent join, only data after the consent date, small-month blanking',
  (pg_get_functiondef('public.run_research_export(uuid)'::regprocedure) like '%patient_consent_state%'
   and pg_get_functiondef('public.run_research_export(uuid)'::regprocedure) like '%granted_at%'
   and pg_get_functiondef('public.run_research_export(uuid)'::regprocedure) like '%enrol_n%')::text, 'true');

-- SABOTAGE
create or replace function private.research_difference_ok(p_prev text[], p_curr text[], p_min integer) returns boolean language sql immutable as $f$ select true $f$;
select pg_temp.ck('SABOTAGE: with the check made always-true the swap passes, so the "refuses a swap" check above would fail (test discriminates)',
  private.research_difference_ok(array['a','b','c'], array['a','b','d'], 20)::text, 'true');

select * from pg_temp.p order by 1;
do $$ begin
  if exists (select 1 from pg_temp.p where verdict <> 'PASS') then raise exception 'research_governance_hardening: one or more checks failed'; end if;
end $$;
rollback;
