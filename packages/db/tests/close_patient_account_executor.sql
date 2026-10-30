-- ===========================================================================
-- Proof: 20261030123107_close_patient_account_executor.sql (OQ-S04b2-2): public.close_patient_account(request).
--
-- Proves, as simulated signed-in sessions (an admin, a patient, a clinician), on fixtures it mints itself:
--   1. A seeded patient with operational rows, clinical rows, a ledger row, an invoice, an audit row, account-level rows, device
--      connections and Care Circle / sharing grants is closed by an admin from an approved request past its grace period.
--   2. Operational rows are gone (every operational registry table, read from the registry); the two append-only operational tables
--      (points ledger, staff time record) are left alone.
--   3. Clinical, ledger, invoice and audit rows are untouched: every row seeded is still there, and no non-operational registry table
--      has fewer rows than before.
--   4. The profile still exists (deactivated, never deleted); the consent history and the deletion request are still there; every
--      consent in force has a withdrawal row; the login is banned; contact details and the sign-in are removed; the name is kept.
--   5. Device connections are ended (unpaired, tokens nulled), Care Circle members revoked, invites cancelled, profile_access removed in
--      both directions, pending access requests cancelled, share links, emergency card and emergency access grants revoked.
--   6. A second run is a no-op that returns the first summary (one audit marker, nothing else changes).
--   7. A non-admin (the patient, a clinician) is refused; a request that is not approved is refused; an approved request still inside
--      its grace period is refused by the function's own check.
--   8. All or nothing: a failure part-way (a trigger that refuses one table) leaves everything as it was, and a retry afterwards works.
--   9. A request an admin already completed by hand can be run through it to finish the removal without touching the request row.
--  10. Another patient with the same rows is untouched (control), and a shared grant on that other patient's record is kept.
--  11. The already-decided guardian rule: a guardian can record a consent for a DEPENDANT only with an unexpired 'manage' grant.
--  12. SABOTAGE: with the registry filter and the helper guard removed a clinical row is deleted (check 3f flips); with the function's
--      grace check removed the early close is refused by the trigger's message instead of the function's (check 7 flips); with the
--      idempotency marker removed a second run writes a second audit marker (check 6 flips). All restored afterwards.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures; touches no real patient.
-- ===========================================================================

begin;

create temporary table cx_fx(k text primary key, v uuid) on commit drop;
create temporary table cx_def(k text primary key, d text) on commit drop;
create temporary table cx_flips(k text primary key) on commit drop;
create temporary table cx_snap(k text primary key, j jsonb) on commit drop;

-- the number of rows a patient has in every registry table
create function pg_temp.cx_count(p_patient uuid) returns jsonb language plpgsql as
$$
declare r record; n bigint; o jsonb := '{}'::jsonb;
begin
  for r in select table_name, patient_expr from public.data_registry order by table_name loop
    execute format('select count(*) from public.%I t where (%s) = $1', r.table_name, r.patient_expr) into n using p_patient;
    if n > 0 then o := o || jsonb_build_object(r.table_name, n); end if;
  end loop;
  return o;
end $$;

