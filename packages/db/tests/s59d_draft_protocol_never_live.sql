-- Proof (S59d): the new draft pathways can never reach a patient without the Chief Medical Officer's signature.
--
--   1. The S59d draft row exists, is INACTIVE and UNSIGNED, its config version equals its row version, it carries the four new pathways
--      (fever, pregnancy_danger_signs, hypertension_complication, diabetes_complication) and every pathway key of the S59 draft, and it is the
--      newest version (so the superseded-draft guard never hides it).
--   2. The database will not let an unsigned version be ACTIVE (triage_protocols_active_requires_signature): activating the draft by hand is
--      refused (23514), and so is setting is_active on any row with a half signature.
--   3. Nobody but a Chief Medical Officer signs: an ordinary clinician, a care coordinator, an admin and anon cannot sign the draft.
--   4. After the refusals the draft is still inactive and unsigned, and private.active_triage_protocol_config() does not return its pathways.
--   SABOTAGE: the constraint dropped, the by-hand activation must then succeed.
-- Wrapped in BEGIN/ROLLBACK; fails loudly with raise exception. NOT RUN against the real schema by its author (Docker was down).
begin;

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
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $f$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's59dp-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language, sex, state)
  values (v, p_org, p_role::public.user_role, 'S59d ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en', 'female', 'Lagos')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, full_name = excluded.full_name;
  return v;
end $f$;
create function pg_temp.mkstaff(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, case when p_tier = 'care_coordinator' then 'care_coordinator' else 'clinician' end);
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test, languages, specialty)
  values (p_org, v, 'S59d ' || p_label, 'MDCN', 'S59DP-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now() - interval '5 days', now() + interval '1 year', p_admin,
      p_tier::public.doctor_tier, 'contracted', 2, true, p_admin, true, array['en'], 'General practice');
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_doc uuid; v_cc uuid;
  r public.triage_protocols%rowtype; v_s59 public.triage_protocols%rowtype; v_k text; v_role text; v_active jsonb;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  select * into r from public.triage_protocols where notes like 'S59d draft:%';
  if r.id is null then raise exception 'FAIL 1a: the S59d draft row is missing'; end if;
  if r.is_active or r.approved_at is not null or r.approved_by is not null then raise exception 'FAIL 1b: the S59d draft is active or signed'; end if;
  if (r.config ->> 'version')::integer <> r.version then raise exception 'FAIL 1c: config version differs from the row version'; end if;
  foreach v_k in array array['fever', 'pregnancy_danger_signs', 'hypertension_complication', 'diabetes_complication'] loop
    if not exists (select 1 from jsonb_array_elements(r.config -> 'pathways') p where p ->> 'key' = v_k) then raise exception 'FAIL 1d: pathway % missing', v_k; end if;
  end loop;
  select * into v_s59 from public.triage_protocols where notes like 'S59 draft:%' order by version desc limit 1;
  if v_s59.id is not null then
    for v_k in select p ->> 'key' from jsonb_array_elements(v_s59.config -> 'pathways') p loop
      if not exists (select 1 from jsonb_array_elements(r.config -> 'pathways') p where p ->> 'key' = v_k) then raise exception 'FAIL 1e: S59 pathway % dropped from the S59d superset', v_k; end if;
    end loop;
  end if;
  if r.version <> (select max(version) from public.triage_protocols) then raise exception 'FAIL 1f: the S59d draft is not the newest version'; end if;

  -- 2. the database refuses an unsigned active version
  if pg_temp.try(format('update public.triage_protocols set is_active = true where id = %L', r.id)) <> '23514' then raise exception 'FAIL 2a: the draft could be activated by hand'; end if;
  if pg_temp.try(format('update public.triage_protocols set is_active = true, approved_at = now() where id = %L', r.id)) <> '23514' then raise exception 'FAIL 2b: a half-signed version could be activated'; end if;

  -- 3. only the CMO signs
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_doc := pg_temp.mkstaff(v_org, v_admin, 'doctor', 'senior_medical_officer');
  v_cc := pg_temp.mkstaff(v_org, v_admin, 'coordinator', 'care_coordinator');
  foreach v_role in array array['doctor', 'coordinator', 'admin'] loop
    perform pg_temp.act(case v_role when 'doctor' then v_doc when 'coordinator' then v_cc else v_admin end);
    if pg_temp.try(format('select public.sign_triage_protocols(%L)', r.id)) = 'ok' then raise exception 'FAIL 3a: % signed the draft', v_role; end if;
    perform pg_temp.back();
  end loop;
  perform pg_temp.act_anon();
  if pg_temp.try(format('select public.sign_triage_protocols(%L)', r.id)) = 'ok' then raise exception 'FAIL 3b: anon signed the draft'; end if;
  perform pg_temp.back();

  -- 4. still a draft, and the live config does not carry its new pathways
  select * into r from public.triage_protocols where id = r.id;
  if r.is_active or r.approved_at is not null or r.approved_by is not null then raise exception 'FAIL 4a: a refused attempt changed the draft'; end if;
  v_active := private.active_triage_protocol_config();
  if v_active is not null and exists (select 1 from jsonb_array_elements(v_active -> 'pathways') p where p ->> 'key' in ('pregnancy_danger_signs', 'hypertension_complication', 'diabetes_complication')) then
    raise exception 'FAIL 4b: a draft pathway is in the live config';
  end if;

  -- SABOTAGE: the constraint dropped, activating the draft by hand must now succeed
  alter table public.triage_protocols drop constraint triage_protocols_active_requires_signature;
  update public.triage_protocols set is_active = false where is_active;
  if pg_temp.try(format('update public.triage_protocols set is_active = true where id = %L', r.id)) <> 'ok' then
    raise exception 'VACUOUS TEST: with the constraint dropped the draft was still refused';
  end if;

  raise notice 'PASS: the S59d draft is inactive and unsigned, the database refuses an unsigned active version, only the CMO signs';
end $$;

rollback;
