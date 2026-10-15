-- ===========================================================================
-- Proof: 20261013181937_s04b2_consent_receipts_withdrawal_rule_deletion_grace.sql (S04b-2; OQ-49, OQ-50, OQ-53).
--
-- Proves, as simulated signed-in sessions (not just as the table owner):
--   1. A consent receipt: channel (label), who (derived: self), the exact text hash and version are stored; a client cannot forge
--      the derived columns; a missing channel is stored as 'unknown', not guessed.
--   2. A consent version that does not match the type cannot be accepted.
--   3. OQ-53: a signed-in patient with an active account cannot withdraw a REQUIRED consent (SQLSTATE 23514, nothing written);
--      an OPTIONAL consent can be given and withdrawn, each one append-only row; a closed account (is_active = false) and a
--      service context (no auth.uid()) are not blocked.
--   4. OQ-49: the drafted care_circle_sharing wording exists, is invisible to a patient and to anon, is visible to an admin,
--      cannot be accepted, cannot be published while the optional_consent_wording module is off, cannot be published by a
--      non-admin, and once the module is on an admin publishes it, after which it is visible and its text is immutable.
--   5. Receipts: a patient reads only their own; a guardian (manage access) can record a consent for a DEPENDANT with relation
--      'guardian'; a stranger cannot read or write a dependant's consents; patient_consents stays append-only for authenticated.
--   6. OQ-50: a deletion request gets a grace period clamped to 7..30 days (14 by default); a second open request is refused;
--      nobody can approve or complete it before the grace ends; only the owner can cancel; cancelling is audited and closes
--      the request; a cancelled request cannot be edited; after the grace ends an admin can approve and complete, and the
--      patient can no longer cancel.
--   7. SABOTAGE: with the required-withdrawal rule removed the OQ-53 check flips (a patient withdraws a required consent); with
--      the grace gate removed an admin approves before the grace ends. Both are restored afterwards.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

create temporary table s4b2_fx(k text primary key, v uuid) on commit drop;
create temporary table s4b2_def(k text primary key, d text) on commit drop;

do $$
declare
  v_org uuid;
  pat uuid := gen_random_uuid();
  pat2 uuid := gen_random_uuid();
  dep uuid := gen_random_uuid();
  gua uuid := gen_random_uuid();
  strg uuid := gen_random_uuid();
  adm uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data)
  values (pat, 's4b2-pat@example.invalid', 'x', now(), now(), '{}', '{}'),
         (pat2, 's4b2-pat2@example.invalid', 'x', now(), now(), '{}', '{}'),
         (dep, 's4b2-dep@example.invalid', 'x', now(), now(), '{}', '{}'),
         (gua, 's4b2-gua@example.invalid', 'x', now(), now(), '{}', '{}'),
         (strg, 's4b2-str@example.invalid', 'x', now(), now(), '{}', '{}'),
         (adm, 's4b2-adm@example.invalid', 'x', now(), now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name) values
    (pat, v_org, 'patient', 'S4B2 Patient'), (pat2, v_org, 'patient', 'S4B2 Patient Two'),
    (dep, v_org, 'patient', 'S4B2 Dependant'), (gua, v_org, 'patient', 'S4B2 Guardian'),
    (strg, v_org, 'patient', 'S4B2 Stranger'), (adm, v_org, 'admin', 'S4B2 Admin')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  update public.profiles set is_dependent_account = true where id = dep;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
    values (dep, gua, 'manage', gua);
  insert into s4b2_fx values ('org', v_org), ('pat', pat), ('pat2', pat2), ('dep', dep), ('gua', gua), ('str', strg), ('adm', adm);
  -- a clean optional purpose of our own (marketing has no live version), plus the live required ones
  update public.consent_versions set is_current = false where consent_type = 'marketing' and is_current;
  insert into public.consent_versions (consent_type, version, title, body, is_current, is_optional)
    values ('marketing', 'proof-opt-v1', 'Proof optional', 'proof optional body', true, true);
end $$;

-- 1 + 2. receipt columns, derived not forged
do $$
declare
  pat uuid := (select v from s4b2_fx where k = 'pat');
  v_org uuid := (select v from s4b2_fx where k = 'org');
  cv record; r record; v_state text;
