-- S85-D3 proof: the go-live guard `sms_emergency_contact_enabled` (migration *_s85d3_sms_emergency_contact_guard.sql).
--
-- Proves in one rolled-back transaction:
--   1. The guard exists, is born off, and the reader the sender relies on says closed. The sender's service role can still read
--      the row (the edge function reads go_live_guards.is_on directly, fail closed on any error).
--   2. It has exactly two conditions, both attestations, both unmet at birth, so it cannot be switched on yet (22023).
--   3. A patient cannot attest; an admin cannot attest a code that does not exist for this guard; an admin records both
--      conditions, the guard switches on with a note, the reader opens, and switching off closes it again.
--   4. The existing guards still evaluate (the replaced functions repeat their live bodies).
--   5. SABOTAGE: with the attest allow-list rebuilt without the new codes the attestation is refused, and with the reader forced
--      open the closed-at-birth check flips. Both matching checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.msg(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.act_anon() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin
  reset role;
  -- clear the session claims too: a leftover sub makes auth.uid() non-null and the is_test guard then treats the owner as a person
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $f$;
create function pg_temp.act_service() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's85d3-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'S85D3 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name;
  if not p_test then update public.profiles set is_test = false where id = v; end if;
  return v;
end $f$;


do $$
declare
  v_org uuid; v_admin uuid; v_pat uuid; v_conds jsonb; v_unmet integer;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');

  -- 1. shape
  perform pg_temp.rec('the guard exists', '1', (select count(*)::text from public.go_live_guards where key = 'sms_emergency_contact_enabled'));
  perform pg_temp.rec('...and is born off', 'false', (select is_on::text from public.go_live_guards where key = 'sms_emergency_contact_enabled'));
  perform pg_temp.rec('...and the reader says closed', 'false', private.go_live_guard_on('sms_emergency_contact_enabled')::text);
  perform pg_temp.rec('the sender (service role) can read the guard row', 'true', has_table_privilege('service_role', 'public.go_live_guards', 'SELECT')::text);
  perform pg_temp.rec('anon cannot execute attest_go_live_condition', 'false', has_function_privilege('anon', 'public.attest_go_live_condition(text,text,boolean,text)', 'EXECUTE')::text);

  -- 2. conditions
  v_conds := private.go_live_conditions('sms_emergency_contact_enabled', v_org);
  select count(*) into v_unmet from jsonb_array_elements(v_conds) c where not (c ->> 'met')::boolean;
  perform pg_temp.rec('two conditions', '2', jsonb_array_length(v_conds)::text);
  perform pg_temp.rec('...both unmet at birth', '2', v_unmet::text);
  perform pg_temp.rec('...and both are attestations', '2', (select count(*)::text from jsonb_array_elements(v_conds) c where c ->> 'source' = 'attestation'));
  perform pg_temp.rec('switching on is refused while they are unmet', '22023', pg_temp.try('select public.set_go_live_guard(''sms_emergency_contact_enabled'', true, ''go'')'));

  -- 3. who can attest and switch
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('a patient cannot attest', '42501', pg_temp.try('select public.attest_go_live_condition(''sms_emergency_contact_enabled'', ''live_sms_delivery_proven'', true, ''checked on a real handset by the founder'')'));
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('an admin cannot attest a code the guard does not have', '22023', pg_temp.try('select public.attest_go_live_condition(''sms_emergency_contact_enabled'', ''made_up'', true, ''checked on a real handset by the founder'')'));
  perform pg_temp.rec('...nor one belonging to another guard', '22023', pg_temp.try('select public.attest_go_live_condition(''sms_emergency_contact_enabled'', ''fee_schedule_approved'', true, ''checked on a real handset by the founder'')'));
  perform pg_temp.rec('an admin records live delivery proven', 'ok', pg_temp.try('select public.attest_go_live_condition(''sms_emergency_contact_enabled'', ''live_sms_delivery_proven'', true, ''Real handset received the test SMS, sender ID approved'')'));
  perform pg_temp.rec('...one condition alone is not enough', '22023', pg_temp.try('select public.set_go_live_guard(''sms_emergency_contact_enabled'', true, ''go'')'));
  perform pg_temp.rec('an admin records the founder approval', 'ok', pg_temp.try('select public.attest_go_live_condition(''sms_emergency_contact_enabled'', ''founder_approval_d3_recorded'', true, ''Founder approved D3 in chat on the date of this test'')'));
  perform pg_temp.rec('switching on needs a note', '22023', pg_temp.try('select public.set_go_live_guard(''sms_emergency_contact_enabled'', true, null)'));
  perform pg_temp.rec('with both met and a note the admin switches it on', 'ok', pg_temp.try('select public.set_go_live_guard(''sms_emergency_contact_enabled'', true, ''Both conditions recorded'')'));
  perform pg_temp.back();
  perform pg_temp.rec('...and the reader now says open', 'true', private.go_live_guard_on('sms_emergency_contact_enabled')::text);
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('switching off always works', 'ok', pg_temp.try('select public.set_go_live_guard(''sms_emergency_contact_enabled'', false, null)'));
  perform pg_temp.back();
  perform pg_temp.rec('...and closes the reader again', 'false', private.go_live_guard_on('sms_emergency_contact_enabled')::text);

  -- 4. the replaced functions still evaluate the other guards
  perform pg_temp.rec('an existing guard still has its conditions', 'true', (jsonb_array_length(private.go_live_conditions('payouts_enabled', v_org)) = 2)::text);
  perform pg_temp.rec('an unknown key still fails closed', 'unknown_guard', private.go_live_conditions('no_such_guard', v_org) -> 0 ->> 'code');

  -- 5. SABOTAGE ------------------------------------------------------------------------------------------------
  -- (a) the attest allow-list without the new codes: the attestation must now be refused, so the matching check flips
  create or replace function public.attest_go_live_condition(p_key text, p_code text, p_met boolean, p_note text) returns jsonb
    language plpgsql security definer set search_path = '' as $f$
    begin
      if (p_key, p_code) not in (('payouts_enabled', 'fee_schedule_approved')) then
        raise exception 'that condition is read from the data (or does not exist), it cannot be attested' using errcode = '22023';
      end if;
      return jsonb_build_object('ok', true);
    end $f$;
  perform pg_temp.act(v_admin);
  insert into results values ('sabotaged', 'an admin records live delivery proven', 'ok',
    pg_temp.try('select public.attest_go_live_condition(''sms_emergency_contact_enabled'', ''live_sms_delivery_proven'', true, ''Real handset received the test SMS, sender ID approved'')'));
  perform pg_temp.back();
  -- (b) the reader forced open: the closed-at-birth check must flip
  create or replace function private.go_live_guard_on(p_key text) returns boolean language sql stable security definer set search_path = '' as $f$ select true $f$;
  insert into results values ('sabotaged', '...and the reader says closed', 'false', private.go_live_guard_on('sms_emergency_contact_enabled')::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S85-D3 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: only % of 2 sabotage steps changed the matching check', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