-- everything one patient needs for the proof
create function pg_temp.cx_seed(p_patient uuid, p_org uuid, p_other uuid, p_sup uuid, p_adm uuid, p_tag text, p_full boolean) returns void language plpgsql as
$$
declare cv record;
begin
  -- consents in force (service context: no auth.uid())
  perform set_config('request.jwt.claims', '', true);
  for cv in select * from public.consent_versions where is_current and not is_optional and consent_type in ('data_processing', 'telehealth', 'terms_of_service') loop
    insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action)
      values (p_org, p_patient, cv.consent_type, cv.id, cv.version, 'accepted');
  end loop;

  update public.profiles set phone = '+2348000000001', avatar_url = 'https://example.invalid/a.png', area = 'Yaba',
         emergency_contact_name = 'Proof Contact', emergency_contact_phone = '+2348000000002', emergency_contact_relationship = 'sibling',
         next_of_kin_name = 'Proof Kin', next_of_kin_phone = '+2348000000003', emergency_contact_consent = true, marketing_opt_in = true
   where id = p_patient;

  -- operational (registry class)
  insert into public.patient_notification_preferences (organisation_id, patient_id, category) values (p_org, p_patient, 'medications');
  insert into public.vitals_reminder_rules (organisation_id, patient_id, frequency_days) values (p_org, p_patient, 7);
  insert into public.patient_home_layout (patient_id, organisation_id) values (p_patient, p_org);
  insert into public.nutrition_preferences (patient_id, organisation_id) values (p_patient, p_org);
  insert into public.feature_waitlist (organisation_id, patient_id, feature_key) values (p_org, p_patient, 'community');
  -- operational by class but append-only by design: must be left alone
  insert into public.wellness_points_ledger (organisation_id, patient_id, points, balance_after, reason) values (p_org, p_patient, 5, 5, 'proof');
  -- account-level, keyed on the profile
  insert into public.push_subscriptions (organisation_id, profile_id, endpoint, p256dh_key, auth_key) values (p_org, p_patient, 'https://push.invalid/' || p_tag, 'k', 'a');
  insert into public.user_known_devices (profile_id, organisation_id, device_fingerprint) values (p_patient, p_org, 'fp-' || p_tag);
  insert into public.notification_settings (profile_id, organisation_id) values (p_patient, p_org);

  -- kept: clinical, invoice (financial), audit
  insert into public.patient_allergies (organisation_id, patient_id, allergen) values (p_org, p_patient, 'penicillin');
  insert into public.alcohol_consumption_logs (organisation_id, patient_id, drinks_count) values (p_org, p_patient, 2);
  insert into public.invoices (organisation_id, patient_id, invoice_number, service_type, source_id, service_label, reference, total_minor, subtotal_minor, currency)
    values (p_org, p_patient, 'CX-' || p_tag, 'consultation', gen_random_uuid(), 'Proof', 'cx-ref-' || p_tag, 1000, 1000, 'NGN');
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
    values (p_org, p_adm, 'proof.pre_existing', 'profile', p_patient, '{}'::jsonb, p_patient);

  -- device connections
  insert into public.patient_devices (organisation_id, patient_id, device_type, ble_device_id) values (p_org, p_patient, 'bp_cuff', 'AA:BB:' || p_tag);
  insert into public.wearable_connections (organisation_id, patient_id, provider, status, access_token, refresh_token) values (p_org, p_patient, 'fitbit', 'active', 'tok-' || p_tag, 'ref-' || p_tag);

  if p_full then
    -- the patient's reading-reminder rule, which a KEPT clinical row (a consultation follow-up) points at: it must stay, untouched
    declare v_rule uuid; v_note uuid;
    begin
      select id into v_rule from public.vitals_reminder_rules where patient_id = p_patient;
      set local session_replication_role = replica;
      insert into public.clinical_encounter_notes (organisation_id, patient_id, encounter_type, reason_for_encounter) values (p_org, p_patient, 'other', 'proof') returning id into v_note;
      insert into public.consultation_follow_ups (organisation_id, patient_id, encounter_note_id, action_type, description, linked_vitals_reminder_rule_id)
        values (p_org, p_patient, v_note, 'monitoring_schedule', 'proof', v_rule);
      set local session_replication_role = origin;
    end;
  end if;

  -- sharing
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (p_patient, p_sup, 'manage', p_patient);
  if p_full then
    insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (p_other, p_patient, 'view', p_other);
    insert into public.care_circle_invites (organisation_id, patient_id, invitee_kind, invitee_hash, invitee_hint, relationship, permissions, grant_days, token_hash, expires_at)
      values (p_org, p_patient, 'phone', repeat('a', 64), '...01', 'sister', array['red_alerts'], 30, repeat('b', 64), now() + interval '7 days');
    insert into public.care_access_requests (profile_id, counterparty_user_id, initiated_by, permission_level) values (p_patient, p_sup, p_patient, 'view');
  end if;
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at)
    values (p_org, p_patient, p_sup, 'sister', array['red_alerts'], now() + interval '1 year');
  insert into public.record_shares (organisation_id, patient_id, token, sections, expires_at) values (p_org, p_patient, md5('s' || p_tag) || md5('t' || p_tag), array['vitals'], now() + interval '1 day');
  insert into public.emergency_cards (patient_id, organisation_id, token) values (p_patient, p_org, md5('c' || p_tag) || md5('d' || p_tag));
  insert into public.emergency_access_grants (profile_id, grantee_user_id, reason) values (p_patient, p_sup, 'proof');
end $$;

-- a request for a patient, made by that patient through the API, then moved to 'approved_full' as a fixture
-- (the grace period is immutable and an approval before it ends is refused by design, so the fixture bypasses the trigger)
create function pg_temp.cx_request(p_patient uuid, p_org uuid, p_adm uuid, p_status text, p_grace_over boolean) returns uuid language plpgsql as
$$
declare v_req uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.data_deletion_requests (organisation_id, patient_id, reason) values (p_org, p_patient, 'proof') returning id into v_req;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  set local session_replication_role = replica;
  update public.data_deletion_requests
     set status = p_status, reviewed_by = p_adm, reviewed_at = now(),
         grace_ends_at = case when p_grace_over then now() - interval '1 second' else now() + interval '5 days' end,
         completed_by = case when p_status = 'completed' then p_adm end, completed_at = case when p_status = 'completed' then now() end,
         decision_note = case when p_status = 'completed' then 'Closed by hand.' end
   where id = v_req;
  set local session_replication_role = origin;
  return v_req;
end $$;

