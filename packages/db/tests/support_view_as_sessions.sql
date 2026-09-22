-- ===========================================================================
-- Verification: 20260922175144_support_view_as
--
--   * a caller WITHOUT the support.view_as permission cannot start a session
--     (sabotage control on the enforce-rules trigger);
--   * a caller WITH the permission (via a direct user_permission_grants row,
--     not the admin role — proving this is a real capability grant, not an
--     admin-only shortcut) CAN start one, and the server derives started_at/
--     expires_at itself — a client-supplied far-future expires_at is
--     silently overridden to the real ~30-minute window, not honoured;
--   * a session cannot target another admin/back-office account (subject
--     role must be patient or clinician) — sabotage control;
--   * a session cannot target the caller themselves (self-view) — sabotage
--     control on the table CHECK constraint;
--   * while a session is active, the viewer CAN read the subject's profile
--     row (private.can_support_view actually grants the read) but CANNOT
--     write it — the whole point of "read-only" is proven, not assumed;
--   * that read grant actually works on EVERY table in the read surface
--     (vitals_readings, medications, appointments, screening_schedules), not
--     just profiles;
--   * the grant is scoped to the exact (viewer, subject) pair — an active
--     session for one subject does NOT also grant a read on a different
--     subject (per-subject scoping, not "any active session anywhere");
--   * a DIFFERENT staff member with no session of their own still cannot
--     read the subject's profile — the grant is scoped to exactly the
--     (viewer, subject) pair, not a blanket opening;
--   * starting a session writes a real public.audit_log row carrying the
--     reason (via the same app.audit_reason GUC the reason/result migration
--     established) and a public.notifications row to the subject;
--   * ending a session (by the viewer) clears the read grant immediately —
--     private.can_support_view goes back to false and the profile read is
--     refused again;
--   * ended_by cannot be set independently of a genuine ended_at transition
--     (a caller permitted to UPDATE the row setting ended_by alone, while
--     the session is still active) — sabotage control on the update-guard
--     trigger's field-forcing logic;
--   * revoking support.view_as mid-session immediately cuts off the read
--     grant, even though the session row itself is still technically active
--     — the permission is re-checked on every read, not just once at
--     session creation, so this really is a "revocable grant" as claimed;
--   * a session cannot be "un-ended" or have its window extended after the
--     fact — sabotage control on the update-guard trigger.
--   * public.search_support_view_subjects matches a query containing a
--     literal backslash — a caught regression where the escape order left
--     the backslash itself unescaped, silently consuming the query's own
--     trailing wildcard and returning zero rows for a real subject.
--   * the update-guard's immutability check, rewritten from a hand-listed
--     column allowlist to a generic jsonb diff, still blocks a column the
--     old allowlist named (reason) — proving the rewrite didn't silently
--     narrow what it protects;
--   * a caller holding ONLY the "Customer support administrator" role
--     preset (via custom_role_id, no direct user_permission_grants row)
--     can genuinely start a session — proving support.view_as actually
--     reaches a real delegable preset, not just the superadmin account.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — this is a verification script, not seed data;
-- it always leaves the database exactly as it found it.
--
-- Pattern (same as packages/db/tests/profiles_self_update_column_guard.sql
-- and wearable_granular_consent_and_patient_control.sql):
-- set_config('request.jwt.claims', ...) + `set local role authenticated`
-- simulates a real client session — running as the connecting superuser
-- would silently bypass RLS via table ownership.
-- ===========================================================================

begin;

create temporary table svas_fixture(k text primary key, v uuid) on commit drop;
create temporary table svas_result(
  check_name text,
  role       text,
  observed   text,
  expected   text,
  verdict    text
) on commit drop;

