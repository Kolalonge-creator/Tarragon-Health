-- CMO decision Q17 (2026-10-07): a clinician's MDCN folio number is never shown publicly.
-- OQ-358: public.clinical_staff_directory returned credential_number to every signed-in
-- user of the organisation, patients included.
--
-- Live facts read 2026-10-15 (pg_get_viewdef / acl): the view is owner-run
-- (security_invoker=false), no dependent views or policies, and `authenticated` held
-- INSERT/UPDATE/DELETE on it (arwd) although it is an auto-updatable view over
-- clinical_staff; those write grants are removed here as well.
--
-- Consumers of the folio through the view were eight document paths that
-- print the issuing clinician's registration number on a document handed to the patient
-- (referral letter, lab interpretation PDF x2, verified-document PDF x2 incl. mobile, prescription PDF, lab request PDF, vaccination certificate). The health passport footer and the lab-order orderer lookup printed/carried it without need and now drop it.
-- They now call public.clinician_folio_for_document(), which derives the clinician FROM
-- the document (never from a caller-supplied id) and returns the folio only when the
-- caller is entitled to that document (same rule as the document table's own SELECT
-- policy) and the document is one the generators actually print.
--
-- Not changed here: clinical_staff (the base table) is readable by org staff, so a
-- clinician colleague can still read a folio from the table; many staff screens read it
-- there. Recorded as an open follow-up in docs/design/folio-exposure-fix.md.

drop view public.clinical_staff_directory;

create view public.clinical_staff_directory
  with (security_invoker = false)
  as
  select
    id,
    organisation_id,
    profile_id,
    full_name,
    photo_url,
    credential_type,
    specialty,
    bio,
    active,
    doctor_tier,
    employment_type,
    offers_therapy_sessions,
    license_verified_at is not null
      and (license_expires_at is null or license_expires_at > now()) as license_verified
  from public.clinical_staff cs
  where organisation_id = private.current_org_id()
     or private.is_org_staff(organisation_id)
     or ((profile_id is not null) and private.can_support_view(profile_id))
     or coalesce(current_setting('role', true), '') = 'service_role'
     or coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';

comment on view public.clinical_staff_directory is
  'Safe-column subset of clinical_staff for patient/family-facing trust display (docs/CLINICAL_TRUST_MODEL_SPEC.md), plus internal service-role callers. Owner-run, not security_invoker: embeds its own org/staff/service-role predicate. NEVER add credential_number (the MDCN folio, CMO Q17), indemnity_*/staff_number/verified_by/credential_verified_by/*_verified_at columns here; documents that must print the folio use public.clinician_folio_for_document().';

revoke all on public.clinical_staff_directory from public;
revoke all on public.clinical_staff_directory from anon;
revoke all on public.clinical_staff_directory from authenticated;
grant select on public.clinical_staff_directory to authenticated;