-- run the executor as a given session; returns the jsonb or 'ERR:<sqlstate>:<message>'
create function pg_temp.cx_close(p_actor uuid, p_request uuid) returns text language plpgsql as
$$
declare v jsonb; v_out text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_actor::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    v := public.close_patient_account(p_request);
    v_out := v::text;
  exception when others then
    v_out := 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end $$;

-- fixtures ---------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid;
  pat uuid := gen_random_uuid(); pat2 uuid := gen_random_uuid(); pat3 uuid := gen_random_uuid(); pat4 uuid := gen_random_uuid();
  pat5 uuid := gen_random_uuid(); pat6 uuid := gen_random_uuid(); pat7 uuid := gen_random_uuid();
  sup uuid := gen_random_uuid(); adm uuid := gen_random_uuid(); cla uuid := gen_random_uuid();
  dep uuid := gen_random_uuid(); gv uuid := gen_random_uuid(); gm uuid := gen_random_uuid();
  ids uuid[]; i int; nm text[] := array['Pat', 'Pat2', 'Pat3', 'Pat4', 'Pat5', 'Pat6', 'Pat7', 'Sup', 'Adm', 'Cla', 'Dep', 'GuaView', 'GuaManage'];
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;
  ids := array[pat, pat2, pat3, pat4, pat5, pat6, pat7, sup, adm, cla, dep, gv, gm];
  for i in 1 .. array_length(ids, 1) loop
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data, phone)
      values (ids[i], 'cx-' || lower(nm[i]) || '@example.invalid', 'x', now(), now(), '{}', '{}', null);
    insert into public.profiles (id, organisation_id, role, full_name)
      values (ids[i], v_org, case when nm[i] = 'Adm' then 'admin'::public.user_role when nm[i] = 'Cla' then 'clinician'::public.user_role else 'patient'::public.user_role end, 'CX ' || nm[i])
      on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  end loop;
  update public.profiles set is_dependent_account = true where id = dep;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (dep, gv, 'view', gv), (dep, gm, 'manage', gm);
  insert into cx_fx values ('org', v_org), ('pat', pat), ('pat2', pat2), ('pat3', pat3), ('pat4', pat4), ('pat5', pat5), ('pat6', pat6), ('pat7', pat7),
    ('sup', sup), ('adm', adm), ('cla', cla), ('dep', dep), ('gv', gv), ('gm', gm);
end $$;

-- seed (as the table owner, so row-level security does not hide anything from the counts)
do $$
declare f record;
begin
  for f in select k, v from cx_fx where k in ('pat', 'pat2', 'pat3', 'pat4', 'pat5', 'pat6', 'pat7') loop
    perform pg_temp.cx_seed(f.v, (select v from cx_fx where k = 'org'), (select v from cx_fx where k = 'pat2'), (select v from cx_fx where k = 'sup'), (select v from cx_fx where k = 'adm'), f.k,
                            f.k = 'pat');
  end loop;
  -- the control patient's record carries a grant that belongs to someone else and must survive
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values ((select v from cx_fx where k = 'pat2'), (select v from cx_fx where k = 'cla'), 'view', (select v from cx_fx where k = 'pat2'));
  insert into cx_snap values ('pat_before', pg_temp.cx_count((select v from cx_fx where k = 'pat'))),
                             ('pat2_before', pg_temp.cx_count((select v from cx_fx where k = 'pat2')));
  insert into cx_fx values ('req', pg_temp.cx_request((select v from cx_fx where k = 'pat'), (select v from cx_fx where k = 'org'), (select v from cx_fx where k = 'adm'), 'approved_full', false));
end $$;

-- sanity on the fixture: the seed actually put rows in the places the proof checks
do $$
declare b jsonb := (select j from cx_snap where k = 'pat_before'); k text;
begin
  foreach k in array array['patient_notification_preferences', 'vitals_reminder_rules', 'patient_home_layout', 'nutrition_preferences', 'feature_waitlist', 'wellness_points_ledger',
                           'patient_allergies', 'alcohol_consumption_logs', 'invoices', 'patient_devices', 'wearable_connections', 'care_circle_members', 'care_circle_invites', 'record_shares', 'emergency_cards', 'patient_consents'] loop
    if coalesce((b ->> k)::int, 0) < 1 then raise exception 'fixture FAIL: seed left no % row', k; end if;
  end loop;
end $$;

-- 7. refusals ----------------------------------------------------------------------------------------------------------------
do $$
declare
  req uuid := (select v from cx_fx where k = 'req');
  pat uuid := (select v from cx_fx where k = 'pat'); cla uuid := (select v from cx_fx where k = 'cla'); adm uuid := (select v from cx_fx where k = 'adm');
  v_org uuid := (select v from cx_fx where k = 'org');
  r text; pending uuid;
