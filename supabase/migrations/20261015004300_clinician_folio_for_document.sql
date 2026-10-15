-- CMO decision Q17 / OQ-358, step 1 of 2 (code first, schema second): add the narrow, document-scoped
-- folio lookup. public.clinical_staff_directory is NOT touched here, so the currently deployed app (which
-- still reads credential_number from the view) keeps working. Step 2 (a later migration) hides the column
-- once this code is deployed.
--
-- public.clinician_folio_for_document() derives the clinician FROM the document (never from a caller-supplied
-- id) and returns the MDCN folio only when the caller is entitled to that document: the owning patient, tied
-- staff (private.staff_may_read, never plain is_org_staff), caregiver permission / emergency access where the
-- document policy admits them, or service role (the real database role, not a JWT claim; the notification PDF route). A document that exists but
-- the caller may not read raises 42501 (never silently zero rows); nothing is logged. Kinds: referral_letter, lab_result_interpretation,
-- verified_document, prescription, lab_request, vaccination_certificate.

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
  -- The REAL database role, set per request by PostgREST (SET LOCAL ROLE). It cannot be forged from a
  -- session: set_config('role', 'service_role') performs a real SET ROLE and is refused for a role the
  -- session is not a member of. The JWT-claim half of the usual service-role idiom is deliberately NOT
  -- used here: request.jwt.claims is an ordinary GUC any session can set, and this function hands out a
  -- registration number. The notification PDF route (service role) can read clinical_staff anyway.
  v_service boolean := coalesce(current_setting('role', true), '') = 'service_role';
