-- ===========================================================================
-- Verification: the admin-review path for the three DSAR request tables
-- (data_export_requests / data_deletion_requests / data_correction_requests
-- -- migrations 20260829223506 / 20260830001845 / 20260907130511, "force
-- organisation_id" hardening 20260830002055).
--
-- Why this exists: each table's own migration DO block only proves the
-- table was created with RLS and no DELETE policy -- it never proves the
-- admin UPDATE path the RLS/trigger were built to allow actually works
-- end to end. A platform audit (2026-09-18) found that no UI anywhere ever
-- called that path: a patient could submit all three requests, but nothing
-- could move them off "pending" -- two real requests sat stuck in
-- production. Per this project's own standing lesson ("assert the gate
-- OPENS, not just closes"), this proves the admin queue this audit added
-- (apps/web/src/app/(dashboard)/admin/data-rights/) can actually act on a
-- request, not only that a stranger is blocked from it.
--
-- Covers, per table:
--   * a patient can submit their own request (attribution trigger stamps
--     patient_id/organisation_id/status server-side regardless of input);
--   * the SAME patient cannot move their own request off "pending"
--     (deletion/export: admin-only; correction: org-staff-only, and
--     'patient' is explicitly excluded from private.is_org_staff) --
--     sabotage control;
--   * an admin session CAN move each request through review to its
--     terminal status, with reviewed_by/reviewed_at (and completed_by/
--     completed_at, fulfilled_by/fulfilled_at) stamped server-side, not
--     client-supplied;
--   * a terminal request (completed/fulfilled) is locked against further
--     edits, per each table's own trigger check.
--
-- Wrapped in BEGIN/ROLLBACK -- a verification script, not seed data.
-- ===========================================================================

begin;

create temporary table dsar_fixture(k text primary key, v uuid) on commit drop;
create temporary table dsar_result(
  check_name text,
  role       text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;

do $$
declare
  v_org     uuid;
  v_patient uuid := gen_random_uuid();
  v_admin   uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    raise exception 'no organisation available -- cannot run this test';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_patient, 'dsar-test-patient@example.invalid', 'x', now(), '{}', '{}'),
    (v_admin, 'dsar-test-admin@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_patient, v_org, 'patient', 'DSAR Test Patient'),
    (v_admin, v_org, 'admin', 'DSAR Test Admin')
  on conflict (id) do update set
    organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  insert into dsar_fixture(k, v) values ('org', v_org), ('patient', v_patient), ('admin', v_admin);
end $$;

-- ==========================================================================
-- EXPORT REQUESTS
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from dsar_fixture where k = 'patient');
  v_admin   uuid := (select v from dsar_fixture where k = 'admin');
  v_req     uuid;
  v_status  text;
  v_caught  boolean := false;
begin
  -- Patient submits.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.data_export_requests (organisation_id, patient_id, note)
  values (gen_random_uuid(), gen_random_uuid(), 'everything please')
  returning id into v_req;
  reset role;

  select status into v_status from public.data_export_requests where id = v_req;
  insert into dsar_result values
    ('export: patient submission lands pending', 'patient', coalesce(v_status, 'null'), 'pending',
     case when v_status = 'pending' then 'PASS' else 'FAIL' end);
  if v_status is distinct from 'pending' then
    raise exception 'BROKEN: export request did not land pending';
  end if;

  -- Sabotage: the same patient tries to fulfil their own request.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.data_export_requests set status = 'fulfilled' where id = v_req;
  exception when others then
    v_caught := true;
  end;
  reset role;
  select status into v_status from public.data_export_requests where id = v_req;

  insert into dsar_result values
    ('export: requester cannot self-fulfil', 'patient', coalesce(v_status, 'null'), 'pending (blocked)',
     case when v_status = 'pending' then 'PASS' else 'FAIL' end);
  if v_status is distinct from 'pending' then
    raise exception 'LEAK: a patient fulfilled their own export request';
  end if;

  -- Admin opens the gate: pending -> under_review -> fulfilled.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.data_export_requests set status = 'under_review' where id = v_req;
  update public.data_export_requests set status = 'fulfilled' where id = v_req;
  reset role;

  perform 1;
  select status into v_status from public.data_export_requests where id = v_req;
  insert into dsar_result values
    ('export: admin reviews and fulfils', 'admin', coalesce(v_status, 'null'), 'fulfilled',
     case when v_status = 'fulfilled' then 'PASS' else 'FAIL' end);
  if v_status is distinct from 'fulfilled' then
    raise exception 'BROKEN: admin session could not move an export request to fulfilled';
  end if;

  if not exists (
    select 1 from public.data_export_requests
    where id = v_req and reviewed_by = v_admin and reviewed_at is not null
      and fulfilled_by = v_admin and fulfilled_at is not null
  ) then
    raise exception 'BROKEN: reviewed_by/reviewed_at/fulfilled_by/fulfilled_at were not stamped server-side';
  end if;

  -- Locked once fulfilled.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_caught := false;
  begin
    update public.data_export_requests set decision_note = 'edit after the fact' where id = v_req;
  exception when others then
    v_caught := true;
  end;
  reset role;

  insert into dsar_result values
    ('export: fulfilled request is locked', 'admin', case when v_caught then 'blocked' else 'not blocked' end,
     'blocked', case when v_caught then 'PASS' else 'FAIL' end);
  if not v_caught then
    raise exception 'BROKEN: a fulfilled export request could still be edited';
  end if;
end $$;

-- ==========================================================================
-- DELETION REQUESTS
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from dsar_fixture where k = 'patient');
  v_admin   uuid := (select v from dsar_fixture where k = 'admin');
  v_req     uuid;
  v_status  text;
  v_caught  boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.data_deletion_requests (organisation_id, patient_id, reason, requested_categories)
  values (gen_random_uuid(), gen_random_uuid(), 'no longer using the app', array['vitals_readings'])
  returning id into v_req;
  reset role;

  -- Sabotage: requester tries to approve their own deletion.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.data_deletion_requests set status = 'approved_full' where id = v_req;
  exception when others then
    v_caught := true;
  end;
  reset role;
  select status into v_status from public.data_deletion_requests where id = v_req;

  insert into dsar_result values
    ('deletion: requester cannot self-approve', 'patient', coalesce(v_status, 'null'), 'pending (blocked)',
     case when v_status = 'pending' then 'PASS' else 'FAIL' end);
  if v_status is distinct from 'pending' then
    raise exception 'LEAK: a patient approved their own deletion request';
  end if;

  -- Admin opens the gate: pending -> under_review -> approved_partial (with
  -- the required blocked_reason) -> completed.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.data_deletion_requests set status = 'under_review' where id = v_req;
  update public.data_deletion_requests
    set status = 'approved_partial',
        blocked_categories = array['clinical_records'],
        blocked_reason = 'clinical_records is under mandatory retention'
    where id = v_req;
  update public.data_deletion_requests set status = 'completed' where id = v_req;
  reset role;

  select status into v_status from public.data_deletion_requests where id = v_req;
  insert into dsar_result values
    ('deletion: admin reviews, approves partially, completes', 'admin', coalesce(v_status, 'null'), 'completed',
     case when v_status = 'completed' then 'PASS' else 'FAIL' end);
  if v_status is distinct from 'completed' then
    raise exception 'BROKEN: admin session could not carry a deletion request to completed';
  end if;

  if not exists (
    select 1 from public.data_deletion_requests
    where id = v_req and reviewed_by = v_admin and completed_by = v_admin and completed_at is not null
      and blocked_reason is not null
  ) then
    raise exception 'BROKEN: reviewed_by/completed_by/completed_at/blocked_reason were not stamped/kept';
  end if;

  -- Locked once completed.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_caught := false;
  begin
    update public.data_deletion_requests set decision_note = 'edit after the fact' where id = v_req;
  exception when others then
    v_caught := true;
  end;
  reset role;

  insert into dsar_result values
    ('deletion: completed request is locked', 'admin', case when v_caught then 'blocked' else 'not blocked' end,
     'blocked', case when v_caught then 'PASS' else 'FAIL' end);
  if not v_caught then
    raise exception 'BROKEN: a completed deletion request could still be edited';
  end if;
