-- Tarragon Health — Vaccination & Immunisation Engine, gap closure 4/4
--
-- Spec §43.12: a patient uploads a photo/PDF of a paper vaccination card,
-- hospital record or school vaccination record; OCR/AI drafts the individual
-- doses it can read; the patient reviews and confirms before anything lands
-- on their permanent record.
--
-- AI DRAFTS, NEVER DECIDES — same discipline as lab_report_extractions
-- (20260803144056) and ecg_report_extractions: this table is a draft a human
-- reviews next to the source image, never written into vaccination_records
-- directly by the extraction pipeline.
--
-- Unlike the lab/ECG drafts (org-staff-only select, clinical data a doctor
-- must file), vaccination self-log has always been directly patient-writable
-- (vaccination_records' own insert policy needs no clinical gate at all) —
-- so this table follows vaccination_records' OWN authority shape instead:
-- the patient (or a 'manage'-level caregiver, profile_access) can read,
-- upload/insert, and confirm their own draft. Confirming reuses the EXISTING
-- verification pathway (20260717120001_vaccination_verified_pathway) rather
-- than inventing a parallel provenance marker — every dose the reviewer
-- accepts lands at verification_status = 'pending_verification' with
-- physical_certificate_path pointing at the SAME uploaded card image, which
-- puts it straight into the clinician verification queue that already
-- exists at /clinician/vaccinations. No new clinician review surface needed.
--
-- Storage: reuses the existing 'vaccination-certificates' private bucket
-- (20260717120001) — same <patient_id>/<uuid>.<ext> path convention, same
-- accepted types/size limit. A card image is documentary evidence for a
-- dose exactly like a certificate photo is; there is no reason to duplicate
-- the bucket.

create table public.vaccination_card_extractions (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  -- Path within the vaccination-certificates bucket, <patient_id>/<uuid>.<ext>.
  source_path           text not null,
  status                text not null default 'pending'
                          check (status in ('pending', 'extracted', 'failed', 'confirmed', 'discarded')),
  model_id              text,
  -- Name printed on the card, kept ONLY to warn a reviewer when it does not
  -- look like the patient whose record this is being filed into.
  card_holder_name      text,
  -- The full ExtractedCardRow[] from lib/vaccination-cards/extract.ts,
  -- including rows that could not be mapped to a catalogue vaccine.
  rows                  jsonb not null default '[]'::jsonb,
  unreadable_reason     text,
  error_message         text,
  -- vaccination_records ids actually filed by confirm_vaccination_card_extraction,
  -- kept for audit — the difference between what the model proposed and what
  -- a human accepted.
  confirmed_record_ids  jsonb not null default '[]'::jsonb,
  confirmed_by          uuid references public.profiles (id) on delete set null,
  confirmed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index vaccination_card_extractions_patient_idx
  on public.vaccination_card_extractions (patient_id, created_at desc);
create index vaccination_card_extractions_org_idx
  on public.vaccination_card_extractions (organisation_id);

create trigger vaccination_card_extractions_set_updated_at
  before update on public.vaccination_card_extractions
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Structural guardrail: only public.confirm_vaccination_card_extraction() may
-- complete the 'confirmed' transition. A raw client update (or a direct
-- INSERT starting straight at 'confirmed', which the insert policy alone
-- would not stop) would leave a draft that claims to be filed with nothing
-- actually filed into vaccination_records — the RPC sets a transaction-local
-- flag immediately before its own internal update so this trigger can tell
-- the two apart; any other route setting 'confirmed' is rejected. Every
-- other column/status transition (draft results landing, discarding) is
-- left to plain RLS, same posture as vaccination_records itself, which a
-- patient can already edit freely on their own rows.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_vaccination_card_extraction_confirm()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status is distinct from 'confirmed') then
    if coalesce(current_setting('vaccination.confirming_extraction', true), 'false') <> 'true' then
      raise exception 'Confirming a card must go through confirm_vaccination_card_extraction()'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger vaccination_card_extractions_guard_confirm
  before insert or update on public.vaccination_card_extractions
  for each row execute function private.enforce_vaccination_card_extraction_confirm();

-- ---------------------------------------------------------------------------
-- RLS — same authority shape as vaccination_records.
-- ---------------------------------------------------------------------------
alter table public.vaccination_card_extractions enable row level security;

create policy vaccination_card_extractions_select on public.vaccination_card_extractions
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = vaccination_card_extractions.patient_id
        and pa.grantee_user_id = (select auth.uid())
    )
  );

