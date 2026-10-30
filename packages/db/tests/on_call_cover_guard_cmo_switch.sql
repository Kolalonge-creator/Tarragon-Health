-- Proof: the on-call cover guard (on_call_cover_ok) is switched by the Chief Medical Officer (migration *_on_call_cover_guard_switched_by_cmo.sql).
--
-- Proves in one rolled-back transaction:
--   1. The guard names the CMO as its switch holder and ships off.
--   2. Switching ON: an admin is refused for the role (so it is not the admin's guard any more), a non-CMO clinician is refused, and the CMO gets past
--      the role check and is stopped only by the unmet condition (the rota covers the next 7 days), so the condition gate is still in force.
--   3. Switching OFF stays the stop button: both an admin and the CMO can switch it off.
--   4. SABOTAGE: with the guard handed back to the admin, the admin gets past the role check and the CMO is refused. Both matching checks must flip,
--      so this proof cannot pass vacuously.
begin;
create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;
create function pg_temp.msg(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin
  reset role;
  -- a leftover sub makes auth.uid() non-null and the is_test guard then treats the owner as a person
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as
$f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'cg-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'CG ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid language plpgsql as
$f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician');
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test, languages, specialty)
  values (p_org, v, 'CG ' || p_label, 'MDCN', 'CG-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now() - interval '5 days', now() + interval '1 year', p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      true, p_admin, true, array['en'], 'General practice');
  return v;
end $f$;
-- a test-only way to put the guard in a known state, as the guard's own trigger would only allow through set_go_live_guard
create function pg_temp.guard_on(p_on boolean, p_by uuid) returns void language plpgsql as
$f$ begin
  alter table public.go_live_guards disable trigger go_live_guards_guard;
  update public.go_live_guards set is_on = p_on, changed_at = case when p_on then now() end, changed_by = case when p_on then p_by end, change_note = case when p_on then 'proof fixture' end where key = 'on_call_cover_ok';
  alter table public.go_live_guards enable trigger go_live_guards_guard;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_smo uuid; v_txt text; v_caught integer;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  -- deterministic: the only active Chief Medical Officer is the one made here
  update public.clinical_staff set active = false where is_test is not true;
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_smo := pg_temp.mkdoc(v_org, v_admin, 'smo', 'senior_medical_officer');
  -- deterministic: no rota, so the "rota covers the next 7 days" condition is unmet
  perform set_config('tarragon.lead_write', 'on', true);
  delete from public.on_call_rota;
  perform set_config('tarragon.lead_write', 'off', true);

  -- 1. The shape ---------------------------------------------------------------------------------------------------
  perform pg_temp.rec('real', '1 the guard is switched by the CMO', 'cmo', (select switch_role from public.go_live_guards where key = 'on_call_cover_ok'));
  perform pg_temp.rec('real', '1 the guard ships off', 'false', (select is_on::text from public.go_live_guards where key = 'on_call_cover_ok'));

  -- 2. Switching ON ------------------------------------------------------------------------------------------------
  perform pg_temp.act(v_admin);
  v_txt := pg_temp.msg('select public.set_go_live_guard(''on_call_cover_ok'', true, ''my turn'')');
  perform pg_temp.rec('real', '2a an admin cannot switch the cover guard on', 'true', (v_txt like '42501:%only the Chief Medical Officer can switch on%')::text);
  perform pg_temp.back();
  perform pg_temp.act(v_smo);
  perform pg_temp.rec('real', '2b a clinician who is not the CMO cannot switch it on', '42501', left(pg_temp.msg('select public.set_go_live_guard(''on_call_cover_ok'', true, ''let me'')'), 5));
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  v_txt := pg_temp.msg('select public.set_go_live_guard(''on_call_cover_ok'', true, ''cover is in place'')');
  perform pg_temp.rec('real', '2c the CMO passes the role check and is stopped only by the unmet condition', 'true',
    (v_txt like '22023:%not yet met%rota covers the next 7 days%')::text);
  perform pg_temp.rec('real', '2d it is still off', 'false', (select is_on::text from public.go_live_guards where key = 'on_call_cover_ok'));
  perform pg_temp.back();

  -- 3. Switching OFF stays the stop button for both -----------------------------------------------------------------
  perform pg_temp.guard_on(true, v_admin);
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('real', '3a an admin can still switch it off', 'true', (public.set_go_live_guard('on_call_cover_ok', false, null) ->> 'changed'));
  perform pg_temp.back();
  perform pg_temp.guard_on(true, v_admin);
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('real', '3b the CMO can switch it off', 'true', (public.set_go_live_guard('on_call_cover_ok', false, null) ->> 'changed'));
  perform pg_temp.back();
  perform pg_temp.rec('real', '3c both switch-offs are logged', '2', (select count(*)::text from public.go_live_guard_log where guard_key = 'on_call_cover_ok' and action = 'switched_off'));

  -- 4. SABOTAGE: hand the guard back to the admin; the two role results must flip ---------------------------------------
  update public.go_live_guards set switch_role = 'admin' where key = 'on_call_cover_ok';
  perform pg_temp.act(v_admin);
  v_txt := pg_temp.msg('select public.set_go_live_guard(''on_call_cover_ok'', true, ''my turn'')');
  perform pg_temp.rec('sabotaged', '2a an admin cannot switch the cover guard on', 'true', (v_txt like '42501:%only the Chief Medical Officer can switch on%')::text);
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  v_txt := pg_temp.msg('select public.set_go_live_guard(''on_call_cover_ok'', true, ''cover is in place'')');
  perform pg_temp.rec('sabotaged', '2c the CMO passes the role check and is stopped only by the unmet condition', 'true',
    (v_txt like '22023:%not yet met%rota covers the next 7 days%')::text);
  perform pg_temp.back();

  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: only % of 2 sabotage steps changed the matching check', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- Sabotaged rows are asserted to differ inside the DO block above and are deliberately not printed.

rollback;