begin
  select * into cv from public.consent_versions where is_current and not is_optional and consent_type = 'terms_of_service';
  perform set_config('request.jwt.claims', json_build_object('sub', pat::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action, channel, consented_by_relation, text_sha256, consented_by)
    values (v_org, pat, cv.consent_type, cv.id, 'forged-version', 'accepted', 'web', 'guardian', 'forged', gen_random_uuid());
  reset role;
  select * into r from public.patient_consents where patient_id = pat and consent_type = cv.consent_type;
  if r.channel <> 'web' then raise exception 'FAIL 1a: channel not stored (%)', r.channel; end if;
  if r.consented_by is distinct from pat or r.consented_by_relation <> 'self' then raise exception 'FAIL 1b: who was forgeable (% %)', r.consented_by, r.consented_by_relation; end if;
  if r.version <> cv.version then raise exception 'FAIL 1c: version string taken from the client (%)', r.version; end if;
  if r.text_sha256 <> encode(sha256(convert_to(cv.title || E'\n' || cv.body, 'UTF8')), 'hex') then raise exception 'FAIL 1d: text hash wrong or forged'; end if;

  -- the receipt view carries the exact text
  perform set_config('request.jwt.claims', json_build_object('sub', pat::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) filter (where body = cv.body and text_sha256 = r.text_sha256) into v_state from public.patient_consent_receipts where patient_id = pat;
  reset role;
  if v_state::int <> 1 then raise exception 'FAIL 1e: receipt view did not return the exact text once (%)', v_state; end if;

  -- missing channel is stored as unknown
  select * into cv from public.consent_versions where is_current and not is_optional and consent_type = 'telehealth';
  perform set_config('request.jwt.claims', json_build_object('sub', pat::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action) values (v_org, pat, cv.consent_type, cv.id, cv.version, 'accepted');
  reset role;
  if (select channel from public.patient_consents where patient_id = pat and consent_type = 'telehealth') <> 'unknown' then raise exception 'FAIL 1f: missing channel was guessed'; end if;

  -- a patient cannot label their own choice as staff-assisted or system
  perform set_config('request.jwt.claims', json_build_object('sub', pat::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action, channel)
      select v_org, pat, 'data_processing', id, version, 'accepted', 'staff_assisted' from public.consent_versions where is_current and consent_type = 'data_processing';
    reset role; raise exception 'FAIL 1g: a patient forged the staff_assisted channel';
  exception when check_violation then reset role; end;

  -- a legacy-shaped row (written by a service context with no receipt columns) is not presented as the person's own act
  perform set_config('request.jwt.claims', '', true);
  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action)
    select v_org, (select v from s4b2_fx where k = 'str'), 'data_processing', id, version, 'accepted' from public.consent_versions where is_current and consent_type = 'data_processing';
  update public.patient_consents set consented_by_relation = null, channel = null, text_sha256 = null where patient_id = (select v from s4b2_fx where k = 'str');
  if (select consented_by_relation || '/' || channel || '/' || coalesce(text_sha256, 'none')
        from public.patient_consent_receipts where patient_id = (select v from s4b2_fx where k = 'str')) <> 'legacy/unknown/none' then
    raise exception 'FAIL 1h: a legacy row is presented with guessed provenance';
  end if;

  -- 2. mismatched type and version
  perform set_config('request.jwt.claims', json_build_object('sub', pat::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action)
      select v_org, pat, 'data_processing', id, version, 'accepted' from public.consent_versions where is_current and consent_type = 'terms_of_service';
    reset role;
    raise exception 'FAIL 2: a version of another type was accepted';
  exception when check_violation then reset role; end;
end $$;

-- 3. OQ-53
do $$
declare
  pat uuid := (select v from s4b2_fx where k = 'pat');
  pat2 uuid := (select v from s4b2_fx where k = 'pat2');
  v_org uuid := (select v from s4b2_fx where k = 'org');
  cv record; opt record; n_before int; n_after int; v_blocked boolean := false;
begin
  select * into cv from public.consent_versions where is_current and not is_optional and consent_type = 'terms_of_service';
  select * into opt from public.consent_versions where version = 'proof-opt-v1';
  select count(*) into n_before from public.patient_consents where patient_id = pat;

  perform set_config('request.jwt.claims', json_build_object('sub', pat::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action, channel) values (v_org, pat, cv.consent_type, cv.id, cv.version, 'withdrawn', 'web');
  exception when check_violation then v_blocked := true; end;
  reset role;
  select count(*) into n_after from public.patient_consents where patient_id = pat;
  if not v_blocked or n_after <> n_before then raise exception 'FAIL 3a: an active account withdrew a required consent (blocked %, rows % -> %)', v_blocked, n_before, n_after; end if;

  -- optional: give, then withdraw, two append-only rows
  perform set_config('request.jwt.claims', json_build_object('sub', pat::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action, channel, created_at) values (v_org, pat, 'marketing', opt.id, opt.version, 'accepted', 'mobile', now() - interval '2 minutes');
  if (select created_at from public.patient_consents where patient_id = pat and consent_type = 'marketing') < now() - interval '1 minute' then raise exception 'FAIL 3b0: a signed-in patient back-dated a consent'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', pat::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action, channel) values (v_org, pat, 'marketing', opt.id, opt.version, 'withdrawn', 'mobile');
  reset role;
  if (select count(*) from public.patient_consents where patient_id = pat and consent_type = 'marketing' and created_at < clock_timestamp()) <> 2 then raise exception 'FAIL 3b: optional give+withdraw is not two rows'; end if;
  if (select count(distinct text_sha256) from public.patient_consents where patient_id = pat and consent_type = 'marketing') <> 1 then raise exception 'FAIL 3c: the withdrawal does not carry the hash of the text withdrawn'; end if;

  -- closed account: allowed
  perform set_config('request.jwt.claims', '', true);
  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action, created_at) values (v_org, pat2, cv.consent_type, cv.id, cv.version, 'accepted', now() - interval '2 minutes');
  -- a suspended patient (inactive profile, no completed deletion request) is NOT a closed account
  update public.profiles set is_active = false where id = pat2;
  perform set_config('request.jwt.claims', json_build_object('sub', pat2::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action, channel) values (v_org, pat2, cv.consent_type, cv.id, cv.version, 'withdrawn', 'web');
    reset role; raise exception 'FAIL 3d0: a suspended (not closed) account withdrew a required consent';
  exception when check_violation then reset role; end;
  perform set_config('request.jwt.claims', '', true);
  set local session_replication_role = replica;
  insert into public.data_deletion_requests (organisation_id, patient_id, status, reviewed_by, reviewed_at, completed_by, completed_at, grace_ends_at)
    values (v_org, pat2, 'completed', (select v from s4b2_fx where k = 'adm'), now(), (select v from s4b2_fx where k = 'adm'), now(), now() - interval '1 day');
  set local session_replication_role = origin;
  perform set_config('request.jwt.claims', json_build_object('sub', pat2::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action, channel) values (v_org, pat2, cv.consent_type, cv.id, cv.version, 'withdrawn', 'web');
  reset role;
  if not exists (select 1 from public.patient_consents where patient_id = pat2 and action = 'withdrawn') then raise exception 'FAIL 3d: a closed account could not withdraw'; end if;
  perform set_config('request.jwt.claims', '', true);
  update public.profiles set is_active = true where id = pat2;

  -- service context (no auth.uid()): allowed
  perform set_config('request.jwt.claims', '', true);
  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action, created_at) values (v_org, pat2, cv.consent_type, cv.id, cv.version, 'accepted', now() + interval '5 seconds');
  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action) values (v_org, pat2, cv.consent_type, cv.id, cv.version, 'withdrawn');
  if not exists (select 1 from public.patient_consents where patient_id = pat2 and action = 'withdrawn' and consented_by_relation = 'system') then raise exception 'FAIL 3e: a service-context row was not labelled system'; end if;
end $$;

-- 4. OQ-49 draft wording
do $$
declare
  pat uuid := (select v from s4b2_fx where k = 'pat');
  adm uuid := (select v from s4b2_fx where k = 'adm');
  v_org uuid := (select v from s4b2_fx where k = 'org');
  d record; n int; v_sqlstate text;
begin
  select * into d from public.consent_versions where consent_type = 'care_circle_sharing' and is_draft;
  if d.id is null then raise exception 'FAIL 4a: the care_circle_sharing draft is not seeded'; end if;
  if not d.is_optional then raise exception 'FAIL 4a2: draft is not optional'; end if;
  if d.is_current then raise exception 'FAIL 4a3: a draft holds the current slot'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', pat::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.consent_versions where is_draft;
  reset role;
  if n <> 0 then raise exception 'FAIL 4b: a patient can see % draft(s)', n; end if;

  set local role anon;
  select count(*) into n from public.consent_versions where is_draft;
  reset role;
  if n <> 0 then raise exception 'FAIL 4c: anon can see a draft'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', adm::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.consent_versions where is_draft;
  reset role;
  if n < 1 then raise exception 'FAIL 4d: an admin cannot review the draft'; end if;

  -- a draft cannot be accepted
  perform set_config('request.jwt.claims', json_build_object('sub', pat::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action) values (v_org, pat, 'care_circle_sharing', d.id, d.version, 'accepted');
    reset role; raise exception 'FAIL 4e: a draft was accepted';
  exception when check_violation then reset role; end;

  -- publish refused while the module is off; direct flip refused too
  perform set_config('request.jwt.claims', json_build_object('sub', adm::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.publish_consent_wording(d.id, 'approved by founder'); v_sqlstate := 'allowed'; exception when others then v_sqlstate := sqlstate; end;
  reset role;
  if v_sqlstate = 'allowed' then raise exception 'FAIL 4f: wording published while the module is off'; end if;
  begin update public.consent_versions set is_draft = false where id = d.id; v_sqlstate := 'allowed'; exception when others then v_sqlstate := sqlstate; end;
  if v_sqlstate = 'allowed' then raise exception 'FAIL 4g: a direct update published a draft while the module is off'; end if;

  -- switch the module on (as a superadmin would), a non-admin still cannot publish, and a direct update still cannot skip the function
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = adm, activation_note = 'proof' where key = 'optional_consent_wording';
  perform set_config('request.jwt.claims', json_build_object('sub', adm::text, 'role', 'authenticated')::text, true);
  begin update public.consent_versions set is_draft = false where id = d.id; v_sqlstate := 'allowed'; exception when others then v_sqlstate := sqlstate; end;
  if v_sqlstate <> '42501' then raise exception 'FAIL 4g2: with the module on, a direct update still published a draft (%)', v_sqlstate; end if;
  set local role authenticated;
  begin
    insert into public.consent_versions (consent_type, version, title, body, is_current, is_optional, is_draft) values ('research', 'proof-direct', 'Direct', 'direct body', false, true, false);
    v_sqlstate := 'allowed';
  exception when others then v_sqlstate := sqlstate; end;
  reset role;
  if v_sqlstate <> '42501' then raise exception 'FAIL 4g3: an admin session inserted final optional wording directly (%)', v_sqlstate; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', pat::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.publish_consent_wording(d.id, 'sneaky'); v_sqlstate := 'allowed'; exception when others then v_sqlstate := sqlstate; end;
  reset role;
  if v_sqlstate <> '42501' then raise exception 'FAIL 4h: a patient could publish wording (%)', v_sqlstate; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', adm::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.publish_consent_wording(d.id, 'approved by founder in the proof');
  reset role;
  if (select is_draft or not is_current from public.consent_versions where id = d.id) then raise exception 'FAIL 4i: publish did not make the version current and final'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', pat::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.consent_versions where id = d.id;
  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action, channel) values (v_org, pat, 'care_circle_sharing', d.id, d.version, 'accepted', 'web');
  reset role;
  if n <> 1 then raise exception 'FAIL 4j: patient cannot see published wording'; end if;

  -- text of a published version is immutable
  begin update public.consent_versions set body = body || ' edited' where id = d.id; v_sqlstate := 'allowed'; exception when others then v_sqlstate := sqlstate; end;
  if v_sqlstate = 'allowed' then raise exception 'FAIL 4k: the text of a published version changed'; end if;
  if exists (select 1 from public.audit_log where entity_id = d.id and action = 'consent_wording.published' and (event ->> 'note') is null) then raise exception 'FAIL 4l: publish audit row lost its note'; end if;
  if (select draft_note from public.consent_versions where id = d.id) is not null then raise exception 'FAIL 4m: an approval note is readable on a published row'; end if;
  update public.platform_modules set is_enabled = false, enabled_at = null, enabled_by = null where key = 'optional_consent_wording';
end $$;

-- 5. guardian, stranger, append-only
do $$
declare
  pat uuid := (select v from s4b2_fx where k = 'pat');
  pat2 uuid := (select v from s4b2_fx where k = 'pat2');
  dep uuid := (select v from s4b2_fx where k = 'dep');
  gua uuid := (select v from s4b2_fx where k = 'gua');
  strg uuid := (select v from s4b2_fx where k = 'str');
  v_org uuid := (select v from s4b2_fx where k = 'org');
  opt record; n int; v_sqlstate text;
begin
  select * into opt from public.consent_versions where version = 'proof-opt-v1';
  perform set_config('request.jwt.claims', json_build_object('sub', gua::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action, channel) values (v_org, dep, 'marketing', opt.id, opt.version, 'accepted', 'web');
  select count(*) into n from public.patient_consent_receipts where patient_id = dep and consented_by_relation = 'guardian';
  if n <> 1 then reset role; raise exception 'FAIL 5a: guardian receipt not recorded or not visible (%)', n; end if;
  begin
    insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action) values (v_org, pat2, 'marketing', opt.id, opt.version, 'accepted');
    v_sqlstate := 'allowed';
  exception when others then v_sqlstate := sqlstate; end;
  reset role;
  if v_sqlstate <> '42501' then raise exception 'FAIL 5b: a guardian wrote a consent for a non-dependant (%)', v_sqlstate; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', strg::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.patient_consent_receipts where patient_id = dep;
  begin
    insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action) values (v_org, dep, 'marketing', opt.id, opt.version, 'accepted');
    v_sqlstate := 'allowed';
  exception when others then v_sqlstate := sqlstate; end;
  reset role;
  if n <> 0 then raise exception 'FAIL 5c: a stranger read a dependant''s receipts'; end if;
  if v_sqlstate <> '42501' then raise exception 'FAIL 5d: a stranger wrote a dependant''s consent (%)', v_sqlstate; end if;

  -- a staff session acting through a definer function is labelled staff, never guardian
  perform set_config('request.jwt.claims', json_build_object('sub', (select v from s4b2_fx where k = 'adm')::text, 'role', 'authenticated')::text, true);
  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action, channel)
    values (v_org, pat2, 'marketing', opt.id, opt.version, 'accepted', 'web');
  if not exists (select 1 from public.patient_consents where patient_id = pat2 and consent_type = 'marketing' and consented_by_relation = 'staff' and channel = 'staff_assisted') then
    raise exception 'FAIL 5g: a staff-made row was not labelled staff / staff_assisted';
  end if;
  perform set_config('request.jwt.claims', '', true);

  perform set_config('request.jwt.claims', json_build_object('sub', pat::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.patient_consent_receipts where patient_id <> pat;
  begin update public.patient_consents set channel = 'web' where patient_id = pat; v_sqlstate := 'allowed'; exception when others then v_sqlstate := sqlstate; end;
  reset role;
  if n <> 0 then raise exception 'FAIL 5e: a patient read other people''s receipts'; end if;
  if v_sqlstate <> '42501' then raise exception 'FAIL 5f: patient_consents is not append-only for authenticated (%)', v_sqlstate; end if;
end $$;

-- 6. deletion grace and cancel
do $$
declare
  pat uuid := (select v from s4b2_fx where k = 'pat');
  pat2 uuid := (select v from s4b2_fx where k = 'pat2');
  adm uuid := (select v from s4b2_fx where k = 'adm');
  v_org uuid := (select v from s4b2_fx where k = 'org');
  req uuid; g timestamptz; v_sqlstate text; st text; n int;
begin
  -- default 14 days
  perform set_config('request.jwt.claims', json_build_object('sub', pat::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.data_deletion_requests (organisation_id, patient_id, reason) values (v_org, pat, 'proof') returning id, grace_ends_at into req, g;
  reset role;
  if g < now() + interval '13 days 23 hours' or g > now() + interval '14 days 1 hour' then raise exception 'FAIL 6a: default grace is not 14 days (%)', g; end if;

  -- a second open request is refused
  perform set_config('request.jwt.claims', json_build_object('sub', pat::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin insert into public.data_deletion_requests (organisation_id, patient_id, reason) values (v_org, pat, 'again'); v_sqlstate := 'allowed'; exception when others then v_sqlstate := sqlstate; end;
  reset role;
  if v_sqlstate <> '23505' then raise exception 'FAIL 6b: two open deletion requests (%)', v_sqlstate; end if;

  -- clamps: 1 day -> 7, 90 days -> 30 (other patient)
  perform set_config('request.jwt.claims', json_build_object('sub', pat2::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.data_deletion_requests (organisation_id, patient_id, requested_grace_days, grace_ends_at) values (v_org, pat2, 1, now() + interval '400 days') returning grace_ends_at into g;
  reset role;
  if g < now() + interval '6 days 23 hours' or g > now() + interval '7 days 1 hour' then raise exception 'FAIL 6c: short grace not raised to 7 days (%)', g; end if;
  update public.data_deletion_requests set status = 'cancelled', cancelled_at = now(), cancelled_by = pat2 where patient_id = pat2 and status = 'pending';
  perform set_config('request.jwt.claims', json_build_object('sub', pat2::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.data_deletion_requests (organisation_id, patient_id, requested_grace_days) values (v_org, pat2, 90) returning grace_ends_at into g;
  reset role;
  if g < now() + interval '29 days 23 hours' or g > now() + interval '30 days 1 hour' then raise exception 'FAIL 6d: long grace not capped at 30 days (%)', g; end if;

  -- admin cannot approve before the grace ends; patient cannot approve
  perform set_config('request.jwt.claims', json_build_object('sub', adm::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.data_deletion_requests set status = 'under_review' where id = req;
  begin update public.data_deletion_requests set status = 'approved_full' where id = req; v_sqlstate := 'allowed'; exception when others then v_sqlstate := sqlstate; end;
  reset role;
  if v_sqlstate <> '23514' then raise exception 'FAIL 6e: an admin approved before the grace ended (%)', v_sqlstate; end if;

  -- another patient cannot cancel it; the owner can; it is audited and closed
  perform set_config('request.jwt.claims', json_build_object('sub', pat2::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.cancel_my_data_deletion_request(req); v_sqlstate := 'allowed'; exception when others then v_sqlstate := sqlstate; end;
  reset role;
  if v_sqlstate <> 'P0002' then raise exception 'FAIL 6f: another patient cancelled the request (%)', v_sqlstate; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', pat::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.cancel_my_data_deletion_request(req);
  reset role;
  select status into st from public.data_deletion_requests where id = req;
  if st <> 'cancelled' or (select cancelled_by from public.data_deletion_requests where id = req) is distinct from pat then raise exception 'FAIL 6g: cancel did not close and stamp the request (%)', st; end if;
  select count(*) into n from public.audit_log where entity_id = req and action in ('data_deletion.requested', 'data_deletion.cancelled');
  if n <> 2 then raise exception 'FAIL 6h: expected 2 audit rows for the request, found %', n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', pat::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.cancel_my_data_deletion_request(req); v_sqlstate := 'allowed'; exception when others then v_sqlstate := sqlstate; end;
  reset role;
  if v_sqlstate <> '23514' then raise exception 'FAIL 6i: a closed request was cancelled again (%)', v_sqlstate; end if;

  -- the person can ask again after cancelling
  perform set_config('request.jwt.claims', json_build_object('sub', pat::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.data_deletion_requests (organisation_id, patient_id, reason) values (v_org, pat, 'second ask') returning id into req;
  reset role;
  insert into s4b2_fx values ('req2', req);
end $$;

-- 6 (continued). after the grace ends: admin proceeds, patient can no longer cancel
do $$
declare
  adm uuid := (select v from s4b2_fx where k = 'adm');
  pat uuid := (select v from s4b2_fx where k = 'pat');
  req uuid := (select v from s4b2_fx where k = 'req2');
  v_sqlstate text; st text;
begin
  set local session_replication_role = replica;   -- fixture only: back-date the immutable grace_ends_at
  update public.data_deletion_requests set grace_ends_at = now() - interval '1 second' where id = req;
  set local session_replication_role = origin;

  perform set_config('request.jwt.claims', json_build_object('sub', pat::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin perform public.cancel_my_data_deletion_request(req); v_sqlstate := 'allowed'; exception when others then v_sqlstate := sqlstate; end;
  reset role;
  if v_sqlstate <> '23514' then raise exception 'FAIL 6j: cancelled after the grace ended (%)', v_sqlstate; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', adm::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.data_deletion_requests set status = 'under_review' where id = req;
  update public.data_deletion_requests set status = 'approved_partial', blocked_categories = array['clinical_record'], blocked_reason = 'retained by law' where id = req;
  update public.data_deletion_requests set status = 'completed' where id = req;
  reset role;
  select status into st from public.data_deletion_requests where id = req;
  if st <> 'completed' then raise exception 'FAIL 6k: admin could not complete after the grace (%)', st; end if;
  if (select is_active from public.profiles where id = pat) then raise exception 'FAIL 6l: completing the request did not deactivate the profile'; end if;
  if not exists (select 1 from public.profiles where id = pat) then raise exception 'FAIL 6m: the profile was deleted'; end if;
  if not exists (select 1 from auth.users where id = pat and banned_until is not null and banned_until > now() + interval '99 years') then raise exception 'FAIL 6p: completing the request did not sign the person out'; end if;
  if not exists (select 1 from public.audit_log where entity_id = req and action = 'data_deletion.completed' and subject_patient_id = pat) then raise exception 'FAIL 6q: completion was not audited'; end if;
  if exists (
    select 1 from (select distinct on (consent_type) consent_type, action from public.patient_consents where patient_id = pat order by consent_type, created_at desc, id desc) l
     where l.action = 'accepted'
  ) then raise exception 'FAIL 6o: completing the request left a consent in force'; end if;
  if not exists (select 1 from public.audit_log where entity_id = req and action = 'data_deletion.requested' and subject_patient_id = pat) then raise exception 'FAIL 6n: the request audit row has no patient subject'; end if;
end $$;

-- 7. SABOTAGE
-- 7a. remove the required-withdrawal rule: check 3a must flip
do $$
declare
  pat2 uuid := (select v from s4b2_fx where k = 'pat2');
  v_org uuid := (select v from s4b2_fx where k = 'org');
  def text; cv record; v_blocked boolean := false;
begin
  def := pg_get_functiondef('private.enforce_patient_consent_withdrawal()'::regprocedure);
  insert into s4b2_def values ('withdrawal', def);
  if position('if v_uid is not null and not v_cv.is_optional and coalesce' in def) = 0 then raise exception 'SABOTAGE setup: anchor not found'; end if;
  execute replace(def, 'if v_uid is not null and not v_cv.is_optional and coalesce', 'if false and coalesce');

  select * into cv from public.consent_versions where is_current and not is_optional and consent_type = 'data_processing';
  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action, created_at) values (v_org, pat2, cv.consent_type, cv.id, cv.version, 'accepted', now() - interval '30 seconds');
  perform set_config('request.jwt.claims', json_build_object('sub', pat2::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action) values (v_org, pat2, cv.consent_type, cv.id, cv.version, 'withdrawn');
  exception when check_violation then v_blocked := true; end;
  reset role;
  if v_blocked then raise exception 'VACUOUS: with the rule removed the withdrawal was still blocked, so check 3a proves nothing'; end if;
  execute (select d from s4b2_def where k = 'withdrawal');
  perform set_config('request.jwt.claims', '', true);
  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action, created_at) values (v_org, pat2, cv.consent_type, cv.id, cv.version, 'accepted', now() + interval '1 second');
  perform set_config('request.jwt.claims', json_build_object('sub', pat2::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action) values (v_org, pat2, cv.consent_type, cv.id, cv.version, 'withdrawn');
    reset role; raise exception 'RESTORE FAIL: the rule did not come back';
  exception when check_violation then reset role; end;
end $$;

-- 7b. remove the grace gate: check 6e must flip
do $$
declare
  adm uuid := (select v from s4b2_fx where k = 'adm');
  pat2 uuid := (select v from s4b2_fx where k = 'pat2');
  v_org uuid := (select v from s4b2_fx where k = 'org');
  def text; req uuid; st text; v_sqlstate text;
begin
  def := pg_get_functiondef('private.enforce_data_deletion_request_attribution()'::regprocedure);
  insert into s4b2_def values ('grace', def);
  if position('and old.grace_ends_at is not null and now() < old.grace_ends_at then' in def) = 0 then raise exception 'SABOTAGE setup: grace anchor not found'; end if;
  execute replace(def, 'and old.grace_ends_at is not null and now() < old.grace_ends_at then', 'and false then');

  update public.data_deletion_requests set status = 'cancelled', cancelled_at = now(), cancelled_by = pat2 where patient_id = pat2 and status = 'pending';
  perform set_config('request.jwt.claims', json_build_object('sub', pat2::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.data_deletion_requests (organisation_id, patient_id, reason) values (v_org, pat2, 'sabotage') returning id into req;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', adm::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.data_deletion_requests set status = 'under_review' where id = req;
  begin update public.data_deletion_requests set status = 'approved_full' where id = req; v_sqlstate := 'allowed'; exception when others then v_sqlstate := sqlstate; end;
  reset role;
  if v_sqlstate <> 'allowed' then raise exception 'VACUOUS: with the grace gate removed approval was still refused, so check 6e proves nothing'; end if;
  execute (select d from s4b2_def where k = 'grace');
end $$;

-- 7c. no oracle: through the API (role authenticated), a stranger gets the same refusal whatever the victim holds
do $$
declare
  strg uuid := (select v from s4b2_fx where k = 'str');
  victim uuid := (select v from s4b2_fx where k = 'pat2');
  v_org uuid := (select v from s4b2_fx where k = 'org');
  cv record; r1 text; r2 text;
begin
  select * into cv from public.consent_versions where is_current and not is_optional and consent_type = 'terms_of_service';
  perform set_config('request.jwt.claims', json_build_object('sub', strg::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action) values (v_org, victim, 'terms_of_service', cv.id, cv.version, 'withdrawn');
    r1 := 'allowed';
  exception when others then r1 := sqlstate || ':' || sqlerrm; end;
  begin
    insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action) values (v_org, victim, 'research', cv.id, cv.version, 'withdrawn');
    r2 := 'allowed';
  exception when others then r2 := sqlstate || ':' || sqlerrm; end;
  reset role;
  if r1 is distinct from r2 or r1 not like '42501%' then raise exception 'FAIL 7c: a stranger could tell consent states apart (% / %)', r1, r2; end if;
end $$;

-- 8. function privileges
do $$
begin
  if has_function_privilege('anon', 'public.cancel_my_data_deletion_request(uuid)', 'EXECUTE') then raise exception 'FAIL 8a: anon can cancel deletion requests'; end if;
  if has_function_privilege('anon', 'public.publish_consent_wording(uuid,text)', 'EXECUTE') then raise exception 'FAIL 8b: anon can publish wording'; end if;
  if has_table_privilege('anon', 'public.patient_consent_receipts', 'SELECT') then raise exception 'FAIL 8c: anon can read receipts'; end if;
end $$;

select 'PASS s04b2: receipts, OQ-53 withdrawal rule, draft wording gate, guardian scope, append-only, deletion grace and cancel; both sabotages flipped' as verdict;

rollback;
