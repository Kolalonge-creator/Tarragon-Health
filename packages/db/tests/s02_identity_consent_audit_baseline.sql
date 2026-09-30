-- ===========================================================================
-- Proof: 20260930*_s02_identity_consent_audit_baseline.sql (v5 S02; OQ-03, OQ-04, OQ-09, OQ-25).
--
-- Proves, against the real migrated schema, with simulated sessions per role (patient, an unrelated patient standing
-- in for a supporter with no grant, clinician, admin, lab partner, anon):
--   1. is_test (INV-13): nobody can flag or unflag themselves; an org-staff clinician cannot flag a patient; an admin
--      can; a service context can; the @tarragon.test backfill left no unflagged test account; the lint ratchet finds
--      no metric/payout view that ignores is_test.
--   2. proxy_setups: the creator inserts and reads her own; another patient, a clinician and a partner see nothing;
--      only admin also sees them; nobody but the definer path updates; the state machine has terminal states and
--      immutable targets; an expired setup cannot be confirmed; anon has no table access.
--   3. audit_log: UPDATE, DELETE and TRUNCATE are impossible for every application role (grants gone, triggers hold),
--      and the TRUNCATE trigger really rejects (proved on a scratch copy so the live trail is never locked).
--   4. Audited reads: admin search/open/consents write an audit_log row (with subject, reason, ip column present,
--      query text NOT stored); a patient, clinician, lab partner and unrelated patient are refused (empty result)
--      and the refusal is itself audited; a clinician with an active break-glass grant is admitted; the
--      reproductive_health category is still excluded from break-glass; anon cannot execute any of it.
--   5. patient_consents: the patient reads her own rows, a clinician (org staff) and an admin no longer read the
--      table directly, and the v5-shaped view reports granted / withdrawn correctly.
--   6. SABOTAGE, one per area, each proving its check can fail: drop the is_test guard, disable the proxy state
--      machine, regrant TRUNCATE, restore the old staff-read consent policy, plant an unfiltered payout view.
--
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- Run:  psql -f packages/db/tests/s02_identity_consent_audit_baseline.sql  (CI: scripts/run-db-proofs.sh)
-- ===========================================================================

begin;

