-- Local/CI-only fix-forward, NOT a functional migration -- same rationale
-- family as supabase/roles.sql's stub fixes (see that file's header) and
-- the other real-migration stubs in this history (lab_partner_own_provider_id,
-- record_voucher_payment_intent, match_lpe_content_blocks):
-- 20260812041044_service_role_write_actor_attribution.sql's own assertion
-- fails on a fresh replay for all four functions it defines, same
-- unexplained default-ACL gap as every other stubbed function -- but these
-- take custom types (public.sex, public.lab_result_document_source) that
-- don't exist when roles.sql runs (before ANY migration, full stop -- a
-- first attempt put these in roles.sql and CI caught the mistake directly:
-- "type public.sex does not exist" during roles.sql itself, since being
-- "long-established" by 2026-08-12 doesn't help when roles.sql predates the
-- very first migration too). Needs a real migration instead, placed where
-- both types are already established (public.sex since 20260705211044,
-- public.lab_result_document_source since 20260720120100, both long before
-- this point in history).
--
-- These are service-role-only surfaces (never granted to authenticated) --
-- app code calls them via a service-role client so a write can carry an
-- audited actor id set_config wouldn't otherwise see -- matching the real
-- migration's own revoke-from-public/grant-to-service_role pattern.
--
-- Explicit `revoke ... from anon` on every one of these, not just `from
-- public` (confirmed necessary via CI: a first pass with only the public
-- revoke still left anon directly EXECUTE-able) -- this environment's
-- default-ACL gap isn't purely PUBLIC-pseudo-role inheritance here, so
-- belt-and-suspenders on both.
create function public.provision_dependent_profile_basics(
  p_child_id uuid,
  p_date_of_birth date,
  p_sex public.sex,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
end;
$$;

revoke all on function public.provision_dependent_profile_basics(uuid, date, public.sex, uuid) from public;
revoke all on function public.provision_dependent_profile_basics(uuid, date, public.sex, uuid) from anon;
grant execute on function public.provision_dependent_profile_basics(uuid, date, public.sex, uuid) to service_role;

create function public.mark_emergency_contact_notified(
  p_event_id uuid,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
end;
$$;

revoke all on function public.mark_emergency_contact_notified(uuid, uuid) from public;
revoke all on function public.mark_emergency_contact_notified(uuid, uuid) from anon;
grant execute on function public.mark_emergency_contact_notified(uuid, uuid) to service_role;

create function public.mark_identity_verified(
  p_patient_id uuid,
  p_verified_at timestamptz,
  p_actor_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
end;
$$;

revoke all on function public.mark_identity_verified(uuid, timestamptz, uuid) from public;
revoke all on function public.mark_identity_verified(uuid, timestamptz, uuid) from anon;
grant execute on function public.mark_identity_verified(uuid, timestamptz, uuid) to service_role;

create function public.insert_audited_lab_result_document(
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
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  return null;
end;
$$;

revoke all on function public.insert_audited_lab_result_document(uuid, uuid, uuid, text, text, text, bigint, public.lab_result_document_source, uuid, text, uuid) from public;
revoke all on function public.insert_audited_lab_result_document(uuid, uuid, uuid, text, text, text, bigint, public.lab_result_document_source, uuid, text, uuid) from anon;
grant execute on function public.insert_audited_lab_result_document(uuid, uuid, uuid, text, text, text, bigint, public.lab_result_document_source, uuid, text, uuid) to service_role;
