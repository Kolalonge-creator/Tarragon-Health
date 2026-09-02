-- ===========================================================================
-- Live proof for the 2026-08-29/30 Data Governance gap-closure pass (§87):
--   20260829223239_data_classification_and_inventory.sql
--   20260829223411_data_deletion_requests.sql
--   20260829223603_regulatory_register_and_vendor_assessments.sql
--   20260829224057_partner_license_expiry_cascade_and_compliance_owner.sql
--   20260830001012_log_patient_data_export.sql
--   20260830001315_fix_log_patient_data_export_schema.sql (moved private -> public)
--
-- Run: npx supabase db query --linked -f packages/db/tests/data_governance_rls.sql
-- Wrapped in BEGIN/ROLLBACK. Session-simulation pattern matches
-- packages/db/tests/medication_issues_rls.sql.
--
-- Checks:
--   1. table_classifications: any authenticated user (patient) can SELECT
--      (broad registry, §87.2); a patient cannot INSERT; an admin can.
--   2. data_deletion_requests: a patient's INSERT is server-stamped
--      (patient_id/organisation_id/status), spoof-resisted.
--   3. A different patient cannot SELECT someone else's deletion request.
--   4. A patient cannot UPDATE their own request directly (review is
--      admin-only by design -- there is no patient UPDATE policy at all).
--   5. An admin CAN review it: reviewed_by/reviewed_at are server-stamped
--      when moving status off 'pending'.
--   6. An admin attempting status='denied' with no decision_note is
--      rejected by the DB's own CHECK constraint -- proves the workflow is
--      enforced even against an admin's mistake, not just against a
--      non-admin's attempt.
--   7. A completed request is immutable -- even an admin cannot edit it
--      further once status='completed'.
--   8. regulatory_obligations / vendor_assessments: a patient reads ZERO
--      rows from either (admin-only, no org-staff carve-out); an admin
--      reads the real seeded rows.
--   9. public.log_patient_data_export() logs a data_exported event
--      attributed to the calling patient -- and only when called by the
--      patient themselves (auth.uid()), not spoofable via argument.
--  10. §87.16 compliance cascade: a partner licence expiring within the
--      30-day window produces exactly one notification at threshold_days=30
--      for its compliance_owner_profile_id; re-running the sweep does not
--      duplicate it (dedup by threshold, not by calendar day).
--
-- TO CONFIRM THIS TEST DISCRIMINATES, break it on purpose: comment out the
-- `constraint data_deletion_requests_denied_requires_reason` check in the
-- data_deletion_requests migration (or drop it live) and re-run -- check 6
-- must FAIL, showing a request denied with no decision_note recorded.
-- ===========================================================================

begin;

create temporary table dg_fixture(k text primary key, v uuid) on commit drop;
create temporary table dg_result(check_name text, role text, observed text, expected text, verdict text) on commit drop;

do $$
declare
  v_org uuid;
  r record;
begin
  select organisation_id into v_org
  from public.profiles
  where role = 'patient' and organisation_id is not null
  group by organisation_id order by count(*) desc limit 1;

  if v_org is null then
    raise exception 'no organisation has patient profiles -- cannot run this test';
  end if;
  insert into dg_fixture(k, v) values ('org', v_org);

  for r in select * from (values
      ('patient_a', 'patient'), ('patient_b', 'patient'), ('admin', 'admin')
    ) as t(key_name, role_name)
  loop
    insert into dg_fixture(k, v) values (r.key_name, gen_random_uuid());
    insert into auth.users (id, email)
    values ((select v from dg_fixture where k = r.key_name), format('dgtest.%s@example.com', r.key_name));
    insert into public.profiles (id, organisation_id, role, full_name)
    values ((select v from dg_fixture where k = r.key_name), v_org, r.role_name::public.user_role, format('DG Test %s', r.key_name))
    on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  end loop;
end $$;

-- ==========================================================================
-- 1. table_classifications: patient reads (broad registry), cannot write;
-- admin can write.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from dg_fixture where k = 'patient_a');
  v_admin uuid := (select v from dg_fixture where k = 'admin');
  v_patient_count bigint;
  v_patient_insert_rejected boolean := false;
  v_admin_row_id uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_patient_count from public.table_classifications;
  reset role;

  insert into dg_result values
    ('patient can read table_classifications (broad registry)', 'patient',
     v_patient_count::text, '>= 1',
     case when v_patient_count >= 1 then 'PASS' else 'FAIL' end);
  if v_patient_count < 1 then
    raise exception 'GAP: a patient reads 0 table_classifications rows -- the registry should be broadly readable';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.table_classifications (table_name, classification, purpose)
    values ('dg_test_table', 'internal', 'DG test row');
  exception when insufficient_privilege then
    v_patient_insert_rejected := true;
  end;
  reset role;

  insert into dg_result values
    ('patient cannot write table_classifications', 'patient',
     case when v_patient_insert_rejected then 'rejected' else 'allowed' end, 'rejected',
     case when v_patient_insert_rejected then 'PASS' else 'FAIL' end);
  if not v_patient_insert_rejected then
    raise exception 'GAP: a patient inserted into table_classifications';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.table_classifications (table_name, classification, purpose)
  values ('dg_test_table', 'internal', 'DG test row')
  returning id into v_admin_row_id;
  reset role;

  insert into dg_result values
    ('admin can write table_classifications', 'admin',
     case when v_admin_row_id is not null then 'inserted' else 'null' end, 'inserted',
     case when v_admin_row_id is not null then 'PASS' else 'FAIL' end);
  if v_admin_row_id is null then
    raise exception 'GAP: an admin could not insert into table_classifications';
  end if;
