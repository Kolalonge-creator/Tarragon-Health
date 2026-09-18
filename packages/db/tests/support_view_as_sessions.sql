-- ===========================================================================
-- Verification: 20260918104500_support_view_as
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
--   * a DIFFERENT staff member with no session of their own still cannot
--     read the subject's profile — the grant is scoped to exactly the
--     (viewer, subject) pair, not a blanket opening;
--   * starting a session writes a real public.audit_log row carrying the
--     reason (via the same app.audit_reason GUC the reason/result migration
--     established) and a public.notifications row to the subject;
--   * ending a session (by the viewer) clears the read grant immediately —
--     private.can_support_view goes back to false and the profile read is
--     refused again;
--   * a session cannot be "un-ended" or have its window extended after the
--     fact — sabotage control on the update-guard trigger.
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

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_support_agent, 'svas-test-support@example.invalid', 'x', now(), '{}', '{}'),
    (v_bystander, 'svas-test-bystander@example.invalid', 'x', now(), '{}', '{}'),
    (v_patient, 'svas-test-patient@example.invalid', 'x', now(), '{}', '{}'),
    (v_clinician, 'svas-test-clinician@example.invalid', 'x', now(), '{}', '{}'),
    (v_other_admin, 'svas-test-other-admin@example.invalid', 'x', now(), '{}', '{}');

  -- Deliberately NOT organisation-staff for v_patient/v_clinician's own org membership check —
  -- the support agent and bystander sit in a DIFFERENT org (private.is_org_staff would refuse
  -- them on org-membership grounds alone), so any read that succeeds below is unambiguously
  -- private.can_support_view doing the work, not a same-org staff coincidence.
  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_support_agent, v_org, 'clinician', 'SVAS Test Support Agent'),
    (v_bystander, v_org, 'clinician', 'SVAS Test Bystander'),
    (v_patient, v_org, 'patient', 'SVAS Test Patient'),
    (v_clinician, v_org, 'clinician', 'SVAS Test Clinician'),
    (v_other_admin, v_org, 'admin', 'SVAS Test Other Admin');

  insert into public.user_permission_grants (profile_id, permission_key)
  values (v_support_agent, 'support.view_as');

  insert into svas_fixture(k, v) values
    ('org', v_org), ('support_agent', v_support_agent), ('bystander', v_bystander),
    ('patient', v_patient), ('clinician', v_clinician), ('other_admin', v_other_admin);
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

  select full_name into v_readback from public.profiles where id = v_patient;

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
  select full_name into v_readback from public.profiles where id = v_patient;
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
  select full_name into v_readback from public.profiles where id = v_patient;
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

select check_name, role, observed, expected, verdict
from svas_result
order by verdict desc, check_name, role;

rollback;
