-- S24b proof: the CMO's protocol functions and the hardening of confirm_care_plan_change (migration *_s24b_protocol_signoff_and_confirm_hardening.sql).
-- Review: docs/security/S24-confirm-care-plan-change-review.md. INV-02, INV-10, INV-16.
--
--   1. save_protocol_draft and approve_protocol: CMO only (an admin, a prescriber and a patient are refused); a draft is versioned, its code and version
--      forced into the definition; saving twice updates the same draft; approving needs steps, retires the previous approved version, stamps the CMO,
--      and the approved row is immutable; every step is audited; anon cannot execute.
--   2. confirm_care_plan_change: a signer whose licence expired or who was deactivated sends the change back (nothing applied, session restored); a signed
--      stop that matches no active medicine is sent back; a mid-apply failure inside a nested block leaves the session as the patient and the change
--      still waiting; the confirmed audit row names the patient; replay does nothing.
--   3. SABOTAGE: the identity assertion's restore removed (the function must then refuse), and approve_protocol's CMO check removed (a non-CMO then gets in).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
-- Run as a signed-in API user (role authenticated) with row security switched off on the three tables the S24 triggers guard, so the write reaches the
-- trigger instead of being filtered by RLS first; returns the SQLSTATE or 'ok'. (Staff have no write policy on medications at all, so without this the
-- trigger would never be exercised.)
create function pg_temp.try_claims(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  alter table public.medications disable row level security;
  alter table public.care_plans disable row level security;
  alter table public.specialist_referrals disable row level security;
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  alter table public.medications enable row level security;
  alter table public.care_plans enable row level security;
  alter table public.specialist_referrals enable row level security;
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's24-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S24 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S24 ' || p_label, 'MDCN', 'S24-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted', case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end,
      true, p_admin, true);
  return v;
end $f$;
create function pg_temp.tie(p_org uuid, p_patient uuid, p_doc uuid) returns void language sql as
$$ insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at) values (p_org, p_patient, p_doc, now()) $$;
create function pg_temp.state_of(p_id uuid) returns text language sql as $$ select state from public.care_plan_changes where id = p_id $$;
create function pg_temp.pcount(p_patient uuid, p_drug text) returns integer language sql as
$$ select count(*)::integer from public.medications where patient_id = p_patient and lower(drug_name) = lower(p_drug) and is_active and superseded_at is null $$;
-- confirm and, in the same session, report auth.uid(): the session must be put back as the patient
create function pg_temp.confirm_as(p_uid uuid, p_change uuid) returns text language plpgsql as
$f$ declare r text; v_after text;
begin
  perform pg_temp.act(p_uid);
  begin
    r := (public.confirm_care_plan_change(p_change) ->> 'outcome');
    v_after := (select auth.uid())::text;
    r := r || '|' || (v_after = p_uid::text)::text;
  exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.propose_med(p_doc uuid, p_patient uuid, p_proposal jsonb, p_extra text default '') returns text language plpgsql as
$f$ declare r text;
begin
  r := pg_temp.q_as(p_doc, format($q$select public.propose_care_plan_change(%L, 'medication', %L::jsonb, 'Average home readings are above the agreed target.'%s)::text$q$, p_patient, p_proposal::text, p_extra));
  return r;
end $f$;
create function pg_temp.sign_as(p_doc uuid, p_change uuid, p_summary text, p_conf boolean, p_over text) returns text language sql as
$$ select pg_temp.try_as(p_doc, format($q$select public.sign_care_plan_change(%L, %L, %L, %L)$q$, p_change, p_summary, p_conf, p_over)) $$;