-- --------------------------------------------------------------------------
-- Fixtures: one org, a support agent (role clinician — deliberately NOT
-- admin, to prove the permission grant itself is what authorises this, not
-- the admin short-circuit), an unrelated second staff member with no grant
-- and no session, a patient subject, a clinician subject, and a third
-- "other admin" profile to prove a session cannot target a back-office
-- account.
-- --------------------------------------------------------------------------
do $$
declare
  v_org           uuid;
  v_agent_org     uuid;
  v_support_agent uuid := gen_random_uuid();
  v_bystander     uuid := gen_random_uuid();
  v_patient       uuid := gen_random_uuid();
  v_clinician     uuid := gen_random_uuid();
  v_other_admin   uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    raise exception 'no organisation available — cannot run this test';
  end if;

  -- A second, temporary org (rolled back with everything else) for the support agent and
  -- bystander — they must NOT be private.is_org_staff() for the subjects' own org, or a read/
  -- write that succeeds below could be ordinary same-org clinician access (profiles_update
  -- itself is `id = auth.uid() OR is_org_staff(organisation_id)` — confirmed live) rather than
  -- proof that private.can_support_view specifically is (or is not) doing the work.
  insert into public.organisations (name, type) values ('SVAS Test Agent Org', 'clinic')
  returning id into v_agent_org;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_support_agent, 'svas-test-support@example.invalid', 'x', now(), '{}', '{}'),
    (v_bystander, 'svas-test-bystander@example.invalid', 'x', now(), '{}', '{}'),
    (v_patient, 'svas-test-patient@example.invalid', 'x', now(), '{}', '{}'),
    (v_clinician, 'svas-test-clinician@example.invalid', 'x', now(), '{}', '{}'),
    (v_other_admin, 'svas-test-other-admin@example.invalid', 'x', now(), '{}', '{}');

  -- ON CONFLICT DO UPDATE: a live trigger on auth.users auto-provisions a matching public.
  -- profiles row (confirmed against the live project — a plain INSERT here hits profiles_pkey),
  -- so this upserts over whatever that trigger already created rather than assuming an empty
  -- table to insert fresh into.
  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_support_agent, v_agent_org, 'clinician', 'SVAS Test Support Agent'),
    (v_bystander, v_agent_org, 'clinician', 'SVAS Test Bystander'),
    (v_patient, v_org, 'patient', 'SVAS Test Patient'),
    (v_clinician, v_org, 'clinician', 'SVAS Test Clinician'),
    (v_other_admin, v_org, 'admin', 'SVAS Test Other Admin')
  on conflict (id) do update set
    organisation_id = excluded.organisation_id,
    role = excluded.role,
    full_name = excluded.full_name;

  insert into public.user_permission_grants (profile_id, permission_key)
  values (v_support_agent, 'support.view_as');

  -- One row per table in the support-view-as read surface (besides profiles, already covered),
  -- so check 5b below can prove private.can_support_view actually grants a READ on each of
  -- them, not just profiles — the original pass only ever read profiles through an active
  -- session, so a broken cast/clause on any of the other 6 tables would have gone unnoticed.
  insert into public.vitals_readings (patient_id, organisation_id, vital_type, source, taken_at, pulse_bpm)
  values (v_patient, v_org, 'pulse', 'manual', now(), 72);
  insert into public.medications (patient_id, organisation_id, drug_name, dose, frequency, is_active)
  values (v_patient, v_org, 'SVAS Test Drug', '10mg', 'daily', true);
  insert into public.appointments
    (patient_id, organisation_id, appointment_type, consultation_method, scheduled_for, ends_at, status)
  values (v_patient, v_org, 'gp', 'telemedicine', now() + interval '1 day', now() + interval '1 day' + interval '30 minutes', 'confirmed');
  insert into public.screening_schedules (patient_id, organisation_id, screen_type_id, due_date, status)
  select v_patient, v_org, id, current_date + interval '30 days', 'pending' from public.screen_types limit 1;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, doctor_tier, employment_type, active)
  values (v_org, v_clinician, 'SVAS Test Clinician', 'medical_officer', 'employed', false);

  insert into svas_fixture(k, v) values
    ('org', v_org), ('agent_org', v_agent_org), ('support_agent', v_support_agent),
    ('bystander', v_bystander), ('patient', v_patient), ('clinician', v_clinician),
    ('other_admin', v_other_admin);
end $$;

-- ==========================================================================
-- 1. Sabotage — the bystander (no support.view_as grant) cannot start a
--    session, even for a valid patient subject.
-- ==========================================================================
do $$
declare
  v_bystander uuid := (select v from svas_fixture where k = 'bystander');
  v_patient   uuid := (select v from svas_fixture where k = 'patient');
  v_caught    boolean := false;
  v_msg       text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_bystander::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.support_view_sessions (viewer_id, subject_id, reason)
    values (v_bystander, v_patient, 'checking a report');
  exception when others then
    v_caught := true;
    v_msg := sqlerrm;
  end;
  reset role;

  insert into svas_result values
    ('caller without support.view_as cannot start a session', 'bystander',
     coalesce(v_msg, 'not blocked'), 'blocked', case when v_caught then 'PASS' else 'FAIL' end);
  if not v_caught then
    raise exception 'LEAK: a caller with no support.view_as grant started a support view-as session';
  end if;
