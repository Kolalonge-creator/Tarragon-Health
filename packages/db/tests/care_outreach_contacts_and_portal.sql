-- Tarragon Health
-- Proves the care-coordinator outreach/contact-log feature has real DB-level
-- teeth, not just app-layer discipline. Zero test coverage existed for this
-- feature before this file (TS query layer + DB triggers were both untested).
--
-- Covers care_outreach_tasks (20260723010019_care_outreach_engine.sql) and
-- care_outreach_contacts (20260809181908_care_outreach_contacts.sql), plus
-- the private.stamp_outreach_contact_author / private.stamp_outreach_resolution
-- triggers.
--
-- WHERE THIS CODE ACTUALLY LIVES, as of writing this test: the care-
-- coordinator dashboard rebuild + care_outreach_contacts migration (commit
-- 1714b4a, PR #220, "Rebuild care-coordinator dashboard...") is live in
-- production (verified directly against the linked DB below) but was never
-- merged back into main-dev -- this checkout's branch predates it and has
-- neither the migration file nor the app code locally. Every schema/trigger
-- this file exercises was confirmed against the live, currently-deployed
-- database, not reconstructed from memory or from `git show` alone.
--
-- Three properties proven, each negative paired with a positive control (a
-- block that stops everyone proves nothing):
--   1. private.stamp_outreach_contact_author / private.stamp_outreach_resolution
--      overwrite a client-supplied author/resolver with the real session's
--      identity -- a coordinator cannot claim credit for someone else's
--      outreach, or vice versa.
--   2. A Care Coordinator CAN create/update outreach rows (that is its job)
--      but is blocked, at the DB level, from medications and escalation
--      claim/resolution -- per CLAUDE.md's standing Care Coordinator
--      write-access rule.
--   3. RLS scopes every care_outreach_tasks/care_outreach_contacts row to
--      the caller's own organisation.
--
-- CLAUDE.md's write-access rule also names a fourth item, protocol signing.
-- That is DELIBERATELY NOT asserted as DB-blocked in the pass/fail section
-- below, because it is not DB-blocked: protocol_versions' insert policy is
-- `is_org_staff(organisation_id)` only (20260712210000_protocol_versions.sql)
-- and "only the Clinical Director signs" is enforced exclusively client-side,
-- in apps/web/src/lib/queries/protocol-versions.ts's getCallerOrgAndDirector().
-- CLAUDE.md says as much ("enforced at the app/server-action layer ... not a
-- new RLS helper"), so that much is documented, not newly broken. What this
-- test file DID newly confirm, and CLAUDE.md's text does not mention: the
-- insert has no self-attribution check at all -- any org staff account, not
-- only a Care Coordinator, can write a protocol_versions row with
-- approved_by set to ANY clinical_staff id in the org, including someone
-- else's, forging a signature that was never actually given. See the
-- "checkpoints" section at the end -- recorded as observed current behaviour,
-- not folded into the hard pass/fail gate, and flagged separately as a
-- follow-up rather than fixed inline here (fixing it means shipping a new
-- migration, out of scope for a test-coverage pass).
--
-- Run (from the MAIN checkout, not a worktree -- the supabase/.temp/ project
-- link only exists there):
--   npx supabase db query --linked -f packages/db/tests/care_outreach_contacts_and_portal.sql
--
-- Fixtures are entirely self-contained (fresh auth.users/profiles/
-- clinical_staff/organisations, never named QA accounts) -- past sessions
-- repeatedly found QA fixture clinical_staff rows dropped by DB rebuilds
-- (see packages/db/tests/clinician_alert_override.sql's header). Only one
-- live organisation exists at time of writing, so a second is created here
-- to prove cross-org RLS scoping. Whole file runs inside begin/rollback --
-- nothing persists.

begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
create temp table checkpoints(check_name text, observed text) on commit drop;

do $$
declare
  v_org             uuid;
  v_org2            uuid;
  v_patient         uuid := gen_random_uuid();
  v_patient2        uuid := gen_random_uuid();
  v_coord           uuid := gen_random_uuid();  -- care_coordinator, org 1
  v_coord2          uuid := gen_random_uuid();  -- care_coordinator, org 2 (cross-org control)
  v_clin            uuid := gen_random_uuid();  -- tier_2 clinician, org 1 (authority positive control)
  v_coord_staff_id  uuid;
  v_clin_staff_id   uuid;
  v_task            uuid;
  v_contact         uuid;
  v_esc             uuid;
  v_med             uuid;
  v_pv              uuid;
  v_blocked         boolean;
  v_err             text;
  v_count           bigint;
begin
  ----------------------------------------------------------------------------
  -- Fixtures
  ----------------------------------------------------------------------------
  select id into v_org from public.organisations order by created_at limit 1;

  insert into public.organisations (name, type)
  values ('ZZ Outreach Test Org 2', 'clinic')
  returning id into v_org2;

  insert into auth.users (id, email) values
    (v_patient,  'zz.outreach.patient1@example.com'),
    (v_patient2, 'zz.outreach.patient2@example.com'),
    (v_coord,    'zz.outreach.coord1@example.com'),
    (v_coord2,   'zz.outreach.coord2@example.com'),
    (v_clin,     'zz.outreach.clin1@example.com');

  -- handle_new_user may already have created a default profile from the
  -- auth.users insert above; upsert so this works either way.
  insert into public.profiles (id, organisation_id, role, full_name) values
    (v_patient,  v_org,  'patient',          'ZZ Outreach Patient 1'),
    (v_patient2, v_org2, 'patient',          'ZZ Outreach Patient 2'),
    (v_coord,    v_org,  'care_coordinator', 'ZZ Outreach Coordinator 1'),
    (v_coord2,   v_org2, 'care_coordinator', 'ZZ Outreach Coordinator 2'),
    (v_clin,     v_org,  'clinician',        'ZZ Outreach Clinician 1')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id,
        role             = excluded.role,
        full_name        = excluded.full_name;

  insert into public.clinical_staff
    (organisation_id, profile_id, full_name, active, doctor_tier, license_verified_at)
  values (v_org, v_coord, 'ZZ Outreach Coordinator 1', true, 'care_coordinator', now())
  returning id into v_coord_staff_id;

  insert into public.clinical_staff
    (organisation_id, profile_id, full_name, active, doctor_tier, license_verified_at)
  values (v_org, v_clin, 'ZZ Outreach Clinician 1', true, 'tier_2', now())
  returning id into v_clin_staff_id;

  insert into public.clinical_staff
    (organisation_id, profile_id, full_name, active, doctor_tier, license_verified_at)
  values (v_org2, v_coord2, 'ZZ Outreach Coordinator 2', true, 'care_coordinator', now());

  ----------------------------------------------------------------------------
  -- 1. Attribution cannot be spoofed: contacted_by / resolved_by are
  --    server-stamped from the real session, never trusted from the client.
  ----------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into public.care_outreach_contacts
    (organisation_id, patient_id, channel, note, contacted_by)
  values
    (v_org, v_patient, 'call', 'Called patient, confirmed BP medication refilled', v_clin)  -- spoofed
  returning id into v_contact;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  insert into results
  select 'contact author is the real caller, not the spoofed value', v_coord::text, contacted_by::text
  from public.care_outreach_contacts where id = v_contact;

  perform set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into public.care_outreach_tasks
    (organisation_id, patient_id, trigger_type, trigger_detail)
  values (v_org, v_patient, 'stale_monitoring', '{}'::jsonb)
  returning id into v_task;

  update public.care_outreach_tasks
  set status = 'resolved',
      outcome_note = 'Patient confirmed readings normal, no action needed',
      resolved_by = v_clin,                     -- spoofed
      resolved_at = now() - interval '30 days'  -- spoofed
  where id = v_task;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  insert into results
  select 'task resolver is the real caller, not the spoofed value', v_coord::text, resolved_by::text
  from public.care_outreach_tasks where id = v_task;

  insert into results
  select 'task resolved_at is real (not the spoofed 30-days-ago)', 'true',
    (resolved_at > now() - interval '1 minute')::text
  from public.care_outreach_tasks where id = v_task;

  -- The trigger fires both ways: moving a task off resolved/dismissed wipes
  -- the attribution rather than leaving stale resolver info behind.
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role','authenticated')::text, true);
  set local role authenticated;
  update public.care_outreach_tasks set status = 'in_progress' where id = v_task;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  insert into results
  select 'reopening a task clears resolved_by/resolved_at', 'null/null',
    coalesce(resolved_by::text,'null') || '/' || coalesce(resolved_at::text,'null')
  from public.care_outreach_tasks where id = v_task;

  ----------------------------------------------------------------------------
  -- 2. A Care Coordinator CAN create/update outreach rows -- that is its job.
  ----------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role','authenticated')::text, true);
  set local role authenticated;
  update public.care_outreach_tasks set status = 'contacted', assigned_to = v_coord where id = v_task;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  insert into results
  select 'coordinator can run the ordinary outreach workflow', 'contacted', status::text
  from public.care_outreach_tasks where id = v_task;

  ----------------------------------------------------------------------------
  -- 3. RLS scopes every row to the caller's own organisation.
  ----------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord2, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into public.care_outreach_tasks
    (organisation_id, patient_id, trigger_type, trigger_detail)
  values (v_org2, v_patient2, 'overdue_screening', '{}'::jsonb);
  insert into public.care_outreach_contacts
    (organisation_id, patient_id, channel, note)
  values (v_org2, v_patient2, 'whatsapp', 'org2 fixture contact');
  reset role;
  perform set_config('request.jwt.claims', '', true);

  perform set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.care_outreach_tasks where organisation_id = v_org2;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into results values ('org-1 coordinator reads zero org-2 tasks', '0', v_count::text);

  perform set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_count from public.care_outreach_contacts where organisation_id = v_org2;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into results values ('org-1 coordinator reads zero org-2 contacts', '0', v_count::text);

  v_blocked := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.care_outreach_tasks
      (organisation_id, patient_id, trigger_type, trigger_detail)
    values (v_org2, v_patient2, 'unactioned_abnormal', '{}'::jsonb);
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into results values ('org-1 coordinator cannot insert a task into org 2', 'true', v_blocked::text);

  ----------------------------------------------------------------------------
  -- 4. Care Coordinator cannot touch medications or escalation claim/
  --    resolution. Every negative is paired with a positive control (a real
  --    clinician succeeds on the same row), so "blocked" cannot be an
  --    accident of a bad fixture rather than a real authority gate.
  ----------------------------------------------------------------------------
  v_blocked := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.medications (organisation_id, patient_id, drug_name)
    values (v_org, v_patient, 'ZZ Outreach Test Amlodipine');
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into results values ('care_coordinator cannot prescribe a new medication', 'true', v_blocked::text);

  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into public.medications (organisation_id, patient_id, drug_name)
  values (v_org, v_patient, 'ZZ Outreach Test Amlodipine')
  returning id into v_med;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into results values ('control: tier-2 clinician CAN prescribe the same drug', 'true', (v_med is not null)::text);

  insert into public.escalations (organisation_id, patient_id, status, reason)
  values (v_org, v_patient, 'open', 'ZZ outreach test escalation - non-emergency')
  returning id into v_esc;

  v_blocked := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    update public.escalations set assigned_doctor_id = v_coord where id = v_esc;
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into results values ('care_coordinator cannot claim an escalation', 'true', v_blocked::text);

  v_blocked := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role','authenticated')::text, true);
  set local role authenticated;
  begin
    update public.escalations
    set status = 'resolved', resolution_note = 'coordinator attempting to close it'
    where id = v_esc;
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into results values ('care_coordinator cannot resolve an escalation', 'true', v_blocked::text);

  -- Still genuinely open after both blocked attempts -- prove that with a
  -- real clinician actually claiming and closing it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role','authenticated')::text, true);
  set local role authenticated;
  update public.escalations
  set assigned_doctor_id = v_clin, status = 'resolved', resolution_note = 'tier-2 clinician control'
  where id = v_esc;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  insert into results
  select 'control: tier-2 clinician CAN claim+resolve the same escalation', 'resolved', status::text
  from public.escalations where id = v_esc;

  ----------------------------------------------------------------------------
  -- CHECKPOINT (informational, not a pass/fail gate): protocol_versions is
  -- NOT DB-blocked for a Care Coordinator today. Recorded so a future
  -- accidental change shows up in a diff against this file. See header.
  ----------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into public.protocol_versions
    (organisation_id, protocol_id, version_number, title, change_summary, content, approved_by)
  values (v_org, 'zz_outreach_test_protocol', 1, 'ZZ test', 'zz change', '{}'::jsonb, v_coord_staff_id)
  returning id into v_pv;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  insert into checkpoints values (
    'non-director care_coordinator can insert protocol_versions self-attributed',
    case when v_pv is not null then 'ALLOWED (app-layer-only enforcement, see file header)' else 'blocked' end
  );

  v_pv := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coord, 'role','authenticated')::text, true);
  set local role authenticated;
  insert into public.protocol_versions
    (organisation_id, protocol_id, version_number, title, change_summary, content, approved_by)
  values (v_org, 'zz_outreach_test_protocol', 2, 'ZZ test 2', 'zz change 2', '{}'::jsonb, v_clin_staff_id)
  returning id into v_pv;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  insert into checkpoints values (
    'care_coordinator can insert protocol_versions attributed to ANOTHER staff member (impersonation)',
    case when v_pv is not null then 'ALLOWED -- no self-attribution check at all, see file header' else 'blocked' end
  );
end $$;

select * from checkpoints order by check_name;

select check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results
order by check_name;

do $$
declare v_fail int;
begin
  select count(*) into v_fail from results where expected <> actual;
  if v_fail > 0 then
    raise exception '% care-outreach check(s) failed', v_fail;
  end if;
end $$;

rollback;
