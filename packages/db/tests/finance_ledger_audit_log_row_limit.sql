-- finance_ledger_entries / finance_audit_log: p_limit is a real limit and p_offset pages.
--
-- Both functions used to end `select jsonb_agg(...) from ... limit N`. A LIMIT
-- cuts the rows a query returns and an aggregate returns one row, so it never
-- cut anything: the "200" on the pages and the printed audit pack's "5000"
-- were not limits, and every entry in range came back. This proves the limit
-- now bites, that paging by offset walks the whole list once with no repeats
-- and no gaps, that a stranger still gets nothing, and that anon cannot call it.
--
-- Self-contained: it mints its own finance and non-finance accounts, counts
-- what the database already holds rather than assuming an empty ledger, then
-- adds five entries and five audit rows of its own. The whole file rolls back.
--
-- Sabotage (do once when changing these functions): put the old `limit` back
-- after the jsonb_agg. Checks 1, 3 and 5 fail (the limit returns every row).
-- Run:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/finance_ledger_audit_log_row_limit.sql

begin;

create temp table _checks (n serial, msg text) on commit drop;
grant insert, select on _checks to authenticated;
grant usage, select on sequence _checks_n_seq to authenticated;

do $$
declare
  c_org       uuid;
  v_finance   uuid := gen_random_uuid();
  v_stranger  uuid := gen_random_uuid();
  i           int;
  v_total     int;
  v_page      jsonb;
  v_all       jsonb;
  v_ids       text[];
  v_paged     text[];
  v_off       int;