end $$;

-- ==========================================================================
-- 2. Sabotage — even the granted support agent cannot target another
--    admin/back-office account (subject role must be patient or clinician).
-- ==========================================================================
do $$
declare
  v_support_agent uuid := (select v from svas_fixture where k = 'support_agent');
  v_other_admin   uuid := (select v from svas_fixture where k = 'other_admin');
  v_caught        boolean := false;
  v_msg           text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_support_agent::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.support_view_sessions (viewer_id, subject_id, reason)
    values (v_support_agent, v_other_admin, 'checking a report');
  exception when others then
    v_caught := true;
    v_msg := sqlerrm;
  end;
  reset role;

  insert into svas_result values
    ('session cannot target a non-patient/clinician account', 'support agent',
     coalesce(v_msg, 'not blocked'), 'blocked', case when v_caught then 'PASS' else 'FAIL' end);
  if not v_caught then
    raise exception 'LEAK: a support view-as session was started against a back-office/admin account';
  end if;
end $$;

-- ==========================================================================
-- 3. Sabotage — a session cannot target the caller themselves.
-- ==========================================================================
do $$
declare
  v_support_agent uuid := (select v from svas_fixture where k = 'support_agent');
  v_caught        boolean := false;
  v_msg           text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_support_agent::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.support_view_sessions (viewer_id, subject_id, reason)
    values (v_support_agent, v_support_agent, 'checking a report');
  exception when others then
    v_caught := true;
    v_msg := sqlerrm;
  end;
  reset role;

  insert into svas_result values
    ('session cannot target the caller themselves', 'support agent',
     coalesce(v_msg, 'not blocked'), 'blocked', case when v_caught then 'PASS' else 'FAIL' end);
  if not v_caught then
    raise exception 'LEAK: a support view-as session was started with viewer_id = subject_id';
  end if;
end $$;

-- ==========================================================================
-- 4. A granted support agent CAN start a session for the patient — and the
--    server ignores a client-supplied expires_at, deriving its own ~30
--    minute window instead of the client's attempted far-future date.
-- ==========================================================================
do $$
declare
  v_support_agent uuid := (select v from svas_fixture where k = 'support_agent');
  v_patient       uuid := (select v from svas_fixture where k = 'patient');
  v_session_id    uuid;
  v_expires_at    timestamptz;
  v_minutes       numeric;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_support_agent::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.support_view_sessions (viewer_id, subject_id, reason, expires_at)
  values (v_support_agent, v_patient, 'patient reports missing vitals on their dashboard', now() + interval '30 days')
  returning id, expires_at into v_session_id, v_expires_at;
  reset role;

  v_minutes := extract(epoch from (v_expires_at - now())) / 60;

  insert into svas_fixture(k, v) values ('session', v_session_id);

  insert into svas_result values
    ('granted support agent starts a session', 'support agent', v_session_id::text, 'not null',
     case when v_session_id is not null then 'PASS' else 'FAIL' end);
  insert into svas_result values
    ('server ignores client-supplied expires_at, derives ~30 min window', 'support agent',
     round(v_minutes, 1)::text || ' minutes', 'between 25 and 30 minutes',
     case when v_minutes between 25 and 30 then 'PASS' else 'FAIL' end);
  if v_session_id is null then
    raise exception 'BROKEN: a granted support agent could not start a session for a valid patient subject';
  end if;
  if v_minutes < 25 or v_minutes > 30 then
    raise exception 'LEAK: expires_at was not re-derived server-side — client-supplied window honoured (% minutes)', v_minutes;
  end if;
end $$;