create or replace function public.clinician_folio_for_document(
  p_document_kind text,
  p_document_ids uuid[]
)
returns table (
  document_id uuid,
  clinician_staff_id uuid,
  clinician_profile_id uuid,
  full_name text,
  credential_type text,
  credential_number text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  -- A service-role caller (the notification PDF route) can already read clinical_staff
  -- directly, so allowing it here exposes nothing new.
  v_service boolean := coalesce(current_setting('role', true), '') = 'service_role'
                    or coalesce((select auth.jwt() ->> 'role'), '') = 'service_role';
begin
  if p_document_ids is null or coalesce(array_length(p_document_ids, 1), 0) = 0 then
    return;
  end if;
  if v_uid is null and not v_service then
    return;
  end if;

  if p_document_kind = 'referral_letter' then
    -- specialist_referrals_select admits the patient only.
    return query
      select sr.id, cs.id, cs.profile_id, cs.full_name, cs.credential_type, cs.credential_number
      from public.specialist_referrals sr
      join public.clinical_staff cs on cs.profile_id = sr.set_by and cs.active
      where sr.id = any (p_document_ids)
        and (v_service or sr.patient_id = v_uid);

  elsif p_document_kind = 'lab_result_interpretation' then
    return query
      select d.id, cs.id, cs.profile_id, cs.full_name, cs.credential_type, cs.credential_number
      from public.lab_result_documents d
      join public.clinical_staff cs on cs.profile_id = d.reviewed_by and cs.active
      where d.id = any (p_document_ids)
        and d.patient_interpretation is not null
        and d.interpretation_sent_at is not null
        and (v_service
             or (d.patient_id = v_uid and (d.source = 'patient' or d.reviewed_at is not null))
             or private.staff_may_read(d.patient_id, d.organisation_id, 'labs_results'::public.care_access_category));

  elsif p_document_kind = 'verified_document' then
    return query
      select vd.id, cs.id, cs.profile_id, cs.full_name, cs.credential_type, cs.credential_number
      from public.verified_documents vd
      join public.clinical_staff cs on cs.id = vd.issued_by
      where vd.id = any (p_document_ids)
        and vd.status = 'issued'
        and (v_service
             or vd.patient_id = v_uid
             or private.staff_may_read(vd.patient_id, vd.organisation_id, 'medical_history'::public.care_access_category));

  elsif p_document_kind = 'prescription' then
    -- medications.added_by is the prescriber's profile id. No active filter: a prescription
    -- already issued keeps the folio of the clinician who wrote it.
    return query
      select m.id, cs.id, cs.profile_id, cs.full_name, cs.credential_type, cs.credential_number
      from public.medications m
      join public.clinical_staff cs on cs.profile_id = m.added_by
      where m.id = any (p_document_ids)
        and (v_service or m.patient_id = v_uid or private.is_org_staff(m.organisation_id)
             or private.can_read_clinical(m.patient_id, 'medications'::public.care_access_category));

  elsif p_document_kind = 'lab_request' then
    -- lab_orders.ordered_by is a clinical_staff id.
    return query
      select lo.id, cs.id, cs.profile_id, cs.full_name, cs.credential_type, cs.credential_number
      from public.lab_orders lo
      join public.clinical_staff cs on cs.id = lo.ordered_by
      where lo.id = any (p_document_ids)
        and (v_service or lo.patient_id = v_uid or private.is_org_staff(lo.organisation_id)
             or private.can_read_clinical(lo.patient_id, 'labs_results'::public.care_access_category));

  elsif p_document_kind = 'vaccination_certificate' then
    return query
      select vr.id, cs.id, cs.profile_id, cs.full_name, cs.credential_type, cs.credential_number
      from public.vaccination_records vr
      join public.clinical_staff cs on cs.profile_id = vr.verified_by and cs.active
      where vr.id = any (p_document_ids)
        and vr.verification_status = 'verified'
        and (v_service or vr.profile_id = v_uid or private.is_org_staff(vr.organisation_id)
             or private.can_read_clinical(vr.profile_id, 'vaccinations'::public.care_access_category));

  else
    raise exception 'unknown document kind %', p_document_kind using errcode = '22023';
  end if;
end;
$$;

comment on function public.clinician_folio_for_document(text, uuid[]) is
  'Returns the issuing clinician''s MDCN folio for documents the caller is entitled to produce/receive (referral_letter, lab_result_interpretation, verified_document, prescription, lab_request, vaccination_certificate). Clinician derived from the document, entitlement mirrors the document table SELECT policy. Zero rows when not entitled. CMO Q17 / OQ-358.';

revoke all on function public.clinician_folio_for_document(text, uuid[]) from public;
grant execute on function public.clinician_folio_for_document(text, uuid[]) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.clinician_folio_for_document(text, uuid[])', 'EXECUTE') then
    raise exception 'anon can execute clinician_folio_for_document';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'clinical_staff_directory'
               and column_name = 'credential_number') then
    raise exception 'directory view still exposes credential_number';
  end if;
  if has_table_privilege('authenticated', 'public.clinical_staff_directory', 'UPDATE')
     or has_table_privilege('authenticated', 'public.clinical_staff_directory', 'INSERT')
     or has_table_privilege('authenticated', 'public.clinical_staff_directory', 'DELETE') then
    raise exception 'authenticated still has write grants on the directory view';
  end if;
end $$;
