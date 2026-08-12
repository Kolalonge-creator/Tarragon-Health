-- Tarragon Health
-- Actor attribution for the handful of service-role writes that have a real known actor
--
-- 20260812030853_row_change_audit_triggers.sql noted that service-role/Edge-Function writes
-- have no auth.uid() and fall back to a GUC (app.audit_actor_id) that nothing set. Investigated
-- properly before building anything: the GUC only survives within a single database
-- transaction, and every supabase-js call is its own PostgREST request/transaction, so it can
-- only ever work when the GUC-set and the write happen inside the SAME function call. The only
-- platform-wide mechanism that would cover every service-role write without that constraint is
-- a PostgREST pre-request hook (`alter role authenticator set pgrst.db_pre_request = ...`) —
-- that changes how every API request on the platform is processed, not just these tables, and
-- was deliberately not done without the founder weighing in on that blast radius.
--
-- What this migration does instead, chosen explicitly over that: wrap the specific service-role
-- writes that have a real, known human actor in a small SECURITY DEFINER RPC that sets the GUC
-- and performs the write in one transaction. Scope, checked file by file against every service-
-- role write touching one of the 21 audited tables (apps/web/src, grep for
-- createServiceRoleClient + .from(<table>).insert/update):
--   - 4 real candidates with a known actor, wrapped here: a parent provisioning a child
--     dependent's profile (add-child-actions.ts), a patient acknowledging their own emergency
--     contact was notified (patient/actions.ts), a patient's identity-verification result
--     landing on their own profile (onboarding/actions.ts), and a staff member uploading a lab
--     result document on a patient's behalf (lab-results/actions.ts, which already stamps
--     uploaded_by — this migration additionally makes the generic audit_log entry agree).
--   - Every other service-role write touching these tables (assess-heart-rate.ts,
--     assess-glucose.ts, cv-risk/escalate.ts, the device-readings integration route) is
--     genuinely system/algorithm-initiated — a clinical-decision-support engine reacting to a
--     reading pattern, or a device/API-key partner with no human profiles.id behind it.
--     actor_id null / actor_resolved: false is the HONEST answer for those, not a gap to close.
--
-- Trust model: p_actor_id is caller-supplied and not independently verified by Postgres (unlike
-- auth.uid(), which is cryptographically tied to the request's JWT) — exactly the same trust
-- boundary createServiceRoleClient() already documents for every service-role write on this
-- platform. EXECUTE is granted only to service_role (never anon/authenticated), so these
-- functions are unreachable from any browser session regardless — only from server code that
-- already ran its own auth check before calling.

create or replace function public.provision_dependent_profile_basics(
  p_child_id uuid,
  p_date_of_birth date,
  p_sex public.sex,
  p_actor_id uuid
) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform set_config('app.audit_actor_id', p_actor_id::text, true);
  update public.profiles
    set date_of_birth = p_date_of_birth,
        sex = p_sex,
        is_dependent_account = true
    where id = p_child_id;
end;
$$;

comment on function public.provision_dependent_profile_basics(uuid, date, public.sex, uuid) is
  'Service-role write wrapper: sets a child dependent''s basics, attributed to the provisioning '
  'parent (p_actor_id). Called from apps/web/src/app/(dashboard)/patient/family/add-child-actions.ts. '
  'See 20260812041044_service_role_write_actor_attribution.sql.';

create or replace function public.mark_emergency_contact_notified(
  p_event_id uuid,
  p_actor_id uuid
) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform set_config('app.audit_actor_id', p_actor_id::text, true);
  update public.emergency_events
    set contact_notified_at = now()
    where id = p_event_id;
end;
$$;

comment on function public.mark_emergency_contact_notified(uuid, uuid) is
  'Service-role write wrapper: stamps contact_notified_at, attributed to the patient who '
  'triggered the notification (p_actor_id). Called from '
  'apps/web/src/app/(dashboard)/patient/actions.ts. See '
  '20260812041044_service_role_write_actor_attribution.sql.';

create or replace function public.mark_identity_verified(
  p_patient_id uuid,
  p_verified_at timestamptz,
  p_actor_id uuid
) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform set_config('app.audit_actor_id', p_actor_id::text, true);
  update public.profiles
    set identity_verified_at = p_verified_at
    where id = p_patient_id;
end;
$$;

comment on function public.mark_identity_verified(uuid, timestamptz, uuid) is
  'Service-role write wrapper: stamps identity_verified_at once a KYC provider confirms a '
  'result, attributed to the patient the verification was for (p_actor_id) — the value itself '
  'is provider-computed, never patient-asserted, but the audit trail records who the '
  'verification was for. Called from apps/web/src/app/onboarding/actions.ts. See '
  '20260812041044_service_role_write_actor_attribution.sql.';

create or replace function public.insert_audited_lab_result_document(
  p_organisation_id uuid,
  p_patient_id uuid,
  p_lab_order_id uuid,
  p_file_path text,
  p_original_filename text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_source public.lab_result_document_source,
  p_uploaded_by uuid,
  p_note text,
  p_actor_id uuid
) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform set_config('app.audit_actor_id', p_actor_id::text, true);
  insert into public.lab_result_documents (
    organisation_id, patient_id, lab_order_id, file_path, original_filename,
    mime_type, file_size_bytes, source, uploaded_by, note
  ) values (
    p_organisation_id, p_patient_id, p_lab_order_id, p_file_path, p_original_filename,
    p_mime_type, p_file_size_bytes, p_source, p_uploaded_by, p_note
  )
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.insert_audited_lab_result_document(
  uuid, uuid, uuid, text, text, text, bigint, public.lab_result_document_source, uuid, text, uuid
) is
  'Service-role write wrapper: inserts a staff-uploaded lab result document, attributed to the '
  'uploading staff member (p_actor_id, same value as p_uploaded_by here). Called from '
  'apps/web/src/lib/lab-results/actions.ts. See '
  '20260812041044_service_role_write_actor_attribution.sql.';

-- All four are service-role-only surface: revoke the default PUBLIC execute, then grant to
-- service_role alone. Not authenticated, not anon — a normal session must never be able to call
-- these directly, only server code that already ran its own auth check.
do $$
declare
  fn text;
  fns text[] := array[
    'public.provision_dependent_profile_basics(uuid, date, public.sex, uuid)',
    'public.mark_emergency_contact_notified(uuid, uuid)',
    'public.mark_identity_verified(uuid, timestamptz, uuid)',
    'public.insert_audited_lab_result_document(uuid, uuid, uuid, text, text, text, bigint, public.lab_result_document_source, uuid, text, uuid)'
  ];
begin
  foreach fn in array fns loop
    execute format('revoke all on function %s from public', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

-- Proof, not hope: assert the ACL landed exactly as intended for every role that matters —
-- anon/authenticated must be rejected, service_role must be allowed. Same discipline as
-- 20260812034612_clinician_patient_record_view_audit.sql: a grant statement running without
-- error is not proof it took effect (PUBLIC=X inheritance has bitten this codebase before).
do $$
declare
  fn text;
  fns text[] := array[
    'public.provision_dependent_profile_basics(uuid, date, public.sex, uuid)',
    'public.mark_emergency_contact_notified(uuid, uuid)',
    'public.mark_identity_verified(uuid, timestamptz, uuid)',
    'public.insert_audited_lab_result_document(uuid, uuid, uuid, text, text, text, bigint, public.lab_result_document_source, uuid, text, uuid)'
  ];
  r text;
begin
  foreach fn in array fns loop
    foreach r in array array['anon', 'authenticated'] loop
      if has_function_privilege(r, fn, 'EXECUTE') then
        raise exception '% is EXECUTE-able by % — ACL did not land as intended', fn, r;
      end if;
    end loop;
    if not has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception '% is NOT EXECUTE-able by service_role — grant failed', fn;
    end if;
  end loop;
end $$;
