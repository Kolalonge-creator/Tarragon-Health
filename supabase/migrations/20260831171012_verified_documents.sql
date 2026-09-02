-- Tarragon Health — Pay-per-service item: Verified Digital Documents.
--
-- Fit-to-work letters and travel health certificates — a digitally signed
-- PDF, no printing or courier involved. Deliberately the PLAIN signed-PDF
-- pattern already live for Health Passport/referral letters/quarterly
-- reports (health-passport-document.tsx et al via @react-pdf/renderer), NOT
-- the separate Ed25519 cryptographic health_passport_issuances/
-- passport_signing_keys system (20260807104733) — that layer is real but
-- completely unwired to any UI and self-documented as structurally unusable
-- today (its own migration proves zero clinical staff have a verified
-- signing credential yet). Building on the unproven layer would mean this
-- item ships broken; building on the proven one means it ships working.
--
-- A document only carries real weight if a doctor actually attests it —
-- unlike the Health Passport (a summary of the patient's own recorded data),
-- this needs a genuine clinical judgement call ("yes, this patient is fit to
-- work" / "yes, this patient is fit to travel"), so issuance is gated the
-- same forge-proof way as every other doctor sign-off in this migration set.
-- Pure pay-per-service, no plan bypass — an official document is a
-- standalone paid item, not a subscription perk.

create type public.verified_document_type as enum (
  'fit_to_work', 'travel_health_certificate'
);

create type public.verified_document_status as enum (
  'requested', 'issued', 'declined'
);

create table public.verified_documents (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  patient_id          uuid not null references public.profiles (id) on delete cascade,
  document_type       public.verified_document_type not null,
  -- What the patient is asking for it to say / where it's for (e.g. an
  -- employer name, a destination country) — free text, never itself the
  -- attestation.
  request_note        text,
  status              public.verified_document_status not null default 'requested',
  -- The doctor's real attestation text — this, not request_note, is what
  -- ever prints on the issued PDF.
  attestation_text    text,
  valid_from          date,
  valid_until         date,
  declined_reason     text,
  issued_by           uuid references public.clinical_staff (id) on delete set null,
  issued_at           timestamptz,
  sla_due_at          timestamptz not null default now() + interval '72 hours',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint verified_documents_issued_has_attestation
    check (status <> 'issued' or (attestation_text is not null and valid_from is not null)),
  constraint verified_documents_valid_range
    check (valid_until is null or valid_from is null or valid_until >= valid_from)
);

create index verified_documents_org_status_idx
  on public.verified_documents (organisation_id, status, sla_due_at);
create index verified_documents_patient_idx
  on public.verified_documents (patient_id, created_at desc);

create trigger verified_documents_set_updated_at
  before update on public.verified_documents
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Pay-per-service gate — one product covers both document types (same
-- clinical-attestation shape either way); price is a placeholder like every
-- other new product in this migration set.
-- ---------------------------------------------------------------------------

insert into public.service_products (code, name, description, price_kobo, currency, access_duration_days, is_active)
values (
  'verified_document_credit',
  'Verified Digital Document',
  'A doctor-attested fit-to-work letter or travel health certificate, delivered as a signed PDF.',
  400000, -- PLACEHOLDER (₦4,000) — not founder-confirmed
  'NGN', 90, true
)
on conflict (code) do nothing;

create or replace function private.enforce_verified_document_credit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.id := coalesce(new.id, gen_random_uuid());

  begin
    perform public.redeem_available_service_purchase(
      new.patient_id, 'verified_document_credit', 'verified_document', new.id
    );
  exception when others then
    if sqlerrm like 'no available%' then
      raise exception 'Buy a verified document credit to request this.'
        using errcode = 'P0001', detail = 'VERIFIED_DOCUMENT_CREDIT_REQUIRED';
    end if;
    raise;
  end;

  return new;
end;
$$;

create trigger verified_documents_enforce_credit
  before insert on public.verified_documents
  for each row execute function private.enforce_verified_document_credit();

-- ---------------------------------------------------------------------------
-- Forge-proof issuance attribution — same shape as the other reviews in
-- this migration set.
-- ---------------------------------------------------------------------------

create or replace function private.stamp_verified_document_issuance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
begin
  if new.status in ('issued', 'declined') and old.status not in ('issued', 'declined') then
    select cs.id into v_staff
    from public.clinical_staff cs
    where cs.profile_id = (select auth.uid())
      and cs.organisation_id = new.organisation_id
      and cs.active
      and cs.doctor_tier is not null
      and cs.doctor_tier <> 'care_coordinator';
    if v_staff is null then
      raise exception 'only an active doctor on this organisation''s care team can issue a verified document'
        using errcode = '42501';
    end if;
    new.issued_by := v_staff;
    new.issued_at := now();
  elsif new.status not in ('issued', 'declined') and old.status not in ('issued', 'declined') then
    new.issued_by := null;
    new.issued_at := null;
  else
    new.issued_by := old.issued_by;
    new.issued_at := old.issued_at;
  end if;
  return new;
end;
$$;

create trigger verified_documents_stamp_issuance
  before update on public.verified_documents
  for each row execute function private.stamp_verified_document_issuance();

alter table public.verified_documents enable row level security;

create policy verified_documents_select on public.verified_documents
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy verified_documents_insert on public.verified_documents
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    and organisation_id = private.current_org_id()
  );
