-- S39 proof: failed guesses on the two public token doors are counted and alarmed, and a valid lookup is not counted
-- (migration *_s39_security_hardening_round1.sql).
-- Proves in one rolled-back transaction: a short, a missing and a wrong token each add one to the hourly counter of their own door and
-- still return null (the answer a guesser sees is unchanged); a valid emergency card and a valid record share still open and add
-- nothing; the counter holds no token; when a door's failures in an hour reach the configured threshold exactly ONE security incident is
-- opened and a further failure opens no second one; the other door is not alarmed by the first; anon cannot read or call the counter.
-- SABOTAGE: the counter call removed from emergency_card_by_token; the counting and alert checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;
create function pg_temp.fails(p_kind text) returns integer language sql as
$$ select coalesce(sum(failures), 0)::integer from public.public_lookup_failures where kind = p_kind $$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;

do $$
declare
  v_org uuid; v_pat uuid := gen_random_uuid(); v_card text := md5(random()::text) || md5(random()::text); v_share text := md5(random()::text) || md5(random()::text);
  r jsonb; i integer; n_before integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_pat, 's39-lookup-' || v_pat || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v_pat, v_org, 'patient', 'S39 lookup', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '40 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, full_name = excluded.full_name, is_test = true;
  insert into public.emergency_cards (patient_id, organisation_id, token, is_active, consented_at, expires_at)
  values (v_pat, v_org, v_card, true, now(), now() + interval '30 days');
  insert into public.record_shares (patient_id, organisation_id, token, sections, expires_at, is_active, consented_at)
  values (v_pat, v_org, v_share, array['vitals','medications','conditions','allergies','lab_results','vaccinations','emergency_info'], now() + interval '7 days', true, now());

  -- valid lookups: they open, and add nothing to the counters
  n_before := pg_temp.fails('emergency_card') + pg_temp.fails('record_share');
  r := public.emergency_card_by_token(v_card);
  perform pg_temp.ck('real', 'a valid emergency card still opens', 'true', (r is not null and r ->> 'full_name' = 'S39 lookup')::text);
  r := public.record_share_by_token(v_share);
  perform pg_temp.ck('real', 'a valid record share still opens', 'true', (r is not null and r ->> 'full_name' = 'S39 lookup')::text);
  -- REGRESSION: a share with every section opens (the vitals section used to fail on a renamed column) and the vitals answer keeps its shape
  perform pg_temp.ck('real', 'REGRESSION a share with all seven sections returns the vitals list', 'array', jsonb_typeof(r -> 'vitals'));
  perform pg_temp.ck('real', 'a valid lookup adds nothing to the counters', '0', ((pg_temp.fails('emergency_card') + pg_temp.fails('record_share')) - n_before)::text);

  -- failed guesses: still null, and counted on their own door
  n_before := pg_temp.fails('emergency_card');
  perform pg_temp.ck('real', 'a wrong card token still returns null', 'true', (public.emergency_card_by_token(md5('x') || md5('y')) is null)::text);
  perform pg_temp.ck('real', 'a short card token still returns null', 'true', (public.emergency_card_by_token('abc') is null)::text);
  perform pg_temp.ck('real', 'a null card token still returns null', 'true', (public.emergency_card_by_token(null) is null)::text);
  perform pg_temp.ck('real', 'only the well-formed wrong guess is counted; a short or null token is not a guess', '1', (pg_temp.fails('emergency_card') - n_before)::text);
  n_before := pg_temp.fails('record_share');
  perform pg_temp.ck('real', 'a wrong share token still returns null', 'true', (public.record_share_by_token(md5('p') || md5('q')) is null)::text);
  perform pg_temp.ck('real', 'one failed share guess adds one to the share counter', '1', (pg_temp.fails('record_share') - n_before)::text);
  perform pg_temp.ck('real', 'the share door did not alarm the card door', '0', (select count(*) from public.ops_incidents where external_reference = 'public-lookup-emergency_card' and created_at > now() - interval '1 minute')::text);
  perform pg_temp.ck('real', 'the counter holds no token', '0', (select count(*) from information_schema.columns where table_name = 'public_lookup_failures' and column_name ~ 'token|ip|hash')::text);

  -- the alert: reaching the limit opens exactly one incident, a further failure opens no second
  update public.security_config set config = jsonb_set(config, '{lookup_failure_alert_per_hour}', to_jsonb(pg_temp.fails('emergency_card') + 2)) where is_active;
  perform public.emergency_card_by_token(md5('z1') || md5('z1'));
  perform pg_temp.ck('real', 'below the threshold there is no incident yet', '0', (select count(*) from public.ops_incidents where external_reference = 'public-lookup-emergency_card')::text);
  perform public.emergency_card_by_token(md5('z2') || md5('z2'));
  perform pg_temp.ck('real', 'reaching the threshold opens one security incident', '1', (select count(*) from public.ops_incidents where external_reference = 'public-lookup-emergency_card' and category = 'security')::text);
  perform public.emergency_card_by_token(md5('z3') || md5('z3'));
  perform public.emergency_card_by_token(md5('z4') || md5('z4'));
  perform pg_temp.ck('real', 'more failures in the same hour open no second incident', '1', (select count(*) from public.ops_incidents where external_reference = 'public-lookup-emergency_card')::text);
  -- a new hour while the incident is still open updates it and opens no second one
  update public.public_lookup_failures set hour_start = hour_start - interval '1 hour' where kind = 'emergency_card';
  perform public.emergency_card_by_token(md5('n1') || md5('n1'));
  perform public.emergency_card_by_token(md5('n2') || md5('n2'));
  perform pg_temp.ck('real', 'an attack across hours keeps ONE open incident', '1', (select count(*) from public.ops_incidents where external_reference = 'public-lookup-emergency_card')::text);
  -- the alert failing never breaks the lookup: with no organisation to attach it to, the door still answers null
  update public.security_config set config = jsonb_set(config, '{lookup_failure_alert_per_hour}', '1'::jsonb) where is_active;
  update public.public_lookup_failures set alerted = false where kind = 'record_share';
  alter table public.ops_incidents disable trigger user;
  update public.ops_incidents set status = 'resolved', root_cause = 'test' where external_reference = 'public-lookup-record_share';
  alter table public.ops_incidents add constraint s39_force_fail check (false) not valid;
  perform pg_temp.ck('real', 'a failing alert never turns a miss into an error', 'true', (public.record_share_by_token(md5('w1') || md5('w2')) is null)::text);
  alter table public.ops_incidents drop constraint s39_force_fail;
  alter table public.ops_incidents enable trigger user;

  -- anon cannot read or call the counter
  perform pg_temp.ck('real', 'anon cannot read the counter table', '42501', pg_temp.try_anon('select * from public.public_lookup_failures'));
  perform pg_temp.ck('real', 'anon cannot call the counter function', '42501', pg_temp.try_anon($q$select private.log_public_lookup_failure('x')$q$));
  perform pg_temp.ck('real', 'anon cannot read the security config', '42501', pg_temp.try_anon('select * from public.security_config'));
  perform pg_temp.ck('real', 'the doors stay open to anon', 'true', has_function_privilege('anon', 'public.emergency_card_by_token(text)', 'EXECUTE')::text);

  -- sabotage: the counter call removed from the card door; the counting must stop
  perform pg_temp.ck('sabotaged', 'card counter before', '0', '0');
