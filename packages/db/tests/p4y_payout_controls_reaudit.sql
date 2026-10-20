-- P4y proof: payout controls re-audit (migration *_p4y_payout_controls_reaudit.sql). One rolled-back transaction. Proves:
--   1. OQ-338: exactly one of maker and checker is the CMO. Two admins cannot pass a batch; two CMOs cannot; an admin's batch is released by the
--      CMO and a CMO's batch by an admin; the maker still cannot release their own.
--   2. The maker-checker flag and the payouts_enabled money guard are tied: the guard cannot be switched on while the flag is off, and while
--      the guard is on the flag cannot be turned off. Other flags are unaffected.
--   3. SABOTAGE: the CMO test neutered, and the flag trigger dropped; the matching checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
-- one statement as a user: first column on success, otherwise the error message (the migration raises coded messages)
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; r := coalesce(r, 'ok'); exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.jq(p_uid uuid, p_sql text) returns jsonb language plpgsql as
$f$ declare t text := pg_temp.q_as(p_uid, p_sql);
begin
  if t like 'ERR:%' then raise exception 'fixture call failed: % (%)', t, left(p_sql, 80); end if;
  return t::jsonb;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'p4y-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'P4y ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'P4y ' || p_label, 'MDCN', 'P4y-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      'senior_medical_officer'::public.doctor_tier, 'contracted'::public.staff_employment_type, 2, true, p_admin, true);
  return v;
end $f$;
-- a payout in a given state with one transfer attempt, written the way the payout functions would (guards are off in replica mode)
create function pg_temp.mkpay(p_org uuid, p_doc uuid, p_approver uuid, p_kobo bigint, p_state text, p_day integer default 0, p_ref text default null) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid(); v_cfg uuid; r text := coalesce(p_ref, 'tpo-' || replace(v::text, '-', '') || '-01');
begin
  select id into v_cfg from public.payouts_config where is_active;
  set local session_replication_role = replica;
  insert into public.payouts (id, organisation_id, clinician_id, period_start, period_end, amount_kobo, line_count, state, recipient_code, payouts_config_id, approved_by, approved_at, is_test)
  values (v, p_org, p_doc, date '2026-01-05' + p_day, date '2026-01-11' + p_day, p_kobo, 1, p_state, 'RCP_proof', v_cfg, p_approver, now(), false);
  insert into public.payout_transfers (payout_id, attempt, reference, state) values (v, 1, r, case p_state when 'sent' then 'sent' else 'pending' end);
  set local session_replication_role = origin;
  return v;
end $f$;
create function pg_temp.ref(p_payout uuid, p_attempt integer default 1) returns text language sql as
$$ select reference from public.payout_transfers where payout_id = p_payout and attempt = p_attempt $$;
create function pg_temp.entries(p_payout uuid) returns integer language sql as
$$ select count(*)::integer from public.payout_gl_postings where payout_id = p_payout and status = 'posted' $$;
create function pg_temp.net(p_account text) returns bigint language sql as
$$ select coalesce(sum(l.debit_minor - l.credit_minor), 0)::bigint from public.finance_journal_lines l
     join public.finance_journal_entries e on e.id = l.entry_id where l.account_code = p_account and e.source in ('payout', 'payout_reversal') $$;
create function pg_temp.guard_on() returns void language plpgsql as
$f$ begin
  create or replace function private.go_live_guard_on(p_key text) returns boolean language sql stable security definer set search_path = ''
  as 'select true';
end $f$;


