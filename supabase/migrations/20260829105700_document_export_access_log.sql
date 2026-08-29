-- Tarragon Health — closes docs/PATIENT_HEALTH_RECORD_ARCHITECTURE.md §1.24's
-- "no export audit trail" gap: "the existing audit_log/pgaudit machinery logs
-- clinician reads and table writes, but nothing logs 'patient X downloaded
-- PDF Y at time Z.'" That doc named the fix itself: "a small, additive fix (a
-- shared helper writing one audit_log-style row from each of the ~6 existing
-- export routes)." This is exactly that helper — no new table, reusing the
-- existing append-only public.audit_log rather than inventing a parallel one.
--
-- The 6 routes (confirmed by reading each): quarterly report, health
-- passport, health-check report, single lab result PDF, combined lab result
-- PDF, vaccination certificate, and referral letter. Each already authorizes
-- the caller itself (role checks, RLS-scoped queries, plan gates where
-- applicable) before generating the PDF — this helper's job is only to record
-- that the export happened, not to re-derive authorization.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'document_export_type') then
    create type public.document_export_type as enum (
      'quarterly_report',
      'health_passport',
      'health_check_report',
      'lab_result_single',
      'lab_result_combined',
      'vaccination_certificate',
      'referral_letter'
    );
  end if;
end $$;

-- Server-derives organisation_id/actor from the calling session rather than
-- trusting parameters for them, same reasoning as
-- private.record_patient_document_access. p_patient_id is the record the
-- export is ABOUT, which for a self-service export is also the caller.
--
-- Deliberately public schema, not private: unlike record_patient_document_access
-- (called only from server-side loader code that already has a direct
-- Postgres connection... no, it's the same shape) this needs to be reachable
-- from a Next.js route handler via `supabase.rpc(...)`, and PostgREST does
-- not expose the `private` schema at all (confirmed live in the 2026-08-12
-- audit that produced 20260812003758) — a private-schema function is
-- unreachable from the API layer no matter which role calls it.
create or replace function public.record_export_access(
  p_patient_id  uuid,
  p_export_type public.document_export_type,
  p_metadata    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
begin
  select organisation_id into v_org from public.profiles where id = p_patient_id;
  if v_org is null then
    return;
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    v_org,
    v_actor,
    'patient_record.exported',
    p_export_type::text,
    p_patient_id,
    coalesce(p_metadata, '{}'::jsonb)
  );
exception
  when others then
    -- A logging failure must never be the reason a patient cannot download
    -- their own PDF — same exception-guard reasoning as
    -- private.log_care_access and private.record_patient_document_access.
    raise warning 'export access log failed for patient % (%): %', p_patient_id, p_export_type, sqlerrm;
end;
$$;

comment on function public.record_export_access(uuid, public.document_export_type, jsonb) is
  '§1.24. Call this from each PDF export route immediately before returning the generated buffer. Writes to the existing append-only audit_log (action=patient_record.exported, entity_type=the export type, entity_id=the patient) rather than a new table. actor_id is server-derived from the session — a service-role/system-generated export (no session) logs with a null actor rather than a guessed one.';

-- public.* functions are born PUBLIC-executable, unlike private.* (closed by
-- schema-level default in 20260812003758) — needs its own explicit revoke,
-- same as every other public-schema RPC in this codebase. A patient logging
-- their own export satisfies audit_log's own INSERT policy
-- (actor_id = auth.uid()) without needing organisation_id to already match
-- anything, so `authenticated` is sufficient here — no service_role needed.
revoke execute on function public.record_export_access(uuid, public.document_export_type, jsonb) from public;
revoke execute on function public.record_export_access(uuid, public.document_export_type, jsonb) from anon;
grant execute on function public.record_export_access(uuid, public.document_export_type, jsonb) to authenticated, service_role;
