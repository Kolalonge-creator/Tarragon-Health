-- The Health Passport becomes a verifiable credential.
--
-- Until now the Health Passport was a PDF: real data, honestly assembled, and
-- worth exactly as much as the recipient's willingness to believe it. Anyone
-- with a word processor can produce a document that says "TarragonHealth".
-- That ceiling is the whole problem — an embassy, an employer, a UK GP surgery
-- or a Lagos hospital cannot act on a document they cannot check.
--
-- This migration adds the three things that turn the document into a record:
--
--   1. ISSUANCE. Every passport is a row here before it is a file. It carries a
--      serial, a frozen point-in-time snapshot of what it asserted, and the
--      identity of the person it was issued to as at that moment.
--   2. SIGNATURE. The app signs a canonical payload with an Ed25519 private key
--      that exists only in the server's environment, never in this database.
--      The matching public key IS stored here (public keys are public), so a
--      verifier can check the signature themselves, offline, forever — even if
--      TarragonHealth is unreachable.
--   3. REVOCATION. A passport can be revoked by the patient or by org staff, and
--      is superseded automatically when a newer one is issued. A signature alone
--      cannot express "this was true in March and is not true now"; only a live
--      status check can.
--
-- ⚠️ WHAT THE PUBLIC VERIFICATION ENDPOINT MAY RETURN — read before changing
-- `health_passport_by_serial`. This is the second anon-executable function on
-- the platform that touches a patient (the first being
-- `emergency_card_by_token`), and unlike that one it must NEVER return clinical
-- content. Not a vital, not a diagnosis, not a medicine, not a screening result.
-- The clinical content lives in the signed PDF, which the verifier is already
-- holding — that is precisely why they are on the page. What this function
-- returns is an ANSWER ABOUT A DOCUMENT: is it genuine, who issued it, when,
-- has it been withdrawn, and which doctor attested it. Identity is disclosed in
-- two stages: a masked name and a year of birth to anyone with the serial, and
-- the full legal name only to someone who can already state the date of birth
-- printed on the document they hold. Guessing is throttled.
--
-- ⚠️ DATABASE STATUS IS NECESSARY BUT NOT SUFFICIENT. `status = 'valid'` in this
-- table does not by itself mean a passport is genuine, and the verification
-- surface must never treat it that way. `seal_health_passport` runs as the
-- patient, so a patient could in principle write an arbitrary row with an
-- arbitrary signature. What they cannot do is produce a signature that verifies
-- against the published public key — the private key is not in this database and
-- is never sent to a browser. So the contract is:
--
--        authenticity  =  Ed25519 signature verifies  (checked in the app)
--        currency      =  status/expiry in this table (checked here)
--
-- Both must pass. The app's verify route enforces the first and this table the
-- second; neither is allowed to stand in for the other.

-- ---------------------------------------------------------------- enums

do $$
begin
  if not exists (select 1 from pg_type where typname = 'health_passport_status') then
    create type public.health_passport_status as enum
      ('unsigned', 'valid', 'superseded', 'revoked');
  end if;
  if not exists (select 1 from pg_type where typname = 'health_passport_attestation_status') then
    create type public.health_passport_attestation_status as enum
      ('pending', 'attested', 'declined', 'withdrawn');
  end if;
end $$;

comment on type public.health_passport_status is
  'unsigned = minted but the app never came back with a signature (never verifies); valid = signed and current; superseded = a newer passport has been issued for this patient; revoked = withdrawn deliberately.';

-- ------------------------------------------------------- signing key registry
--
-- PUBLIC keys only. The private key lives in HEALTH_PASSPORT_SIGNING_KEY in the
-- server environment and must never be written here, logged, or returned by any
-- function. Keys are kept forever after retirement: a passport signed in 2026
-- must still verify in 2031, long after its key stopped being used for new
-- signatures.