begin
  -- approved but still inside the grace period: the function's own check refuses, and nothing changes
  r := pg_temp.cx_close(adm, req);
  if r not like 'ERR:23514:%cannot be closed yet%' then raise exception 'FAIL 7a: early close not refused by the function (%)', r; end if;
  if not exists (select 1 from public.profiles where id = pat and is_active) or (select status from public.data_deletion_requests where id = req) <> 'approved_full' then
    raise exception 'FAIL 7b: a refused early close changed something';
  end if;

  -- grace over, but not an admin
  set local session_replication_role = replica;
  update public.data_deletion_requests set grace_ends_at = now() - interval '1 second' where id = req;
  set local session_replication_role = origin;
  r := pg_temp.cx_close(pat, req);
  if r not like 'ERR:42501:%' then raise exception 'FAIL 7c: the patient could close their own account (%)', r; end if;
  r := pg_temp.cx_close(cla, req);
  if r not like 'ERR:42501:%' then raise exception 'FAIL 7d: a clinician could close an account (%)', r; end if;
  if has_function_privilege('anon', 'public.close_patient_account(uuid)', 'EXECUTE') then raise exception 'FAIL 7e: anon can execute'; end if;

  -- a request that is not approved (a pending one for another patient)
  pending := pg_temp.cx_request((select v from cx_fx where k = 'pat7'), v_org, adm, 'pending', true);
  r := pg_temp.cx_close(adm, pending);
  if r not like 'ERR:23514:%must be approved%' then raise exception 'FAIL 7f: a pending request was closed (%)', r; end if;
  if (select status from public.data_deletion_requests where id = pending) <> 'pending' then raise exception 'FAIL 7g: a refused request changed'; end if;
  r := pg_temp.cx_close(adm, gen_random_uuid());
  if r not like 'ERR:P0002:%' then raise exception 'FAIL 7h: an unknown request was not refused (%)', r; end if;
end $$;

-- 1-5. the close ------------------------------------------------------------------------------------------------------------
do $$
declare
  req uuid := (select v from cx_fx where k = 'req');
  pat uuid := (select v from cx_fx where k = 'pat'); adm uuid := (select v from cx_fx where k = 'adm'); sup uuid := (select v from cx_fx where k = 'sup');
  pat2 uuid := (select v from cx_fx where k = 'pat2');
  before_j jsonb := (select j from cx_snap where k = 'pat_before');
  after_j jsonb; r text; res jsonb; t record; n int;
  allergy uuid; invoice uuid; ledger uuid; audit_id uuid;
