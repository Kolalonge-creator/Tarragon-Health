-- Proof: the active Chief Medical Officer can READ unreviewed lpe_content_blocks
-- (migration *_lpe_content_blocks_read_allows_active_clinical_director.sql), and nobody else
-- who is not an admin can. Without this the CMO, who is never role=admin, could not see the
-- blocks they alone may sign, and the sign-off hub's count silently read 0.
--
--   1. The active CMO sees an unreviewed block.
--   2. A non-CMO clinician, a patient and anon see none.
--   3. The CMO still cannot WRITE a block directly (writes stay admin-only; signing is the RPC).
--   4. SABOTAGE: the new policy dropped; check 1 must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
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
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'lpedir-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'LpeDir ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician'); v_staff uuid;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'LpeDir ' || p_label, 'MDCN', 'LpeDir-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      p_tier = 'chief_medical_officer', case when p_tier = 'chief_medical_officer' then p_admin end, true)
  returning id into v_staff;
  return v;
end $f$;


do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_smo uuid; v_pat uuid; v_blk uuid; v_n integer; v_rows integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  update public.clinical_staff set active = false where is_test is not true;
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_smo := pg_temp.mkdoc(v_org, v_admin, 'smo', 'senior_medical_officer');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');

  -- Make sure one block is unreviewed (the migrations seed a library; reset one to draft).
  select id into v_blk from public.lpe_content_blocks order by key limit 1;
  update public.lpe_content_blocks set clinician_reviewed = false where id = v_blk;

  -- Behavioural, not has_table_privilege: a fresh local replay gives anon a default table ACL the live project never had.
  perform pg_temp.act_anon();
  select count(*) into v_n from public.lpe_content_blocks where id = v_blk;
  perform pg_temp.back();
  perform pg_temp.rec('anon sees no block', '0', v_n::text);

  perform pg_temp.act(v_cmo);
  select count(*) into v_n from public.lpe_content_blocks where id = v_blk and not clinician_reviewed;
  perform pg_temp.back();
  perform pg_temp.rec('the CMO sees an unreviewed block', '1', v_n::text);

  perform pg_temp.act(v_smo);
  select count(*) into v_n from public.lpe_content_blocks where id = v_blk;
  perform pg_temp.back();
  perform pg_temp.rec('a non-CMO clinician does not see it', '0', v_n::text);

  perform pg_temp.act(v_pat);
  select count(*) into v_n from public.lpe_content_blocks where id = v_blk;
  perform pg_temp.back();
  perform pg_temp.rec('a patient does not see it', '0', v_n::text);

  perform pg_temp.act(v_cmo);
  update public.lpe_content_blocks set title = title || ' (edited by cmo)' where id = v_blk;
  get diagnostics v_rows = row_count;
  perform pg_temp.back();
  perform pg_temp.rec('the CMO cannot write a block directly', '0', v_rows::text);

  -- SABOTAGE: drop the new policy; the CMO must stop seeing the block (so check 1 would fail).
  drop policy lpe_content_blocks_read_director on public.lpe_content_blocks;
  perform pg_temp.act(v_cmo);
  select count(*) into v_n from public.lpe_content_blocks where id = v_blk and not clinician_reviewed;
  perform pg_temp.back();
  insert into results values ('sabotaged', 'the CMO sees an unreviewed block', '1', v_n::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'LPE director-read proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 1 then
    raise exception 'VACUOUS TEST: the sabotage step did not change the matching check';
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- Sabotaged rows are asserted to differ inside the DO block above and are deliberately not printed.

rollback;
