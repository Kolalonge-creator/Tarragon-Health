-- Proof for OQ-483 (founder decision: accepted as designed, proofs added). Bug class: identity / claims leakage across a transaction.
--
-- public.confirm_care_plan_change(uuid) runs for the PATIENT, but while it applies a signed change it sets the transaction-local session claims
-- (request.jwt.claim.sub, request.jwt.claims, and the flag tarragon.change_apply) to the recorded SIGNER, so that every existing medication trigger sees
-- the signer's own act. The design is accepted (docs/security/S24-confirm-care-plan-change-review.md). This proof pins the properties that make it safe:
--
--   1. Success path: after the call the claims (sub GUC, claims JSON sub, role), the apply flag and the database role are exactly the patient's again,
--      the applied medicine is attributed to the recorded signer, and a SECOND STATEMENT in the same transaction still runs as the patient (it cannot see
--      a clinician-only draft that the signer can see).
--   2. Error path: when the apply raises part-way (a forced trigger failure on the medicine insert) and the caller catches it with a savepoint, the claims,
--      the apply flag and the role are the patient's again, nothing was applied, the change is still waiting, and the retry then works. (Without a savepoint
--      the whole transaction is aborted and no later statement can run, so there is nothing further to leak.)
--   3. Only the recorded signer: another patient cannot confirm the change (42501, nothing moves), anon cannot execute it, a patient cannot rewrite
--      signed_by, an unsigned draft cannot be confirmed, and two changes signed by two different doctors are each attributed to their own signer.
--   4. Fail closed: a signer who was deactivated, or whose licence expired, between signing and confirming gets "needs_review": nothing is applied, the
--      change lapses, and the session is the patient's again.
--   5. Other return paths and kinds: a signed stop or change that went stale (the medicine was already stopped) is sent back with the session restored;
--      a target change and a reading-schedule change apply and leave the plan guard closed to the patient afterwards; a session that carries ONLY the
--      claims JSON (no separate sub setting) is restored too.
--   6. SABOTAGE (copies of the live body): (A) restore and assertion removed on the success path, (B) restore removed on the lost-authority return,
--      (C) the lost-authority check removed, (D) the patient check removed, (E) the apply wrapped in a handler that swallows its error, (F) only the
--      claims-JSON restore removed (the auth.uid() assertion stays silent, the session check must not), (G) restore removed on the stale-stop return.
--      Every one of the seven must flip a check, or the proof is vacuous.
--   Note on the error path: PostgreSQL itself reverts a transaction-local setting made inside a rolled-back savepoint, so the error-path checks pin the
--      observable result (session, flag, nothing applied, change still waiting, retry works). Sabotage E shows they notice a handler that swallows the error.
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
-- Act as a signed-in API user the way PostgREST does: both claim settings, the role claim, and the database role.
create function pg_temp.act(p_uid uuid, p_claims_only boolean default false) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', case when p_claims_only then '' else p_uid::text end, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $f$;
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
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'oq483-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'OQ483 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, organisation_id = excluded.organisation_id, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'OQ483 ' || p_label, 'MDCN', 'OQ483-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted', case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end,
      true, p_admin, true);
  return v;
end $f$;

-- What the session looks like: sub setting | sub inside the claims JSON | role claim | apply flag | database role. '-' stands for unset or empty.
create function pg_temp.sess() returns text language sql as
$$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), '-') || '|' ||
          coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '-') || '|' ||
          coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), '-') || '|' ||
          coalesce(nullif(current_setting('tarragon.change_apply', true), ''), '-') || '|' ||
          current_user $$;
-- The session of a signed-in user whose claims were never touched.
create function pg_temp.as_user(p_uid uuid) returns text language sql as
$$ select p_uid::text || '|' || p_uid::text || '|authenticated|-|authenticated' $$;
-- The same for a session that carries only the claims JSON (no separate sub setting).
create function pg_temp.as_user_json(p_uid uuid) returns text language sql as
$$ select '-|' || p_uid::text || '|authenticated|-|authenticated' $$;
-- Sign a change of any kind (draft_sign below is the medicine-start shortcut).
create function pg_temp.draft_sign_any(p_doc uuid, p_patient uuid, p_kind text, p_proposal jsonb, p_plan uuid default null) returns uuid language plpgsql as
$f$ declare r text; c uuid;
begin
  r := pg_temp.q_as(p_doc, format($q$select public.propose_care_plan_change(%L, %L, %L::jsonb, 'Average home readings are above the agreed target.', %L)::text$q$, p_patient, p_kind, p_proposal::text, p_plan));
  if r like 'ERR%' then raise exception 'fixture propose failed: %', r; end if;
  c := r::uuid;
  r := pg_temp.try_as(p_doc, format($q$select public.sign_care_plan_change(%L, %L, %L, %L)$q$, c, 'Your care team would like to make a change.', true, null));
  if r <> 'ok' then raise exception 'fixture sign failed: %', r; end if;
  return c;