begin
  select id into allergy from public.patient_allergies where patient_id = pat;
  select id into invoice from public.invoices where patient_id = pat;
  select id into ledger from public.wellness_points_ledger where patient_id = pat;
  select id into audit_id from public.audit_log where subject_patient_id = pat and action = 'proof.pre_existing';
  insert into cx_snap values ('consent_ids_before', (select jsonb_agg(id) from public.patient_consents where patient_id = pat));

  r := pg_temp.cx_close(adm, req);
  if r like 'ERR:%' then raise exception 'FAIL 1a: the close failed (%)', r; end if;
  res := r::jsonb;
  if (res ->> 'closed') <> 'true' or (res ->> 'already_closed') <> 'false' then raise exception 'FAIL 1b: unexpected summary (%)', r; end if;
  after_j := pg_temp.cx_count(pat);

  -- 2. operational rows gone (read from the registry), the append-only ones left alone
  for t in select table_name from public.data_registry where retention_class = 'operational' loop
    if t.table_name in ('wellness_points_ledger', 'clinician_time_entries') then
      if coalesce((after_j ->> t.table_name)::int, 0) <> coalesce((before_j ->> t.table_name)::int, 0) then raise exception 'FAIL 2a: % (append-only) was changed', t.table_name; end if;
    elsif coalesce((after_j ->> t.table_name)::int, 0) <> (select count(*) from (values (t.table_name)) v(n) where v.n = 'vitals_reminder_rules') then
      raise exception 'FAIL 2b: operational table % still has rows for the patient (or lost the one a kept row points at)', t.table_name;
    end if;
  end loop;
  if not exists (select 1 from public.consultation_follow_ups f join public.vitals_reminder_rules v on v.id = f.linked_vitals_reminder_rule_id where f.patient_id = pat) then
    raise exception 'FAIL 2e: a reminder rule that a kept clinical follow-up points at was deleted or the link was cleared';
  end if;
  if (res -> 'removed' ->> 'patient_home_layout') is distinct from '1' or (res -> 'removed' ->> 'feature_waitlist') is distinct from '1' then raise exception 'FAIL 2c: the summary does not list what was removed (%)', res -> 'removed'; end if;
  if exists (select 1 from public.push_subscriptions where profile_id = pat) or exists (select 1 from public.user_known_devices where profile_id = pat)
     or exists (select 1 from public.notification_settings where profile_id = pat) then raise exception 'FAIL 2d: account-level rows remain'; end if;

  -- 3. nothing kept is gone: every seeded row, and no non-operational registry table with fewer rows
  if not exists (select 1 from public.patient_allergies where id = allergy) then raise exception 'FAIL 3a: a clinical row was deleted'; end if;
  if not exists (select 1 from public.alcohol_consumption_logs where patient_id = pat) then raise exception 'FAIL 3f: a clinical (alcohol log) row was deleted'; end if;
  if not exists (select 1 from public.invoices where id = invoice) then raise exception 'FAIL 3b: an invoice (financial) was deleted'; end if;
  if not exists (select 1 from public.wellness_points_ledger where id = ledger) then raise exception 'FAIL 3c: a ledger row was deleted'; end if;
  if not exists (select 1 from public.audit_log where id = audit_id) then raise exception 'FAIL 3d: an audit row was deleted'; end if;
  for t in select table_name from public.data_registry where retention_class <> 'operational' loop
    if coalesce((after_j ->> t.table_name)::int, 0) < coalesce((before_j ->> t.table_name)::int, 0) then raise exception 'FAIL 3e: % lost rows (kept class)', t.table_name; end if;
  end loop;

  -- 4. profile deactivated not deleted, history and record kept, login banned, contact removed, name kept
  if not exists (select 1 from public.profiles where id = pat and not is_active and full_name = 'CX Pat' and phone is null and avatar_url is null and area is null
                   and emergency_contact_name is null and emergency_contact_phone is null and emergency_contact_relationship is null
                   and next_of_kin_name is null and next_of_kin_phone is null and not emergency_contact_consent and not marketing_opt_in) then
    raise exception 'FAIL 4a: the profile is not deactivated with contact details removed and the name kept';
  end if;
  if not exists (select 1 from public.data_deletion_requests where id = req and status = 'completed' and patient_id = pat and anonymisation_summary is not null and decision_note like '%Removed:%') then
    raise exception 'FAIL 4b: the deletion record is missing or not completed with a note';
  end if;
  if (select count(*) from public.patient_consents where patient_id = pat and id in (select jsonb_array_elements_text(j)::uuid from cx_snap where k = 'consent_ids_before')) <> (select jsonb_array_length(j) from cx_snap where k = 'consent_ids_before') then
    raise exception 'FAIL 4c: consent history rows were deleted';
  end if;
  if exists (select 1 from (select distinct on (consent_type) consent_type, action from public.patient_consents where patient_id = pat order by consent_type, created_at desc, id desc) l where l.action = 'accepted') then
    raise exception 'FAIL 4d: a consent is still in force';
  end if;
  if not exists (select 1 from auth.users where id = pat and banned_until > now() + interval '99 years' and phone is null and email = 'closed-' || pat::text || '@closed.invalid' and encrypted_password = '')
     or exists (select 1 from auth.identities where user_id = pat) or exists (select 1 from auth.sessions where user_id = pat) then
    raise exception 'FAIL 4e: the login is not banned and emptied';
  end if;

  -- 5. devices and sharing
  if exists (select 1 from public.patient_devices where patient_id = pat and status = 'active') or not exists (select 1 from public.patient_devices where patient_id = pat and status = 'unpaired' and unpaired_reason = 'Account closed') then raise exception 'FAIL 5a: devices are not unpaired'; end if;
  if exists (select 1 from public.wearable_connections where patient_id = pat and (status <> 'disconnected' or access_token is not null or refresh_token is not null)) then raise exception 'FAIL 5b: a wearable connection is still live'; end if;
  if exists (select 1 from public.care_circle_members where state = 'active' and (patient_id = pat or supporter_id = pat)) or not exists (select 1 from public.care_circle_members where patient_id = pat and state = 'revoked') then raise exception 'FAIL 5c: Care Circle members are not revoked'; end if;
  if exists (select 1 from public.care_circle_invites where patient_id = pat and state = 'pending') then raise exception 'FAIL 5d: a Care Circle invite is still pending'; end if;
  if exists (select 1 from public.profile_access where profile_id = pat or grantee_user_id = pat) then raise exception 'FAIL 5e: a profile_access grant is left (either direction)'; end if;
  if exists (select 1 from public.care_access_requests where status = 'pending' and (profile_id = pat or counterparty_user_id = pat)) then raise exception 'FAIL 5f: an access request is still pending'; end if;
  if exists (select 1 from public.record_shares where patient_id = pat and (is_active or revoked_at is null)) or exists (select 1 from public.emergency_cards where patient_id = pat and is_active)
     or exists (select 1 from public.emergency_access_grants where profile_id = pat and revoked_at is null) then raise exception 'FAIL 5g: a share link, the emergency card or an emergency grant is still open'; end if;
  -- no notice goes to the people who lost access
  if exists (select 1 from public.notifications where recipient_id = sup and template = 'care_access_revoked' and created_at > now() - interval '1 minute') then raise exception 'FAIL 5h: a revocation notice was sent'; end if;

  -- 10. control: the other patient and the grant on their record are untouched
  if (pg_temp.cx_count(pat2) - 'care_access_events') <> ((select j from cx_snap where k = 'pat2_before') - 'care_access_events') then raise exception 'FAIL 10a: the control patient changed'; end if;
  if not exists (select 1 from public.profiles where id = pat2 and is_active and phone = '+2348000000001') or not exists (select 1 from auth.users where id = pat2 and (banned_until is null or banned_until < now())) then raise exception 'FAIL 10b: the control profile or login changed'; end if;
  if not exists (select 1 from public.profile_access where profile_id = pat2 and grantee_user_id = (select v from cx_fx where k = 'cla')) then raise exception 'FAIL 10c: someone else''s grant on the control record was removed'; end if;
  if not exists (select 1 from public.wearable_connections where patient_id = pat2 and access_token is not null and status = 'active') then raise exception 'FAIL 10d: the control device connection changed'; end if;
  select count(*) into n from public.audit_log where entity_id = req and action = 'data_deletion.account_closed' and subject_patient_id = pat;
  if n <> 1 then raise exception 'FAIL 1c: expected one audit marker, found %', n; end if;