begin
  if p_document_ids is null or coalesce(array_length(p_document_ids, 1), 0) = 0 then
    return;
  end if;
  if v_uid is null and not v_service then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  -- Contract: a document id that does not exist (or is not in a printable state) yields no row; a document
  -- that exists but the caller is not entitled to raises 42501, so a refusal can never look like "no folio";
  -- an entitled document always yields a row, with null clinician fields when no staff row backs it.

  if p_document_kind = 'referral_letter' then
    if exists (select 1 from public.specialist_referrals sr
                where sr.id = any (p_document_ids) and not (v_service or sr.patient_id = v_uid)) then
      raise exception 'not entitled to this document' using errcode = '42501';
    end if;
    return query
      select sr.id, cs.id, cs.profile_id, cs.full_name, cs.credential_type, cs.credential_number
      from public.specialist_referrals sr
      left join public.clinical_staff cs on cs.profile_id = sr.set_by and cs.active
      where sr.id = any (p_document_ids);

  elsif p_document_kind = 'lab_result_interpretation' then
    if exists (select 1 from public.lab_result_documents d
                where d.id = any (p_document_ids)
                  and d.patient_interpretation is not null and d.interpretation_sent_at is not null
                  and not (v_service
                           or (d.patient_id = v_uid and (d.source = 'patient' or d.reviewed_at is not null))
                           or private.staff_may_read(d.patient_id, d.organisation_id, 'labs_results'::public.care_access_category))) then
      raise exception 'not entitled to this document' using errcode = '42501';
    end if;
    return query
      select d.id, cs.id, cs.profile_id, cs.full_name, cs.credential_type, cs.credential_number
      from public.lab_result_documents d
      left join public.clinical_staff cs on cs.profile_id = d.reviewed_by and cs.active
      where d.id = any (p_document_ids)
        and d.patient_interpretation is not null
        and d.interpretation_sent_at is not null;

  elsif p_document_kind = 'verified_document' then
    if exists (select 1 from public.verified_documents vd
                where vd.id = any (p_document_ids) and vd.status = 'issued'
                  and not (v_service or vd.patient_id = v_uid
                           or private.staff_may_read(vd.patient_id, vd.organisation_id, 'medical_history'::public.care_access_category))) then
      raise exception 'not entitled to this document' using errcode = '42501';
    end if;
    return query
      select vd.id, cs.id, cs.profile_id, cs.full_name, cs.credential_type, cs.credential_number
      from public.verified_documents vd
      left join public.clinical_staff cs on cs.id = vd.issued_by
      where vd.id = any (p_document_ids) and vd.status = 'issued';

  elsif p_document_kind = 'prescription' then
    -- medications.added_by is the prescriber's profile id. No active filter: an issued prescription keeps
    -- the folio of the clinician who wrote it.
    if exists (select 1 from public.medications m
                where m.id = any (p_document_ids)
                  and not (v_service or m.patient_id = v_uid
                           or private.staff_may_read(m.patient_id, m.organisation_id, 'medications'::public.care_access_category)
                           or private.can_read_clinical(m.patient_id, 'medications'::public.care_access_category)
                           or private.can_read_clinical(m.patient_id, 'view_medication'::public.caregiver_permission))) then
      raise exception 'not entitled to this document' using errcode = '42501';
    end if;
    return query
      select m.id, cs.id, cs.profile_id, cs.full_name, cs.credential_type, cs.credential_number
      from public.medications m
      left join public.clinical_staff cs on cs.profile_id = m.added_by
      where m.id = any (p_document_ids);

  elsif p_document_kind = 'lab_request' then
    -- lab_orders.ordered_by is a clinical_staff id.
    if exists (select 1 from public.lab_orders lo
                where lo.id = any (p_document_ids)
                  and not (v_service or lo.patient_id = v_uid
                           or private.staff_may_read(lo.patient_id, lo.organisation_id, 'labs_results'::public.care_access_category)
                           or private.can_read_clinical(lo.patient_id, 'labs_results'::public.care_access_category)
                           or private.has_emergency_access(lo.patient_id, 'labs_results'::public.care_access_category)
                           or private.can_read_clinical(lo.patient_id, 'view_results'::public.caregiver_permission))) then
      raise exception 'not entitled to this document' using errcode = '42501';
    end if;
    return query
      select lo.id, cs.id, cs.profile_id, cs.full_name, cs.credential_type, cs.credential_number
      from public.lab_orders lo
      left join public.clinical_staff cs on cs.id = lo.ordered_by
      where lo.id = any (p_document_ids);

  elsif p_document_kind = 'vaccination_certificate' then
    if exists (select 1 from public.vaccination_records vr
                where vr.id = any (p_document_ids) and vr.verification_status = 'verified'
                  and not (v_service or vr.profile_id = v_uid
                           or private.staff_may_read(vr.profile_id, vr.organisation_id, 'vaccinations'::public.care_access_category)
                           or private.can_read_clinical(vr.profile_id, 'vaccinations'::public.care_access_category)
                           or private.has_emergency_access(vr.profile_id, 'vaccinations'::public.care_access_category))) then
      raise exception 'not entitled to this document' using errcode = '42501';
    end if;
    return query
      select vr.id, cs.id, cs.profile_id, cs.full_name, cs.credential_type, cs.credential_number
      from public.vaccination_records vr
      left join public.clinical_staff cs on cs.profile_id = vr.verified_by and cs.active
      where vr.id = any (p_document_ids) and vr.verification_status = 'verified';

  else
    raise exception 'unknown document kind %', p_document_kind using errcode = '22023';
  end if;
end;
$$;

comment on function public.clinician_folio_for_document(text, uuid[]) is
  'Returns the issuing clinician''s MDCN folio for documents the caller is entitled to produce/receive (referral_letter, lab_result_interpretation, verified_document, prescription, lab_request, vaccination_certificate). Clinician derived from the document, entitlement mirrors the document table SELECT policy. 42501 when the document exists but the caller is not entitled; zero rows for a missing document. CMO Q17 / OQ-358.';

revoke all on function public.clinician_folio_for_document(text, uuid[]) from public;
grant execute on function public.clinician_folio_for_document(text, uuid[]) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.clinician_folio_for_document(text, uuid[])', 'EXECUTE') then
    raise exception 'anon can execute clinician_folio_for_document';
  end if;
end $$;
