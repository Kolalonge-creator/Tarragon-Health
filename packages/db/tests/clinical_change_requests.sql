-- ===========================================================================
-- Verification: 20261027095217_clinical_change_requests (audit G-12, change control)
-- Structural proof that needs no fixture rows, so it holds on a fresh replay:
--   * the table cannot be written or read by a client role except through the policy and the three functions;
--   * row level security is on and the only policy is a SELECT;
--   * the three functions are not callable by anon (revoked from PUBLIC, which is how anon inherits EXECUTE);
--   * the CHECK constraints that carry the rules exist: an incident must be named, a decider is never the requester, a rejection needs a reason;
--   * the guard trigger exists, and the object types are a closed list.
-- The behaviour (CMO only, never on their own proposal, forward-only states, audit rows) was proved on a scratch Postgres 16 with
-- stand-in tables (27 checks including a sabotage); it needs staff and organisation fixtures that differ per stack, so it is not repeated here.
-- SABOTAGE: INSERT is granted to authenticated inside the transaction; the "not writable" check must then flip.
-- BEGIN/ROLLBACK.
-- ===========================================================================
begin;
create temporary table p(check_name text, observed text, expected text, verdict text) on commit drop;

insert into p values
 ('row level security is on', (select relrowsecurity from pg_class where oid = 'public.clinical_change_requests'::regclass)::text, 'true',
  case when (select relrowsecurity from pg_class where oid = 'public.clinical_change_requests'::regclass) then 'PASS' else 'FAIL' end),
 ('the only policy is a read policy', (select string_agg(cmd, ',') from pg_policies where tablename = 'clinical_change_requests'), 'SELECT',
  case when (select string_agg(cmd, ',') from pg_policies where tablename = 'clinical_change_requests') = 'SELECT' then 'PASS' else 'FAIL' end),
 ('authenticated cannot insert', has_table_privilege('authenticated', 'public.clinical_change_requests', 'INSERT')::text, 'false',
  case when not has_table_privilege('authenticated', 'public.clinical_change_requests', 'INSERT') then 'PASS' else 'FAIL' end),
 ('authenticated cannot update', has_table_privilege('authenticated', 'public.clinical_change_requests', 'UPDATE')::text, 'false',
  case when not has_table_privilege('authenticated', 'public.clinical_change_requests', 'UPDATE') then 'PASS' else 'FAIL' end),
 ('authenticated cannot delete', has_table_privilege('authenticated', 'public.clinical_change_requests', 'DELETE')::text, 'false',
  case when not has_table_privilege('authenticated', 'public.clinical_change_requests', 'DELETE') then 'PASS' else 'FAIL' end),
 ('anon cannot read', has_table_privilege('anon', 'public.clinical_change_requests', 'SELECT')::text, 'false',
  case when not has_table_privilege('anon', 'public.clinical_change_requests', 'SELECT') then 'PASS' else 'FAIL' end),
 ('anon cannot propose', has_function_privilege('anon', 'public.propose_clinical_change(text,text,text,text,text,uuid,uuid,text,text,text)', 'EXECUTE')::text, 'false',
  case when not has_function_privilege('anon', 'public.propose_clinical_change(text,text,text,text,text,uuid,uuid,text,text,text)', 'EXECUTE') then 'PASS' else 'FAIL' end),
 ('anon cannot decide', has_function_privilege('anon', 'public.decide_clinical_change(uuid,boolean,text)', 'EXECUTE')::text, 'false',
  case when not has_function_privilege('anon', 'public.decide_clinical_change(uuid,boolean,text)', 'EXECUTE') then 'PASS' else 'FAIL' end),
 ('anon cannot mark applied', has_function_privilege('anon', 'public.mark_clinical_change_applied(uuid,text)', 'EXECUTE')::text, 'false',
  case when not has_function_privilege('anon', 'public.mark_clinical_change_applied(uuid,text)', 'EXECUTE') then 'PASS' else 'FAIL' end),
 ('a signed-in user can call the functions', has_function_privilege('authenticated', 'public.decide_clinical_change(uuid,boolean,text)', 'EXECUTE')::text, 'true',
  case when has_function_privilege('authenticated', 'public.decide_clinical_change(uuid,boolean,text)', 'EXECUTE') then 'PASS' else 'FAIL' end);

insert into p select 'the rule constraints exist (' || count(*) || ' of 4)', count(*)::text, '4', case when count(*) = 4 then 'PASS' else 'FAIL' end
  from pg_constraint where conrelid = 'public.clinical_change_requests'::regclass
   and conname in ('clinical_change_requests_incident_named', 'clinical_change_requests_decider_not_requester',
                   'clinical_change_requests_rejection_needs_reason', 'clinical_change_requests_decision_complete');
insert into p select 'the forward-only guard trigger exists', count(*)::text, '1', case when count(*) = 1 then 'PASS' else 'FAIL' end
  from pg_trigger where tgrelid = 'public.clinical_change_requests'::regclass and tgname = 'clinical_change_requests_guard' and not tgisinternal;
-- SABOTAGE: grant INSERT to authenticated; the "cannot insert" check must flip
grant insert on public.clinical_change_requests to authenticated;
insert into p select 'SABOTAGE: with INSERT granted the "cannot insert" check would fail (test discriminates)',
  has_table_privilege('authenticated', 'public.clinical_change_requests', 'INSERT')::text, 'true',
  case when has_table_privilege('authenticated', 'public.clinical_change_requests', 'INSERT') then 'PASS' else 'FAIL' end;

select * from p order by 1;
do $$ begin
  if exists (select 1 from pg_temp.p where verdict <> 'PASS') then raise exception 'clinical_change_requests: one or more checks failed'; end if;
end $$;
rollback;