do $$
declare
  v_org uuid;
  v_pat uuid := gen_random_uuid();
  v_pat2 uuid := gen_random_uuid();
  v_clin uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_partner uuid := gen_random_uuid();
  v_n integer;
  v_id uuid;
  v_ver record;
  v_failed boolean;
  v_state text;
  v_err text;
  v_sqlstate text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_pat,     's02-pat@example.invalid',     'x', now(), '{}', '{}'),
    (v_pat2,    's02-pat2@example.invalid',    'x', now(), '{}', '{}'),
    (v_clin,    's02-clin@example.invalid',    'x', now(), '{}', '{}'),
    (v_admin,   's02-admin@example.invalid',   'x', now(), '{}', '{}'),
    (v_partner, 's02-partner@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_pat,     v_org, 'patient',    'S02 Patient One', '+2348011110001'),
    (v_pat2,    v_org, 'patient',    'S02 Patient Two', '+2348011110002'),
    (v_clin,    v_org, 'clinician',  'S02 Clinician',   '+2348011110003'),
    (v_admin,   v_org, 'admin',      'S02 Admin',       '+2348011110004'),
    (v_partner, v_org, 'lab_partner','S02 Partner',     '+2348011110005')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  -- =========================================================================
  -- 1. is_test
  -- =========================================================================
  -- 1a. a patient cannot flag herself
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin
    update public.profiles set is_test = true where id = v_pat;
  exception when others then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL 1a: a patient could set her own is_test'; end if;

  -- 1b. control: the same patient CAN edit her own discreet_mode / low_data_mode (the gate opens)
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.profiles set discreet_mode = true, low_data_mode = true where id = v_pat;
  execute 'reset role';
  if not exists (select 1 from public.profiles where id = v_pat and discreet_mode and low_data_mode) then
    raise exception 'FAIL 1b: a patient could not set her own discreet_mode / low_data_mode';
  end if;

  -- 1c. an org-staff clinician cannot flag even her own row: staff are exempt from guard_profiles_self_update, so
  --     guard_is_test_flag is the ONLY thing stopping this and it must raise (a hidden row would not prove it)
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false; v_sqlstate := null;
  begin
    update public.profiles set is_test = true where id = v_clin;
  exception when others then v_failed := true; get stacked diagnostics v_sqlstate = returned_sqlstate; end;
  execute 'reset role';
  if not v_failed or v_sqlstate <> '42501' then
    raise exception 'FAIL 1c: a clinician could flag a profile as test (failed=%, sqlstate=%)', v_failed, v_sqlstate;
  end if;

  -- 1d. an admin can; then a service context (auth.uid() null) can unflag
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.profiles set is_test = true where id = v_pat2;
  execute 'reset role';
  if not exists (select 1 from public.profiles where id = v_pat2 and is_test) then
    raise exception 'FAIL 1d: an admin could not flag a test account';
  end if;
  perform set_config('request.jwt.claims', null, true);
  update public.profiles set is_test = false where id = v_pat2;
  if exists (select 1 from public.profiles where id = v_pat2 and is_test) then
    raise exception 'FAIL 1d: a service context could not unflag';
  end if;

  -- 1e. the backfill left no unflagged @tarragon.test account
  select count(*) into v_n from public.profiles p join auth.users u on u.id = p.id
   where u.email ilike '%@tarragon.test' and not p.is_test;
  if v_n <> 0 then raise exception 'FAIL 1e: % @tarragon.test profiles are not flagged is_test', v_n; end if;

  -- 1f. lint ratchet: no metric/payout view (public) or analytics view may ignore is_test. The three existing
  --     *_quality_metrics views predate S02 and are listed as follow-ups in docs/design/S02.md.
  select count(*) into v_n from pg_views
   where ((schemaname = 'public' and (viewname ~* 'payout' or viewname ~* 'metric') and viewname not in
             ('hypertension_quality_metrics', 'obesity_quality_metrics', 'diabetes_quality_metrics'))
          or schemaname = 'analytics')
     and definition !~* 'is_test';
  if v_n <> 0 then raise exception 'FAIL 1f: % metric/payout view(s) do not filter is_test', v_n; end if;

  -- =========================================================================
  -- 2. proxy_setups
  -- =========================================================================
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.proxy_setups (organisation_id, created_by_profile_id, target_full_name, target_phone_e164, expires_at)
  values (v_org, v_pat, 'Mama Test', '+2348099990001', now() + interval '3 days') returning id into v_id;
  select count(*) into v_n from public.proxy_setups;
  if v_n <> 1 then raise exception 'FAIL 2a: creator sees % of her setups, expected 1', v_n; end if;

  -- refused: a setup born already confirmed, one attributed to someone else, a non-E.164 phone
  v_failed := false;
  begin
    insert into public.proxy_setups (organisation_id, created_by_profile_id, target_full_name, target_phone_e164, expires_at, state, confirmed_at)
    values (v_org, v_pat, 'X', '+2348099990002', now() + interval '1 day', 'confirmed', now());
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 2b: a setup could be created already confirmed'; end if;
  v_failed := false;
  begin
    insert into public.proxy_setups (organisation_id, created_by_profile_id, target_full_name, target_phone_e164, expires_at)
    values (v_org, v_pat2, 'X', '+2348099990003', now() + interval '1 day');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 2c: a setup could be created on behalf of another profile'; end if;
  v_failed := false;
  begin
    insert into public.proxy_setups (organisation_id, created_by_profile_id, target_full_name, target_phone_e164, expires_at)
    values (v_org, v_pat, 'X', '08099990004', now() + interval '1 day');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 2d: a non-E.164 target phone was accepted'; end if;

  -- the creator cannot update or delete (no policy): zero rows touched
  update public.proxy_setups set target_full_name = 'Changed' where id = v_id;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'FAIL 2e: the creator could update her own setup'; end if;
  delete from public.proxy_setups where id = v_id;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'FAIL 2e: the creator could delete her own setup'; end if;
  execute 'reset role';

  -- everyone else sees none of it; admin sees it
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.proxy_setups;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL 2f: another patient saw % proxy setups', v_n; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.proxy_setups;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL 2g: a clinician saw % proxy setups', v_n; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_partner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.proxy_setups;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL 2h: a lab partner saw % proxy setups', v_n; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.proxy_setups where id = v_id;
  execute 'reset role';
  if v_n <> 1 then raise exception 'FAIL 2i: an admin could not see a proxy setup'; end if;
  perform set_config('request.jwt.claims', null, true);

  if has_table_privilege('anon', 'public.proxy_setups', 'SELECT') or has_table_privilege('anon', 'public.proxy_setups', 'INSERT') then
    raise exception 'FAIL 2j: anon has access to proxy_setups';
  end if;

  -- state machine (definer/service path: this session is postgres)
  update public.proxy_setups set state = 'confirmed', confirmed_at = now(), confirmed_profile_id = v_pat2 where id = v_id;
  v_failed := false;
  begin update public.proxy_setups set state = 'declined' where id = v_id;
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 2k: a confirmed setup moved to another state'; end if;
  v_failed := false;
  begin update public.proxy_setups set target_phone_e164 = '+2348099990009' where id = v_id;
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 2l: a setup target phone was edited'; end if;

  -- an expired pending setup cannot be confirmed but can be expired
  insert into public.proxy_setups (organisation_id, created_by_profile_id, target_full_name, target_phone_e164, created_at, expires_at)
  values (v_org, v_pat, 'Old', '+2348099990010', now() - interval '2 days', now() - interval '1 day') returning id into v_id;
  v_failed := false;
  begin update public.proxy_setups set state = 'confirmed', confirmed_at = now() where id = v_id;
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 2m: an expired setup was confirmed'; end if;
  update public.proxy_setups set state = 'expired' where id = v_id;   -- the legal move

  -- SABOTAGE 2: with the state machine off, the terminal-state check would have passed vacuously
  alter table public.proxy_setups disable trigger proxy_setups_state_machine;
  update public.proxy_setups set state = 'pending_confirmation' where id = v_id;   -- expired -> pending: must now succeed
  select state into v_state from public.proxy_setups where id = v_id;
  alter table public.proxy_setups enable trigger proxy_setups_state_machine;
  if v_state <> 'pending_confirmation' then
    raise exception 'FAIL SABOTAGE 2: disabling the state machine did not open the transition, so checks 2k/2m prove nothing';
  end if;

  -- SABOTAGE 1: with the is_test guard gone, a patient could flag herself, so check 1a would have failed
  drop trigger profiles_guard_is_test on public.profiles;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.profiles set is_test = true where id = v_pat;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  if not exists (select 1 from public.profiles where id = v_pat and is_test) then
    raise exception 'FAIL SABOTAGE 1: without the guard the self-flag still failed, so check 1a proves nothing';
  end if;
  update public.profiles set is_test = false where id = v_pat;
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.profiles set is_test = true where id = v_clin;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  if not exists (select 1 from public.profiles where id = v_clin and is_test) then
    raise exception 'FAIL SABOTAGE 1: without the guard the clinician self-flag still failed, so check 1c proves nothing';
  end if;
  update public.profiles set is_test = false where id = v_clin;
  create trigger profiles_guard_is_test before insert or update of is_test on public.profiles
    for each row execute function private.guard_is_test_flag();

  -- =========================================================================
  -- 3. audit_log immutability
  -- =========================================================================
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, reason, result)
  values (v_org, v_admin, 's02.proof_row', 'profile', 'immutability probe row for S02 proof', 'success') returning id into v_id;

  -- The grants are revoked, so first hand them back to isolate the row triggers: the trigger, not the missing
  -- privilege, must be what refuses (the message names the append-only rule).
  grant update, delete on public.audit_log to postgres;
  v_failed := false; v_err := null;
  begin update public.audit_log set action = 'tampered' where id = v_id; exception when others then v_failed := true; v_err := sqlerrm; end;
  if not v_failed or v_err !~ 'append-only' then raise exception 'FAIL 3a: audit_log UPDATE was not stopped by the trigger (%)', v_err; end if;
  v_failed := false; v_err := null;
  begin delete from public.audit_log where id = v_id; exception when others then v_failed := true; v_err := sqlerrm; end;
  if not v_failed or v_err !~ 'append-only' then raise exception 'FAIL 3b: audit_log DELETE was not stopped by the trigger (%)', v_err; end if;
  revoke update, delete on public.audit_log from postgres;
  -- and with the privilege revoked (the state the migration leaves) it is refused at the privilege check too. The
  -- local CI stack runs as a superuser, which ignores grants, so this half only applies where postgres is not one
  -- (the hosted project); the trigger checks above hold in both.
  if not (select rolsuper from pg_roles where rolname = current_user) then
    v_failed := false;
    begin update public.audit_log set action = 'tampered' where id = v_id; exception when insufficient_privilege then v_failed := true; end;
    if not v_failed then raise exception 'FAIL 3a2: audit_log UPDATE succeeded without the grant'; end if;
  end if;

  if has_table_privilege('service_role', 'public.audit_log', 'UPDATE') or has_table_privilege('service_role', 'public.audit_log', 'DELETE')
     or has_table_privilege('service_role', 'public.audit_log', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.audit_log', 'UPDATE') or has_table_privilege('authenticated', 'public.audit_log', 'DELETE')
     or has_table_privilege('authenticated', 'public.audit_log', 'TRUNCATE') or has_table_privilege('anon', 'public.audit_log', 'SELECT')
     or (not (select rolsuper from pg_roles where rolname = 'postgres')
         and has_table_privilege('postgres', 'public.audit_log', 'TRUNCATE')) then
    raise exception 'FAIL 3c: an application role holds UPDATE/DELETE/TRUNCATE on audit_log (or anon can read it)';
  end if;

  -- the TRUNCATE trigger really rejects: proved on a scratch copy wired to the same function, never on the live trail
  create temporary table _audit_scratch (id int);
  create trigger scratch_no_truncate before truncate on _audit_scratch for each statement execute function private.reject_mutation();
  v_failed := false;
  begin truncate _audit_scratch; exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 3d: reject_mutation did not stop a TRUNCATE'; end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.audit_log'::regclass and tgname = 'audit_log_no_truncate'
                   and (tgtype & 32) = 32) then
    raise exception 'FAIL 3d: audit_log has no BEFORE TRUNCATE trigger';
  end if;

  -- SABOTAGE 3: regrant TRUNCATE and the privilege check in 3c would trip
  grant truncate on public.audit_log to service_role;
  if not has_table_privilege('service_role', 'public.audit_log', 'TRUNCATE') then
    raise exception 'FAIL SABOTAGE 3: the regrant did not register, so check 3c proves nothing';
  end if;
  revoke truncate on public.audit_log from service_role;

  -- =========================================================================
  -- 4. audited reads
  -- =========================================================================
  -- fixture: the admin needs support.view_as; has_permission() is true for an active admin.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into v_n from public.search_patients_audited('S02 Patient One', 'support ticket 4411 identity check');
  if v_n <> 1 then execute 'reset role'; raise exception 'FAIL 4a: admin search returned % rows, expected 1', v_n; end if;

  v_failed := false;
  begin perform 1 from public.search_patients_audited('S02', 'short'); exception when sqlstate '22023' then v_failed := true; end;
  if not v_failed then execute 'reset role'; raise exception 'FAIL 4b: a search without a real reason was allowed'; end if;

  -- an admin with NO support-view session for this patient is refused (the patient must be told a session started)
  select count(*) into v_n from public.open_patient_identity_audited(v_pat, 'investigating a duplicate account report');
  if v_n <> 0 then execute 'reset role'; raise exception 'FAIL 4c0: an admin opened an identity with no support-view session (% rows)', v_n; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  if not exists (select 1 from public.audit_log where actor_id = v_admin and action = 'admin.patient_identity_open'
                   and result = 'denied' and subject_patient_id = v_pat) then
    raise exception 'FAIL 4c0: the sessionless open was not audited as denied with its subject';
  end if;

  -- the session is started the way the product starts one: by the admin herself (its trigger checks her permission)
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.support_view_sessions (viewer_id, subject_id, subject_full_name, subject_role, organisation_id, reason, expires_at)
  values (v_admin, v_pat, 'S02 Patient One', 'patient', v_org, 'S02 proof: support case 4411', now() + interval '30 minutes');
  select count(*) into v_n from public.open_patient_identity_audited(v_pat, 'investigating a duplicate account report');
  if v_n <> 1 then execute 'reset role'; raise exception 'FAIL 4c: admin with a support-view session got % rows, expected 1', v_n; end if;

  select count(*) into v_n from public.read_patient_consents_audited(v_pat, 'consent audit for a support case');
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);

  -- the audit rows exist, carry the subject and reason, and never contain the search text
  if not exists (select 1 from public.audit_log where actor_id = v_admin and action = 'admin.patient_search' and result = 'success'
                   and reason = 'support ticket 4411 identity check' and (event ->> 'result_count')::int = 1
                   and event ? 'query_length' and not (event ? 'query_sha256') and event::text not ilike '%S02 Patient One%') then
    raise exception 'FAIL 4d: the search audit row is missing, wrong, or stored the query text';
  end if;
  if not exists (select 1 from public.audit_log where actor_id = v_admin and action = 'admin.patient_identity_open'
                   and subject_patient_id = v_pat and reason = 'investigating a duplicate account report' and result = 'success') then
    raise exception 'FAIL 4e: the record-open audit row is missing or lacks subject_patient_id';
  end if;
  if not exists (select 1 from public.audit_log where actor_id = v_admin and action = 'staff.patient_consents_read' and subject_patient_id = v_pat) then
    raise exception 'FAIL 4f: the consents-read audit row is missing';
  end if;

  -- refused roles: a patient gets an explicit error and writes no audit row (no flooding); staff without a gate get
  -- nothing back, and the refusal is audited WITH the subject
  declare
    v_who uuid;
    v_names text[] := array['patient','unrelated patient','clinician','lab partner'];
    v_ids uuid[] := array[v_pat, v_pat2, v_clin, v_partner];
    i integer;
    v_is_patient boolean;
  begin
    for i in 1 .. 4 loop
      v_who := v_ids[i];
      v_is_patient := i <= 2;
      perform set_config('request.jwt.claims', json_build_object('sub', v_who, 'role', 'authenticated')::text, true);
      execute 'set local role authenticated';
      v_failed := false; v_sqlstate := null; v_n := 0;
      begin
        select count(*) into v_n from public.search_patients_audited('S02 Patient', 'trying to browse patients here');
        if v_n <> 0 then raise exception 'FAIL 4g: % could search patients (% rows)', v_names[i], v_n; end if;
        select count(*) into v_n from public.open_patient_identity_audited(v_pat, 'trying to open a record here');
        if v_n <> 0 then raise exception 'FAIL 4h: % could open a patient identity (% rows)', v_names[i], v_n; end if;
        select count(*) into v_n from public.read_patient_consents_audited(v_pat, 'trying to read consents here');
        if v_n <> 0 then raise exception 'FAIL 4i: % could read consents through the staff function (% rows)', v_names[i], v_n; end if;
      exception when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate;
        if sqlerrm like 'FAIL%' then execute 'reset role'; raise; end if;
        v_failed := true;
      end;
      execute 'reset role';
      perform set_config('request.jwt.claims', null, true);
      if v_is_patient then
        if not v_failed or v_sqlstate <> '42501' then
          raise exception 'FAIL 4j: % was not refused with 42501 (failed=%, sqlstate=%)', v_names[i], v_failed, v_sqlstate;
        end if;
        if exists (select 1 from public.audit_log where actor_id = v_who and result = 'denied') then
          raise exception 'FAIL 4j: a refused % wrote audit rows (flooding vector)', v_names[i];
        end if;
      else
        if v_failed then raise exception 'FAIL 4j: staff refusal for % raised % instead of returning empty', v_names[i], v_sqlstate; end if;
        if not exists (select 1 from public.audit_log where actor_id = v_who and action = 'admin.patient_identity_open'
                         and result = 'denied' and subject_patient_id = v_pat)
           or not exists (select 1 from public.audit_log where actor_id = v_who and action = 'admin.patient_search' and result = 'denied') then
          raise exception 'FAIL 4j: the refused staff calls by % were not audited with their subject', v_names[i];
        end if;
      end if;
    end loop;
  end;

  -- break-glass: a clinician with an active grant is admitted (the gate opens), and reproductive_health stays excluded
  insert into public.emergency_record_access_grants (requester_id, requester_org_id, patient_id, patient_org_id, reason, expires_at)
  values (v_clin, v_org, v_pat, v_org, 'S02 proof: patient collapsed, chart needed', now() + interval '1 hour');
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.open_patient_identity_audited(v_pat, 'emergency chart access for a collapsed patient');
  if v_n <> 1 then execute 'reset role'; raise exception 'FAIL 4k: a clinician with an active break-glass grant was refused'; end if;
  if not private.has_emergency_access(v_pat, 'vitals_readings') then
    execute 'reset role'; raise exception 'FAIL 4l: break-glass does not cover an ordinary category';
  end if;
  if private.has_emergency_access(v_pat, 'reproductive_health') then
    execute 'reset role'; raise exception 'FAIL 4m: break-glass covers reproductive_health';
  end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  -- the identity RPC exposes no reproductive/clinical column at all
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname in ('search_patients_audited', 'open_patient_identity_audited', 'read_patient_consents_audited')
                and pg_get_function_result(p.oid) ~* '(menstru|pregnan|fertil|contracept|reproductive|diagnos|medication)') then
    raise exception 'FAIL 4n: an audited identity RPC returns a clinical or reproductive column';
  end if;

  -- anon and PUBLIC cannot execute
  if has_function_privilege('anon', 'public.search_patients_audited(text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.open_patient_identity_audited(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.read_patient_consents_audited(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'private.audit_patient_read(uuid,text,uuid,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.audit_patient_read(uuid,text,uuid,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.can_staff_read_patient_identity(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'private.request_ip()', 'EXECUTE') then
    raise exception 'FAIL 4o: an audited-read function is executable by anon or by authenticated directly';
  end if;
  if not has_function_privilege('authenticated', 'public.search_patients_audited(text,text)', 'EXECUTE') then
    raise exception 'FAIL 4p: authenticated cannot execute the audited search (the gate never opens)';
  end if;

  -- =========================================================================
  -- 5. patient_consents direct read + the v5-shaped view
  -- =========================================================================
  select id, version into v_ver from public.consent_versions where is_current order by created_at limit 1;
  if v_ver.id is null then raise exception 'fixture FAIL: no current consent version'; end if;
  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, accepted_at, created_at, action)
  select v_org, v_pat, cv.consent_type, cv.id, cv.version, now() - interval '2 hours', now() - interval '2 hours', 'accepted'
    from public.consent_versions cv where cv.id = v_ver.id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.patient_consents where patient_id = v_pat;
  execute 'reset role';
  if v_n < 1 then raise exception 'FAIL 5a: the patient cannot read her own consents (the gate never opens)'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.patient_consents where patient_id = v_pat;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL 5b: a clinician read % patient_consents rows directly', v_n; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.patient_consents where patient_id = v_pat;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL 5c: an admin read % patient_consents rows directly', v_n; end if;
  perform set_config('request.jwt.claims', null, true);

  -- SABOTAGE 5: restore the old staff-read policy: the clinician would now see the rows
  drop policy patient_consents_select on public.patient_consents;
  create policy patient_consents_select on public.patient_consents for select to authenticated
    using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.patient_consents where patient_id = v_pat;
  execute 'reset role';
  perform set_config('request.jwt.claims', null, true);
  if v_n = 0 then raise exception 'FAIL SABOTAGE 5: the old policy did not expose the rows, so check 5b proves nothing'; end if;
  drop policy patient_consents_select on public.patient_consents;
  create policy patient_consents_select on public.patient_consents for select to authenticated
    using (patient_id = (select auth.uid()));

  -- view: accepted, then withdrawn
  select granted into v_failed from public.patient_consent_state where patient_id = v_pat limit 1;
  if v_failed is distinct from true then raise exception 'FAIL 5d: patient_consent_state does not show an accepted consent as granted'; end if;
  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, accepted_at, created_at, action)
  select v_org, v_pat, cv.consent_type, cv.id, cv.version, now() - interval '1 hour', now() - interval '1 hour', 'withdrawn'
    from public.consent_versions cv where cv.id = v_ver.id;
  select granted into v_failed from public.patient_consent_state where patient_id = v_pat and withdrawn_at is not null limit 1;
  if v_failed is distinct from false then raise exception 'FAIL 5e: patient_consent_state does not show a withdrawal'; end if;
  if (select reloptions::text from pg_class where oid = 'public.patient_consent_state'::regclass) !~ 'security_invoker=true' then
    raise exception 'FAIL 5f: patient_consent_state is not security_invoker';
  end if;

  -- SABOTAGE 1f: plant a payout view that ignores is_test; the ratchet must flag it
  create view public.zz_s02_payout_probe as select id from public.profiles;
  select count(*) into v_n from pg_views
   where schemaname = 'public' and viewname ~* 'payout' and definition !~* 'is_test';
  if v_n <> 1 then raise exception 'FAIL SABOTAGE 1f: the lint scan did not flag an unfiltered payout view (%)', v_n; end if;
end $$;

rollback;
