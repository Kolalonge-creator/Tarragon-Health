-- ===========================================================================
-- Proof: S75 A2 audit of institution aggregate reads (public.log_institution_aggregate_read).
--   1. An hmo_admin of the organisation writes one audit row (actor, organisation, surface, day, role only); a second call
--      the same day for the same surface writes none; a different surface writes one.
--   2. An hmo_admin of ANOTHER organisation, a patient, a clinician and anon are refused and write nothing.
--   3. A platform admin may log for any organisation.
--   4. A bad surface label (spaces, capitals, free text) is refused.
--   5. The row holds no health data (event keys are exactly surface, day, reader_role).
--   6. SABOTAGE: the role check removed lets a patient write a row (check 2 would FAIL).
-- BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================
begin;
create temp table s75a2_results (check_name text, observed text, expected text, verdict text);
grant all on s75a2_results to public;

do $$
declare
  o1 uuid := gen_random_uuid(); o2 uuid := gen_random_uuid();
  h1 uuid := gen_random_uuid(); h2 uuid := gen_random_uuid(); pt uuid := gen_random_uuid(); cl uuid := gen_random_uuid(); ad uuid := gen_random_uuid();
  v_b boolean; v_n integer; v_keys text;
begin
  insert into public.organisations (id, name, type) values (o1, 'S75A2 One', 'hmo'), (o2, 'S75A2 Two', 'hmo');
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select x, 's75a2-' || replace(x::text, '-', '') || '@example.invalid', 'x', now(), '{}', '{}' from unnest(array[h1, h2, pt, cl, ad]) x;
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (h1, o1, 'hmo_admin', 'S75A2 H1', '+2348075200001'), (h2, o2, 'hmo_admin', 'S75A2 H2', '+2348075200002'),
    (pt, o1, 'patient', 'S75A2 P', '+2348075200003'), (cl, o1, 'clinician', 'S75A2 C', '+2348075200004'), (ad, o1, 'admin', 'S75A2 A', '+2348075200005')
  on conflict (id) do update set role = excluded.role, organisation_id = excluded.organisation_id;

  perform set_config('request.jwt.claims', json_build_object('sub', h1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_b := public.log_institution_aggregate_read(o1, 'hmo_dashboard');
  insert into s75a2_results values ('1a first read writes a row', v_b::text, 'true', case when v_b then 'PASS' else 'FAIL' end);
  v_b := public.log_institution_aggregate_read(o1, 'hmo_dashboard');
  insert into s75a2_results values ('1b same day, same surface writes none', v_b::text, 'false', case when not v_b then 'PASS' else 'FAIL' end);
  v_b := public.log_institution_aggregate_read(o1, 'hmo_reports');
  insert into s75a2_results values ('1c another surface writes a row', v_b::text, 'true', case when v_b then 'PASS' else 'FAIL' end);
  execute 'reset role';

  select count(*) into v_n from public.audit_log where actor_id = h1 and action = 'institution.aggregate_read' and entity_id = o1;
  insert into s75a2_results values ('1d two rows in the audit log for that reader', v_n::text, '2', case when v_n = 2 then 'PASS' else 'FAIL' end);
  select string_agg(k, ',' order by k) into v_keys from (select distinct jsonb_object_keys(event) k from public.audit_log where actor_id = h1 and action = 'institution.aggregate_read') q;
  insert into s75a2_results values ('5 row holds only surface, day, reader_role', v_keys, 'day,reader_role,surface', case when v_keys = 'day,reader_role,surface' then 'PASS' else 'FAIL' end);

  -- 2 refusals
  perform set_config('request.jwt.claims', json_build_object('sub', h2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.log_institution_aggregate_read(o1, 'hmo_dashboard'); insert into s75a2_results values ('2a other org admin refused', 'allowed', 'refused', 'FAIL');
  exception when others then insert into s75a2_results values ('2a other org admin refused', sqlerrm, 'not authorised', case when sqlerrm = 'not authorised' then 'PASS' else 'FAIL' end); end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', pt, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.log_institution_aggregate_read(o1, 'hmo_dashboard'); insert into s75a2_results values ('2b patient refused', 'allowed', 'refused', 'FAIL');
  exception when others then insert into s75a2_results values ('2b patient refused', sqlerrm, 'not authorised', case when sqlerrm = 'not authorised' then 'PASS' else 'FAIL' end); end;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', cl, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin perform public.log_institution_aggregate_read(o1, 'hmo_dashboard'); insert into s75a2_results values ('2c clinician refused', 'allowed', 'refused', 'FAIL');
  exception when others then insert into s75a2_results values ('2c clinician refused', sqlerrm, 'not authorised', case when sqlerrm = 'not authorised' then 'PASS' else 'FAIL' end); end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  begin execute 'set local role anon'; perform public.log_institution_aggregate_read(o1, 'hmo_dashboard'); insert into s75a2_results values ('2d anon refused', 'allowed', 'refused', 'FAIL');
  exception when others then insert into s75a2_results values ('2d anon refused', 'refused', 'refused', 'PASS'); end;
  execute 'reset role';
  select count(*) into v_n from public.audit_log where actor_id in (h2, pt, cl) and action = 'institution.aggregate_read';
  insert into s75a2_results values ('2e refused callers wrote nothing', v_n::text, '0', case when v_n = 0 then 'PASS' else 'FAIL' end);

  -- 3 platform admin
  perform set_config('request.jwt.claims', json_build_object('sub', ad, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_b := public.log_institution_aggregate_read(o2, 'hmo_dashboard');
  insert into s75a2_results values ('3 platform admin may log for any organisation', v_b::text, 'true', case when v_b then 'PASS' else 'FAIL' end);
  -- 4 bad labels
  begin perform public.log_institution_aggregate_read(o1, 'Bad Label with spaces'); insert into s75a2_results values ('4a free text label refused', 'allowed', 'refused', 'FAIL');
  exception when others then insert into s75a2_results values ('4a free text label refused', sqlerrm, 'invalid surface label', case when sqlerrm = 'invalid surface label' then 'PASS' else 'FAIL' end); end;
  execute 'reset role';

  -- 6 SABOTAGE
  execute replace(pg_get_functiondef('public.log_institution_aggregate_read(uuid,text)'::regprocedure),
    $a$raise exception 'not authorised' using errcode = '42501';$a$, $b$null;$b$);
  perform set_config('request.jwt.claims', json_build_object('sub', pt, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    v_b := public.log_institution_aggregate_read(o1, 'hmo_dashboard');
    insert into s75a2_results values ('6 SABOTAGE: without the role check a patient writes a row (2b would FAIL)', v_b::text, 'true', case when v_b then 'PASS' else 'FAIL' end);
  exception when others then
    insert into s75a2_results values ('6 SABOTAGE: without the role check a patient writes a row (2b would FAIL)', sqlerrm, 'true', 'FAIL');
  end;
  execute 'reset role';
end $$;

select * from s75a2_results order by check_name;
do $$ begin
  if exists (select 1 from s75a2_results where verdict = 'FAIL') then raise exception 'S75 A2 proof: % check(s) FAILED', (select count(*) from s75a2_results where verdict = 'FAIL'); end if;
end $$;
rollback;