end $$;

-- ==========================================================================
-- 2/3. data_deletion_requests: patient INSERT server-stamped and
-- spoof-resisted; a different patient cannot read it.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from dg_fixture where k = 'org');
  v_patient_a uuid := (select v from dg_fixture where k = 'patient_a');
  v_patient_b uuid := (select v from dg_fixture where k = 'patient_b');
  v_spoofed_patient uuid := gen_random_uuid();
  v_request_id uuid;
  v_actual_patient uuid;
  v_actual_status text;
  v_other_org uuid;
  v_b_visible_count bigint;
begin
  select id into v_other_org from public.organisations where id <> v_org limit 1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient_a::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.data_deletion_requests (organisation_id, patient_id, reason, requested_categories, status)
  values (coalesce(v_other_org, v_org), v_spoofed_patient, 'DG test deletion request', array['marketing_and_analytics'], 'approved_full')
  returning id, patient_id, status into v_request_id, v_actual_patient, v_actual_status;
  reset role;

  insert into dg_fixture(k, v) values ('request_id', v_request_id);

  insert into dg_result values
    ('patient INSERT server-stamps patient_id, spoof resisted', 'patient_a',
     v_actual_patient::text, v_patient_a::text,
     case when v_actual_patient = v_patient_a then 'PASS' else 'FAIL' end);
  if v_actual_patient is distinct from v_patient_a then
    raise exception 'SPOOFABLE: data_deletion_requests.patient_id = % (expected caller''s own auth.uid() %)', v_actual_patient, v_patient_a;
  end if;

  insert into dg_result values
    ('patient INSERT forces status=pending regardless of client value', 'patient_a',
     v_actual_status, 'pending',
     case when v_actual_status = 'pending' then 'PASS' else 'FAIL' end);
  if v_actual_status <> 'pending' then
    raise exception 'GAP: a patient could set data_deletion_requests.status directly on insert (got %)', v_actual_status;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient_b::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_b_visible_count from public.data_deletion_requests where id = v_request_id;
  reset role;

  insert into dg_result values
    ('a different patient cannot read the request', 'patient_b', v_b_visible_count::text, '0',
     case when v_b_visible_count = 0 then 'PASS' else 'FAIL' end);
  if v_b_visible_count <> 0 then
    raise exception 'LEAK: patient_b reads another patient''s data_deletion_requests row';
  end if;
end $$;

-- ==========================================================================
-- 4/5. Patient cannot self-update; admin review stamps reviewed_by/at.
-- ==========================================================================
do $$
declare
  v_patient_a uuid := (select v from dg_fixture where k = 'patient_a');
  v_admin uuid := (select v from dg_fixture where k = 'admin');
  v_request_id uuid := (select v from dg_fixture where k = 'request_id');
  v_patient_update_rejected boolean := false;
  v_status_after_patient_attempt text;
  v_reviewed_by uuid;
  v_reviewed_at timestamptz;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient_a::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.data_deletion_requests set status = 'under_review' where id = v_request_id;
  exception when insufficient_privilege then
    v_patient_update_rejected := true;
  end;
  reset role;

  select status into v_status_after_patient_attempt from public.data_deletion_requests where id = v_request_id;

  insert into dg_result values
    ('patient cannot move their own request off pending', 'patient_a',
     case when v_patient_update_rejected then 'rejected (exception)' when v_status_after_patient_attempt = 'pending' then 'rejected (0 rows matched)' else 'allowed' end,
     'rejected',
     case when v_patient_update_rejected or v_status_after_patient_attempt = 'pending' then 'PASS' else 'FAIL' end);
  if not v_patient_update_rejected and v_status_after_patient_attempt <> 'pending' then
    raise exception 'GAP: a patient updated their own data_deletion_requests row -- review must be admin-only';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.data_deletion_requests set status = 'under_review' where id = v_request_id
  returning reviewed_by, reviewed_at into v_reviewed_by, v_reviewed_at;
  reset role;

  insert into dg_result values
    ('admin review stamps reviewed_by/reviewed_at', 'admin',
     format('%s/%s', v_reviewed_by::text, (v_reviewed_at is not null)::text), format('%s/true', v_admin::text),
     case when v_reviewed_by = v_admin and v_reviewed_at is not null then 'PASS' else 'FAIL' end);
  if v_reviewed_by is distinct from v_admin or v_reviewed_at is null then
    raise exception 'GAP: admin review did not stamp reviewed_by/reviewed_at correctly (got %/%)', v_reviewed_by, v_reviewed_at;
  end if;