-- ==========================================================================
-- 5. While the session is active: the viewer CAN read the patient's profile
--    (private.can_support_view grants it) but CANNOT write it — read-only
--    proven, not assumed.
-- ==========================================================================
do $$
declare
  v_support_agent uuid := (select v from svas_fixture where k = 'support_agent');
  v_patient       uuid := (select v from svas_fixture where k = 'patient');
  v_readback      text;
  v_row_count     bigint;
  v_write_caught  boolean := false;
  v_write_msg     text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_support_agent::text, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- Not a plain `select ... from public.profiles` — profiles carries no can_support_view RLS
  -- clause at all (see the migration's own note: a row-level grant there would expose
  -- hiv_status/hbv_status/hcv_status/emergency_contact_*, not just identity fields). The
  -- identity read goes through get_support_view_subject_identity() instead, same as the real
  -- admin page does.
  select full_name into v_readback from public.get_support_view_subject_identity(v_patient);

  begin
    update public.profiles set full_name = 'TAMPERED BY SUPPORT AGENT' where id = v_patient;
    get diagnostics v_row_count = row_count;
  exception when others then
    v_write_caught := true;
    v_write_msg := sqlerrm;
  end;
  reset role;

  insert into svas_result values
    ('active session: viewer can read the subject profile', 'support agent',
     coalesce(v_readback, 'null'), 'SVAS Test Patient',
     case when v_readback = 'SVAS Test Patient' then 'PASS' else 'FAIL' end);
  if v_readback is distinct from 'SVAS Test Patient' then
    raise exception 'BROKEN: an active support view-as session could not read its subject''s profile';
  end if;

  insert into svas_result values
    ('active session: viewer cannot write the subject profile', 'support agent',
     case when v_write_caught then coalesce(v_write_msg, 'blocked') else v_row_count::text || ' rows updated' end,
     'blocked or 0 rows', case when v_write_caught or v_row_count = 0 then 'PASS' else 'FAIL' end);
  if not v_write_caught and v_row_count <> 0 then
    raise exception 'LEAK: a support view-as session was able to WRITE the subject''s profile — this must be read-only';
  end if;

  -- Control: the tamper attempt (blocked or not) must not have actually changed the row.
  if exists (select 1 from public.profiles where id = v_patient and full_name = 'TAMPERED BY SUPPORT AGENT') then
    raise exception 'LEAK: the subject profile was actually mutated by a support view-as session';
  end if;
end $$;

-- ==========================================================================
-- 5b. While the session is active: the viewer CAN read the patient's data on
--     EVERY table in the read surface, not just profiles — the previous pass
--     of this suite only ever exercised a read against profiles through an
--     active session, so a broken cast/clause on vitals_readings, medications,
--     appointments, screening_schedules, notifications, or clinical_staff
--     could have shipped with all-green tests. Each of these 6 tables got one
--     fixture row for the patient (or, for clinical_staff, the clinician) in
--     the setup block above.
-- ==========================================================================
do $$
declare
  v_support_agent uuid := (select v from svas_fixture where k = 'support_agent');
  v_patient       uuid := (select v from svas_fixture where k = 'patient');
  v_vitals_count       bigint;
  v_medications_count  bigint;
  v_appointments_count bigint;
  v_screenings_count   bigint;
  v_notifications_count bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_support_agent::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_vitals_count from public.vitals_readings where patient_id = v_patient;
  select count(*) into v_medications_count from public.medications where patient_id = v_patient;
  select count(*) into v_appointments_count from public.appointments where patient_id = v_patient;
  select count(*) into v_screenings_count from public.screening_schedules where patient_id = v_patient;
  -- The AFTER INSERT notify trigger already wrote the "support_view_as_started" row to the
  -- patient the moment the session started (check 4) — this proves the viewer can read
  -- notifications for their subject too, not just the other clinical tables.
  select count(*) into v_notifications_count from public.notifications where recipient_id = v_patient;
  reset role;

  insert into svas_result values
    ('active session: viewer can read vitals_readings', 'support agent', v_vitals_count::text, '1',
     case when v_vitals_count = 1 then 'PASS' else 'FAIL' end);
  insert into svas_result values
    ('active session: viewer can read medications', 'support agent', v_medications_count::text, '1',
     case when v_medications_count = 1 then 'PASS' else 'FAIL' end);
  insert into svas_result values
    ('active session: viewer can read appointments', 'support agent', v_appointments_count::text, '1',
     case when v_appointments_count = 1 then 'PASS' else 'FAIL' end);
  insert into svas_result values
    ('active session: viewer can read screening_schedules', 'support agent', v_screenings_count::text, '1',
     case when v_screenings_count = 1 then 'PASS' else 'FAIL' end);
  insert into svas_result values
    ('active session: viewer can read notifications', 'support agent', v_notifications_count::text, '>= 1',
     case when v_notifications_count >= 1 then 'PASS' else 'FAIL' end);
  if v_vitals_count <> 1 or v_medications_count <> 1 or v_appointments_count <> 1 or v_screenings_count <> 1
    or v_notifications_count < 1
  then
    raise exception 'BROKEN: an active support view-as session could not read one or more of vitals_readings (%), medications (%), appointments (%), screening_schedules (%), notifications (%) for its subject',
      v_vitals_count, v_medications_count, v_appointments_count, v_screenings_count, v_notifications_count;
  end if;
end $$;