create table if not exists public.passport_signing_keys (
  kid             text primary key check (kid ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
  algorithm       text not null default 'Ed25519' check (algorithm = 'Ed25519'),
  -- Base64 (standard alphabet) of the SPKI DER public key, i.e. the body of a
  -- PEM `-----BEGIN PUBLIC KEY-----` block with the newlines removed.
  public_key_spki text not null check (length(public_key_spki) between 32 and 512),
  created_at      timestamptz not null default now(),
  -- Null until an operator turns it on; the app refuses to sign with a key that
  -- is not activated, so a key can be published for verifiers ahead of first use.
  activated_at    timestamptz,
  -- Set when the key stops signing NEW passports. Retired keys still verify old
  -- ones, forever — that is the entire reason rows here are never deleted.
  retired_at      timestamptz
);

comment on table public.passport_signing_keys is
  'Public halves of the Health Passport signing keys, keyed by kid. Never delete a row: retired keys must keep verifying passports signed while they were live. The private key is env-only (HEALTH_PASSPORT_SIGNING_KEY) and must never be stored here.';

-- ------------------------------------------------------- attestation requests
--
-- The difference between "TarragonHealth exported this record" and "a doctor
-- looked at this record and put their name and registration number to it". Both
-- passports are cryptographically genuine; only one is a clinical statement, and
-- the platform must never blur them (docs/CLINICAL_TRUST_MODEL_SPEC.md §2/§9 —
-- an attribution line requires a real attributed record behind it).

create table if not exists public.health_passport_attestation_requests (
  id               uuid primary key default gen_random_uuid(),
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  organisation_id  uuid not null references public.organisations (id),
  status           public.health_passport_attestation_status not null default 'pending',
  -- Why the patient needs an attested passport. Shown to the reviewing doctor so
  -- they know what they are putting their name to (a visa medical and a new-GP
  -- handover are not the same ask).
  purpose          text not null check (length(trim(purpose)) between 3 and 200),
  patient_note     text check (length(patient_note) <= 2000),
  requested_at     timestamptz not null default now(),
  -- Null until actioned. Deliberately nullable rather than NOT NULL: an
  -- unactioned request has no reviewer, and the platform's null-gating rule is
  -- that an absent attribution renders as absent, never as a default.
  reviewed_by      uuid references public.profiles (id) on delete restrict,
  reviewed_at      timestamptz,
  -- The doctor's own words. Printed verbatim on the passport when present.
  statement        text check (length(statement) <= 2000),
  decline_reason   text check (length(decline_reason) <= 2000),
  created_at       timestamptz not null default now()
);

create index if not exists health_passport_attestation_requests_worklist_idx
  on public.health_passport_attestation_requests (organisation_id, requested_at)
  where status = 'pending';

create index if not exists health_passport_attestation_requests_patient_idx
  on public.health_passport_attestation_requests (patient_id, requested_at desc);

-- One open request at a time per patient — a queue of duplicates is a worklist
-- problem, not a feature.
create unique index if not exists health_passport_attestation_one_open_per_patient
  on public.health_passport_attestation_requests (patient_id)
  where status = 'pending';

-- --------------------------------------------------------------- issuances

create table if not exists public.health_passport_issuances (
  id                    uuid primary key default gen_random_uuid(),
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  organisation_id       uuid not null references public.organisations (id),

  -- Printed on the document, spoken over the phone, typed into the verify page.
  -- Crockford-style base32 (no I/L/O/U, so nothing is misread as 1 or 0) in four
  -- groups of four: 80 bits of randomness, which is what makes it safe to treat
  -- the serial itself as the lookup key with no separate secret token.
  serial                text not null unique
                          check (serial ~ '^THP(-[0-9A-HJKMNP-TV-Z]{4}){4}$'),

  status                public.health_passport_status not null default 'unsigned',

  -- Frozen at mint time from `profiles`, never from anything a caller passes in.
  -- A passport asserts who it was issued to as at its issue date; if the patient
  -- later corrects their name, old passports keep saying what they said, which is
  -- what makes them checkable against a document issued years ago.
  subject_name          text not null,
  subject_dob           date,
  subject_patient_number text,

  -- The clinical content this passport asserted, frozen. Re-downloading a serial
  -- must reproduce the same document; a passport that silently tracked live data
  -- would make its own signature meaningless.
  content_snapshot      jsonb,
  -- sha256 hex of the canonical serialisation of content_snapshot. Printed on the
  -- document and shown on the verify page so the two can be compared by eye.
  content_digest        text check (content_digest ~ '^[0-9a-f]{64}$'),

  -- The exact bytes that were signed (canonical JSON, sorted keys, no
  -- whitespace) and the detached Ed25519 signature over them, base64url. Stored
  -- verbatim so a verifier can re-run the check byte-for-byte rather than trust
  -- a re-serialisation.
  signed_payload        text,
  signature             text,
  signing_kid           text references public.passport_signing_keys (kid),

  issued_at             timestamptz not null default now(),
  -- A health summary ages. Twelve months matches the emergency card and is what
  -- most institutional processes assume of a medical document.
  expires_at            timestamptz not null default (now() + interval '12 months'),

  -- Attestation, snapshotted at issue. Snapshotted rather than joined on purpose:
  -- if a doctor later leaves, changes name, or has their record edited, a
  -- passport that already went to an embassy must keep saying exactly what the
  -- embassy read. Null throughout when the passport is a plain signed export.
  attestation_request_id uuid references public.health_passport_attestation_requests (id) on delete restrict,
  attested_by            uuid references public.profiles (id) on delete restrict,
  attested_at            timestamptz,
  attesting_doctor_name  text,
  attesting_credential_type   text,
  attesting_credential_number text,
  attestation_statement  text,

  revoked_at            timestamptz,
  revoked_by            uuid references public.profiles (id) on delete restrict,
  revocation_reason     text check (length(revocation_reason) <= 500),

  verification_count    integer not null default 0,
  last_verified_at      timestamptz,
  last_verified_on      date,

  created_at            timestamptz not null default now(),

  -- A signed passport is signed completely or not at all. There is no partial
  -- state where a document verifies on some fields and not others.
  constraint health_passport_signed_completely check (
    status = 'unsigned'
    or (signature is not null and signed_payload is not null
        and signing_kid is not null and content_digest is not null)
  ),

  -- An attestation is all-or-nothing, and it is never anonymous. The
  -- "Reviewed by Dr. X" pattern must have a real record behind every part of it
  -- (CLAUDE.md: never render a doctor-review claim without a corresponding
  -- reviewed_by/reviewed_at), and for an INSTITUTIONAL document that includes the
  -- registration number — an attested passport with no number is exactly the
  -- unverifiable claim this whole migration exists to stop making.
  constraint health_passport_attestation_complete check (
    attested_by is null
    or (attested_at is not null
        and attesting_doctor_name is not null
        and attesting_credential_type is not null
        and attesting_credential_number is not null
        and attestation_request_id is not null)
  ),

  constraint health_passport_revocation_complete check (
    (status = 'revoked') = (revoked_at is not null)
  )
);

create index if not exists health_passport_issuances_patient_idx
  on public.health_passport_issuances (patient_id, issued_at desc);

create index if not exists health_passport_issuances_serial_valid_idx
  on public.health_passport_issuances (serial)
  where status = 'valid';

comment on column public.health_passport_issuances.content_snapshot is
  'Frozen clinical content as at issue. Never re-read from live tables when re-rendering a passport — the signature covers a digest of this exact value.';

comment on column public.health_passport_issuances.attesting_credential_number is
  'Snapshotted registration number (e.g. MDCN) of the attesting doctor. Enforced NOT NULL for any attested passport by health_passport_attestation_complete — an attested passport that cannot name a registered doctor must not exist.';

-- ------------------------------------------------------- verification log
--
-- Every check, shown back to the patient. A passport is a document the patient
-- hands to institutions; knowing it was looked at, and when, is the difference
-- between a credential they control and one that circulates without them.

create table if not exists public.health_passport_verifications (
  id                 uuid primary key default gen_random_uuid(),
  issuance_id        uuid not null references public.health_passport_issuances (id) on delete cascade,
  verified_at        timestamptz not null default now(),
  -- Whether the checker could also state the date of birth printed on the
  -- document, i.e. whether they were plausibly holding it rather than holding a
  -- URL. Recorded because "someone opened the link" and "someone with the
  -- document confirmed the identity" are different events for the patient.
  identity_confirmed boolean not null default false
);

create index if not exists health_passport_verifications_issuance_idx
  on public.health_passport_verifications (issuance_id, verified_at desc);

-- ------------------------------------------------------------------- RLS

alter table public.passport_signing_keys enable row level security;
alter table public.health_passport_attestation_requests enable row level security;
alter table public.health_passport_issuances enable row level security;
alter table public.health_passport_verifications enable row level security;

-- Public keys are public. This is the one table on the platform anon may read
-- directly, and it is safe precisely because a public key is designed to be
-- copied — the whole point is that a verifier who has never heard of us can
-- fetch it and check a signature without asking permission.
drop policy if exists passport_signing_keys_read on public.passport_signing_keys;
create policy passport_signing_keys_read on public.passport_signing_keys
  for select using (true);

drop policy if exists health_passport_attestation_requests_select
  on public.health_passport_attestation_requests;
create policy health_passport_attestation_requests_select
  on public.health_passport_attestation_requests
  for select using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

drop policy if exists health_passport_issuances_select on public.health_passport_issuances;
create policy health_passport_issuances_select on public.health_passport_issuances
  for select using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

drop policy if exists health_passport_verifications_select on public.health_passport_verifications;
create policy health_passport_verifications_select on public.health_passport_verifications
  for select using (
    exists (
      select 1 from public.health_passport_issuances i
      where i.id = health_passport_verifications.issuance_id
        and (i.patient_id = (select auth.uid()) or private.is_org_staff(i.organisation_id))
    )
  );

-- No insert/update/delete policy anywhere by design. Every state change goes
-- through a security-definer RPC below, so a passport cannot be minted for
-- someone else, an attestation cannot be written without the tier and
-- credential checks, and a revocation is always attributed.

-- A freshly created table gets no table-level grant from RLS alone. This has
-- silently broken access on this project at least three times; an
-- `alter default privileges` migration now covers new tables, but the explicit
-- grant is kept here so the fix is visible at the point of creation and the
-- assertions at the foot of this file can prove it took.
grant select on public.passport_signing_keys to anon, authenticated;
grant select on public.health_passport_attestation_requests to authenticated;
grant select on public.health_passport_issuances to authenticated;
revoke select on public.health_passport_issuances from anon;
grant select on public.health_passport_verifications to authenticated;
revoke select on public.health_passport_verifications from anon;

-- ------------------------------------------------------------ serial minting

create or replace function private.new_passport_serial()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  -- Crockford base32 minus I, L, O and U: nothing in this alphabet can be
  -- misread as 1, 0 or as an accidental word. Someone reads this down a phone
  -- line to a consulate, so that matters more than density.
  v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes    bytea;
  v_serial   text := 'THP';
  v_i        integer;
begin
  for v_attempt in 1..8 loop
    v_serial := 'THP';
    v_bytes := extensions.gen_random_bytes(16);
    for v_i in 1..16 loop
      if v_i % 4 = 1 then
        v_serial := v_serial || '-';
      end if;
      v_serial := v_serial || substr(v_alphabet, (get_byte(v_bytes, v_i - 1) % 32) + 1, 1);
    end loop;
    exit when not exists (
      select 1 from public.health_passport_issuances where serial = v_serial
    );
  end loop;
  return v_serial;
end;
$$;

revoke all on function private.new_passport_serial() from public, anon;
grant execute on function private.new_passport_serial() to authenticated, service_role;

-- --------------------------------------------------- patient: request review

create or replace function public.request_health_passport_attestation(
  p_purpose text,
  p_note    text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_id  uuid;
begin
  select organisation_id into v_org
  from public.profiles
  where id = (select auth.uid()) and role = 'patient' and receives_care;

  if v_org is null then
    raise exception 'only a patient receiving care may request a passport attestation'
      using errcode = '42501';
  end if;

  if p_purpose is null or length(trim(p_purpose)) < 3 then
    raise exception 'a purpose is required so the reviewing doctor knows what they are attesting'
      using errcode = '22023';
  end if;

  insert into public.health_passport_attestation_requests
    (patient_id, organisation_id, purpose, patient_note)
  values ((select auth.uid()), v_org, trim(p_purpose), nullif(trim(coalesce(p_note, '')), ''))
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.withdraw_health_passport_attestation(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.health_passport_attestation_requests
  set status = 'withdrawn', reviewed_at = now()
  where id = p_request_id
    and patient_id = (select auth.uid())
    and status = 'pending';
end;
$$;

-- ------------------------------------------------ clinician: attest / decline
--
-- Two gates, both hard failures rather than silent no-ops:
--
--   TIER — Tier 2 or above, or the Clinical Director. Attesting a whole record
--   to an outside institution is a broader clinical statement than confirming a
--   refill, so it sits alongside emergency-escalation authority rather than with
--   first-line review. Deliberately its own function, not a reuse of
--   private.can_handle_emergency_escalation: these gate different acts and must
--   be free to diverge (the same reasoning that kept that one separate from
--   private.has_prescribing_authority).
--
--   CREDENTIAL — the doctor must have a registration authority and number on
--   file. This is the load-bearing check. An attested passport exists to be
--   checked by someone who has never heard of Tarragon; a named doctor with no
--   verifiable registration number gives them nothing to check. As of this
--   migration no active clinical_staff record carries a real credential number,
--   which means zero passports can be attested today — that is the correct
--   behaviour, not a bug to work around. The plain signed export still works for
--   every patient in the meantime.

create or replace function private.can_attest_health_passport(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = org
      and active
      and (
        is_clinical_director
        or doctor_tier in ('tier_2', 'tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist')
      )
  );
$$;

comment on function private.can_attest_health_passport(uuid) is
  'Tier 2+ or the org Clinical Director may attest a Health Passport. Enforcement boundary for attest_health_passport_request; mirrored for UI only by canAttestHealthPassport() in apps/web/src/lib/clinical/doctor-tier.ts.';

revoke all on function private.can_attest_health_passport(uuid) from public, anon;
grant execute on function private.can_attest_health_passport(uuid) to authenticated, service_role;

create or replace function public.attest_health_passport_request(
  p_request_id uuid,
  p_statement  text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req   public.health_passport_attestation_requests%rowtype;
  v_staff public.clinical_staff%rowtype;
begin
  select * into v_req
  from public.health_passport_attestation_requests
  where id = p_request_id;

  if not found or v_req.status <> 'pending' then
    raise exception 'attestation request not found or already actioned'
      using errcode = 'P0002';
  end if;

  if not private.can_attest_health_passport(v_req.organisation_id) then
    raise exception 'attesting a Health Passport requires Tier 2 or above, or Clinical Director'
      using errcode = '42501';
  end if;

  select * into v_staff
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = v_req.organisation_id
    and active;

  if v_staff.credential_type is null or v_staff.credential_number is null
     or length(trim(v_staff.credential_number)) = 0 then
    raise exception 'a registration authority and number must be on your staff record before you can attest a passport'
      using errcode = '42501';
  end if;

  update public.health_passport_attestation_requests
  set status      = 'attested',
      reviewed_by = (select auth.uid()),
      reviewed_at = now(),
      statement   = nullif(trim(coalesce(p_statement, '')), '')
  where id = p_request_id;

  -- The patient asked; tell them it is ready rather than making them check.
  insert into public.notifications
    (organisation_id, recipient_id, channel, template, payload)
  values
    (v_req.organisation_id, v_req.patient_id, 'in_app', 'health_passport_attested',
     jsonb_build_object('request_id', p_request_id)),
    (v_req.organisation_id, v_req.patient_id, 'email', 'health_passport_attested',
     jsonb_build_object('request_id', p_request_id));

  return p_request_id;
end;
$$;

create or replace function public.decline_health_passport_attestation(
  p_request_id uuid,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.health_passport_attestation_requests%rowtype;
begin
  select * into v_req
  from public.health_passport_attestation_requests
  where id = p_request_id;

  if not found or v_req.status <> 'pending' then
    raise exception 'attestation request not found or already actioned'
      using errcode = 'P0002';
  end if;

  if not private.can_attest_health_passport(v_req.organisation_id) then
    raise exception 'declining a Health Passport attestation requires Tier 2 or above, or Clinical Director'
      using errcode = '42501';
  end if;

  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'a reason is required — the patient is told why'
      using errcode = '22023';
  end if;

  update public.health_passport_attestation_requests
  set status         = 'declined',
      reviewed_by    = (select auth.uid()),
      reviewed_at    = now(),
      decline_reason = trim(p_reason)
  where id = p_request_id;

  insert into public.notifications
    (organisation_id, recipient_id, channel, template, payload)
  values
    (v_req.organisation_id, v_req.patient_id, 'in_app', 'health_passport_attestation_declined',
     jsonb_build_object('request_id', p_request_id, 'reason', trim(p_reason)));
end;
$$;

-- ----------------------------------------------------------------- mint
--
-- Step one of two. Creates the issuance row and returns the facts the app must
-- sign. Identity and attestation are read HERE, from the database, and returned
-- to the caller — the app signs what this function says, not what its caller
-- claims. That is what stops a signed passport from ever asserting a name or a
-- doctor that the database does not hold.

create or replace function public.mint_health_passport(
  p_attestation_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_req     public.health_passport_attestation_requests%rowtype;
  v_staff   public.clinical_staff%rowtype;
  v_doctor  public.profiles%rowtype;
  v_serial  text;
  v_id      uuid;
  v_issued  timestamptz := now();
  v_expires timestamptz := now() + interval '12 months';
begin
  select * into v_profile
  from public.profiles
  where id = (select auth.uid()) and role = 'patient' and receives_care;

  if not found or v_profile.organisation_id is null then
    raise exception 'only a patient receiving care may issue their own Health Passport'
      using errcode = '42501';
  end if;

  if v_profile.full_name is null or length(trim(v_profile.full_name)) = 0 then
    raise exception 'a Health Passport cannot be issued without a name on the account'
      using errcode = '22023';
  end if;

  if p_attestation_request_id is not null then
    select * into v_req
    from public.health_passport_attestation_requests
    where id = p_attestation_request_id
      and patient_id = v_profile.id
      and status = 'attested';

    if not found then
      raise exception 'that attestation is not available for this patient'
        using errcode = 'P0002';
    end if;

    -- Re-read the doctor's record as at NOW and snapshot it onto the issuance.
    -- If their credential has since been cleared, a new attested passport must
    -- not be mintable from an old approval — the credential is the claim.
    select * into v_staff
    from public.clinical_staff
    where profile_id = v_req.reviewed_by
      and organisation_id = v_req.organisation_id;

    select * into v_doctor from public.profiles where id = v_req.reviewed_by;

    if v_staff.credential_type is null or v_staff.credential_number is null then
      raise exception 'the attesting doctor no longer has a registration number on file'
        using errcode = '42501';
    end if;
  end if;

  v_serial := private.new_passport_serial();

  insert into public.health_passport_issuances (
    patient_id, organisation_id, serial, status,
    subject_name, subject_dob, subject_patient_number,
    issued_at, expires_at,
    attestation_request_id, attested_by, attested_at,
    attesting_doctor_name, attesting_credential_type, attesting_credential_number,
    attestation_statement
  ) values (
    v_profile.id, v_profile.organisation_id, v_serial, 'unsigned',
    trim(v_profile.full_name), v_profile.date_of_birth, v_profile.patient_number,
    v_issued, v_expires,
    case when v_req.id is not null then v_req.id end,
    v_req.reviewed_by,
    v_req.reviewed_at,
    case when v_req.id is not null then coalesce(v_staff.full_name, v_doctor.full_name) end,
    v_staff.credential_type,
    v_staff.credential_number,
    v_req.statement
  )
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'serial', v_serial,
    'organisation_id', v_profile.organisation_id,
    'subject_name', trim(v_profile.full_name),
    'subject_dob', v_profile.date_of_birth,
    'subject_patient_number', v_profile.patient_number,
    'issued_at', v_issued,
    'expires_at', v_expires,
    'attestation', case
      when v_req.id is null then null
      else jsonb_build_object(
        'doctor_name', coalesce(v_staff.full_name, v_doctor.full_name),
        'credential_type', v_staff.credential_type,
        'credential_number', v_staff.credential_number,
        'attested_at', v_req.reviewed_at,
        'statement', v_req.statement,
        'purpose', v_req.purpose
      )
    end
  );
end;
$$;

-- ----------------------------------------------------------------- seal
--
-- Step two. The app has now built the canonical payload from what mint returned,
-- signed it with the environment's private key, and frozen the content. Sealing
-- flips the row to 'valid' and supersedes whatever the patient was carrying
-- before, so an older PDF cannot be presented as the current one.

create or replace function public.seal_health_passport(
  p_issuance_id    uuid,
  p_content_snapshot jsonb,
  p_content_digest text,
  p_signed_payload text,
  p_signature      text,
  p_kid            text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.health_passport_issuances%rowtype;
begin
  select * into v_row
  from public.health_passport_issuances
  where id = p_issuance_id
    and patient_id = (select auth.uid())
    and status = 'unsigned';

  if not found then
    raise exception 'no unsigned passport of yours with that id'
      using errcode = 'P0002';
  end if;

  if p_content_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'content digest must be lowercase sha256 hex' using errcode = '22023';
  end if;
  if p_signature is null or length(p_signature) < 64 then
    raise exception 'a passport cannot be sealed without a signature' using errcode = '22023';
  end if;
  if not exists (select 1 from public.passport_signing_keys where kid = p_kid) then
    raise exception 'unknown signing key %', p_kid using errcode = '23503';
  end if;

  -- Everything the patient was carrying before this moment stops being current.
  -- Superseded, not revoked: those passports were genuine and were genuinely
  -- issued, and a verifier should be told the difference.
  update public.health_passport_issuances
  set status = 'superseded'
  where patient_id = v_row.patient_id
    and status = 'valid'
    and id <> p_issuance_id;

  update public.health_passport_issuances
  set status           = 'valid',
      content_snapshot = p_content_snapshot,
      content_digest   = p_content_digest,
      signed_payload   = p_signed_payload,
      signature        = p_signature,
      signing_kid      = p_kid
  where id = p_issuance_id;
end;
$$;

-- --------------------------------------------------------------- revocation

create or replace function public.revoke_health_passport(
  p_issuance_id uuid,
  p_reason      text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.health_passport_issuances%rowtype;
begin
  select * into v_row from public.health_passport_issuances where id = p_issuance_id;
  if not found then
    raise exception 'passport not found' using errcode = 'P0002';
  end if;

  -- The patient owns the document. Org staff can also pull one — a passport
  -- issued off a record that turned out to be wrong has to be stoppable by the
  -- people who found the error, not only by the person holding the PDF.
  if v_row.patient_id <> (select auth.uid())
     and not private.is_org_staff(v_row.organisation_id) then
    raise exception 'not authorised to revoke this passport' using errcode = '42501';
  end if;

  if v_row.status = 'revoked' then
    return;
  end if;

  update public.health_passport_issuances
  set status            = 'revoked',
      revoked_at        = now(),
      revoked_by        = (select auth.uid()),
      revocation_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = p_issuance_id;

  -- If staff revoked it, the patient needs to know before someone tells them at
  -- a consulate desk.
  if v_row.patient_id <> (select auth.uid()) then
    insert into public.notifications
      (organisation_id, recipient_id, channel, template, payload)
    values
      (v_row.organisation_id, v_row.patient_id, 'in_app', 'health_passport_revoked',
       jsonb_build_object('serial', v_row.serial, 'reason', nullif(trim(coalesce(p_reason, '')), ''))),
      (v_row.organisation_id, v_row.patient_id, 'email', 'health_passport_revoked',
       jsonb_build_object('serial', v_row.serial, 'reason', nullif(trim(coalesce(p_reason, '')), '')));
  end if;
end;
$$;

-- ------------------------------------------------------------ the public read
--
-- Anon-executable, deliberately, because the entire product goal is that a
-- stranger at an embassy or a GP surgery can check this without an account.
--
-- Returns NO CLINICAL CONTENT, ever. See the header of this file. Identity is
-- two-stage: masked always, full only to a caller who can state the date of
-- birth printed on the document. Guessing a date of birth is throttled to 20
-- attempts an hour per passport, which makes brute force useless while leaving a
-- genuine verifier — who reads it off the page in front of them — unaffected.

create or replace function public.health_passport_by_serial(
  p_serial text,
  p_dob    date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row       public.health_passport_issuances%rowtype;
  v_key       public.passport_signing_keys%rowtype;
  v_confirmed boolean := false;
  v_attempts  integer;
  v_masked    text;
  v_status    text;
begin
  if p_serial is null then
    return null;
  end if;

  -- Accept what a human actually types: lowercase, spaces instead of dashes, or
  -- the groups run together. A verifier squinting at a printed page should not
  -- be defeated by punctuation.
  p_serial := upper(regexp_replace(p_serial, '[^0-9A-Za-z]', '', 'g'));
  if p_serial !~ '^THP[0-9A-HJKMNP-TV-Z]{16}$' then
    return null;
  end if;
  p_serial := 'THP-' || substr(p_serial, 4, 4) || '-' || substr(p_serial, 8, 4)
              || '-' || substr(p_serial, 12, 4) || '-' || substr(p_serial, 16, 4);

  select * into v_row
  from public.health_passport_issuances
  where serial = p_serial;

  -- An unsigned row is an issuance that never completed. It is not a document
  -- anyone can be holding, so it does not exist as far as verification goes.
  if not found or v_row.status = 'unsigned' then
    return null;
  end if;

  -- Expiry is derived, not stored as a status: a passport that lapses overnight
  -- should start reporting as expired without anything having to run.
  v_status := case
    when v_row.status = 'revoked' then 'revoked'
    when v_row.expires_at <= now() then 'expired'
    when v_row.status = 'superseded' then 'superseded'
    else 'valid'
  end;

  select count(*) into v_attempts
  from public.health_passport_verifications
  where issuance_id = v_row.id
    and verified_at > now() - interval '1 hour';

  if p_dob is not null and v_row.subject_dob is not null and v_attempts < 20 then
    v_confirmed := (p_dob = v_row.subject_dob);
  end if;

  insert into public.health_passport_verifications (issuance_id, identity_confirmed)
  values (v_row.id, v_confirmed);

  -- One notification per calendar day, same reasoning as the emergency card: a
  -- single embassy appointment may check a passport several times, and a
  -- notification per check would train the patient to ignore all of them.
  if v_row.last_verified_on is null or v_row.last_verified_on < current_date then
    insert into public.notifications
      (organisation_id, recipient_id, channel, template, payload)
    values
      (v_row.organisation_id, v_row.patient_id, 'in_app', 'health_passport_verified',
       jsonb_build_object('serial', v_row.serial, 'verified_on', current_date));
  end if;

  update public.health_passport_issuances
  set verification_count = verification_count + 1,
      last_verified_at   = now(),
      last_verified_on   = current_date
  where id = v_row.id;

  -- First name in full, family names reduced to an initial and a length hint.
  -- Enough for a verifier holding the document to see it is the same person;
  -- not enough for a stray URL to name anybody.
  v_masked := (
    select string_agg(
      case when ord = 1 then part
           else left(part, 1) || repeat('•', greatest(length(part) - 1, 1)) end,
      ' ' order by ord)
    from (
      select part, row_number() over () as ord
      from unnest(string_to_array(v_row.subject_name, ' ')) as part
      where length(part) > 0
    ) parts
  );

  select * into v_key from public.passport_signing_keys where kid = v_row.signing_kid;

  return jsonb_build_object(
    'serial', v_row.serial,
    'status', v_status,
    'issuer', 'TarragonHealth',
    'issuer_domain', 'tarragonhealth.ng',
    'issued_at', v_row.issued_at,
    'expires_at', v_row.expires_at,
    'revoked_at', v_row.revoked_at,
    'content_digest', v_row.content_digest,
    'signature', v_row.signature,
    'signed_payload', v_row.signed_payload,
    'signing_kid', v_row.signing_kid,
    'signing_public_key', v_key.public_key_spki,
    'signing_algorithm', v_key.algorithm,
    'subject_name_masked', v_masked,
    'subject_year_of_birth', case
      when v_row.subject_dob is null then null
      else extract(year from v_row.subject_dob)::int
    end,
    'identity_confirmed', v_confirmed,
    -- Released only to a caller who already knew the date of birth, i.e. who is
    -- holding the document.
    'subject_name', case when v_confirmed then v_row.subject_name end,
    'subject_patient_number', case when v_confirmed then v_row.subject_patient_number end,
    'attestation', case
      when v_row.attested_by is null then null
      else jsonb_build_object(
        'doctor_name', v_row.attesting_doctor_name,
        'credential_type', v_row.attesting_credential_type,
        'credential_number', v_row.attesting_credential_number,
        'attested_at', v_row.attested_at,
        'statement', v_row.attestation_statement
      )
    end
  );
end;
$$;

-- --------------------------------------------------- registering a public key
--
-- Operator action, super-admin only. Takes the PUBLIC half; there is no
-- parameter here that could carry a private key even by accident. Idempotent, so
-- a deploy that re-runs the registration step is harmless, but a kid can never
-- be repointed at a DIFFERENT key — that would retroactively invalidate every
-- passport already signed under it, which is the one thing this table exists to
-- prevent.

create or replace function public.register_passport_signing_key(
  p_kid             text,
  p_public_key_spki text,
  p_activate        boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing text;
begin
  if not private.is_admin() then
    raise exception 'only a platform admin may register a passport signing key'
      using errcode = '42501';
  end if;

  select public_key_spki into v_existing
  from public.passport_signing_keys where kid = p_kid;

  if v_existing is not null and v_existing <> p_public_key_spki then
    raise exception 'kid % is already bound to a different public key; publish a new kid instead', p_kid
      using errcode = '23505';
  end if;

  insert into public.passport_signing_keys (kid, public_key_spki, activated_at)
  values (p_kid, p_public_key_spki, case when p_activate then now() end)
  on conflict (kid) do update
    set activated_at = coalesce(public.passport_signing_keys.activated_at,
                                case when p_activate then now() end);
end;
$$;

create or replace function public.retire_passport_signing_key(p_kid text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'only a platform admin may retire a passport signing key'
      using errcode = '42501';
  end if;
  -- Retired, never deleted: passports signed under this key must keep verifying.
  update public.passport_signing_keys set retired_at = now() where kid = p_kid;
end;
$$;

-- --------------------------------------------------------------- privileges

revoke all on function public.register_passport_signing_key(text, text, boolean) from public, anon;
revoke all on function public.retire_passport_signing_key(text) from public, anon;
grant execute on function public.register_passport_signing_key(text, text, boolean) to authenticated;
grant execute on function public.retire_passport_signing_key(text) to authenticated;

revoke all on function public.request_health_passport_attestation(text, text) from public, anon;
revoke all on function public.withdraw_health_passport_attestation(uuid) from public, anon;
revoke all on function public.attest_health_passport_request(uuid, text) from public, anon;
revoke all on function public.decline_health_passport_attestation(uuid, text) from public, anon;
revoke all on function public.mint_health_passport(uuid) from public, anon;
revoke all on function public.seal_health_passport(uuid, jsonb, text, text, text, text) from public, anon;
revoke all on function public.revoke_health_passport(uuid, text) from public, anon;
revoke all on function public.health_passport_by_serial(text, date) from public;

grant execute on function public.request_health_passport_attestation(text, text) to authenticated;
grant execute on function public.withdraw_health_passport_attestation(uuid) to authenticated;
grant execute on function public.attest_health_passport_request(uuid, text) to authenticated;
grant execute on function public.decline_health_passport_attestation(uuid, text) to authenticated;
grant execute on function public.mint_health_passport(uuid) to authenticated;
grant execute on function public.seal_health_passport(uuid, jsonb, text, text, text, text) to authenticated;
grant execute on function public.revoke_health_passport(uuid, text) to authenticated;
-- The deliberate exception, and the entire point of the feature.
grant execute on function public.health_passport_by_serial(text, date) to anon, authenticated;

-- ------------------------------------------------------------- assertions
--
-- "Removed"/"granted"/"revoked" is provable here rather than hopeful. Note that
-- EXECUTE is inherited through the PUBLIC pseudo-role, so `revoke ... from
-- public` above is what actually closes anon out — revoking from anon directly
-- would not, and this project has been caught believing otherwise more than once.

do $$
begin
  if not has_table_privilege('authenticated', 'public.health_passport_issuances', 'SELECT') then
    raise exception 'health_passport_issuances: authenticated grant did not take';
  end if;
  if not has_table_privilege('authenticated', 'public.health_passport_attestation_requests', 'SELECT') then
    raise exception 'health_passport_attestation_requests: authenticated grant did not take';
  end if;
  if not has_table_privilege('authenticated', 'public.health_passport_verifications', 'SELECT') then
    raise exception 'health_passport_verifications: authenticated grant did not take';
  end if;

  -- anon reaches a passport ONLY through the serial function, never the table.
  if has_table_privilege('anon', 'public.health_passport_issuances', 'SELECT') then
    raise exception 'anon must not be able to read health_passport_issuances directly';
  end if;
  if has_table_privilege('anon', 'public.health_passport_verifications', 'SELECT') then
    raise exception 'anon must not be able to read the verification log';
  end if;

  -- Public keys are the one thing anon is meant to read directly.
  if not has_table_privilege('anon', 'public.passport_signing_keys', 'SELECT') then
    raise exception 'passport_signing_keys must be anon-readable — verifiers need the public key';
  end if;

  if not has_function_privilege('anon', 'public.health_passport_by_serial(text, date)', 'EXECUTE') then
    raise exception 'health_passport_by_serial must be anon-executable — that is the feature';
  end if;
  if has_function_privilege('anon', 'public.mint_health_passport(uuid)', 'EXECUTE') then
    raise exception 'mint_health_passport must never be anon-executable';
  end if;
  if has_function_privilege('anon', 'public.seal_health_passport(uuid, jsonb, text, text, text, text)', 'EXECUTE') then
    raise exception 'seal_health_passport must never be anon-executable';
  end if;
  if has_function_privilege('anon', 'public.attest_health_passport_request(uuid, text)', 'EXECUTE') then
    raise exception 'attest_health_passport_request must never be anon-executable';
  end if;
  if has_function_privilege('anon', 'private.can_attest_health_passport(uuid)', 'EXECUTE') then
    raise exception 'the attestation tier gate must never be anon-executable';
  end if;
  if has_function_privilege('anon', 'public.register_passport_signing_key(text, text, boolean)', 'EXECUTE') then
    raise exception 'key registration must never be anon-executable';
  end if;

  -- The constraint that makes an attested passport worth attesting.
  if not exists (
    select 1 from pg_constraint
    where conname = 'health_passport_attestation_complete'
      and conrelid = 'public.health_passport_issuances'::regclass
  ) then
    raise exception 'the attestation-completeness constraint is missing';
  end if;
end $$;