end $$;

-- ==========================================================================
-- 6. Admin cannot set status='denied' without a decision_note -- the DB
-- itself enforces the workflow, not just the client UI.
-- ==========================================================================
do $$
declare
  v_admin uuid := (select v from dg_fixture where k = 'admin');
  v_request_id uuid := (select v from dg_fixture where k = 'request_id');
  v_denied_without_reason_rejected boolean := false;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.data_deletion_requests set status = 'denied', decision_note = null where id = v_request_id;
  exception when check_violation then
    v_denied_without_reason_rejected := true;
  end;
  reset role;

  insert into dg_result values
    ('admin cannot deny a request with no decision_note', 'admin',
     case when v_denied_without_reason_rejected then 'rejected (check_violation)' else 'allowed' end, 'rejected (check_violation)',
     case when v_denied_without_reason_rejected then 'PASS' else 'FAIL' end);
  if not v_denied_without_reason_rejected then
    raise exception 'GAP: data_deletion_requests was denied with no decision_note -- the CHECK constraint did not fire';
  end if;
end $$;

-- ==========================================================================
-- 7. A completed request is immutable, even to an admin.
-- ==========================================================================
do $$
declare
  v_admin uuid := (select v from dg_fixture where k = 'admin');
  v_request_id uuid := (select v from dg_fixture where k = 'request_id');
  v_edit_after_complete_rejected boolean := false;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.data_deletion_requests set status = 'completed', decision_note = 'DG test completion' where id = v_request_id;

  begin
    update public.data_deletion_requests set decision_note = 'trying to edit after completion' where id = v_request_id;
  exception when insufficient_privilege then
    v_edit_after_complete_rejected := true;
  end;
  reset role;

  insert into dg_result values
    ('a completed request is immutable, even to an admin', 'admin',
     case when v_edit_after_complete_rejected then 'rejected' else 'allowed' end, 'rejected',
     case when v_edit_after_complete_rejected then 'PASS' else 'FAIL' end);
  if not v_edit_after_complete_rejected then
    raise exception 'GAP: a completed data_deletion_requests row was edited further -- should be locked';
  end if;
end $$;

-- ==========================================================================
-- 8. regulatory_obligations / vendor_assessments: admin-only, no org-staff
-- carve-out.
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from dg_fixture where k = 'patient_a');
  v_admin uuid := (select v from dg_fixture where k = 'admin');
  v_patient_reg_count bigint;
  v_patient_vendor_count bigint;
  v_admin_reg_count bigint;
  v_admin_vendor_count bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_patient_reg_count from public.regulatory_obligations;
  select count(*) into v_patient_vendor_count from public.vendor_assessments;
  reset role;

  insert into dg_result values
    ('patient reads 0 regulatory_obligations rows', 'patient', v_patient_reg_count::text, '0',
     case when v_patient_reg_count = 0 then 'PASS' else 'FAIL' end);
  if v_patient_reg_count <> 0 then
    raise exception 'LEAK: a patient reads % regulatory_obligations row(s)', v_patient_reg_count;
  end if;

  insert into dg_result values
    ('patient reads 0 vendor_assessments rows', 'patient', v_patient_vendor_count::text, '0',
     case when v_patient_vendor_count = 0 then 'PASS' else 'FAIL' end);
  if v_patient_vendor_count <> 0 then
    raise exception 'LEAK: a patient reads % vendor_assessments row(s)', v_patient_vendor_count;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_admin_reg_count from public.regulatory_obligations;
  select count(*) into v_admin_vendor_count from public.vendor_assessments;
  reset role;

  insert into dg_result values
    ('admin reads the seeded regulatory_obligations rows', 'admin', v_admin_reg_count::text, '>= 10',
     case when v_admin_reg_count >= 10 then 'PASS' else 'FAIL' end);
  if v_admin_reg_count < 10 then
    raise exception 'GAP: admin reads only % regulatory_obligations rows -- seed looks incomplete or RLS is over-restricting', v_admin_reg_count;
  end if;

  insert into dg_result values
    ('admin reads the seeded vendor_assessments rows', 'admin', v_admin_vendor_count::text, '>= 5',
     case when v_admin_vendor_count >= 5 then 'PASS' else 'FAIL' end);
  if v_admin_vendor_count < 5 then
    raise exception 'GAP: admin reads only % vendor_assessments rows -- seed looks incomplete or RLS is over-restricting', v_admin_vendor_count;
  end if;