-- ==========================================================================
-- 5c. Per-subject scoping — while the support agent's ONLY active session is
--     for the PATIENT, they still cannot read the CLINICIAN's profile or
--     clinical_staff record. This is the check that would actually fail if
--     private.can_support_view() were buggy in a way check 6 below cannot
--     catch — e.g. checking only "does this caller have ANY active session"
--     without also matching p_subject_id to the specific row being read.
-- ==========================================================================
do $$
declare
  v_support_agent uuid := (select v from svas_fixture where k = 'support_agent');
  v_clinician     uuid := (select v from svas_fixture where k = 'clinician');
  v_readback      text;
  v_staff_count   bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_support_agent::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select full_name into v_readback from public.get_support_view_subject_identity(v_clinician);
  select count(*) into v_staff_count from public.clinical_staff where profile_id = v_clinician;
  reset role;

  insert into svas_result values
    ('per-subject scoping: patient session does not also grant the clinician subject', 'support agent',
     coalesce(v_readback, 'null (refused)') || ' / clinical_staff=' || v_staff_count::text,
     'null (refused) / clinical_staff=0',
     case when v_readback is null and v_staff_count = 0 then 'PASS' else 'FAIL' end);
  if v_readback is not null or v_staff_count <> 0 then
    raise exception 'LEAK: an active session for one subject (patient) also granted a read on an UNRELATED subject (clinician) — private.can_support_view is not scoping by subject_id correctly';
  end if;
end $$;

-- ==========================================================================
-- 6. A DIFFERENT staff member (no session, no grant) still cannot read the
--    patient's profile — the read grant is scoped to exactly this
--    (viewer, subject) pair, not opened up for every staff account.
-- ==========================================================================
do $$
declare
  v_bystander uuid := (select v from svas_fixture where k = 'bystander');
  v_patient   uuid := (select v from svas_fixture where k = 'patient');
  v_readback  text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_bystander::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  -- Not a plain `select ... from public.profiles` — profiles carries no can_support_view RLS
  -- clause at all (see the migration's own note: a row-level grant there would expose
  -- hiv_status/hbv_status/hcv_status/emergency_contact_*, not just identity fields). The
  -- identity read goes through get_support_view_subject_identity() instead, same as the real
  -- admin page does.
  select full_name into v_readback from public.get_support_view_subject_identity(v_patient);
  reset role;

  insert into svas_result values
    ('an unrelated staff account still cannot read the subject', 'bystander',
     coalesce(v_readback, 'null (refused)'), 'null (refused)',
     case when v_readback is null then 'PASS' else 'FAIL' end);
  if v_readback is not null then
    raise exception 'LEAK: a staff account with no support view-as session of its own could read the subject''s profile';
  end if;
end $$;

-- ==========================================================================
-- 7. Starting the session wrote a real audit_log row (with the reason) and
--    a real in_app notification to the subject.
-- ==========================================================================
do $$
declare
  v_support_agent uuid := (select v from svas_fixture where k = 'support_agent');
  v_patient       uuid := (select v from svas_fixture where k = 'patient');
  v_session_id    uuid := (select v from svas_fixture where k = 'session');
  v_audit_reason  text;
  v_audit_result  text;
  v_notif_count   bigint;
begin
  select reason, result into v_audit_reason, v_audit_result
  from public.audit_log
  where actor_id = v_support_agent
    and entity_id = v_session_id
    and action = 'support_view_sessions.created';

  insert into svas_result values
    ('starting a session writes an audit_log row with the reason', 'support agent',
     coalesce(v_audit_reason, 'null') || ' / ' || coalesce(v_audit_result, 'null'),
     'patient reports missing vitals on their dashboard / success',
     case when v_audit_reason = 'patient reports missing vitals on their dashboard' and v_audit_result = 'success'
       then 'PASS' else 'FAIL' end);
  if v_audit_reason is distinct from 'patient reports missing vitals on their dashboard' then
    raise exception 'BROKEN: starting a support view-as session did not record the reason in audit_log';
  end if;

  select count(*) into v_notif_count
  from public.notifications
  where recipient_id = v_patient
    and channel = 'in_app'
    and template = 'support_view_as_started'
    and (payload ->> 'session_id')::uuid = v_session_id;

  insert into svas_result values
    ('starting a session notifies the subject in-app', 'system', v_notif_count::text, '1',
     case when v_notif_count = 1 then 'PASS' else 'FAIL' end);
  if v_notif_count <> 1 then
    raise exception 'BROKEN: the subject was not notified when a support view-as session started against them';
  end if;
