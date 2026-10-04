-- Prescription PDF, phase 2: no-login verification for a pharmacy that has no TarragonHealth account (founder decision D2, 2026-10-01).
--
-- The existing verify_prescription(rx_number, verification_code) answers only a logged-in pharmacist, and its two inputs are weak for a public
-- page: the Rx number is a visible sequence and the code is 24 bits. So the public check is keyed on a NEW high-entropy token carried by the QR
-- on the PDF (64 hex characters, two random UUIDs with the dashes removed: more than 240 bits). The token is the whole credential: whoever
-- holds the printed prescription can check it, nobody can walk the space, and no patient identifier is ever returned.
--
--  1. medications.public_token, unique, stamped for every clinician prescription at insert (extends private.stamp_prescription_lifecycle,
--     live body reproduced with one addition) and backfilled for existing rows (2 clinician prescriptions live when written). The backfill
--     disables user triggers for the one UPDATE because private.enforce_medication_confirm_only would otherwise stamp last_confirmed_at and
--     last_confirmed_by on a row nobody confirmed; the token is not clinical, so skipping the row-change audit for it is deliberate.
--     A patient cannot edit the column: private.enforce_patient_clinician_medication_allowlist compares the whole row, and staff have no
--     UPDATE path (S05f).
--  2. public.verify_prescription_public(p_token text): SECURITY DEFINER, anon-executable on purpose (added to the release-integrity allowlist).
--     Returns proof only: status, Rx number, drug, dose, frequency, quantity, duration, repeats allowed / used / remaining, validity, version,
--     prescriber name and credential. It returns NO patient name, date of birth, number or contact detail. An unknown, malformed or
--     non-clinician token returns zero rows, indistinguishable from each other. Rate limiting is applied by the page that calls it.

alter table public.medications add column if not exists public_token text;

create unique index if not exists medications_public_token_key
  on public.medications (public_token) where public_token is not null;

comment on column public.medications.public_token is
  'High-entropy (64 hex) credential carried by the prescription PDF QR for no-login verification via public.verify_prescription_public(). Clinician prescriptions only, set once at insert, never reassigned (an amendment is a new row with its own token). Treat like a bearer secret: never log it, never put it in a notification.';

alter table public.medications disable trigger user;
update public.medications
   set public_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
 where source = 'clinician' and public_token is null;
alter table public.medications enable trigger user;

create or replace function private.stamp_prescription_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source = 'clinician' then
    if new.rx_number is null then
      new.rx_number := 'TRG-RX-' || extract(year from now())::text || '-'
        || lpad(nextval('private.medication_rx_number_seq')::text, 6, '0');
    end if;
    if new.verification_code is null then
      new.verification_code := upper(substr(md5(gen_random_uuid()::text), 1, 6));
    end if;
    if new.public_token is null then
      new.public_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    end if;
    if new.expires_at is null then
      if coalesce(new.repeats_allowed, 0) > 0 then
        new.expires_at := now() + interval '6 months';
      elsif new.duration_days is not null then
        new.expires_at := now() + make_interval(days => new.duration_days) + interval '30 days';
      else
        new.expires_at := now() + interval '90 days';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.verify_prescription_public(p_token text)
returns table (
  status text,
  rx_number text,
  drug_name text,
  dose text,
  frequency text,
  quantity text,
  duration_days integer,
  repeats_allowed integer,
  repeats_used integer,
  repeats_remaining integer,
  signed_at timestamptz,
  expires_at timestamptz,
  version integer,
  prescriber_name text,
  prescriber_credential text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_med public.medications%rowtype;
  v_used integer;
  v_name text;
  v_cred text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  select * into v_med from public.medications m
   where m.public_token = p_token and m.source = 'clinician';
  if v_med.id is null then
    return;
  end if;

  select count(*) into v_used from public.medication_repeat_requests mrr
   where mrr.medication_id = v_med.id and mrr.status = 'approved';

  select p.full_name into v_name from public.profiles p where p.id = v_med.added_by;
  select cs.credential_type || ' ' || cs.credential_number into v_cred
    from public.clinical_staff cs
   where cs.profile_id = v_med.added_by
     and cs.license_verified_at is not null
     and (cs.license_expires_at is null or cs.license_expires_at > now())
     and cs.credential_type is not null and cs.credential_number is not null
     and cs.credential_number !~* '(pending|placeholder|tbc|tbd)'
   limit 1;

  return query select
    case
      when v_med.superseded_at is not null then 'superseded'
      when v_med.expires_at is not null and v_med.expires_at < now() then 'expired'
      when not v_med.is_active then 'cancelled'
      else 'active'
    end,
    v_med.rx_number, v_med.drug_name, v_med.dose, v_med.frequency, v_med.quantity, v_med.duration_days,
    coalesce(v_med.repeats_allowed, 0), coalesce(v_used, 0),
    greatest(coalesce(v_med.repeats_allowed, 0) - coalesce(v_used, 0), 0),
    v_med.created_at, v_med.expires_at, v_med.version,
    coalesce(v_name, 'Tarragon care team'), v_cred;
end;
$$;

revoke all on function public.verify_prescription_public(text) from public;
grant execute on function public.verify_prescription_public(text) to anon, authenticated;

do $$
begin
  if not has_function_privilege('anon', 'public.verify_prescription_public(text)', 'EXECUTE') then
    raise exception 'verify_prescription_public must be anon-executable: that is the feature';
  end if;
  if exists (select 1 from public.medications where source = 'clinician' and public_token is null) then
    raise exception 'a clinician prescription has no public_token';
  end if;
  if exists (select 1 from public.medications where public_token is not null and public_token !~ '^[0-9a-f]{64}$') then
    raise exception 'malformed public_token';
  end if;
end $$;