end $$;

-- ==========================================================================
-- 9. public.log_patient_data_export() attributes to the calling patient
-- only, not an arbitrary target.
-- ==========================================================================
do $$
declare
  v_patient_a uuid := (select v from dg_fixture where k = 'patient_a');
  v_logged_patient uuid;
  v_logged_kind text;
  v_before_count bigint;
  v_after_count bigint;
begin
  select count(*) into v_before_count from public.care_access_events
  where patient_id = v_patient_a and kind = 'data_exported';

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient_a::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.log_patient_data_export();
  reset role;

  select count(*) into v_after_count from public.care_access_events
  where patient_id = v_patient_a and kind = 'data_exported';

  select patient_id, kind::text into v_logged_patient, v_logged_kind from public.care_access_events
  where patient_id = v_patient_a and kind = 'data_exported'
  order by occurred_at desc limit 1;

  insert into dg_result values
    ('log_patient_data_export logs a data_exported event for the caller', 'patient_a',
     format('%s new row(s), kind=%s', v_after_count - v_before_count, v_logged_kind),
     '1 new row(s), kind=data_exported',
     case when v_after_count - v_before_count = 1 and v_logged_kind = 'data_exported' and v_logged_patient = v_patient_a then 'PASS' else 'FAIL' end);
  if v_after_count - v_before_count <> 1 or v_logged_kind is distinct from 'data_exported' then
    raise exception 'GAP: log_patient_data_export did not record a data_exported event for the calling patient';
  end if;
end $$;

-- ==========================================================================
-- 10. §87.16 compliance cascade: one notification per threshold crossing,
-- dedup prevents re-notification on re-run.
-- ==========================================================================
do $$
declare
  v_admin uuid := (select v from dg_fixture where k = 'admin');
  v_lab_id uuid;
  v_notify_count_first bigint;
  v_notify_count_second bigint;
  v_threshold_recorded integer;
  v_owner_notification_count bigint;
begin
  insert into public.lab_providers (name, is_active, license_expires_at, compliance_owner_profile_id, regions)
  values ('DG Test Lab Provider', true, now() + interval '20 days', v_admin, array['Lagos'])
  returning id into v_lab_id;

  perform private.queue_partner_license_expiry_alerts();

  select count(*) into v_notify_count_first from public.partner_license_expiry_notifications
  where partner_table = 'lab_providers' and partner_id = v_lab_id;

  select threshold_days into v_threshold_recorded from public.partner_license_expiry_notifications
  where partner_table = 'lab_providers' and partner_id = v_lab_id;

  insert into dg_result values
    ('cascade records one notification at threshold_days=30 for a 20-day-out licence', 'admin',
     format('%s row(s), threshold=%s', v_notify_count_first, v_threshold_recorded), '1 row(s), threshold=30',
     case when v_notify_count_first = 1 and v_threshold_recorded = 30 then 'PASS' else 'FAIL' end);
  if v_notify_count_first <> 1 or v_threshold_recorded is distinct from 30 then
    raise exception 'GAP: expected exactly one threshold_days=30 notification, got % row(s) with threshold=%', v_notify_count_first, v_threshold_recorded;
  end if;

  select count(*) into v_owner_notification_count from public.notifications
  where recipient_id = v_admin and template = 'partner_license_expiry'
    and payload->>'partner_id' = v_lab_id::text and (payload->>'as_compliance_owner')::boolean = true;

  insert into dg_result values
    ('compliance_owner_profile_id is notified directly', 'admin', v_owner_notification_count::text, '>= 1',
     case when v_owner_notification_count >= 1 then 'PASS' else 'FAIL' end);
  if v_owner_notification_count < 1 then
    raise exception 'GAP: the assigned compliance owner received no notification for their partner''s licence expiry';
  end if;

  -- Re-run: must NOT duplicate the threshold_days=30 notification.
  perform private.queue_partner_license_expiry_alerts();

  select count(*) into v_notify_count_second from public.partner_license_expiry_notifications
  where partner_table = 'lab_providers' and partner_id = v_lab_id;

  insert into dg_result values
    ('re-running the sweep does not duplicate the threshold notification', 'admin',
     v_notify_count_second::text, '1',
     case when v_notify_count_second = 1 then 'PASS' else 'FAIL' end);
  if v_notify_count_second <> 1 then
    raise exception 'GAP: re-running queue_partner_license_expiry_alerts duplicated the threshold_days=30 notification (% rows)', v_notify_count_second;
  end if;
end $$;

select check_name, role, observed, expected, verdict from dg_result order by verdict desc, check_name, role;

rollback;