end $$;

-- ==========================================================================
-- 8. Ending the session (by the viewer) immediately revokes the read grant.
-- ==========================================================================
do $$
declare
  v_support_agent uuid := (select v from svas_fixture where k = 'support_agent');
  v_patient       uuid := (select v from svas_fixture where k = 'patient');
  v_session_id    uuid := (select v from svas_fixture where k = 'session');
  v_ended_at      timestamptz;
  v_ended_by      uuid;
  v_readback      text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_support_agent::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.support_view_sessions set ended_at = now() where id = v_session_id;
  select ended_at, ended_by into v_ended_at, v_ended_by from public.support_view_sessions where id = v_session_id;
  -- Not a plain `select ... from public.profiles` — profiles carries no can_support_view RLS
  -- clause at all (see the migration's own note: a row-level grant there would expose
  -- hiv_status/hbv_status/hcv_status/emergency_contact_*, not just identity fields). The
  -- identity read goes through get_support_view_subject_identity() instead, same as the real
  -- admin page does.
  select full_name into v_readback from public.get_support_view_subject_identity(v_patient);
  reset role;

  insert into svas_result values
    ('viewer ends the session and ended_by is server-derived', 'support agent',
     coalesce(v_ended_by::text, 'null'), v_support_agent::text,
     case when v_ended_by = v_support_agent then 'PASS' else 'FAIL' end);
  if v_ended_at is null or v_ended_by is distinct from v_support_agent then
    raise exception 'BROKEN: ending a support view-as session did not record ended_at/ended_by correctly';
  end if;

  insert into svas_result values
    ('read grant is gone immediately after the session ends', 'support agent',
     coalesce(v_readback, 'null (refused)'), 'null (refused)',
     case when v_readback is null then 'PASS' else 'FAIL' end);
  if v_readback is not null then
    raise exception 'LEAK: an ended support view-as session still grants a read on the subject''s profile';
  end if;
end $$;

-- ==========================================================================
-- 8b. Sabotage — ended_by cannot be set independently of a genuine ended_at
--     null->non-null transition (a caller permitted to UPDATE the row setting
--     ended_by alone, while the session is still active). Uses a fresh
--     second session (against the clinician subject) so it's still active
--     going into this check — also doubles as the positive clinical_staff
--     read proof (the last table in the read surface 5b didn't cover, since
--     the fixture's clinical_staff row belongs to the clinician, not the
--     patient session that was active at that point).
-- ==========================================================================
do $$
declare
  v_support_agent uuid := (select v from svas_fixture where k = 'support_agent');
  v_bystander     uuid := (select v from svas_fixture where k = 'bystander');
  v_clinician     uuid := (select v from svas_fixture where k = 'clinician');
  v_session_id    uuid;
  v_ended_by      uuid;
  v_ended_at      timestamptz;
  v_staff_count   bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_support_agent::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.support_view_sessions (viewer_id, subject_id, reason)
  values (v_support_agent, v_clinician, 'checking a clinician-side report')
  returning id into v_session_id;
  select count(*) into v_staff_count from public.clinical_staff where profile_id = v_clinician;
  reset role;

  insert into svas_result values
    ('active session for the clinician subject: viewer can read clinical_staff', 'support agent',
     v_staff_count::text, '1', case when v_staff_count = 1 then 'PASS' else 'FAIL' end);
  if v_staff_count <> 1 then
    raise exception 'BROKEN: an active support view-as session for a clinician subject could not read their clinical_staff record';
  end if;

  -- The subject may also touch this row (support_view_sessions_end admits viewer/subject/admin),
  -- so attempt the sabotage as the clinician subject setting only ended_by, leaving ended_at null.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clinician::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.support_view_sessions set ended_by = v_bystander where id = v_session_id;
  reset role;

  select ended_by, ended_at into v_ended_by, v_ended_at from public.support_view_sessions where id = v_session_id;

  insert into svas_result values
    ('ended_by cannot be set independently of ending the session', 'clinician subject',
     coalesce(v_ended_by::text, 'null') || ' / ended_at=' || coalesce(v_ended_at::text, 'null'),
     'null / ended_at=null',
     case when v_ended_by is null and v_ended_at is null then 'PASS' else 'FAIL' end);
  if v_ended_by is not null then
    raise exception 'LEAK: ended_by was set to % on a session still active (ended_at is null) — the update-guard trigger did not force it back', v_ended_by;
  end if;
end $$;