create policy vaccination_card_extractions_insert on public.vaccination_card_extractions
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = vaccination_card_extractions.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
    )
  );

create policy vaccination_card_extractions_update on public.vaccination_card_extractions
  for update to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = vaccination_card_extractions.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
    )
  )
  with check (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = vaccination_card_extractions.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
    )
  );

create policy vaccination_card_extractions_delete on public.vaccination_card_extractions
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.vaccination_card_extractions to authenticated;

-- ---------------------------------------------------------------------------
-- Confirm: files the reviewer's accepted rows into vaccination_records
-- atomically, at 'pending_verification' with physical_certificate_path set
-- to the uploaded card image, then stamps this draft 'confirmed'. The
-- values written are whatever the REVIEWER submitted (p_records), not
-- necessarily the model's original draft — same "reviewer's numbers, not
-- the machine's" rule as confirm_lab_report_extraction.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_vaccination_card_extraction(
  p_extraction_id uuid,
  p_records jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row public.vaccination_card_extractions%rowtype;
  v_can_act boolean;
  v_record jsonb;
  v_new_id uuid;
  v_ids uuid[] := '{}';
  v_filed integer := 0;
begin
  select * into v_row from public.vaccination_card_extractions where id = p_extraction_id;
  if v_row.id is null then
    raise exception 'Extraction not found' using errcode = '42501';
  end if;

  -- Same authority as logging a dose directly: the patient themselves, a
  -- 'manage'-level caregiver, or org staff.
  select (
    (select auth.uid()) = v_row.patient_id
    or private.is_org_staff(v_row.organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = v_row.patient_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
    )
  ) into v_can_act;
  if not v_can_act then
    raise exception 'Not authorised to file this card' using errcode = '42501';
  end if;

  if v_row.status = 'confirmed' then
    raise exception 'This card has already been filed' using errcode = '23505';
  end if;
  if v_row.status = 'failed' then
    raise exception 'This card could not be read, so there is nothing to file' using errcode = '22023';
  end if;

  for v_record in select * from jsonb_array_elements(coalesce(p_records, '[]'::jsonb))
  loop
    insert into public.vaccination_records (
      organisation_id, profile_id, vaccination_catalog_id, dose_number,
      date_administered, provider, batch_lot_number, route, site, location,
      physical_certificate_path, verification_status
    ) values (
      v_row.organisation_id, v_row.patient_id,
      (v_record->>'vaccination_catalog_id')::uuid,
      coalesce((v_record->>'dose_number')::integer, 1),
      (v_record->>'date_administered')::date,
      nullif(v_record->>'provider', ''),
      nullif(v_record->>'batch_lot_number', ''),
      nullif(v_record->>'route', '')::public.vaccination_route,
      nullif(v_record->>'site', ''),
      nullif(v_record->>'location', ''),
      v_row.source_path,
      'pending_verification'
    )
    returning id into v_new_id;

    v_ids := v_ids || v_new_id;
    v_filed := v_filed + 1;
  end loop;

  if v_filed = 0 then
    raise exception 'Select at least one dose to file' using errcode = '22023';
  end if;

  perform set_config('vaccination.confirming_extraction', 'true', true);
  update public.vaccination_card_extractions
    set status = 'confirmed',
        confirmed_by = (select auth.uid()),
        confirmed_at = now(),
        confirmed_record_ids = to_jsonb(v_ids)
    where id = p_extraction_id;

  return v_filed;
end;
$function$;

revoke all on function public.confirm_vaccination_card_extraction(uuid, jsonb) from public, anon;
grant execute on function public.confirm_vaccination_card_extraction(uuid, jsonb) to authenticated;

do $$
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'vaccination_card_extractions') then
    raise exception 'vaccination_card_extractions table was not created';
  end if;
  if not has_table_privilege('authenticated', 'public.vaccination_card_extractions', 'SELECT') then
    raise exception 'vaccination_card_extractions: authenticated grant did not take';
  end if;
  if has_table_privilege('anon', 'public.vaccination_card_extractions', 'SELECT') then
    raise exception 'FAIL: anon can read vaccination_card_extractions';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'vaccination_card_extractions_guard_confirm'
      and tgrelid = 'public.vaccination_card_extractions'::regclass and not tgisinternal
  ) then
    raise exception 'vaccination_card_extractions_guard_confirm trigger was not created';
  end if;
  if has_function_privilege('anon', 'public.confirm_vaccination_card_extraction(uuid, jsonb)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute confirm_vaccination_card_extraction';
  end if;
  raise notice 'PASS: vaccination_card_extractions + confirm RPC installed';
end $$;
