-- CMO decisions OQ-358 / OQ-358b, step 2 of 2 (SCHEMA SECOND). Stacked after branch fu/folio-base-table-lock (step 1, code).
-- APPLY ONLY AFTER step 1 is deployed READY on production: the app of step 1 reads the folio through
-- public.clinical_staff_folio() (falling back to the column only while that function is absent) and selects explicit
-- columns from public.clinical_staff. The app deployed before step 1 does `select *` and reads credential_number from the
-- table and would fail, as a whole, the moment the column grant below is removed.
--
-- What this does (live facts read 2026-10-15 from koiplnmbgnqnbywhpjlf):
--   A. public.clinical_staff_folio(uuid[]): the one door to the MDCN folio on the base table: the clinician themself, the CMO and
--      credentialing staff (private.can_credential_review(): admin or CMO, in the clinician's organisation), service role. Anyone
--      else gets zero rows, never an error.
--   B. The base table: `authenticated` held table-level SELECT; a column REVOKE is a no-op under a table grant, so the table
--      grant is revoked and an explicit column list (every column except credential_number) is granted. service_role and
--      postgres keep everything; INSERT/UPDATE/DELETE grants and every RLS policy are untouched (RLS policies read no folio).
--   C. Folio leaks through patient-facing functions, found by scanning every function body for credential_number:
--      public.clinician_licence_public (any signed-in user got any clinician's folio) now returns type and date only;
--      public.list_bookable_consult_slots no longer returns mdcn_number (the booking card shows "Licence verified on <date>").
--   D. public.clinician_folio_for_document returns a null folio for lab_result_interpretation and verified_document (OQ-358b):
--      the folio prints on letters and prescriptions only; defence in depth beside the generators that no longer print it.
-- Not changed here (open questions in docs/design/FU-folio-closeout.md): health_passport_by_serial/mint_health_passport carry the
-- attesting doctor's folio (anon-readable by serial); lab_request and vaccination_certificate PDFs still print it.

-- ---------------------------------------------------------------------------
-- A. The folio reader
-- ---------------------------------------------------------------------------
create function public.clinical_staff_folio(p_staff_ids uuid[])
returns table (clinical_staff_id uuid, credential_number text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  -- the REAL database role (PostgREST sets it per request); never a JWT claim, which any session can forge
  v_service boolean := coalesce(current_setting('role', true), '') = 'service_role';
  v_uid uuid := (select auth.uid());
begin
  if p_staff_ids is null or coalesce(array_length(p_staff_ids, 1), 0) = 0 then return; end if;
  if v_uid is null and not v_service then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  return query
    select cs.id, cs.credential_number
      from public.clinical_staff cs
     where cs.id = any (p_staff_ids)
       and (
            v_service
            or cs.profile_id = v_uid
            or (private.can_credential_review() and private.is_org_staff(cs.organisation_id))
           );
end;
$$;

comment on function public.clinical_staff_folio(uuid[]) is
  'The MDCN folio (clinical_staff.credential_number) for the clinicians given, only when the caller is that clinician, the CMO or credentialing staff (private.can_credential_review(), in the same organisation), or service role. Anyone else gets zero rows. The base table no longer lets authenticated select the column. CMO OQ-358.';

revoke all on function public.clinical_staff_folio(uuid[]) from public;
grant execute on function public.clinical_staff_folio(uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- D. The document function: no folio on lab result or verified-document PDFs (OQ-358b)
-- ---------------------------------------------------------------------------
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
      select d.id, cs.id, cs.profile_id, cs.full_name, cs.credential_type, null::text
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
      select vd.id, cs.id, cs.profile_id, cs.full_name, cs.credential_type, null::text
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
  'Returns the issuing clinician''s MDCN folio for documents the caller is entitled to produce/receive (referral_letter, prescription, lab_request, vaccination_certificate). For lab_result_interpretation and verified_document the folio is always null (CMO OQ-358b: the folio prints on letters and prescriptions only); the name and profile still come back. Clinician derived from the document, entitlement mirrors the document table SELECT policy. 42501 when the document exists but the caller is not entitled; zero rows for a missing document. CMO Q17 / OQ-358.';


revoke all on function public.clinician_folio_for_document(text, uuid[]) from public;
grant execute on function public.clinician_folio_for_document(text, uuid[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- C1. clinician_licence_public: the date only, never the folio (CMO Q17)
-- ---------------------------------------------------------------------------
drop function public.clinician_licence_public(uuid);
create function public.clinician_licence_public(p_profile uuid) returns table (credential_type text, checked_on date)
language sql stable security definer set search_path = ''
as $$
  select cs.credential_type, (coalesce(cs.credential_verified_at, cs.license_verified_at) at time zone 'Africa/Lagos')::date
    from public.clinical_staff cs
   where (select auth.uid()) is not null and cs.profile_id = p_profile and cs.active
     and cs.credential_type is not null and nullif(btrim(cs.credential_number), '') is not null
     and coalesce(cs.credential_verified_at, cs.license_verified_at) is not null
$$;
revoke all on function public.clinician_licence_public(uuid) from public, anon;
grant execute on function public.clinician_licence_public(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- C2. list_bookable_consult_slots: no mdcn_number (live definition read 2026-10-15; only the two marked lines differ)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_bookable_consult_slots(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_language text DEFAULT NULL::text, p_sex text DEFAULT NULL::text, p_patient uuid DEFAULT NULL::uuid, p_specialty text DEFAULT NULL::text, p_role text DEFAULT 'doctor'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_subject uuid;
  v_org uuid;
  c jsonb := private.consult_policy();
  v_len integer;
  v_from timestamptz;
  v_to timestamptz;
  v_out jsonb;
begin
  if v_uid is null then return '[]'::jsonb; end if;
  if p_role is null or p_role not in ('doctor', 'dietitian', 'pharmacist') then return '[]'::jsonb; end if;
  -- the slots are for the person being booked: the caller, or someone they may book for (a caregiver with permission, or staff)
  v_subject := coalesce(p_patient, v_uid);
  select organisation_id into v_org from public.profiles where id = v_subject;
  if v_org is null or c is null then return '[]'::jsonb; end if;
  if v_subject <> v_uid
     and not private.is_org_staff(v_org)
     and not private.can_act_for(v_subject, 'book_appointments'::public.caregiver_permission) then
    return '[]'::jsonb;
  end if;
  -- a per-item role is listed only while its product is active and priced, so a patient is never offered a slot that cannot be held
  if p_role <> 'doctor' and not exists (
       select 1 from public.service_products sp
        where sp.code = private.booking_product_code(p_role) and sp.is_active and sp.price_kobo > 0) then
    return '[]'::jsonb;
  end if;
  v_len := (c ->> 'sessionMinutes')::integer;
  if v_len is null or v_len <= 0 then return '[]'::jsonb; end if;
  v_from := greatest(coalesce(p_from, now()), now() + ((c ->> 'bookingLeadMinutes')::integer * interval '1 minute'));
  v_to := least(coalesce(p_to, v_from + ((c ->> 'bookingHorizonDays')::integer * interval '1 day')),
                now() + ((c ->> 'bookingHorizonDays')::integer * interval '1 day'));
  if v_to <= v_from then return '[]'::jsonb; end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.slot_start, x.clinician_name), '[]'::jsonb) into v_out
  from (
    select cs.profile_id as clinician_id,
           cs.full_name as clinician_name,
           cs.specialty,
           cs.languages,
           cs.care_role,
           pr.sex::text as sex,
           -- CMO Q17 / OQ-358: only the date of a recorded credential check is returned, never the registration number
           case when cs.credential_verified_at is not null and cs.credential_type = 'MDCN' then cs.credential_verified_at end as licence_checked_on,
           (cs.license_verified_at is not null and (cs.license_expires_at is null or cs.license_expires_at > now())) as licence_current,
           cs.license_verified_at as licence_verified_at,
           s.slot_start, s.slot_start + (v_len * interval '1 minute') as slot_end
      from public.availability_blocks b
      join public.clinical_staff cs on cs.profile_id = b.clinician_id and cs.organisation_id = b.organisation_id and cs.active
      join public.profiles pr on pr.id = b.clinician_id
      cross join lateral generate_series(b.starts_at, b.ends_at - (v_len * interval '1 minute'), v_len * interval '1 minute') as s(slot_start)
     where b.organisation_id = v_org
       and b.kind = 'bookable_consultations'
       and b.state = 'confirmed'
       and cs.care_role = p_role
       and s.slot_start >= v_from and s.slot_start < v_to
       and (p_language is null or cs.languages @> array[p_language])
       and (p_specialty is null or lower(btrim(cs.specialty)) = lower(btrim(p_specialty)))
       and (p_sex is null or pr.sex::text = p_sex)
       -- the same rule hold and confirm apply: grid, licence, leave, conflicts, test or real, lead time and horizon
       and private.slot_is_open(b.clinician_id, v_subject, s.slot_start, s.slot_start + (v_len * interval '1 minute'))
       and not exists (
             select 1 from public.appointments a
              where a.clinician_id = b.clinician_id
                and a.status in ('held', 'booked', 'confirmed', 'checked_in', 'in_progress')
                and not (a.status = 'held' and a.hold_expires_at < now())
                and tstzrange(a.scheduled_for, a.ends_at, '[)') && tstzrange(s.slot_start, s.slot_start + (v_len * interval '1 minute'), '[)'))
     order by s.slot_start
     limit 200
  ) x;
  return v_out;
end;
$function$;

-- ---------------------------------------------------------------------------
-- B. The base table: authenticated may select every column except the folio
-- ---------------------------------------------------------------------------
do $$
declare v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'clinical_staff' and column_name <> 'credential_number';
  -- a column REVOKE is a no-op under a table-level grant: take the table grant away, then grant the explicit list
  revoke select on public.clinical_staff from authenticated;
  revoke select on public.clinical_staff from anon;
  revoke select (credential_number) on public.clinical_staff from authenticated, anon;
  execute format('grant select (%s) on public.clinical_staff to authenticated', v_cols);
end $$;

-- ---------------------------------------------------------------------------
-- Assertions: "locked" is provable, not hopeful
-- ---------------------------------------------------------------------------
do $$
declare v_missing text;
begin
  if has_column_privilege('authenticated', 'public.clinical_staff', 'credential_number', 'SELECT') then
    raise exception 'authenticated can still select clinical_staff.credential_number';
  end if;
  if has_table_privilege('authenticated', 'public.clinical_staff', 'SELECT') then
    raise exception 'authenticated still holds table-level SELECT on clinical_staff';
  end if;
  if has_table_privilege('anon', 'public.clinical_staff', 'SELECT') or has_column_privilege('anon', 'public.clinical_staff', 'credential_number', 'SELECT') then
    raise exception 'anon can read clinical_staff';
  end if;
  select string_agg(column_name, ', ') into v_missing
    from information_schema.columns
   where table_schema = 'public' and table_name = 'clinical_staff' and column_name <> 'credential_number'
     and not has_column_privilege('authenticated', 'public.clinical_staff', column_name, 'SELECT');
  if v_missing is not null then raise exception 'authenticated lost SELECT on clinical_staff columns: %', v_missing; end if;
  if not has_column_privilege('service_role', 'public.clinical_staff', 'credential_number', 'SELECT') then
    raise exception 'service_role lost the folio';
  end if;
  if not has_table_privilege('authenticated', 'public.clinical_staff', 'UPDATE') or not has_table_privilege('authenticated', 'public.clinical_staff', 'INSERT') then
    raise exception 'authenticated lost its write grants on clinical_staff (they must be untouched)';
  end if;
  if has_function_privilege('anon', 'public.clinical_staff_folio(uuid[])', 'EXECUTE') then
    raise exception 'anon can execute clinical_staff_folio';
  end if;
  if not has_function_privilege('authenticated', 'public.clinical_staff_folio(uuid[])', 'EXECUTE') then
    raise exception 'authenticated cannot execute clinical_staff_folio';
  end if;
  if has_function_privilege('anon', 'public.clinician_licence_public(uuid)', 'EXECUTE') then
    raise exception 'anon can execute clinician_licence_public';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clinical_staff_directory' and column_name = 'credential_number') then
    raise exception 'the staff directory view exposes credential_number again';
  end if;
end $$;

notify pgrst, 'reload schema';