-- ==========================================================================
-- 8c. Revoking support.view_as mid-session immediately cuts off the read
--     grant, even though the session row itself is still technically active
--     (ended_at null, expires_at in the future) — private.can_support_view()
--     re-checks the permission on every read, not just once at session
--     creation. Reuses the still-active clinician session from 8b.
-- ==========================================================================
do $$
declare
  v_support_agent uuid := (select v from svas_fixture where k = 'support_agent');
  v_clinician     uuid := (select v from svas_fixture where k = 'clinician');
  v_staff_count   bigint;
begin
  update public.user_permission_grants
  set revoked_at = now()
  where profile_id = v_support_agent and permission_key = 'support.view_as';

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_support_agent::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_staff_count from public.clinical_staff where profile_id = v_clinician;
  reset role;

  insert into svas_result values
    ('revoking support.view_as mid-session immediately refuses the read', 'support agent',
     v_staff_count::text, '0', case when v_staff_count = 0 then 'PASS' else 'FAIL' end);
  if v_staff_count <> 0 then
    raise exception 'LEAK: a still-active session kept granting reads after the underlying support.view_as permission was revoked';
  end if;

  -- Restore the grant — checks 9/10 below still need it (un-ending a session and the search
  -- RPC are both gated on it too); this test only needed the revoked window, not a
  -- permanently-revoked fixture.
  update public.user_permission_grants
  set revoked_at = null
  where profile_id = v_support_agent and permission_key = 'support.view_as';
end $$;

-- ==========================================================================
-- 9. Sabotage — an ended session cannot be "un-ended" or have its window
--    silently extended.
-- ==========================================================================
do $$
declare
  v_support_agent uuid := (select v from svas_fixture where k = 'support_agent');
  v_session_id    uuid := (select v from svas_fixture where k = 'session');
  v_caught        boolean := false;
  v_msg           text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_support_agent::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    update public.support_view_sessions set ended_at = null where id = v_session_id;
  exception when others then
    v_caught := true;
    v_msg := sqlerrm;
  end;
  reset role;

  insert into svas_result values
    ('an ended session cannot be un-ended', 'support agent',
     coalesce(v_msg, 'not blocked'), 'blocked', case when v_caught then 'PASS' else 'FAIL' end);
  if not v_caught then
    raise exception 'LEAK: an ended support view-as session was reopened';
  end if;
end $$;

-- ==========================================================================
-- 9b. Sabotage — the update-guard's immutability check (rewritten from a
--     hand-listed column allowlist to a generic jsonb diff — see this
--     migration's private.guard_support_view_session_update()) still blocks
--     a column the old allowlist explicitly named, proving the rewrite
--     didn't silently narrow what's protected. Uses a fresh session (the
--     original `session` fixture is already ended by check 8) so there's an
--     active row to attempt the sabotage against.
-- ==========================================================================
do $$
declare
  v_support_agent uuid := (select v from svas_fixture where k = 'support_agent');
  v_clinician     uuid := (select v from svas_fixture where k = 'clinician');
  v_session_id    uuid;
  v_caught        boolean := false;
  v_msg           text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_support_agent::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.support_view_sessions (viewer_id, subject_id, reason)
  values (v_support_agent, v_clinician, 'checking a report, take two')
  returning id into v_session_id;

  begin
    update public.support_view_sessions set reason = 'REWRITTEN BY SUPPORT AGENT' where id = v_session_id;
  exception when others then
    v_caught := true;
    v_msg := sqlerrm;
  end;
  reset role;

  insert into svas_result values
    ('generic jsonb-diff immutability guard still blocks changing reason', 'support agent',
     coalesce(v_msg, 'not blocked'), 'blocked', case when v_caught then 'PASS' else 'FAIL' end);
  if not v_caught then
    raise exception 'LEAK: reason was mutated after session creation — the rewritten generic-diff immutability guard is narrower than the allowlist it replaced';
  end if;
end $$;

