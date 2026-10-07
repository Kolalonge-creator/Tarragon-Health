-- Proof: S88 clinical config drafts (migration *_s88_clinical_config_drafts.sql).
--
--   1. Six unsigned v1 drafts exist; none signed or active; anon cannot execute; the API cannot write.
--   2. Signing is refused for a non-CMO (42501), for anon, and for a high-risk kind with no approved
--      independent review (55000). A changes_requested review, or a review of a DIFFERENT version, does not unlock it.
--   3. Only an admin or the CMO can record a review.
--   4. With an approved review for that exact version the CMO signs a high-risk kind; a medium-risk kind signs with no review.
--      Signing activates, stamps the CMO, writes an audit row, and a signed row cannot be signed again.
--   5. A stale version (older than one already signed) is refused (23514); signing a newer one retires the previous
--      active row and leaves exactly one active per kind.
--   6. SABOTAGE A: the review gate replaced by "always true"; the unreviewed high-risk kind must now sign (check flips).
--      SABOTAGE B: the stale gate replaced by "always false"; the stale version must now sign (check flips).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.msg(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  set local role authenticated;
end $f$;
create function pg_temp.act_anon() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's88-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'S88 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician');
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S88 ' || p_label, 'MDCN', 'S88-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      p_tier = 'chief_medical_officer', case when p_tier = 'chief_medical_officer' then p_admin end, true);
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_smo uuid;
  v_ai uuid; v_htn uuid; v_glp uuid; v_nurse uuid; v_nurse2 uuid; v_nurse3 uuid;
  v_txt text; v_n integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  v_smo := pg_temp.mkdoc(v_org, v_admin, 'smo', 'senior_medical_officer');

  select id into v_ai from public.clinical_config_versions where config_kind = 'ai_copilot_acceptable_use' and version = 1;
  select id into v_htn from public.clinical_config_versions where config_kind = 'hypertension_care_gap_rules' and version = 1;
  select id into v_glp from public.clinical_config_versions where config_kind = 'glp1_readiness_protocol' and version = 1;
  select id into v_nurse from public.clinical_config_versions where config_kind = 'field_nurse_visit_scope' and version = 1;

  -- 1. Shape
  perform pg_temp.rec('six unsigned v1 drafts', '6',
    (select count(*)::text from public.clinical_config_versions where version = 1 and status = 'draft' and approved_by is null and verify_against_source));
  perform pg_temp.rec('none active', '0', (select count(*)::text from public.clinical_config_versions where is_active));
  perform pg_temp.rec('anon cannot execute sign', 'false', has_function_privilege('anon', 'public.sign_clinical_config_version(uuid)', 'EXECUTE')::text);
  perform pg_temp.rec('anon cannot execute record review', 'false', has_function_privilege('anon', 'public.record_independent_clinical_review(uuid,text,text,timestamptz,text,text)', 'EXECUTE')::text);

  -- 2. Refusals
  perform pg_temp.act(v_smo);
  v_txt := pg_temp.msg(format('select public.sign_clinical_config_version(%L)', v_nurse));
  perform pg_temp.back();
  perform pg_temp.rec('a non-CMO cannot sign', 'true', (v_txt like '42501:%')::text);

  perform pg_temp.act_anon();
  v_txt := pg_temp.msg(format('select public.sign_clinical_config_version(%L)', v_nurse));
  perform pg_temp.back();
  perform pg_temp.rec('anon cannot sign', 'true', (v_txt like '42501:%')::text);

  perform pg_temp.act(v_cmo);
  v_txt := pg_temp.msg(format('select public.sign_clinical_config_version(%L)', v_glp));
  perform pg_temp.back();
  perform pg_temp.rec('high-risk kind without review is refused', 'true', (v_txt like '55000:%independent clinical review%')::text);
  perform pg_temp.rec('...and stays a draft', 'draft', (select status from public.clinical_config_versions where id = v_glp));

  -- 3. Who can record a review
  perform pg_temp.act(v_smo);
  v_txt := pg_temp.msg(format('select public.record_independent_clinical_review(%L, %L, %L, now(), %L, null)', v_glp, 'Dr R', 'MDCN/1', 'approved'));
  perform pg_temp.back();
  perform pg_temp.rec('a non-admin non-CMO cannot record a review', 'true', (v_txt like '42501:%')::text);

  perform pg_temp.act(v_admin);
  v_txt := pg_temp.msg(format('select public.record_independent_clinical_review(%L, %L, %L, now(), %L, %L)', v_glp, 'Dr Reviewer', 'MDCN/2', 'changes_requested', 'tighten stop rule'));
  perform pg_temp.back();
  perform pg_temp.rec('admin records a changes_requested review', 'ok', case when v_txt ~ '^[0-9a-f-]{36}$' or v_txt = 'ok' then 'ok' else v_txt end);

  perform pg_temp.act(v_cmo);
  v_txt := pg_temp.msg(format('select public.sign_clinical_config_version(%L)', v_glp));
  perform pg_temp.back();
  perform pg_temp.rec('changes_requested does not unlock signing', 'true', (v_txt like '55000:%')::text);

  -- a review of a DIFFERENT version does not unlock this one
  perform pg_temp.act(v_admin);
  perform public.record_independent_clinical_review(v_htn, 'Dr Reviewer', 'MDCN/2', now(), 'approved', null);
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  v_txt := pg_temp.msg(format('select public.sign_clinical_config_version(%L)', v_ai));
  perform pg_temp.back();
  perform pg_temp.rec('a review of another version does not unlock this one', 'true', (v_txt like '55000:%')::text);
  perform pg_temp.rec('...this one stays a draft', 'draft', (select status from public.clinical_config_versions where id = v_ai));

  -- 4. Signing works
  perform pg_temp.act(v_admin);
  perform public.record_independent_clinical_review(v_glp, 'Dr Reviewer', 'MDCN/2', now(), 'approved', 'ok');
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  v_txt := pg_temp.msg(format('select public.sign_clinical_config_version(%L)', v_glp));
  perform pg_temp.back();
  perform pg_temp.rec('high-risk kind signs with an approved review for that version', 'true', (v_txt ~ '^[0-9a-f-]{36}$' or v_txt = 'ok')::text);
  perform pg_temp.rec('...it is active and signed', 'active:true', (select status || ':' || (approved_by is not null and approved_at is not null)::text from public.clinical_config_versions where id = v_glp));
  perform pg_temp.rec('...and audited', '1', (select count(*)::text from public.audit_log where action = 'clinical_config_versions.signed' and entity_id = v_glp));
  perform pg_temp.act(v_cmo);
  v_txt := pg_temp.msg(format('select public.sign_clinical_config_version(%L)', v_glp));
  perform pg_temp.back();
  perform pg_temp.rec('a signed row cannot be signed again', 'true', (v_txt like '55000:%')::text);

  perform pg_temp.act(v_cmo);
  v_txt := pg_temp.msg(format('select public.sign_clinical_config_version(%L)', v_nurse));
  perform pg_temp.back();
  perform pg_temp.rec('medium-risk kind signs with no review (CMO session)', 'true', (v_txt ~ '^[0-9a-f-]{36}$' or v_txt = 'ok')::text);

  -- 5. Stale refusal, and retiring the previous active row
  insert into public.clinical_config_versions (config_kind, version, content, sources)
    select config_kind, 2, content, sources from public.clinical_config_versions where id = v_nurse returning id into v_nurse2;
  insert into public.clinical_config_versions (config_kind, version, content, sources)
    select config_kind, 3, content, sources from public.clinical_config_versions where id = v_nurse returning id into v_nurse3;
  perform pg_temp.act(v_cmo);
  v_txt := pg_temp.msg(format('select public.sign_clinical_config_version(%L)', v_nurse3));
  perform pg_temp.back();
  perform pg_temp.rec('a newer version signs', 'true', (v_txt ~ '^[0-9a-f-]{36}$' or v_txt = 'ok')::text);
  perform pg_temp.rec('...the previous active version is retired', 'retired', (select status from public.clinical_config_versions where id = v_nurse));
  perform pg_temp.rec('...exactly one active per kind', '1', (select count(*)::text from public.clinical_config_versions where config_kind = 'field_nurse_visit_scope' and is_active));
  perform pg_temp.act(v_cmo);
  v_txt := pg_temp.msg(format('select public.sign_clinical_config_version(%L)', v_nurse2));
  perform pg_temp.back();
  perform pg_temp.rec('a stale version is refused', 'true', (v_txt like '23514:%older than a signed version%')::text);
  perform pg_temp.rec('...and stays a draft', 'draft', (select status from public.clinical_config_versions where id = v_nurse2));

  -- API cannot write
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('API insert refused', '42501', left(pg_temp.msg(format($q$insert into public.clinical_config_versions (config_kind, version, content, sources) values ('field_nurse_visit_scope', 9, '{}', '[{}]')$q$)), 5));
  perform pg_temp.rec('API update refused', '42501', left(pg_temp.msg(format($q$update public.clinical_config_versions set status = 'active' where id = %L$q$, v_ai)), 5));
  perform pg_temp.rec('API delete refused', '42501', left(pg_temp.msg(format($q$delete from public.clinical_config_versions where id = %L$q$, v_ai)), 5));
  perform pg_temp.rec('API review insert refused', '42501', left(pg_temp.msg(format($q$insert into public.independent_clinical_reviews (config_version_id, reviewer_name, mdcn_number, reviewed_at, outcome, recorded_by) values (%L, 'x', 'y', now(), 'approved', %L)$q$, v_ai, v_admin)), 5));
  perform pg_temp.back();

  -- 6a. SABOTAGE A: review gate always true; the unreviewed AI kind must now sign (so the real check would fail).
  create or replace function private.clinical_config_review_ok(p_id uuid) returns boolean language sql as $s$ select true $s$;
  perform pg_temp.act(v_cmo);
  v_txt := pg_temp.msg(format('select public.sign_clinical_config_version(%L)', v_ai));
  perform pg_temp.back();
  insert into results values ('sabotaged', 'a review of another version does not unlock this one', 'true', (v_txt like '55000:%')::text);

  -- 6b. SABOTAGE B: stale gate always false; the stale version must now sign.
  create or replace function private.clinical_config_is_stale(p_id uuid) returns boolean language sql as $s$ select false $s$;
  perform pg_temp.act(v_cmo);
  v_txt := pg_temp.msg(format('select public.sign_clinical_config_version(%L)', v_nurse2));
  perform pg_temp.back();
  insert into results values ('sabotaged', 'a stale version is refused', 'true', (v_txt like '23514:%older than a signed version%')::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S88 clinical config proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: only % of 2 sabotage steps changed their matching check', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