create function pg_temp.try_sql_owner(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.pz(p_patient uuid, p_drug text) returns text language sql as
$$ select pg_temp.pcount(p_patient, p_drug)::text $$;

-- 0. Fixtures ----------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  update public.clinical_staff set active = false where is_test is not true;
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin));
  perform pg_temp.setf('smo', pg_temp.mkdoc(v_org, 'smo', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('smo2', pg_temp.mkdoc(v_org, 'smo2', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('pat', pg_temp.mkuser(v_org, 'pat', 'patient'));
  perform pg_temp.setf('pat2', pg_temp.mkuser(v_org, 'pat2', 'patient'));
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, pg_temp.f('pat'), pg_temp.f('smo'));
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, pg_temp.f('pat2'), pg_temp.f('smo2'));
  insert into public.patient_allergies (organisation_id, patient_id, allergen, source, recorded_by) values
    (v_org, pg_temp.f('pat'), 'proof-none', 'clinician', pg_temp.f('smo')), (v_org, pg_temp.f('pat2'), 'proof-none', 'clinician', pg_temp.f('smo2'));
end $$;

-- 1. Protocol functions ------------------------------------------------------------------------------------------------------
do $$
declare v_cmo uuid := pg_temp.f('cmo'); v_admin uuid := pg_temp.f('admin'); v_smo uuid := pg_temp.f('smo'); v_pat uuid := pg_temp.f('pat');
  d1 uuid; d1b uuid; d2 uuid; r text;
  def jsonb := '{"params":{"x":1},"steps":[{"id":"s1"}]}';
begin
  perform pg_temp.ck('anon cannot save a protocol draft', '42501', pg_temp.try_anon($q$select public.save_protocol_draft('proof_proto', '{"params":{},"steps":[]}'::jsonb)$q$));
  perform pg_temp.ck('anon cannot approve a protocol', '42501', pg_temp.try_anon($q$select public.approve_protocol(gen_random_uuid())$q$));
  foreach r in array array['admin', 'smo', 'pat'] loop
    perform pg_temp.ck('only the CMO can save a draft (' || r || ' refused)', 'true',
      (pg_temp.try_as(pg_temp.f(r), format($q$select public.save_protocol_draft('proof_proto', %L::jsonb)$q$, def::text)) like 'only the Chief Medical Officer%')::text);
  end loop;
  r := pg_temp.q_as(v_cmo, format($q$select public.save_protocol_draft('proof_proto', %L::jsonb, 'first cut')::text$q$, def::text));
  perform pg_temp.ck('the CMO can save a draft', 'true', (r !~ '^ERR')::text);
  d1 := r::uuid;
  perform pg_temp.ck('...version 1, status draft, code and version forced into the definition', 'draft|1|proof_proto|1',
    (select status || '|' || version::text || '|' || (definition ->> 'code') || '|' || (definition ->> 'version') from public.protocols where id = d1));
  d1b := pg_temp.q_as(v_cmo, format($q$select public.save_protocol_draft('proof_proto', %L::jsonb, 'second cut')::text$q$, '{"params":{"x":2},"steps":[{"id":"s1"},{"id":"s2"}]}'))::uuid;
  perform pg_temp.ck('saving again updates the same draft', d1::text || '|2', d1b::text || '|' || (select jsonb_array_length(definition -> 'steps')::text from public.protocols where id = d1));
  perform pg_temp.ck('a definition with no steps list is refused', 'true',
    (pg_temp.q_as(v_cmo, $q$select public.save_protocol_draft('proof_proto2', '{"params":{}}'::jsonb)::text$q$) like 'ERR:a protocol definition needs params%')::text);
  perform pg_temp.ck('a bad code is refused', 'true',
    (pg_temp.q_as(v_cmo, format($q$select public.save_protocol_draft('Bad Code!', %L::jsonb)::text$q$, def::text)) like 'ERR:a protocol code is%')::text);
  perform pg_temp.ck('a non-CMO cannot approve', 'true', (pg_temp.try_as(v_admin, format($q$select public.approve_protocol(%L)$q$, d1)) like 'only the Chief Medical Officer%')::text);
  perform pg_temp.ck('...a prescriber cannot either', 'true', (pg_temp.try_as(v_smo, format($q$select public.approve_protocol(%L)$q$, d1)) like 'only the Chief Medical Officer%')::text);
  -- an empty steps list cannot be approved
  d2 := (select id from public.protocols limit 0);
  insert into public.protocols (code, version, status, definition) values ('proof_empty', 1, 'draft', '{"code":"proof_empty","version":1,"params":{},"steps":[]}') returning id into d2;
  perform pg_temp.ck('a protocol with no steps cannot be approved', 'true', (pg_temp.try_as(v_cmo, format($q$select public.approve_protocol(%L)$q$, d2)) like 'a protocol with no steps%')::text);
  -- the test-only placeholder can never be approved
  insert into public.protocols (code, version, status, definition) values ('proof_placeholder', 1, 'draft', '{"code":"proof_placeholder","version":1,"placeholder":true,"params":{},"steps":[{"id":"a"}]}') returning id into d2;
  perform pg_temp.ck('a placeholder step table cannot be approved', 'true', (pg_temp.try_as(v_cmo, format($q$select public.approve_protocol(%L)$q$, d2)) like 'a placeholder step table%')::text);
  perform pg_temp.ck('...and stays a draft', 'draft', (select status from public.protocols where id = d2));
  perform pg_temp.ck('the CMO approves a draft', 'ok', pg_temp.try_as(v_cmo, format($q$select public.approve_protocol(%L, 'reviewed')$q$, d1)));
  perform pg_temp.ck('...approved, stamped as the CMO, definition marked approved', 'approved|' || v_cmo::text || '|approved',
    (select status || '|' || approved_by::text || '|' || (definition ->> 'status') from public.protocols where id = d1));
  perform pg_temp.ck('...the server can fetch it', 'proof_proto', pg_temp.q_as(v_smo, $q$select (public.get_approved_protocol('proof_proto') ->> 'code')$q$));
  perform pg_temp.ck('an approved protocol cannot be edited', '42501', pg_temp.try_sql_owner(format($q$update public.protocols set definition = '{"code":"proof_proto","version":1,"params":{},"steps":[1]}' where id = %L$q$, d1)));
  perform pg_temp.ck('...nor approved again', 'true', (pg_temp.try_as(v_cmo, format($q$select public.approve_protocol(%L)$q$, d1)) like 'only a draft protocol%')::text);
  -- a new version retires the old one
  d2 := pg_temp.q_as(v_cmo, format($q$select public.save_protocol_draft('proof_proto', %L::jsonb)::text$q$, def::text))::uuid;
  perform pg_temp.ck('a new draft after approval is version 2', '2', (select version::text from public.protocols where id = d2));
  perform pg_temp.try_as(v_cmo, format($q$select public.approve_protocol(%L)$q$, d2));
  perform pg_temp.ck('approving it retires version 1 and leaves one approved', 'retired|approved|1',
    (select (select status from public.protocols where id = d1) || '|' || (select status from public.protocols where id = d2) || '|' ||
            (select count(*)::text from public.protocols where code = 'proof_proto' and status = 'approved')));
  perform pg_temp.ck('saving and approving were audited', '5',
    (select count(*)::text from public.audit_log where action in ('protocol.draft_saved', 'protocol.approved') and actor_id = v_cmo and entity_id in (d1, d2)) );
end $$;

-- 2. confirm_care_plan_change hardening -------------------------------------------------------------------------------------
create function pg_temp.draft_sign(p_doc uuid, p_patient uuid, p_proposal jsonb) returns uuid language plpgsql as
$f$ declare r text; c uuid;
begin
  r := pg_temp.propose_med(p_doc, p_patient, p_proposal);
  if r like 'ERR%' then raise exception 'fixture propose failed: %', r; end if;
  c := r::uuid;
  r := pg_temp.sign_as(p_doc, c, 'Your care team would like to make a change to your tablets.', true, null);
  if r <> 'ok' then raise exception 'fixture sign failed: %', r; end if;
  return c;
end $f$;

do $$
declare v_smo uuid := pg_temp.f('smo'); v_smo2 uuid := pg_temp.f('smo2'); v_pat uuid := pg_temp.f('pat'); v_pat2 uuid := pg_temp.f('pat2');
  base uuid; c uuid; r text; caught text; uid_after text; st text;
  item jsonb := '{"drug_name":"%s","dose":"5 mg","frequency":"daily","duration_days":30,"quantity":"30 tablets"}';
begin
  base := pg_temp.q_as(v_smo, format($q$select public.prescribe_medication(%L, 'BaseDrug', '5 mg', 'daily', null, null, null, 'oral', 30, '30 tablets', 0, null, null, true)::text$q$, v_pat))::uuid;
  perform pg_temp.setf('base', base);

  -- a. the licence of the signer expires between signing and confirming
  c := pg_temp.draft_sign(v_smo, v_pat, jsonb_build_object('action', 'start', 'item', format(item::text, 'LicDrug')::jsonb));
  update public.clinical_staff set license_expires_at = now() - interval '1 day' where profile_id = v_smo;
  perform pg_temp.ck('a signer whose licence expired: the change is sent back', 'needs_review|true', pg_temp.confirm_as(v_pat, c));
  perform pg_temp.ck('...nothing was applied and the change lapsed', '0|expired', pg_temp.pz(v_pat, 'LicDrug') || '|' || pg_temp.state_of(c));
  perform pg_temp.ck('...the signer is told, neutrally', 'true',
    ((select count(*) from public.notifications where recipient_id = v_smo and template = 'care_change_expired_staff') >= 1)::text);
  update public.clinical_staff set license_expires_at = null where profile_id = v_smo;

  -- b. the signer is deactivated
  c := pg_temp.draft_sign(v_smo2, v_pat2, jsonb_build_object('action', 'start', 'item', format(item::text, 'GoneDrug')::jsonb));
  update public.clinical_staff set active = false where profile_id = v_smo2;
  perform pg_temp.ck('a deactivated signer: the change is sent back', 'needs_review|true', pg_temp.confirm_as(v_pat2, c));
  perform pg_temp.ck('...nothing applied', '0|expired', pg_temp.pz(v_pat2, 'GoneDrug') || '|' || pg_temp.state_of(c));
  update public.clinical_staff set active = true where profile_id = v_smo2;

  -- c. a signed stop whose medicine the patient already stopped herself
  c := pg_temp.draft_sign(v_smo, v_pat, jsonb_build_object('action', 'stop', 'medication_id', base, 'reason', 'Review outcome'));
  perform pg_temp.ck('(the patient stops her own medicine herself)', 'ok', pg_temp.try_as(v_pat, format($q$update public.medications set is_active = false, stopped_at = now(), stopped_reason = 'stopped by patient' where id = %L$q$, base)));
  perform pg_temp.ck('a stop that matches no active medicine is sent back, not reported as applied', 'needs_review|true', pg_temp.confirm_as(v_pat, c));
  perform pg_temp.ck('...the change lapsed', 'expired', pg_temp.state_of(c));

  -- d. a failure in the middle of applying: the identity comes back and the change stays waiting
  create function private.s24b_fail() returns trigger language plpgsql as $t$ begin raise exception 's24b forced failure'; end $t$;
  create trigger zz_s24b_fail before insert on public.medications for each row when (new.drug_name = 'ZZ-FAIL') execute function private.s24b_fail();
  c := pg_temp.draft_sign(v_smo, v_pat, jsonb_build_object('action', 'start', 'item', format(item::text, 'ZZ-FAIL')::jsonb));
  perform pg_temp.act(v_pat);
  begin
    perform public.confirm_care_plan_change(c);
    caught := 'no error';
  exception when others then caught := sqlerrm;
  end;
  uid_after := (select auth.uid())::text;
  perform pg_temp.back();
  perform pg_temp.ck('a failure mid-apply raises', 's24b forced failure', caught);
  perform pg_temp.ck('...the session is the patient again, not the signer', 'true', (uid_after = v_pat::text)::text);
  perform pg_temp.ck('...the change is still waiting and nothing was applied', 'signed|0', pg_temp.state_of(c) || '|' || pg_temp.pz(v_pat, 'ZZ-FAIL'));
  drop trigger zz_s24b_fail on public.medications;

  -- e. a normal confirm: audit names the patient, replay does nothing
  c := pg_temp.draft_sign(v_smo, v_pat, jsonb_build_object('action', 'start', 'item', format(item::text, 'GoodDrug')::jsonb));
  perform pg_temp.setf('c_good', c);
  perform pg_temp.ck('a normal confirm still applies', 'applied|true', pg_temp.confirm_as(v_pat, c));
  perform pg_temp.ck('...the confirmed audit row names the PATIENT as actor', v_pat::text,
    (select actor_id::text from public.audit_log where entity_id = c and action = 'care_plan_change.confirmed'));
  perform pg_temp.ck('...the signed audit row names the signer', v_smo::text,
    (select actor_id::text from public.audit_log where entity_id = c and action = 'care_plan_change.signed'));
  perform pg_temp.ck('...the applied medicine is attributed to the signer', v_smo::text,
    (select added_by::text from public.medications where patient_id = v_pat and drug_name = 'GoodDrug'));
  perform pg_temp.ck('...a replay does nothing', 'not_available|true', pg_temp.confirm_as(v_pat, c));
  perform pg_temp.ck('...and one medicine row exists', '1', pg_temp.pz(v_pat, 'GoodDrug'));
end $$;

-- 3. SABOTAGE ---------------------------------------------------------------------------------------------------------------
do $$
declare v_smo uuid := pg_temp.f('smo'); v_pat uuid := pg_temp.f('pat'); v_admin uuid := pg_temp.f('admin'); c uuid; v_def text; v_orig text; r text; d uuid;
  item jsonb := '{"drug_name":"SabDrug","dose":"5 mg","frequency":"daily","duration_days":30,"quantity":"30 tablets"}';
begin
  -- A. the final identity restore removed but the assertion kept: the assertion must refuse the confirm (defence in depth, a real check)
  v_orig := pg_get_functiondef('public.confirm_care_plan_change(uuid)'::regprocedure);
  v_def := replace(v_orig,
    E'  perform set_config(''request.jwt.claim.sub'', v_save_sub, true);\n  perform set_config(''request.jwt.claims'', v_save_claims, true);\n  perform set_config(''tarragon.change_apply'', '''', true);\n  -- Defence in depth',
    E'  -- Defence in depth');
  if v_def = v_orig then raise exception 'SABOTAGE A not applied'; end if;
  execute v_def;
  c := pg_temp.draft_sign(v_smo, v_pat, jsonb_build_object('action', 'start', 'item', item));
  r := pg_temp.confirm_as(v_pat, c);
  insert into results values ('real', 'if the identity were not restored, the assertion refuses the confirm', 'true', (r like 'ERR:session identity was not restored%')::text);

  -- B. the restore AND the assertion removed: the confirm applies but leaves the session as the signer, which the check must notice
  v_def := replace(v_def, 'if (select auth.uid()) is distinct from v_uid then', 'if false then');
  if v_def not like '%if false then%' then raise exception 'SABOTAGE B not applied'; end if;
  execute v_def;
  c := pg_temp.draft_sign(v_smo, v_pat, jsonb_build_object('action', 'start', 'item', replace(item::text, 'SabDrug', 'SabDrug2')::jsonb));
  r := pg_temp.confirm_as(v_pat, c);
  insert into results values ('sabotaged', 'after the apply the session is the patient again', 'applied|true', r);
  execute v_orig;

  -- approve_protocol without its CMO check: a non-CMO gets in
  d := (select id from public.protocols where code = 'proof_empty' limit 1);
  insert into public.protocols (code, version, status, definition) values ('proof_sab', 1, 'draft', '{"code":"proof_sab","version":1,"params":{},"steps":[{"id":"a"}]}') returning id into d;
  v_def := replace(pg_get_functiondef('public.approve_protocol(uuid,text)'::regprocedure), 'if not private.credential_is_cmo() then', 'if false then');
  if v_def not like '%if false then%' then raise exception 'SABOTAGE 2 not applied'; end if;
  execute v_def;
  r := pg_temp.try_as(v_admin, format($q$select public.approve_protocol(%L)$q$, d));
  insert into results values ('sabotaged', 'a non-CMO cannot approve a protocol', 'refused',
    case when r like 'only the Chief Medical Officer%' then 'refused' else 'accepted' end);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S24b proof FAILED on the real migrations: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks (%)', v_caught,
      (select string_agg(check_name || ' => ' || actual, '; ') from results where phase = 'sabotaged');
  end if;
end $$;

select phase, check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