begin
  select id into c_org from public.organisations order by created_at limit 1;
  if c_org is null then raise exception 'fixture FAIL: no organisation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_finance, 'rowlimit-finance@example.invalid', 'x', now(), '{}', '{}'),
         (v_stranger, 'rowlimit-stranger@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_finance, c_org, 'finance', 'Row Limit Finance Test'),
         (v_stranger, c_org, 'patient', 'Row Limit Stranger Test')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;

  for i in 1..5 loop
    perform private.finance_post_journal(
      current_date, 'NGN', 'payment', 'limit-proof-' || i, 'Row limit proof ' || i,
      jsonb_build_array(
        jsonb_build_object('account_code', '1020', 'debit_minor', 1000 * i, 'credit_minor', 0, 'organisation_id', c_org),
        jsonb_build_object('account_code', '2000', 'debit_minor', 0, 'credit_minor', 1000 * i, 'organisation_id', c_org)),
      null);
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, event, created_at)
    values (c_org, v_finance, 'finance.limit_proof', 'proof', jsonb_build_object('n', i), now() - make_interval(secs => 10 - i));
  end loop;

  -- =========================================================================
  -- LEDGER, as finance staff
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_finance, 'role', 'authenticated')::text, true);
  set local role authenticated;

  v_all := public.finance_ledger_entries(current_date, current_date, null, null, 100000);
  v_total := jsonb_array_length(v_all);
  if v_total < 5 then raise exception 'FAIL 0: expected at least the five fixture entries, got %', v_total; end if;

  v_page := public.finance_ledger_entries(current_date, current_date, null, null, 3);
  if jsonb_array_length(v_page) = 3 then
    insert into _checks (msg) values ('PASS 1: p_limit 3 returns exactly 3 of ' || v_total || ' entries');
  else
    raise exception 'FAIL 1: p_limit 3 returned % of % entries (the limit does not bite)', jsonb_array_length(v_page), v_total;
  end if;

  if jsonb_array_length(public.finance_ledger_entries(current_date, current_date, null, null, 0)) = 1 then
    insert into _checks (msg) values ('PASS 2: p_limit 0 is treated as 1, as before');
  else
    raise exception 'FAIL 2: p_limit 0 did not return exactly one entry';
  end if;

  select array_agg(e->>'id' order by ord) into v_ids from jsonb_array_elements(v_all) with ordinality as t(e, ord);
  v_paged := '{}';
  v_off := 0;
  loop
    v_page := public.finance_ledger_entries(current_date, current_date, null, null, 2, v_off);
    exit when jsonb_array_length(v_page) = 0;
    v_paged := v_paged || (select array_agg(e->>'id' order by ord) from jsonb_array_elements(v_page) with ordinality as t(e, ord));
    v_off := v_off + 2;
    if v_off > v_total + 4 then raise exception 'FAIL 3: paging never ended'; end if;
  end loop;
  if v_paged = v_ids then
    insert into _checks (msg) values ('PASS 3: paging 2 at a time walks all ' || v_total || ' entries once, in the same order, no repeats or gaps');
  else
    raise exception 'FAIL 3: pages by offset did not add up to the full list (% vs %)', cardinality(v_paged), cardinality(v_ids);
  end if;

  if public.finance_ledger_entries(current_date, current_date, null, null, 2, v_total + 10) = '[]'::jsonb then
    insert into _checks (msg) values ('PASS 4: an offset past the end is an empty list');
  else
    raise exception 'FAIL 4: an offset past the end returned rows';
  end if;

  -- The account and source filters sit inside the paged subquery. A limit must apply to what they
  -- let through, not to the whole ledger before them.
  if jsonb_array_length(public.finance_ledger_entries(current_date, current_date, '1020', 'payment', 2, 0)) = 2
     and jsonb_array_length(public.finance_ledger_entries(current_date, current_date, '1020', 'payment', 100000)) >= 5
     and public.finance_ledger_entries(current_date, current_date, '1020', 'no_such_source', 100000) = '[]'::jsonb
     and public.finance_ledger_entries(current_date, current_date, '9999', null, 100000) = '[]'::jsonb then
    insert into _checks (msg) values ('PASS 4b: account and source filters narrow the list first, then the limit applies');
  else
    raise exception 'FAIL 4b: the account or source filter and the limit did not combine correctly';
  end if;

  -- =========================================================================
  -- AUDIT LOG, as finance staff, narrowed to the five fixture rows
  -- =========================================================================
  v_page := public.finance_audit_log(now() - interval '1 hour', now() + interval '1 hour', 'finance.limit_proof', 2);
  if jsonb_array_length(v_page) = 2 then
    insert into _checks (msg) values ('PASS 5: audit log p_limit 2 returns exactly 2 of 5 rows');
  else
    raise exception 'FAIL 5: audit log p_limit 2 returned % rows (the limit does not bite)', jsonb_array_length(v_page);
  end if;

  v_paged := '{}';
  for v_off in 0..4 by 2 loop
    v_page := public.finance_audit_log(now() - interval '1 hour', now() + interval '1 hour', 'finance.limit_proof', 2, v_off);
    if jsonb_array_length(v_page) > 0 then
      v_paged := v_paged || (select array_agg(e->>'id' order by ord) from jsonb_array_elements(v_page) with ordinality as t(e, ord));
    end if;
  end loop;
  if cardinality(v_paged) = 5 and (select count(distinct x) from unnest(v_paged) x) = 5 then
    insert into _checks (msg) values ('PASS 6: audit log paged 2 at a time gives all 5 rows once each');
  else
    raise exception 'FAIL 6: audit log pages gave % rows, % distinct', cardinality(v_paged), (select count(distinct x) from unnest(v_paged) x);
  end if;

  reset role;

  -- =========================================================================
  -- A stranger still gets nothing; anon cannot call either function
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if public.finance_ledger_entries(current_date, current_date, null, null, 100000) = '[]'::jsonb
     and public.finance_audit_log(now() - interval '1 hour', now() + interval '1 hour', null, 100000) = '[]'::jsonb then
    insert into _checks (msg) values ('PASS 7: a non-finance account gets an empty list from both');
  else
    raise exception 'FAIL 7: a non-finance account was given finance rows';
  end if;
  reset role;

  if has_function_privilege('anon', 'public.finance_ledger_entries(date, date, text, text, int, int)', 'EXECUTE')
     or has_function_privilege('anon', 'public.finance_audit_log(timestamptz, timestamptz, text, int, int)', 'EXECUTE') then
    raise exception 'FAIL 8: anon can execute a finance reporting function';
  else
    insert into _checks (msg) values ('PASS 8: anon has no EXECUTE on either function');
  end if;
end $$;

select msg from _checks order by n;

rollback;