end $f$;
-- Run as a signed-in patient with row security off on care_plans so the write reaches the plan guard trigger; returns the SQLSTATE or 'ok'.
create function pg_temp.try_plan_write(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  alter table public.care_plans disable row level security;
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  alter table public.care_plans enable row level security;
  return r;
end $f$;

create function pg_temp.state_of(p_id uuid) returns text language sql as $$ select state from public.care_plan_changes where id = p_id $$;
create function pg_temp.pcount(p_patient uuid, p_drug text) returns integer language sql as
$$ select count(*)::integer from public.medications where patient_id = p_patient and lower(drug_name) = lower(p_drug) and is_active and superseded_at is null $$;
create function pg_temp.added_by(p_patient uuid, p_drug text) returns text language sql as
$$ select coalesce(string_agg(distinct added_by::text, ','), 'none') from public.medications where patient_id = p_patient and lower(drug_name) = lower(p_drug) $$;

-- Confirm as the patient and, in the SAME transaction and the SAME session, report: the outcome, the session afterwards, and how many clinician-only
-- staff-only reads it can still make ('refused' for a patient, 'staff' for the signer). A caught error is reported by its message, the session still read after it.
create function pg_temp.confirm_probe(p_uid uuid, p_change uuid, p_claims_only boolean default false) returns text language plpgsql as
$f$ declare r text; s text; n text;
begin
  perform pg_temp.act(p_uid, p_claims_only);
  begin
    r := (public.confirm_care_plan_change(p_change) ->> 'outcome');
  exception when others then r := 'ERR:' || sqlerrm; end;
  s := pg_temp.sess();
  begin
    perform public.list_care_plan_changes(p_uid, 'oq483 probe');
    n := 'staff';
  exception when others then n := 'refused'; end;
  perform pg_temp.back();
  return r || '#' || s || '#' || n;
end $f$;

create function pg_temp.draft_sign(p_doc uuid, p_patient uuid, p_drug text) returns uuid language plpgsql as
$f$ declare r text; c uuid; v_prop jsonb;
begin
  v_prop := jsonb_build_object('action', 'start', 'item',
    jsonb_build_object('drug_name', p_drug, 'dose', '5 mg', 'frequency', 'daily', 'duration_days', 30, 'quantity', '30 tablets'));
  r := pg_temp.q_as(p_doc, format($q$select public.propose_care_plan_change(%L, 'medication', %L::jsonb, 'Average home readings are above the agreed target.')::text$q$, p_patient, v_prop::text));
  if r like 'ERR%' then raise exception 'fixture propose failed: %', r; end if;
  c := r::uuid;
  r := pg_temp.try_as(p_doc, format($q$select public.sign_care_plan_change(%L, %L, %L, %L)$q$, c, 'Your care team would like to make a change to your tablets.', true, null));
  if r <> 'ok' then raise exception 'fixture sign failed: %', r; end if;
  return c;
end $f$;

-- 0. Fixtures ----------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  perform pg_temp.setf('smo', pg_temp.mkdoc(v_org, 'smo', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('smo2', pg_temp.mkdoc(v_org, 'smo2', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('pat', pg_temp.mkuser(v_org, 'pat', 'patient'));
  perform pg_temp.setf('pat2', pg_temp.mkuser(v_org, 'pat2', 'patient'));
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, pg_temp.f('pat'), pg_temp.f('smo'));
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, pg_temp.f('pat2'), pg_temp.f('smo2'));
  insert into public.patient_allergies (organisation_id, patient_id, allergen, source, recorded_by) values
    (v_org, pg_temp.f('pat'), 'proof-none', 'clinician', pg_temp.f('smo')), (v_org, pg_temp.f('pat2'), 'proof-none', 'clinician', pg_temp.f('smo2'));
end $$;

-- 1. Success path ------------------------------------------------------------------------------------------------------
do $$
declare v_smo uuid := pg_temp.f('smo'); v_pat uuid := pg_temp.f('pat'); c uuid; draft uuid; r text;
begin
  -- a staff-only read (list_care_plan_changes) is what tells "still the patient" from "still the signer": the signer can run it, the patient is refused
  -- an unsigned draft, used later to show a draft cannot be confirmed
  draft := pg_temp.q_as(v_smo, format($q$select public.propose_care_plan_change(%L, 'medication', %L::jsonb, 'A draft only the care team may see.')::text$q$, v_pat,
            '{"action":"start","item":{"drug_name":"DraftOnly","dose":"5 mg","frequency":"daily","duration_days":30,"quantity":"30 tablets"}}'))::uuid;
  perform pg_temp.setf('draft', draft);
  perform pg_temp.ck('control: the signer can run the staff-only read', 'true',
    pg_temp.q_as(v_smo, format($q$select (public.list_care_plan_changes(%L, 'oq483 control') is not null)::text$q$, v_pat)));
  perform pg_temp.ck('control: the patient is refused the staff-only read', 'ERR:Not authorised to see these changes',
    pg_temp.q_as(v_pat, format($q$select (public.list_care_plan_changes(%L, 'oq483 control') is not null)::text$q$, v_pat)));

  c := pg_temp.draft_sign(v_smo, v_pat, 'OkDrug');
  perform pg_temp.setf('c_ok', c);
  r := pg_temp.confirm_probe(v_pat, c);
  perform pg_temp.ck('success: the change is applied', 'applied', split_part(r, '#', 1));
  perform pg_temp.ck('success: claims (sub, claims sub, role), apply flag and database role are the patient''s again', pg_temp.as_user(v_pat), split_part(r, '#', 2));
  perform pg_temp.ck('success: a second statement in the same transaction still runs as the patient (refused the staff-only read)', 'refused', split_part(r, '#', 3));
  perform pg_temp.ck('success: the change is confirmed and one medicine exists', 'confirmed|1', pg_temp.state_of(c) || '|' || pg_temp.pcount(v_pat, 'OkDrug'));
  perform pg_temp.ck('success: the applied medicine is attributed to the recorded signer, not the patient', v_smo::text, pg_temp.added_by(v_pat, 'OkDrug'));
  perform pg_temp.ck('success: the confirmed audit row names the patient', v_pat::text,
    (select actor_id::text from public.audit_log where entity_id = c and action = 'care_plan_change.confirmed'));
end $$;

-- 2. Error path: the apply raises part-way and the caller catches it with a savepoint ---------------------------------------
do $$
declare v_smo uuid := pg_temp.f('smo'); v_pat uuid := pg_temp.f('pat'); c uuid; r text;
begin
  create function private.oq483_fail() returns trigger language plpgsql as $t$ begin raise exception 'oq483 forced failure'; end $t$;
  create trigger zz_oq483_fail before insert on public.medications for each row when (new.drug_name = 'ZZ-FAIL') execute function private.oq483_fail();
  c := pg_temp.draft_sign(v_smo, v_pat, 'ZZ-FAIL');
  r := pg_temp.confirm_probe(v_pat, c);
  perform pg_temp.ck('error: the apply raised part-way', 'ERR:oq483 forced failure', split_part(r, '#', 1));
  perform pg_temp.ck('error: claims, apply flag and database role are the patient''s again after the caught error', pg_temp.as_user(v_pat), split_part(r, '#', 2));
  perform pg_temp.ck('error: a following statement runs as the patient (refused the staff-only read)', 'refused', split_part(r, '#', 3));
  perform pg_temp.ck('error: nothing was applied and the change is still waiting', 'signed|0', pg_temp.state_of(c) || '|' || pg_temp.pcount(v_pat, 'ZZ-FAIL'));
  -- the failure goes away: the same change then applies (nothing was left stuck, locked or half-written)
  drop trigger zz_oq483_fail on public.medications;
  r := pg_temp.confirm_probe(v_pat, c);
  perform pg_temp.ck('error: the retry applies once the cause is gone', 'applied', split_part(r, '#', 1));
  perform pg_temp.ck('error: ...and the session is the patient''s again', pg_temp.as_user(v_pat), split_part(r, '#', 2));
end $$;

-- 3. Only the recorded signer -------------------------------------------------------------------------------------------------
do $$
declare v_smo uuid := pg_temp.f('smo'); v_smo2 uuid := pg_temp.f('smo2'); v_pat uuid := pg_temp.f('pat'); v_pat2 uuid := pg_temp.f('pat2');
  c1 uuid; c2 uuid; c3 uuid; r text;
begin
  c1 := pg_temp.draft_sign(v_smo, v_pat, 'SignerOne');
  c2 := pg_temp.draft_sign(v_smo2, v_pat2, 'SignerTwo');
  -- another patient tries to confirm c1
  r := pg_temp.confirm_probe(v_pat2, c1);
  perform pg_temp.ck('another patient cannot confirm the change', 'ERR:Not authorised to confirm this change', split_part(r, '#', 1));
  perform pg_temp.ck('...their session is untouched', pg_temp.as_user(v_pat2), split_part(r, '#', 2));
  perform pg_temp.ck('...the change is unchanged and nothing was applied', 'signed|0', pg_temp.state_of(c1) || '|' || (pg_temp.pcount(v_pat, 'SignerOne') + pg_temp.pcount(v_pat2, 'SignerOne'))::text);
  perform pg_temp.ck('a made-up change id is refused the same way', 'ERR:Not authorised to confirm this change',
    split_part(pg_temp.confirm_probe(v_pat, gen_random_uuid()), '#', 1));
  perform pg_temp.ck('anon cannot execute it', '42501', pg_temp.try_anon($q$select public.confirm_care_plan_change(gen_random_uuid())$q$));
  perform pg_temp.ck('a signed-in clinician (not the patient) cannot confirm it', 'ERR:Not authorised to confirm this change', split_part(pg_temp.confirm_probe(v_smo, c1), '#', 1));
  -- a patient cannot rewrite who the signer is
  perform pg_temp.try_as(v_pat, format($q$update public.care_plan_changes set signed_by = %L where id = %L$q$, v_pat, c1));
  perform pg_temp.ck('a patient cannot rewrite signed_by', v_smo::text, (select signed_by::text from public.care_plan_changes where id = c1));
  -- an unsigned draft cannot be confirmed
  c3 := pg_temp.f('draft');
  perform pg_temp.ck('an unsigned draft cannot be confirmed', 'not_available', split_part(pg_temp.confirm_probe(v_pat, c3), '#', 1));
  perform pg_temp.ck('...and nothing was applied', '0', pg_temp.pcount(v_pat, 'DraftOnly')::text);
  -- each change is applied as its OWN recorded signer
  perform pg_temp.ck('patient one confirms', 'applied', split_part(pg_temp.confirm_probe(v_pat, c1), '#', 1));
  r := pg_temp.confirm_probe(v_pat2, c2);
  perform pg_temp.ck('patient two confirms', 'applied', split_part(r, '#', 1));
  perform pg_temp.ck('...and is the patient again afterwards', pg_temp.as_user(v_pat2), split_part(r, '#', 2));
  perform pg_temp.ck('change one is attributed to its signer only', v_smo::text, pg_temp.added_by(v_pat, 'SignerOne'));
  perform pg_temp.ck('change two is attributed to its signer only', v_smo2::text, pg_temp.added_by(v_pat2, 'SignerTwo'));
end $$;

-- 4. Fail closed when the signer has lost authority ---------------------------------------------------------------------------
do $$
declare v_smo uuid := pg_temp.f('smo'); v_smo2 uuid := pg_temp.f('smo2'); v_pat uuid := pg_temp.f('pat'); v_pat2 uuid := pg_temp.f('pat2'); c uuid; r text;
begin
  -- a. deactivated
  c := pg_temp.draft_sign(v_smo2, v_pat2, 'GoneDrug');
  update public.clinical_staff set active = false where profile_id = v_smo2;
  r := pg_temp.confirm_probe(v_pat2, c);
  perform pg_temp.ck('a deactivated signer: the change is sent back', 'needs_review', split_part(r, '#', 1));
  perform pg_temp.ck('...the session is the patient''s again, apply flag cleared', pg_temp.as_user(v_pat2), split_part(r, '#', 2));
  perform pg_temp.ck('...nothing applied, the change lapsed', '0|expired', pg_temp.pcount(v_pat2, 'GoneDrug') || '|' || pg_temp.state_of(c));
  perform pg_temp.ck('...the signer is told', 'true',
    ((select count(*) from public.notifications where recipient_id = v_smo2 and template = 'care_change_expired_staff') >= 1)::text);
  update public.clinical_staff set active = true where profile_id = v_smo2;
  -- b. licence expired
  c := pg_temp.draft_sign(v_smo, v_pat, 'LicDrug');
  update public.clinical_staff set license_expires_at = now() - interval '1 day' where profile_id = v_smo;
  r := pg_temp.confirm_probe(v_pat, c);
  perform pg_temp.ck('an expired licence: the change is sent back', 'needs_review', split_part(r, '#', 1));
  perform pg_temp.ck('...the session is the patient''s again', pg_temp.as_user(v_pat), split_part(r, '#', 2));
  perform pg_temp.ck('...nothing applied, the change lapsed', '0|expired', pg_temp.pcount(v_pat, 'LicDrug') || '|' || pg_temp.state_of(c));
  update public.clinical_staff set license_expires_at = null where profile_id = v_smo;
end $$;

-- 4b. Other return paths and kinds -------------------------------------------------------------------------------------------
do $$
declare v_smo uuid := pg_temp.f('smo'); v_pat uuid := pg_temp.f('pat'); v_org uuid := pg_temp.f('org'); base uuid; base2 uuid; plan uuid; c uuid; r text;
begin
  base := pg_temp.q_as(v_smo, format($q$select public.prescribe_medication(%L, 'StaleBase', '5 mg', 'daily', null, null, null, 'oral', 30, '30 tablets', 0, null, null, true)::text$q$, v_pat))::uuid;
  base2 := pg_temp.q_as(v_smo, format($q$select public.prescribe_medication(%L, 'StaleBase2', '5 mg', 'daily', null, null, null, 'oral', 30, '30 tablets', 0, null, null, true)::text$q$, v_pat))::uuid;
  perform pg_temp.setf('stale1', base);
  -- a. a signed stop whose medicine the patient already stopped
  c := pg_temp.draft_sign_any(v_smo, v_pat, 'medication', jsonb_build_object('action', 'stop', 'medication_id', base, 'reason', 'Review outcome'));
  perform pg_temp.try_as(v_pat, format($q$update public.medications set is_active = false, stopped_at = now(), stopped_reason = 'stopped by patient' where id = %L$q$, base));
  r := pg_temp.confirm_probe(v_pat, c);
  perform pg_temp.ck('stale stop: sent back', 'needs_review', split_part(r, '#', 1));
  perform pg_temp.ck('...session, flag and role are the patient''s again', pg_temp.as_user(v_pat), split_part(r, '#', 2));
  perform pg_temp.ck('...a later staff-only read is still refused', 'refused', split_part(r, '#', 3));
  -- b. a signed change whose medicine the patient already stopped
  c := pg_temp.draft_sign_any(v_smo, v_pat, 'medication',
         jsonb_build_object('action', 'change', 'medication_id', base2, 'item', jsonb_build_object('drug_name', 'StaleBase2', 'dose', '10 mg', 'frequency', 'daily', 'duration_days', 30, 'quantity', '30 tablets')));
  perform pg_temp.try_as(v_pat, format($q$update public.medications set is_active = false, stopped_at = now(), stopped_reason = 'stopped by patient' where id = %L$q$, base2));
  r := pg_temp.confirm_probe(v_pat, c);
  perform pg_temp.ck('stale change: sent back', 'needs_review', split_part(r, '#', 1));
  perform pg_temp.ck('...session, flag and role are the patient''s again', pg_temp.as_user(v_pat), split_part(r, '#', 2));
  perform pg_temp.ck('...nothing was applied', '0', pg_temp.pcount(v_pat, 'StaleBase2')::text);
  -- c. care plan target and reading schedule
  insert into public.care_plans (organisation_id, patient_id, condition, status, target_ranges) values (v_org, v_pat, 'hypertension', 'active', '{"systolic_max":140,"diastolic_max":90}')
  returning id into plan;
  c := pg_temp.draft_sign_any(v_smo, v_pat, 'target', '{"target_ranges":{"systolic_max":130,"diastolic_max":80}}'::jsonb, plan);
  r := pg_temp.confirm_probe(v_pat, c);
  perform pg_temp.ck('target change: applied', 'applied', split_part(r, '#', 1));
  perform pg_temp.ck('...session, flag and role are the patient''s again', pg_temp.as_user(v_pat), split_part(r, '#', 2));
  perform pg_temp.ck('...the target changed', '130', (select target_ranges ->> 'systolic_max' from public.care_plans where id = plan));
  perform pg_temp.ck('...afterwards the patient cannot edit the target herself (the plan guard is closed again)', '42501',
    pg_temp.try_plan_write(v_pat, format($q$update public.care_plans set target_ranges = '{"systolic_max":200}' where id = %L$q$, plan)));
  c := pg_temp.draft_sign_any(v_smo, v_pat, 'reading_schedule', '{"reading_schedule":{"per_week":7}}'::jsonb, plan);
  r := pg_temp.confirm_probe(v_pat, c);
  perform pg_temp.ck('reading schedule change: applied, session the patient''s again', 'applied|' || pg_temp.as_user(v_pat), split_part(r, '#', 1) || '|' || split_part(r, '#', 2));
  perform pg_temp.ck('...afterwards the patient cannot edit the schedule herself', '42501',
    pg_temp.try_plan_write(v_pat, format($q$update public.care_plans set reading_schedule = '{"per_week":1}' where id = %L$q$, plan)));
  -- d. a session that carries only the claims JSON
  c := pg_temp.draft_sign(v_smo, v_pat, 'JsonOnly');
  r := pg_temp.confirm_probe(v_pat, c, true);
  perform pg_temp.ck('claims-JSON-only session: applied', 'applied', split_part(r, '#', 1));
  perform pg_temp.ck('...restored exactly (no sub setting invented, claims JSON is the patient''s)', pg_temp.as_user_json(v_pat), split_part(r, '#', 2));
  perform pg_temp.ck('...a later staff-only read is still refused', 'refused', split_part(r, '#', 3));
  perform pg_temp.ck('...the medicine is attributed to the signer', v_smo::text, pg_temp.added_by(v_pat, 'JsonOnly'));
end $$;

-- 6. SABOTAGE: copies of the live body that forget to restore, or skip a check -------------------------------------------------
-- Each sabotage re-runs the same probe on a fresh change. The rows go in as phase 'sabotaged' (never printed) and must differ from what the real body gives.
do $$
declare v_smo uuid := pg_temp.f('smo'); v_smo2 uuid := pg_temp.f('smo2'); v_pat uuid := pg_temp.f('pat'); v_pat2 uuid := pg_temp.f('pat2');
  v_orig text; v_def text; c uuid; r text;
  restore3 text := E'  perform set_config(''request.jwt.claim.sub'', v_save_sub, true);\n  perform set_config(''request.jwt.claims'', v_save_claims, true);\n  perform set_config(''tarragon.change_apply'', '''', true);\n';
  auth_restore text := E'    perform set_config(''request.jwt.claim.sub'', v_save_sub, true);\n    perform set_config(''request.jwt.claims'', v_save_claims, true);\n    perform set_config(''tarragon.change_apply'', '''', true);\n    update public.care_plan_changes set state = ''expired'', expired_at = now() where id = p_change;\n    perform private.written_care_notify(c.signed_by, c.organisation_id, ''care_change_expired_staff'', jsonb_build_object(''care_plan_change_id'', p_change, ''reason'', ''authority''));\n';
  stale_restore text := E'\n        perform set_config(''request.jwt.claim.sub'', v_save_sub, true);\n        perform set_config(''request.jwt.claims'', v_save_claims, true);\n        perform set_config(''tarragon.change_apply'', '''', true);\n        update public.care_plan_changes set state = ''expired'', expired_at = now() where id = p_change;\n        perform private.written_care_notify(c.signed_by, c.organisation_id, ''care_change_expired_staff'', jsonb_build_object(''care_plan_change_id'', p_change, ''reason'', ''stale''));\n        return jsonb_build_object(''outcome'', ''needs_review'');';
  stale_restore_gone text := E'\n        update public.care_plan_changes set state = ''expired'', expired_at = now() where id = p_change;\n        perform private.written_care_notify(c.signed_by, c.organisation_id, ''care_change_expired_staff'', jsonb_build_object(''care_plan_change_id'', p_change, ''reason'', ''stale''));\n        return jsonb_build_object(''outcome'', ''needs_review'');';
  v_base uuid;
  auth_restore_gone text := E'    update public.care_plan_changes set state = ''expired'', expired_at = now() where id = p_change;\n    perform private.written_care_notify(c.signed_by, c.organisation_id, ''care_change_expired_staff'', jsonb_build_object(''care_plan_change_id'', p_change, ''reason'', ''authority''));\n';
begin
  v_orig := pg_get_functiondef('public.confirm_care_plan_change(uuid)'::regprocedure);

  -- A. success path: the final restore AND the identity assertion removed
  v_def := replace(v_orig, restore3 || E'  -- Defence in depth', E'  -- Defence in depth');
  if v_def = v_orig then raise exception 'SABOTAGE A not applied'; end if;
  v_def := replace(v_def, 'if (select auth.uid()) is distinct from v_uid then', 'if false then');
  if v_def not like '%if false then%' then raise exception 'SABOTAGE A2 not applied'; end if;
  execute v_def;
  c := pg_temp.draft_sign(v_smo, v_pat, 'SabA');
  r := pg_temp.confirm_probe(v_pat, c);
  insert into results values ('sabotaged', 'A: success path leaves the patient''s session', pg_temp.as_user(v_pat), split_part(r, '#', 2));
  insert into results values ('sabotaged', 'A: a second statement still runs as the patient', 'refused', split_part(r, '#', 3));
  execute v_orig;

  -- B. lost-authority return: the restore removed
  v_def := replace(v_orig, auth_restore, auth_restore_gone);
  if v_def = v_orig then raise exception 'SABOTAGE B not applied'; end if;
  execute v_def;
  c := pg_temp.draft_sign(v_smo2, v_pat2, 'SabB');
  update public.clinical_staff set active = false where profile_id = v_smo2;
  r := pg_temp.confirm_probe(v_pat2, c);
  insert into results values ('sabotaged', 'B: lost-authority return leaves the patient''s session', pg_temp.as_user(v_pat2), split_part(r, '#', 2));
  update public.clinical_staff set active = true where profile_id = v_smo2;
  execute v_orig;

  -- C. the lost-authority check removed
  v_def := replace(v_orig, 'if not private.has_prescribing_authority(c.organisation_id)', 'if false and not private.has_prescribing_authority(c.organisation_id)');
  v_def := replace(v_def, 'or not exists (select 1 from public.clinical_staff cs', 'and false and not exists (select 1 from public.clinical_staff cs');
  if v_def = v_orig or v_def not like '%and false and not exists%' or v_def not like '%if false and not private.has_prescribing%' then raise exception 'SABOTAGE C not applied'; end if;
  execute v_def;
  c := pg_temp.draft_sign(v_smo, v_pat, 'SabC');
  update public.clinical_staff set license_expires_at = now() - interval '1 day' where profile_id = v_smo;
  r := pg_temp.confirm_probe(v_pat, c);
  if split_part(r, '#', 1) <> 'applied' then raise exception 'SABOTAGE C flipped for another reason: %', r; end if;
  insert into results values ('sabotaged', 'C: a signer with an expired licence is sent back', 'needs_review', split_part(r, '#', 1));
  insert into results values ('sabotaged', 'C: ...and nothing is applied', '0', pg_temp.pcount(v_pat, 'SabC')::text);
  update public.clinical_staff set license_expires_at = null where profile_id = v_smo;
  execute v_orig;

  -- D. the patient check removed
  v_def := replace(v_orig, 'if c.id is null or v_uid is null or c.patient_id <> v_uid then', 'if c.id is null or v_uid is null then');
  if v_def = v_orig then raise exception 'SABOTAGE D not applied'; end if;
  execute v_def;
  c := pg_temp.draft_sign(v_smo, v_pat, 'SabD');
  r := pg_temp.confirm_probe(v_pat2, c);
  insert into results values ('sabotaged', 'D: another patient cannot confirm the change', 'ERR:Not authorised to confirm this change', split_part(r, '#', 1));
  execute v_orig;

  -- E. the apply wrapped in a handler that swallows its error and reports success
  v_def := replace(v_orig, E'  return jsonb_build_object(''outcome'', ''applied'');\nend;', E'  return jsonb_build_object(''outcome'', ''applied'');\nexception when others then\n  return jsonb_build_object(''outcome'', ''applied'');\nend;');
  if v_def = v_orig then raise exception 'SABOTAGE E not applied'; end if;
  execute v_def;
  create or replace function private.oq483_fail() returns trigger language plpgsql as $t$ begin raise exception 'oq483 forced failure'; end $t$;
  create trigger zz_oq483_fail before insert on public.medications for each row when (new.drug_name = 'ZZ-FAIL-E') execute function private.oq483_fail();
  c := pg_temp.draft_sign(v_smo, v_pat, 'ZZ-FAIL-E');
  r := pg_temp.confirm_probe(v_pat, c);
  insert into results values ('sabotaged', 'E: the apply raised part-way and the caller is told', 'ERR:oq483 forced failure', split_part(r, '#', 1));
  insert into results values ('sabotaged', 'E: ...nothing applied and the change still waiting', 'signed|0', pg_temp.state_of(c) || '|' || pg_temp.pcount(v_pat, 'ZZ-FAIL-E'));
  drop trigger zz_oq483_fail on public.medications;
  execute v_orig;

  -- F. only the claims-JSON restore removed on the success path: auth.uid() still reads the restored sub setting, so the function's own assertion stays silent
  v_def := replace(v_orig, restore3 || E'  -- Defence in depth', replace(restore3, E'  perform set_config(''request.jwt.claims'', v_save_claims, true);\n', '') || E'  -- Defence in depth');
  if v_def = v_orig then raise exception 'SABOTAGE F not applied'; end if;
  execute v_def;
  c := pg_temp.draft_sign(v_smo, v_pat, 'SabF');
  r := pg_temp.confirm_probe(v_pat, c);
  if split_part(r, '#', 1) <> 'applied' then raise exception 'SABOTAGE F was caught by the function''s own assertion, not by the session check: %', r; end if;
  insert into results values ('sabotaged', 'F: the claims JSON is the patient''s again after a partial restore', pg_temp.as_user(v_pat), split_part(r, '#', 2));
  execute v_orig;

  -- G. the stale-stop return: restore removed
  v_def := replace(v_orig, stale_restore, stale_restore_gone);
  if v_def = v_orig then raise exception 'SABOTAGE G not applied'; end if;
  execute v_def;
  v_base := pg_temp.q_as(v_smo, format($q$select public.prescribe_medication(%L, 'SabGBase', '5 mg', 'daily', null, null, null, 'oral', 30, '30 tablets', 0, null, null, true)::text$q$, v_pat))::uuid;
  c := pg_temp.draft_sign_any(v_smo, v_pat, 'medication', jsonb_build_object('action', 'stop', 'medication_id', v_base, 'reason', 'Review outcome'));
  perform pg_temp.try_as(v_pat, format($q$update public.medications set is_active = false, stopped_at = now(), stopped_reason = 'stopped by patient' where id = %L$q$, v_base));
  r := pg_temp.confirm_probe(v_pat, c);
  insert into results values ('sabotaged', 'G: stale-stop return leaves the patient''s session', pg_temp.as_user(v_pat), split_part(r, '#', 2));
  execute v_orig;
end $$;

do $$
declare v_bad integer; v_flipped integer; v_total integer; v_names text;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'OQ-483 proof FAILED on the real function: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  -- the sabotage rows are grouped by their letter: how many of the seven sabotages flipped at least one check
  select count(distinct left(check_name, 1)) into v_flipped from results where phase = 'sabotaged' and expected is distinct from actual;
  select count(distinct left(check_name, 1)) into v_total from results where phase = 'sabotaged';
  select string_agg(check_name || ' => ' || coalesce(actual, 'null'), '; ') into v_names from results where phase = 'sabotaged';
  if v_total < 7 or v_flipped < 7 then
    raise exception 'VACUOUS TEST: the sabotage flipped % of % checks (%)', v_flipped, v_total, v_names;
  end if;
end $$;

select phase, check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