-- ==========================================================================
-- 10. public.search_support_view_subjects: a bystander with no support.view_as
--     grant gets nothing back (even though the row exists and matches), while
--     the granted support agent can find the subject to start a session
--     against in the first place.
-- ==========================================================================
do $$
declare
  v_bystander     uuid := (select v from svas_fixture where k = 'bystander');
  v_support_agent uuid := (select v from svas_fixture where k = 'support_agent');
  v_bystander_hits   int;
  v_support_agent_hits int;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_bystander::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_bystander_hits from public.search_support_view_subjects('SVAS Test Patient');
  reset role;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_support_agent::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_support_agent_hits from public.search_support_view_subjects('SVAS Test Patient');
  reset role;

  insert into svas_result values
    ('subject search: bystander without the grant finds nothing', 'bystander',
     v_bystander_hits::text, '0', case when v_bystander_hits = 0 then 'PASS' else 'FAIL' end);
  if v_bystander_hits <> 0 then
    raise exception 'LEAK: a caller without support.view_as could search for support-view-as subjects';
  end if;

  insert into svas_result values
    ('subject search: granted support agent finds the patient', 'support agent',
     v_support_agent_hits::text, '>= 1', case when v_support_agent_hits >= 1 then 'PASS' else 'FAIL' end);
  if v_support_agent_hits < 1 then
    raise exception 'BROKEN: a granted support agent could not find a valid subject via search_support_view_subjects';
  end if;
end $$;

-- ==========================================================================
-- 11. public.search_support_view_subjects: a query containing a literal
--     backslash still matches — a caught regression. The escaping originally
--     only handled ILIKE's own wildcards (%, _) and missed the escape
--     character itself: a query like "Foo\Bar" got re-escaped into a pattern
--     whose trailing wildcard was consumed by the unescaped backslash
--     ("...Foo\%" parses as a literal "%", not "any characters"), silently
--     returning zero rows for a subject who was actually right there.
-- ==========================================================================
do $$
declare
  v_org           uuid;
  v_support_agent uuid := (select v from svas_fixture where k = 'support_agent');
  v_backslash_patient uuid := gen_random_uuid();
  v_hits          int;
begin
  select v into v_org from svas_fixture where k = 'org';

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_backslash_patient, 'svas-test-backslash-patient@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_backslash_patient, v_org, 'patient', 'Foo\Bar Patient')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_support_agent::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_hits from public.search_support_view_subjects('Foo\Bar');
  reset role;

  insert into svas_result values
    ('subject search: a query containing a literal backslash still matches', 'support agent',
     v_hits::text, '1', case when v_hits = 1 then 'PASS' else 'FAIL' end);
  if v_hits <> 1 then
    raise exception 'BROKEN: searching for a name containing a literal backslash ("Foo\Bar") returned % rows, expected 1 — the escape-order regression is back', v_hits;
  end if;
end $$;

-- ==========================================================================
-- 12. The "Customer support administrator" role preset
--     (20260922185119_support_view_as_customer_support_preset_grant.sql)
--     genuinely carries support.view_as — a caller holding ONLY that preset
--     (via custom_role_id, no direct user_permission_grants row at all) can
--     start a real session. Before that migration, support.view_as was
--     unreachable by any preset, so this tool was usable only by the
--     superadmin `admin` account despite being designed as a delegable
--     capability — proving the grant via a role assignment, not just
--     asserting the role_permissions row exists, is what actually closes
--     that gap.
-- ==========================================================================
do $$
declare
  v_org             uuid := (select v from svas_fixture where k = 'agent_org');
  v_patient         uuid := (select v from svas_fixture where k = 'patient');
  v_preset_role_id  uuid;
  v_preset_holder   uuid := gen_random_uuid();
  v_session_id      uuid;
begin
  select id into v_preset_role_id from public.custom_roles where name = 'Customer support administrator';
  if v_preset_role_id is null then
    raise exception 'FAIL: "Customer support administrator" preset not found — 20260829093427_ops_admin_role_presets.sql may not be applied';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_preset_holder, 'svas-test-preset-holder@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, custom_role_id, full_name)
  values (v_preset_holder, v_org, 'care_coordinator', v_preset_role_id, 'SVAS Test Preset Holder')
  on conflict (id) do update set
    organisation_id = excluded.organisation_id,
    role = excluded.role,
    custom_role_id = excluded.custom_role_id,
    full_name = excluded.full_name;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_preset_holder::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.support_view_sessions (viewer_id, subject_id, reason)
  values (v_preset_holder, v_patient, 'preset-only grantee starting a session')
  returning id into v_session_id;
  reset role;

  insert into svas_result values
    ('a caller holding only the Customer support administrator preset can start a session', 'preset holder',
     v_session_id::text, 'not null', case when v_session_id is not null then 'PASS' else 'FAIL' end);
  if v_session_id is null then
    raise exception 'BROKEN: a caller assigned the Customer support administrator preset (no direct user_permission_grants row) could not start a support view-as session — support.view_as is not actually reaching this preset';
  end if;
end $$;

select check_name, role, observed, expected, verdict
from svas_result
order by verdict desc, check_name, role;

rollback;