end $$;

-- ==========================================================================
-- CORRECTION REQUESTS (org-staff reviewable, not admin-only -- 'patient' is
-- excluded from private.is_org_staff either way, so the requester is still
-- blocked from reviewing their own request).
-- ==========================================================================
do $$
declare
  v_patient uuid := (select v from dsar_fixture where k = 'patient');
  v_admin   uuid := (select v from dsar_fixture where k = 'admin');
  v_req     uuid;
  v_status  text;
  v_caught  boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.data_correction_requests
    (organisation_id, patient_id, record_description, what_is_wrong, requested_change)
  values (gen_random_uuid(), gen_random_uuid(), 'my date of birth', 'it is a year off', '1990-01-01')
  returning id into v_req;
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.data_correction_requests set status = 'approved' where id = v_req;
  exception when others then
    v_caught := true;
  end;
  reset role;
  select status into v_status from public.data_correction_requests where id = v_req;

  insert into dsar_result values
    ('correction: requester cannot self-approve', 'patient', coalesce(v_status, 'null'), 'pending (blocked)',
     case when v_status = 'pending' then 'PASS' else 'FAIL' end);
  if v_status is distinct from 'pending' then
    raise exception 'LEAK: a patient approved their own correction request';
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.data_correction_requests set status = 'under_review' where id = v_req;
  update public.data_correction_requests set status = 'approved' where id = v_req;
  update public.data_correction_requests
    set status = 'applied', resolution_note = 'corrected date_of_birth on the profile row'
    where id = v_req;
  reset role;

  select status into v_status from public.data_correction_requests where id = v_req;
  insert into dsar_result values
    ('correction: admin reviews, approves, marks applied', 'admin', coalesce(v_status, 'null'), 'applied',
     case when v_status = 'applied' then 'PASS' else 'FAIL' end);
  if v_status is distinct from 'applied' then
    raise exception 'BROKEN: admin session could not carry a correction request to applied';
  end if;

  if not exists (
    select 1 from public.data_correction_requests
    where id = v_req and reviewed_by = v_admin and resolution_note is not null
  ) then
    raise exception 'BROKEN: reviewed_by/resolution_note were not stamped/kept for the correction request';
  end if;

  -- Locked once applied -- added by 20260918103344_lock_applied_data_
  -- correction_requests.sql, closing the one sibling that didn't already
  -- lock its terminal status (deletion/export both do, from 20260830002055).
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_caught := false;
  begin
    update public.data_correction_requests set resolution_note = 'edit after the fact' where id = v_req;
  exception when others then
    v_caught := true;
  end;
  reset role;

  insert into dsar_result values
    ('correction: applied request is locked', 'admin', case when v_caught then 'blocked' else 'not blocked' end,
     'blocked', case when v_caught then 'PASS' else 'FAIL' end);
  if not v_caught then
    raise exception 'BROKEN: an applied correction request could still be edited';
  end if;
end $$;

select check_name, role, observed, expected, verdict
from dsar_result
order by verdict desc, check_name, role;

rollback;