create function pg_temp.guard_real() returns void language plpgsql as
$f$ begin
  create or replace function private.go_live_guard_on(p_key text) returns boolean language sql stable security definer set search_path = ''
  as 'select coalesce((select g.is_on from public.go_live_guards g where g.key = p_key), false)';
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_admin2 uuid; v_cmo uuid; v_cmo2 uuid; v_doc uuid; v_pay uuid; v_pay2 uuid; v_batch uuid; r jsonb; v_s text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin1', 'admin');
  v_admin2 := pg_temp.mkuser(v_org, 'admin2', 'admin');
  v_doc := pg_temp.mkdoc(v_org, 'payee', v_admin);
  v_cmo := pg_temp.mkdoc(v_org, 'cmo1', v_admin);
  v_cmo2 := pg_temp.mkdoc(v_org, 'cmo2', v_admin);
  update public.profiles set is_test = false where id in (v_doc, v_admin2, v_cmo, v_cmo2);
  update public.clinical_staff set is_test = false where profile_id in (v_doc, v_cmo, v_cmo2);
  -- the two CMOs: chief tier, indemnity-exempt and credentialed as the fixture already is
  update public.clinical_staff set doctor_tier = 'chief_medical_officer'::public.doctor_tier where profile_id in (v_cmo, v_cmo2);
  perform pg_temp.guard_on();

  perform pg_temp.ck('the helper tells a CMO from an admin', 'true|false', (private.is_cmo_user(v_cmo))::text || '|' || (private.is_cmo_user(v_admin))::text);
  perform pg_temp.ck('both new triggers exist', '2', (select count(*)::text from pg_trigger where tgname in ('go_live_guards_payout_controls', 'feature_flags_payout_controls_held') and not tgisinternal));

  update public.feature_flags set status = 'on' where key = 'payout_batch_maker_checker';

  -- 1. OQ-338: the CMO is the second approver ------------------------------------------------------
  v_pay := pg_temp.mkpay(v_org, v_doc, v_admin, 1000000, 'approved', 0);
  r := pg_temp.jq(v_admin, format($q$select public.propose_payout_batch(array[%L]::uuid[], 'admin proposes')::text$q$, v_pay));
  v_batch := (r ->> 'batch_id')::uuid;
  perform pg_temp.ck('two admins cannot pass a batch between them', 'ERR:payout_batch_needs_cmo_pair', pg_temp.q_as(v_admin2, format($q$select public.release_payout_batch(%L)::text$q$, v_batch)));
  perform pg_temp.ck('the batch is still proposed after the refused release', 'proposed', (select state from public.payout_batches where id = v_batch));
  perform pg_temp.ck('the CMO releases an admin''s batch', 'released', (pg_temp.q_as(v_cmo, format($q$select public.release_payout_batch(%L)::text$q$, v_batch))::jsonb ->> 'state'));
  perform pg_temp.ck('the released batch records the CMO as checker', 'true', (select (checked_by = v_cmo and made_by = v_admin)::text from public.payout_batches where id = v_batch));

  v_pay2 := pg_temp.mkpay(v_org, v_doc, v_admin, 1000000, 'approved', 7);
  r := pg_temp.jq(v_cmo, format($q$select public.propose_payout_batch(array[%L]::uuid[], 'cmo proposes')::text$q$, v_pay2));
  v_batch := (r ->> 'batch_id')::uuid;
  perform pg_temp.ck('a second CMO cannot release a CMO''s batch', 'ERR:payout_batch_needs_cmo_pair', pg_temp.q_as(v_cmo2, format($q$select public.release_payout_batch(%L)::text$q$, v_batch)));
  perform pg_temp.ck('the maker still cannot release their own batch (checked first)', 'ERR:payout_batch_self_release', pg_temp.q_as(v_cmo, format($q$select public.release_payout_batch(%L)::text$q$, v_batch)));
  perform pg_temp.ck('an admin releases a CMO''s batch', 'released', (pg_temp.q_as(v_admin, format($q$select public.release_payout_batch(%L)::text$q$, v_batch))::jsonb ->> 'state'));

  -- 2. The flag and the money guard are tied together -----------------------------------------------
  perform pg_temp.guard_real();
  -- (the guard table refuses a direct change; a log row in the same transaction is exactly what set_go_live_guard writes)
  update public.feature_flags set status = 'off' where key = 'payout_batch_maker_checker';
  insert into public.go_live_guard_log (guard_key, action, actor_id, actor_role, note) values ('payouts_enabled', 'switched_on', v_admin, 'admin', 'p4y proof');
  begin update public.go_live_guards set is_on = true, changed_at = now(), changed_by = v_admin, change_note = 'p4y proof' where key = 'payouts_enabled'; v_s := 'accepted'; exception when others then v_s := sqlstate || ':' || split_part(sqlerrm, ':', 1); end;
  perform pg_temp.ck('the money guard cannot be switched on while the maker-checker flag is off', '55000:payout_guard_needs_maker_checker', v_s);
  update public.feature_flags set status = 'on' where key = 'payout_batch_maker_checker';
  begin update public.go_live_guards set is_on = true, changed_at = now(), changed_by = v_admin, change_note = 'p4y proof' where key = 'payouts_enabled'; v_s := 'accepted'; exception when others then v_s := sqlstate; end;
  perform pg_temp.ck('with the flag on the guard can be switched on', 'accepted', v_s);
  begin update public.feature_flags set status = 'off' where key = 'payout_batch_maker_checker'; v_s := 'accepted'; exception when others then v_s := sqlstate || ':' || split_part(sqlerrm, ':', 1); end;
  perform pg_temp.ck('while the guard is on the flag cannot be turned off', '55000:payout_maker_checker_held', v_s);
  perform pg_temp.ck('and the flag is still on', 'on', (select status::text from public.feature_flags where key = 'payout_batch_maker_checker'));
  begin update public.feature_flags set status = 'on' where key = 'payout_batch_maker_checker'; v_s := 'accepted'; exception when others then v_s := sqlstate; end;
  perform pg_temp.ck('setting the flag on again is fine', 'accepted', v_s);
  begin update public.feature_flags set status = 'off' where key = 'payout_gl_posting'; v_s := 'accepted'; exception when others then v_s := sqlstate; end;
  perform pg_temp.ck('other flags are not affected', 'accepted', v_s);

  -- 3. SABOTAGE: the CMO-pair check removed -> two admins must now be able to release ------------------
  -- (restore the S31x body, which only forbids the maker)
  v_pay := pg_temp.mkpay(v_org, v_doc, v_admin, 1000000, 'approved', 14);
  r := pg_temp.jq(v_admin, format($q$select public.propose_payout_batch(array[%L]::uuid[])::text$q$, v_pay));
  -- the "is a CMO" answer now differs between the two people whoever they are, so the pair rule is satisfied by two admins
  create or replace function private.is_cmo_user(p_uid uuid) returns boolean language sql stable security definer set search_path = ''
    as 'select p_uid = (select made_by from public.payout_batches order by made_at desc limit 1)';
  insert into results values ('sabotaged', 'two admins cannot pass a batch between them (CMO test neutered)', 'ERR:payout_batch_needs_cmo_pair', pg_temp.q_as(v_admin2, format($q$select public.release_payout_batch(%L)::text$q$, r ->> 'batch_id')));
  -- 3b. SABOTAGE: the flag trigger dropped -> the flag can now be turned off while the guard is on
  drop trigger feature_flags_payout_controls_held on public.feature_flags;
  begin update public.feature_flags set status = 'off' where key = 'payout_batch_maker_checker'; v_s := 'accepted'; exception when others then v_s := sqlstate; end;
  insert into results values ('sabotaged', 'while the guard is on the flag cannot be turned off (trigger dropped)', '55000', v_s);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'P4y proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: expected both sabotages to fail their checks, only % did', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
