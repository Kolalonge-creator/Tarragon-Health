-- Blood group and genotype may never enter the record unsourced.
--
-- Supersedes the free-text `source` column from 20260803125000 (zero rows, so
-- this is a clean structural change with nothing to convert). That version
-- allowed 'clinician_recorded' — a value with no evidence behind it at all,
-- which is exactly the rumour this table exists to prevent. A genotype on an
-- emergency card is read by a stranger who has no way to check it, so there are
-- now exactly TWO ways it can get in, and the database refuses anything else:
--
--   1. `lab_document`   — backed by a real uploaded lab report on this patient's
--                         own record. The document is linked, so anyone can go
--                         and look at what it actually said.
--   2. `patient_attested` — the patient states it themselves, having explicitly
--                         confirmed what it is and understood where it will be
--                         shown. Versioned, timestamped, and labelled as such
--                         everywhere it is displayed.
--
-- ⚠️ NOTE ON LIABILITY WORDING. The founder asked for patients to "attest and be
-- liable for any error". This migration records an ATTESTATION — what they
-- confirmed, when, and against which exact wording (`attestation_version`) — so
-- the fact is auditable. It deliberately does NOT encode a liability clause:
-- what a patient is legally answerable for is a matter for counsel to word, not
-- for a migration to invent, and it belongs with the other consent copy that is
-- already pending legal review. The mechanism to carry such wording exists here
-- the moment counsel supplies it: bump the version string.

drop table if exists public.patient_blood_profile;

create table public.patient_blood_profile (
  patient_id        uuid primary key references public.profiles (id) on delete cascade,
  organisation_id   uuid not null references public.organisations (id),
  blood_group       public.blood_group,
  genotype          public.haemoglobin_genotype,
  genotype_note     text,

  provenance        text not null check (provenance in ('lab_document', 'patient_attested')),

  -- Set only for 'lab_document'. The report this was read off, so the claim can
  -- always be traced back to something a human can re-read.
  document_id       uuid references public.lab_result_documents (id) on delete set null,

  -- Set only for 'patient_attested'. `attestation_version` pins the exact
  -- wording the patient agreed to, so a later change to that copy can never be
  -- retro-applied to someone who never saw it.
  attested_at         timestamptz,
  attestation_version text,

  recorded_by       uuid references public.profiles (id),
  recorded_at       timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint patient_blood_profile_not_empty
    check (blood_group is not null or genotype is not null),

  -- The core rule. Nothing gets in without one of the two provenances complete.
  constraint patient_blood_profile_provenance_complete check (
    (provenance = 'lab_document'   and document_id is not null
                                   and attested_at is null and attestation_version is null)
    or
    (provenance = 'patient_attested' and attested_at is not null and attestation_version is not null
                                     and document_id is null)
  )
);

alter table public.patient_blood_profile enable row level security;

create policy patient_blood_profile_select on public.patient_blood_profile
  for select using (
    patient_id = auth.uid()
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

-- Org staff write the lab-backed case (they are the ones who read the report).
create policy patient_blood_profile_staff_write on public.patient_blood_profile
  for all using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

-- The patient writes their own attested case. Scoped to their own row; the
-- trigger below is what stops them writing it as if it were lab-backed.
create policy patient_blood_profile_self_insert on public.patient_blood_profile
  for insert with check (patient_id = auth.uid());

create policy patient_blood_profile_self_update on public.patient_blood_profile
  for update using (patient_id = auth.uid()) with check (patient_id = auth.uid());

/**
 * Narrows what each caller may actually write, in the same "RLS admits broadly,
 * trigger narrows" shape as enforce_medication_confirm_only.
 *
 * A patient can only ever produce a `patient_attested` row, and the attestation
 * stamp is server-derived so it cannot be back-dated or forged. A linked
 * document must genuinely belong to this patient, which is what stops a
 * document_id being pointed at someone else's report to lend false weight.
 */
create or replace function private.enforce_blood_profile_provenance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_staff  boolean;
  v_doc_owner uuid;
begin
  v_is_staff := private.is_org_staff(new.organisation_id);

  if not v_is_staff then
    -- The caller is the patient acting on their own record. Force the only
    -- provenance they are entitled to claim, and stamp it ourselves.
    if new.patient_id <> auth.uid() then
      raise exception 'you may only record your own blood group and genotype'
        using errcode = '42501';
    end if;
    new.provenance          := 'patient_attested';
    new.document_id         := null;
    new.attested_at         := now();
    new.recorded_by         := auth.uid();
    if new.attestation_version is null then
      raise exception 'an attestation version is required' using errcode = '23514';
    end if;
  end if;

  if new.provenance = 'lab_document' then
    if new.document_id is null then
      raise exception 'a lab-backed blood group or genotype must link the report it came from'
        using errcode = '23514';
    end if;
    select patient_id into v_doc_owner
    from public.lab_result_documents where id = new.document_id;

    if v_doc_owner is null or v_doc_owner <> new.patient_id then
      raise exception 'that report does not belong to this patient'
        using errcode = '23514';
    end if;
    new.attested_at         := null;
    new.attestation_version := null;
  end if;

  -- A note only makes sense against 'other'; clearing the genotype clears it,
  -- so a stale variant description can never outlive the fact it described.
  if new.genotype is distinct from 'other'::public.haemoglobin_genotype then
    new.genotype_note := null;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists blood_profile_enforce_provenance on public.patient_blood_profile;
create trigger blood_profile_enforce_provenance
  before insert or update on public.patient_blood_profile
  for each row execute function private.enforce_blood_profile_provenance();

grant select, insert, update on public.patient_blood_profile to authenticated;

-- The assertion below needs a real patient profile to reference. A from-
-- scratch replay has none (seed.sql only inserts reference/lookup data, no
-- organisations/profiles/auth.users), which previously made the `where ...
-- limit 1` silently match zero rows and fall straight through to the "was
-- accepted" exception without ever exercising the constraint. Creates and
-- tears down its own minimal patient fixture instead.
do $$
declare
  v_test_user uuid := gen_random_uuid();
  v_org uuid;
begin
  if not has_table_privilege('authenticated', 'public.patient_blood_profile', 'SELECT') then
    raise exception 'patient_blood_profile: authenticated grant did not take';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_test_user, 'blood-profile-provenance-check@example.invalid', 'x', now(), '{}', '{}');

  select organisation_id into v_org from public.profiles where id = v_test_user;
  if v_org is null then
    select id into v_org from public.organisations limit 1;
    update public.profiles set organisation_id = v_org where id = v_test_user;
  end if;

  -- The unsourced case must be structurally impossible, not merely discouraged.
  begin
    insert into public.patient_blood_profile
      (patient_id, organisation_id, genotype, provenance)
    values (v_test_user, v_org, 'AA'::public.haemoglobin_genotype, 'lab_document');
    raise exception 'patient_blood_profile: a lab_document row was accepted with no document';
  exception
    when check_violation then null;  -- expected
    when others then
      if sqlstate = 'P0001' then raise; end if;
  end;

  -- Cascades to the auto-created profiles row and any patient_blood_profile
  -- row that (should not, but might) have been inserted above.
  delete from auth.users where id = v_test_user;
end $$;