end $$;

-- 6. second run is a no-op ---------------------------------------------------------------------------------------------------
do $$
declare
  req uuid := (select v from cx_fx where k = 'req');
  pat uuid := (select v from cx_fx where k = 'pat'); adm uuid := (select v from cx_fx where k = 'adm');
  r text; res jsonb; a bigint; c1 jsonb; c2 jsonb; ev bigint;
begin
  c1 := pg_temp.cx_count(pat);
  select count(*) into a from public.audit_log where subject_patient_id = pat;
  r := pg_temp.cx_close(adm, req);
  if r like 'ERR:%' then raise exception 'FAIL 6a: the second run failed (%)', r; end if;
  res := r::jsonb;
  if (res ->> 'already_closed') <> 'true' or (res ->> 'closed') <> 'true' then raise exception 'FAIL 6b: the second run did not say already closed (%)', r; end if;
  c2 := pg_temp.cx_count(pat);
  if c1 <> c2 then raise exception 'FAIL 6c: the second run changed rows'; end if;
  if (select count(*) from public.audit_log where subject_patient_id = pat) <> a then raise exception 'FAIL 6d: the second run wrote audit rows'; end if;
  if (select count(*) from public.audit_log where entity_id = req and action = 'data_deletion.account_closed') <> 1 then raise exception 'FAIL 6e: more than one close marker'; end if;
end $$;

-- 9. a request an admin completed by hand ---------------------------------------------------------------------------------------
do $$
declare
  pat3 uuid := (select v from cx_fx where k = 'pat3'); adm uuid := (select v from cx_fx where k = 'adm'); v_org uuid := (select v from cx_fx where k = 'org');
  req uuid; r text;
begin
  req := pg_temp.cx_request(pat3, v_org, adm, 'completed', true);
  insert into cx_fx values ('req3', req);
  -- completed on paper, but the profile is still active and the login was never banned: the function makes both true
  r := pg_temp.cx_close(adm, req);
  if r like 'ERR:%' then raise exception 'FAIL 9a: a hand-completed request could not be finished (%)', r; end if;
  if exists (select 1 from public.vitals_reminder_rules where patient_id = pat3) or exists (select 1 from public.push_subscriptions where profile_id = pat3)
     or exists (select 1 from public.profile_access where profile_id = pat3) then raise exception 'FAIL 9b: the removal did not run for a hand-completed request'; end if;
  if not exists (select 1 from public.data_deletion_requests where id = req and status = 'completed' and decision_note = 'Closed by hand.' and anonymisation_summary is null) then raise exception 'FAIL 9c: the hand-completed request row was changed'; end if;
  if not exists (select 1 from public.patient_allergies where patient_id = pat3) then raise exception 'FAIL 9d: a clinical row was deleted'; end if;
  if exists (select 1 from public.profiles where id = pat3 and is_active) or not exists (select 1 from auth.users where id = pat3 and banned_until > now() + interval '99 years') then raise exception 'FAIL 9g: a hand-completed account was left active or with a live login'; end if;
  if (select count(*) from public.audit_log where entity_id = req and action = 'data_deletion.account_closed') <> 1 then raise exception 'FAIL 9e: no close marker'; end if;
  r := pg_temp.cx_close(adm, req);
  if (r::jsonb ->> 'already_closed') <> 'true' then raise exception 'FAIL 9f: the hand-completed request was closed twice'; end if;
end $$;

-- 8. all or nothing -------------------------------------------------------------------------------------------------------------
create function pg_temp.cx_block() returns trigger language plpgsql as $$ begin if old.patient_id = (select v from pg_temp.cx_fx where k = 'pat4') then raise exception 'proof: refused' using errcode = '55000'; end if; return old; end $$;
do $$
declare
  pat4 uuid := (select v from cx_fx where k = 'pat4'); adm uuid := (select v from cx_fx where k = 'adm'); v_org uuid := (select v from cx_fx where k = 'org');
  req uuid; r text;
