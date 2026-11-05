-- Diagnostic directory Phase 5: a doctor suggests where the patient can have an ordered test done (design §12 P5).
--
--   diagnostic_order_suggestions   one active suggestion per lab or imaging order: the branch, the investigation it is for,
--                                  who suggested it and when, when the patient first opened it, and if it was withdrawn.
--                                  Kept apart from lab_orders/imaging_orders on purpose: those tables carry about 30 billing,
--                                  routing and notification triggers, and a suggestion must never touch any of them. It does
--                                  not change fulfilment, provider, location, price or who the patient pays.
--   clinician_suggest_place(kind, order, branch, concept)   active clinical staff of the order's organisation. The branch must
--                                  be recommendable for that investigation NOW (same eligibility as search). Replaces any
--                                  earlier suggestion (the old one is kept, withdrawn).
--   clinician_withdraw_place(suggestion, reason)
--   order_suggested_place(kind, order)  the suggestion with public branch fields and whether it is still recommendable today.
--                                  The patient (first call stamps viewed_at), results-scoped staff, a consented reader or a
--                                  caregiver with view_results, and the service role (request PDFs) may read it; only the
--                                  patient's own read stamps viewed_at.
--
-- The patient stays free to go anywhere: the copy says so, and lab_orders.location_id (the patient's own choice) is untouched.

create table public.diagnostic_order_suggestions (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete restrict,
  lab_order_id       uuid references public.lab_orders (id) on delete restrict,
  imaging_order_id   uuid references public.imaging_orders (id) on delete restrict,
  branch_listing_id  uuid not null references public.diagnostic_branch_listings (id) on delete restrict,
  concept_id         uuid not null references public.reference_concepts (id) on delete restrict,
  suggested_by       uuid not null references public.profiles (id) on delete restrict,
  suggested_at       timestamptz not null default now(),
  viewed_at          timestamptz,
  withdrawn_at       timestamptz,
  withdrawn_by       uuid references public.profiles (id) on delete restrict,
  withdrawn_reason   text,
  constraint diagnostic_order_suggestions_one_order check ((lab_order_id is null) <> (imaging_order_id is null)),
  constraint diagnostic_order_suggestions_withdrawn check (
    (withdrawn_at is null and withdrawn_by is null and withdrawn_reason is null)
    or (withdrawn_at is not null and withdrawn_by is not null and char_length(btrim(coalesce(withdrawn_reason, ''))) >= 5))
);
create unique index diagnostic_order_suggestions_one_lab on public.diagnostic_order_suggestions (lab_order_id)
  where lab_order_id is not null and withdrawn_at is null;
create unique index diagnostic_order_suggestions_one_imaging on public.diagnostic_order_suggestions (imaging_order_id)
  where imaging_order_id is not null and withdrawn_at is null;
create index diagnostic_order_suggestions_patient_idx on public.diagnostic_order_suggestions (patient_id);
comment on table public.diagnostic_order_suggestions is
  'Diagnostic directory P5: a doctor''s suggestion of where to have an ordered test done. Advice only: never changes fulfilment, provider, location, price or payment. The patient may go anywhere.';

alter table public.diagnostic_order_suggestions enable row level security;
-- Same category scope as lab_orders and the lab_request folio: a suggestion names the test, so it is a results read.
create policy diagnostic_order_suggestions_select_staff on public.diagnostic_order_suggestions
  for select to authenticated
  using (private.staff_may_read(patient_id, organisation_id, 'labs_results'::public.care_access_category));
grant select on public.diagnostic_order_suggestions to authenticated;
revoke insert, update, delete, truncate on public.diagnostic_order_suggestions from authenticated, anon;

-- ---------------------------------------------------------------------------
-- Suggest / withdraw
-- ---------------------------------------------------------------------------
create or replace function public.clinician_suggest_place(p_kind text, p_order_id uuid, p_branch_listing_id uuid, p_concept_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_patient uuid;
  v_status text;
  v_study_concept uuid;
  b public.diagnostic_branch_listings%rowtype;
  c public.reference_concepts%rowtype;
  v_old uuid;
  v_id uuid;
begin
  if p_kind = 'lab' then
    select organisation_id, patient_id, status::text into v_org, v_patient, v_status from public.lab_orders where id = p_order_id;
  elsif p_kind = 'imaging' then
    select o.organisation_id, o.patient_id, o.status::text, s.concept_id into v_org, v_patient, v_status, v_study_concept
      from public.imaging_orders o left join public.imaging_studies s on s.id = o.study_id where o.id = p_order_id;
  else
    raise exception 'kind must be lab or imaging' using errcode = '22023';
  end if;
  if v_org is null then raise exception 'order not found' using errcode = '22023'; end if;
  if auth.uid() is null or not private.is_active_clinical_staff(v_org)
     or not private.staff_may_read(v_patient, v_org, 'labs_results'::public.care_access_category) then
    raise exception 'only active clinical staff who may read this patient''s results can suggest a place' using errcode = '42501';
  end if;
  if v_status in ('cancelled', 'resulted', 'result_returned', 'reviewed', 'reported') then
    raise exception 'this order is closed' using errcode = '22023';
  end if;

  select * into c from public.reference_concepts where id = p_concept_id;
  if c.id is null or c.investigation_category is null or c.is_ambiguous then
    raise exception 'choose one specific investigation' using errcode = '22023';
  end if;
  if p_kind = 'lab' and c.domain <> 'lab_test' then
    raise exception 'a lab order suggestion must be for a laboratory test' using errcode = '22023';
  end if;
  if p_kind = 'imaging' and v_study_concept is not null and v_study_concept <> c.id then
    raise exception 'the suggestion must be for the study that was ordered' using errcode = '22023';
  end if;

  select * into b from public.diagnostic_branch_listings where id = p_branch_listing_id;
  if b.id is null or (p_kind = 'lab' and b.lab_location_id is null) or (p_kind = 'imaging' and b.imaging_location_id is null) then
    raise exception 'choose a % branch from the directory', p_kind using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.diagnostic_branch_services s
     where s.branch_listing_id = b.id and s.concept_id = c.id and private.diagnostic_service_eligible(s.id)) then
    raise exception 'that branch is not currently recommendable for this test' using errcode = '23514';
  end if;

  update public.diagnostic_order_suggestions
     set withdrawn_at = now(), withdrawn_by = auth.uid(), withdrawn_reason = 'Replaced by a new suggestion'
   where withdrawn_at is null
     and ((p_kind = 'lab' and lab_order_id = p_order_id) or (p_kind = 'imaging' and imaging_order_id = p_order_id))
  returning id into v_old;

  insert into public.diagnostic_order_suggestions
    (organisation_id, patient_id, lab_order_id, imaging_order_id, branch_listing_id, concept_id, suggested_by)
  values (v_org, v_patient, case when p_kind = 'lab' then p_order_id end, case when p_kind = 'imaging' then p_order_id end,
          b.id, c.id, auth.uid())
  returning id into v_id;
  perform private.diagnostic_log('diagnostic_order_suggestions', v_id, 'place_suggested', v_old::text, b.id::text, p_kind || ' order');
  return v_id;
end;
$$;
revoke all on function public.clinician_suggest_place(text, uuid, uuid, uuid) from public, anon;
grant execute on function public.clinician_suggest_place(text, uuid, uuid, uuid) to authenticated;

create or replace function public.clinician_withdraw_place(p_suggestion_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_org uuid;
begin
  select organisation_id into v_org from public.diagnostic_order_suggestions where id = p_suggestion_id and withdrawn_at is null;
  if v_org is null then raise exception 'no active suggestion with that id' using errcode = '22023'; end if;
  if auth.uid() is null or not private.is_active_clinical_staff(v_org) then
    raise exception 'only active clinical staff of this organisation can withdraw a suggestion' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'give a reason' using errcode = '22023'; end if;
  update public.diagnostic_order_suggestions
     set withdrawn_at = now(), withdrawn_by = auth.uid(), withdrawn_reason = btrim(p_reason)
   where id = p_suggestion_id;
  perform private.diagnostic_log('diagnostic_order_suggestions', p_suggestion_id, 'place_withdrawn', null, null, p_reason);
end;
$$;
revoke all on function public.clinician_withdraw_place(uuid, text) from public, anon;
grant execute on function public.clinician_withdraw_place(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Read (patient, staff, service role for request PDFs)
-- ---------------------------------------------------------------------------
create or replace function public.order_suggested_place(p_kind text, p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  -- The real database role (set by PostgREST), never the JWT claim GUC, which a session can set itself
  -- (same idiom as clinician_folio_for_document).
  v_service boolean := coalesce(current_setting('role', true), '') = 'service_role';
  x public.diagnostic_order_suggestions%rowtype;
  v_org uuid;
  v_patient uuid;
  v_out jsonb;
begin
  if p_kind = 'lab' then
    select organisation_id, patient_id into v_org, v_patient from public.lab_orders where id = p_order_id;
  elsif p_kind = 'imaging' then
    select organisation_id, patient_id into v_org, v_patient from public.imaging_orders where id = p_order_id;
  else
    raise exception 'kind must be lab or imaging' using errcode = '22023';
  end if;
  if v_org is null then return null; end if;
  -- Who may read: the same rule as the lab_request folio (patient, results-scoped staff, a consented clinical reader or a
  -- caregiver with view_results), plus the service role for request PDFs.
  if not (v_service or (v_uid is not null and (
            v_uid = v_patient
            or private.staff_may_read(v_patient, v_org, 'labs_results'::public.care_access_category)
            or private.can_read_clinical(v_patient, 'labs_results'::public.care_access_category)
            or private.can_read_clinical(v_patient, 'view_results'::public.caregiver_permission)))) then
    raise exception 'not your order' using errcode = '42501';
  end if;

  select * into x from public.diagnostic_order_suggestions
   where withdrawn_at is null
     and ((p_kind = 'lab' and lab_order_id = p_order_id) or (p_kind = 'imaging' and imaging_order_id = p_order_id));
  if x.id is null then return null; end if;

  if v_uid is not null and v_uid = v_patient and x.viewed_at is null then
    update public.diagnostic_order_suggestions set viewed_at = now() where id = x.id returning * into x;
    perform private.diagnostic_log('diagnostic_order_suggestions', x.id, 'place_viewed', null, null, null);
  end if;

  select jsonb_build_object(
           'suggestion_id', x.id,
           'kind', p_kind,
           'test', rc.display,
           'provider_name', coalesce(lp.name, ip.name),
           'branch_name', coalesce(ll.name, il.name),
           'address', coalesce(ll.address, il.address),
           'town', coalesce(b.town, ll.town),
           'lga', b.lga,
           'state', coalesce(ll.state, il.state),
           'phone', coalesce(ll.contact_phone, il.contact_phone),
           'latitude', coalesce(ll.latitude, il.latitude),
           'longitude', coalesce(ll.longitude, il.longitude),
           'appointment_required', s.appointment_required,
           'preparation_note', s.preparation_note,
           -- Re-checked on every read: a branch that has since expired or been suspended says so instead of looking current.
           'still_recommendable', coalesce(private.diagnostic_service_eligible(s.id), false),
           'is_partner', private.diagnostic_branch_is_partner(b.id),
           'suggested_at', x.suggested_at,
           'suggested_by', (select full_name from public.profiles where id = x.suggested_by),
           'viewed_at', x.viewed_at)
    into v_out
    from public.diagnostic_branch_listings b
    join public.reference_concepts rc on rc.id = x.concept_id
    left join public.diagnostic_branch_services s on s.branch_listing_id = b.id and s.concept_id = x.concept_id
    left join public.diagnostic_provider_listings p on p.id = b.provider_listing_id
    left join public.lab_provider_locations ll on ll.id = b.lab_location_id
    left join public.imaging_provider_locations il on il.id = b.imaging_location_id
    left join public.lab_providers lp on lp.id = p.lab_provider_id
    left join public.imaging_providers ip on ip.id = p.imaging_provider_id
   where b.id = x.branch_listing_id;
  return v_out;
end;
$$;
revoke all on function public.order_suggested_place(text, uuid) from public, anon;
grant execute on function public.order_suggested_place(text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Imaging request PDF: the folio (ordering doctor's name and registration) for an imaging order. Redefined from the
-- latest body (20261022114116_clinical_staff_folio_lock.sql, checked against live) with one new branch.
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

  elsif p_document_kind = 'imaging_request' then
    -- Diagnostic directory P5: the imaging request PDF. imaging_orders.ordering_clinician_id is a clinical_staff id.
    if exists (select 1 from public.imaging_orders io
                where io.id = any (p_document_ids)
                  and not (v_service or io.patient_id = v_uid
                           or private.staff_may_read(io.patient_id, io.organisation_id, 'labs_results'::public.care_access_category)
                           or private.can_read_clinical(io.patient_id, 'labs_results'::public.care_access_category)
                           or private.has_emergency_access(io.patient_id, 'labs_results'::public.care_access_category)
                           or private.can_read_clinical(io.patient_id, 'view_results'::public.caregiver_permission))) then
      raise exception 'not entitled to this document' using errcode = '42501';
    end if;
    return query
      select io.id, cs.id, cs.profile_id, cs.full_name, cs.credential_type, cs.credential_number
      from public.imaging_orders io
      left join public.clinical_staff cs on cs.id = io.ordering_clinician_id
      where io.id = any (p_document_ids) and io.status <> 'cancelled';

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
revoke all on function public.clinician_folio_for_document(text, uuid[]) from public;
grant execute on function public.clinician_folio_for_document(text, uuid[]) to authenticated, service_role;

do $$
declare f text;
begin
  foreach f in array array['public.clinician_suggest_place(text, uuid, uuid, uuid)', 'public.clinician_withdraw_place(uuid, text)',
                           'public.order_suggested_place(text, uuid)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon must not execute %', f; end if;
  end loop;
  if has_table_privilege('authenticated', 'public.diagnostic_order_suggestions', 'INSERT') then
    raise exception 'authenticated must not write suggestions directly';
  end if;
end;
$$;