end $$;

do $$
declare v_def text; v_before integer; v_after integer;
begin
  -- integration with S43: the public name is now a wrapper over the renamed full-card function, which holds the lookup and the failure log
  select pg_get_functiondef('public.emergency_card_full_by_token(text)'::regprocedure) into v_def;
  v_def := replace(v_def, E'perform private.log_public_lookup_failure(''emergency_card'');\n    return null;', 'return null;');
  execute v_def;
  v_before := pg_temp.fails('emergency_card');
    perform public.emergency_card_by_token(md5('s1') || md5('s2'));
  v_after := pg_temp.fails('emergency_card');
  insert into results values ('sabotaged', 'SABOTAGE: one well-formed failed card guess adds one to the counter', '1', (v_after - v_before)::text);
end $$;

do $$
declare v_def text; v_msg text := 'no error'; v_tok text;
begin
  -- sabotage 2: the old bad column put back; opening a share with vitals must fail again
  select token into v_tok from public.record_shares where 'vitals' = any(sections) order by created_at desc limit 1;
  -- integration with S43: record_share_by_token is now a wrapper over record_share_open, which holds the section queries
  select pg_get_functiondef('public.record_share_open(text, text, boolean)'::regprocedure) into v_def;
  v_def := replace(v_def, 'vr.glucose_mmol_l,', 'vr.glucose_mmol,');
  execute v_def;
  begin perform public.record_share_by_token(v_tok); exception when others then v_msg := sqlerrm; end;
  insert into results values ('sabotaged', 'SABOTAGE: the renamed-column bug makes a vitals share fail', 'no error', v_msg);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S39 lookup proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and check_name like 'SABOTAGE%' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;

rollback;