create policy verified_documents_update on public.verified_documents
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.verified_documents to authenticated;

do $$
declare
  v_org uuid;
  v_patient uuid;
  v_staff_profile uuid;
  v_product_id uuid;
  v_purchase_id uuid;
  v_doc_id uuid;
begin
  select id, organisation_id into v_patient, v_org from public.profiles where role = 'patient' limit 1;
  if v_patient is null then
    raise notice 'SKIPPED behavioral proof: no patient row exists to test against';
    return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.verified_documents (organisation_id, patient_id, document_type, request_note)
    values (v_org, v_patient, 'fit_to_work', 'repoint-proof: should be blocked, no credit');
    reset role;
    raise exception 'FAIL: verified_documents insert succeeded with no credit';
  exception when others then
    reset role;
    if sqlerrm not like '%Buy a verified document credit%' then
      raise;
    end if;
  end;

  select id into v_product_id from public.service_products where code = 'verified_document_credit';
  insert into public.service_purchases
    (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
     amount_kobo, currency, purchased_at, expires_at)
  values
    (v_org, v_patient, v_patient, v_product_id, 'active', 400000, 'NGN', now(), now() + interval '90 days')
  returning id into v_purchase_id;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.verified_documents (organisation_id, patient_id, document_type, request_note)
  values (v_org, v_patient, 'fit_to_work', 'repoint-proof: paid via credit')
  returning id into v_doc_id;
  reset role;

  if not exists (select 1 from public.service_purchases where id = v_purchase_id and redeemed_at is not null and redeemed_entity_id = v_doc_id) then
    raise exception 'FAIL: verified document credit was not redeemed against the new request row';
  end if;

  select cs.profile_id into v_staff_profile
  from public.clinical_staff cs
  where cs.organisation_id = v_org and cs.active and cs.doctor_tier is not null and cs.doctor_tier <> 'care_coordinator'
  limit 1;

  if v_staff_profile is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', v_staff_profile, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      update public.verified_documents set status = 'issued' where id = v_doc_id;
      reset role;
      raise exception 'FAIL: issuing without attestation_text/valid_from should have violated the check constraint';
    exception when others then
      reset role;
      if sqlerrm not like '%verified_documents_issued_has_attestation%' then
        raise;
      end if;
    end;

    perform set_config('request.jwt.claims', json_build_object('sub', v_staff_profile, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update public.verified_documents
      set status = 'issued', attestation_text = 'proof attestation', valid_from = current_date
      where id = v_doc_id;
    reset role;

    if not exists (select 1 from public.verified_documents where id = v_doc_id and issued_by is not null and issued_at is not null) then
      raise exception 'FAIL: issuing did not stamp issued_by/issued_at';
    end if;
  else
    raise notice 'SKIPPED issuance-attribution proof: no active non-coordinator doctor fixture in org';
  end if;

  delete from public.verified_documents where id = v_doc_id;
  delete from public.service_purchases where id = v_purchase_id;

  raise notice 'PASS: verified_documents credit gate + attestation constraint + forge-proof issuance all work';
end $$;