begin
  req := pg_temp.cx_request(pat4, v_org, adm, 'approved_full', true);
  insert into cx_fx values ('req4', req);
  -- patient_home_layout sorts after feature_waitlist, so by then feature_waitlist has already been deleted inside the call
  create trigger cx_block before delete on public.patient_home_layout for each row execute function pg_temp.cx_block();
  r := pg_temp.cx_close(adm, req);
  if r not like 'ERR:55000:%' then raise exception 'FAIL 8a: the forced failure did not surface (%)', r; end if;
  if not exists (select 1 from public.feature_waitlist where patient_id = pat4) or not exists (select 1 from public.patient_home_layout where patient_id = pat4)
     or not exists (select 1 from public.push_subscriptions where profile_id = pat4) or not exists (select 1 from public.profile_access where profile_id = pat4)
     or not exists (select 1 from public.wearable_connections where patient_id = pat4 and status = 'active' and access_token is not null)
     or not exists (select 1 from public.care_circle_members where patient_id = pat4 and state = 'active')
     or not exists (select 1 from auth.users where id = pat4 and email = 'cx-pat4@example.invalid') then
    raise exception 'FAIL 8b: a failed close left a half-closed account';
  end if;
  if not exists (select 1 from public.profiles where id = pat4 and is_active and phone is not null) or (select status from public.data_deletion_requests where id = req) <> 'approved_full'
     or exists (select 1 from public.audit_log where entity_id = req and action = 'data_deletion.account_closed') then raise exception 'FAIL 8c: a failed close changed the profile, the request or the audit log'; end if;
  drop trigger cx_block on public.patient_home_layout;
  r := pg_temp.cx_close(adm, req);
  if r like 'ERR:%' or not exists (select 1 from public.profiles where id = pat4 and not is_active) then raise exception 'FAIL 8d: the retry after a failure did not close the account (%)', r; end if;
end $$;

-- 11. guardian rule (already decided): only an unexpired 'manage' grant records a consent for a dependant ------------------------------
do $$
declare
  dep uuid := (select v from cx_fx where k = 'dep'); gv uuid := (select v from cx_fx where k = 'gv'); gm uuid := (select v from cx_fx where k = 'gm');
  v_org uuid := (select v from cx_fx where k = 'org'); cv record; st text; n int;
begin
  select * into cv from public.consent_versions where is_current and not is_optional and consent_type = 'terms_of_service';
  -- view-level guardian: refused
  perform set_config('request.jwt.claims', json_build_object('sub', gv::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action) values (v_org, dep, cv.consent_type, cv.id, cv.version, 'accepted');
    st := 'allowed';
  exception when others then st := sqlstate; end;
  reset role;
  if st <> '42501' then raise exception 'FAIL 11a: a view-only guardian recorded a consent for a dependant (%)', st; end if;
  -- manage guardian with an expired grant: refused
  update public.profile_access set created_at = now() - interval '2 days', expires_at = now() - interval '1 day' where profile_id = dep and grantee_user_id = gm;
  perform set_config('request.jwt.claims', json_build_object('sub', gm::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action) values (v_org, dep, cv.consent_type, cv.id, cv.version, 'accepted');
    st := 'allowed';
  exception when others then st := sqlstate; end;
  reset role;
  if st <> '42501' then raise exception 'FAIL 11b: an expired manage grant recorded a consent for a dependant (%)', st; end if;
  -- manage guardian with a live grant: allowed, labelled guardian
  update public.profile_access set expires_at = null where profile_id = dep and grantee_user_id = gm;
  perform set_config('request.jwt.claims', json_build_object('sub', gm::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action) values (v_org, dep, cv.consent_type, cv.id, cv.version, 'accepted');
  reset role;
  perform set_config('request.jwt.claims', '', true);
  select count(*) into n from public.patient_consents where patient_id = dep and consented_by = gm and consented_by_relation = 'guardian';
  if n <> 1 then raise exception 'FAIL 11c: a manage guardian could not record a consent for a dependant (%)', n; end if;
end $$;

-- 13. the consent trigger in force is S04b-2's (live had been overwritten by S42's older body; closing an account cannot withdraw a required consent without it)
do $$
begin
  if position('app.closing_account' in pg_get_functiondef('private.enforce_patient_consent_withdrawal()'::regprocedure)) = 0 then
    raise exception 'FAIL 13: the S04b-2 consent trigger is not in force';
  end if;
end $$;

-- 12. SABOTAGE -----------------------------------------------------------------------------------------------------------------------
-- 12a. registry filter and helper guard removed: a clinical row is deleted, so check 3f flips
do $$
declare
  pat5 uuid := (select v from cx_fx where k = 'pat5'); adm uuid := (select v from cx_fx where k = 'adm'); v_org uuid := (select v from cx_fx where k = 'org');
  def_main text; def_help text; req uuid; r text; st text;
begin
  def_main := pg_get_functiondef('public.close_patient_account(uuid)'::regprocedure);
  def_help := pg_get_functiondef('private.close_account_remove_rows(text,text,uuid)'::regprocedure);
  insert into cx_def values ('main', def_main), ('help', def_help);
  if position('where retention_class = ''operational'' and not (table_name = any (v_left_alone))' in def_main) = 0 then raise exception 'SABOTAGE setup: registry filter anchor not found'; end if;
  if position('if v_class is not null and v_class <> ''operational'' then' in def_help) = 0 or position('if private.table_is_retained(p_table) then' in def_help) = 0 then raise exception 'SABOTAGE setup: helper anchors not found'; end if;
  execute replace(def_main, 'where retention_class = ''operational'' and not (table_name = any (v_left_alone))', 'where (retention_class = ''operational'' or table_name = ''alcohol_consumption_logs'') and not (table_name = any (v_left_alone))');
  execute replace(replace(def_help, 'if v_class is not null and v_class <> ''operational'' then', 'if false then'), 'if private.table_is_retained(p_table) then', 'if false then');

  req := pg_temp.cx_request(pat5, v_org, adm, 'approved_full', true);
  r := pg_temp.cx_close(adm, req);
  if r like 'ERR:%' then raise exception 'SABOTAGE setup: the sabotaged close failed (%)', r; end if;
  if not exists (select 1 from public.alcohol_consumption_logs where patient_id = pat5) then insert into cx_flips values ('registry_filter'); end if;

  execute (select d from cx_def where k = 'main');
  execute (select d from cx_def where k = 'help');
  begin
    perform private.close_account_remove_rows('alcohol_consumption_logs', 'patient_id', pat5);
    st := 'allowed';
  exception when others then st := sqlstate; end;
  if st <> '42501' then raise exception 'RESTORE FAIL: the helper guard did not come back (%)', st; end if;
end $$;

-- 12b. the function's own grace check removed: the early close is no longer refused with the function's own message, so check 7a flips
do $$
declare
  pat6 uuid := (select v from cx_fx where k = 'pat6'); adm uuid := (select v from cx_fx where k = 'adm'); v_org uuid := (select v from cx_fx where k = 'org');
  def text; req uuid; r text;
begin
  def := pg_get_functiondef('public.close_patient_account(uuid)'::regprocedure);
  if position('if d.grace_ends_at is not null and now() < d.grace_ends_at then' in def) = 0 then raise exception 'SABOTAGE setup: grace anchor not found'; end if;
  execute replace(def, 'if d.grace_ends_at is not null and now() < d.grace_ends_at then', 'if false then');
  req := pg_temp.cx_request(pat6, v_org, adm, 'approved_full', false);
  r := pg_temp.cx_close(adm, req);
  if r not like 'ERR:23514:%cannot be closed yet%' then insert into cx_flips values ('grace_check'); end if;
  execute (select d from cx_def where k = 'main');
  r := pg_temp.cx_close(adm, req);
  if r not like 'ERR:23514:%cannot be closed yet%' then raise exception 'RESTORE FAIL: the grace check did not come back (%)', r; end if;
end $$;

-- 12c. idempotency marker removed: a second run on a hand-completed request writes a second marker, so check 6e flips
do $$
declare
  pat7 uuid := (select v from cx_fx where k = 'pat7'); adm uuid := (select v from cx_fx where k = 'adm'); v_org uuid := (select v from cx_fx where k = 'org');
  def text; req uuid; r text;
begin
  def := pg_get_functiondef('public.close_patient_account(uuid)'::regprocedure);
  if position('if v_prior is not null then' in def) = 0 then raise exception 'SABOTAGE setup: marker anchor not found'; end if;
  execute replace(def, 'if v_prior is not null then', 'if false then');
  set local session_replication_role = replica;
  update public.data_deletion_requests set status = 'cancelled', cancelled_at = now() where patient_id = pat7 and status = 'pending';
  set local session_replication_role = origin;
  req := pg_temp.cx_request(pat7, v_org, adm, 'completed', true);
  r := pg_temp.cx_close(adm, req);
  r := pg_temp.cx_close(adm, req);
  if (select count(*) from public.audit_log where entity_id = req and action = 'data_deletion.account_closed') <> 1 then insert into cx_flips values ('idempotency'); end if;
  execute (select d from cx_def where k = 'main');
end $$;

do $$
begin
  if (select count(*) from cx_flips) < 3 then
    raise exception 'VACUOUS TEST: only % of 3 sabotages flipped a check (%)', (select count(*) from cx_flips), (select string_agg(k, ',') from cx_flips);
  end if;
end $$;

select 'PASS close_patient_account: operational rows removed from the registry, clinical/ledger/invoice/audit rows untouched, profile kept and deactivated, login banned, sharing revoked, idempotent, all-or-nothing, admin-only, grace enforced, guardian rule proved; 3 of 3 sabotages flipped' as verdict;

rollback;
