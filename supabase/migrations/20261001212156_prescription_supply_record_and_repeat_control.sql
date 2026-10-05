-- Prescription PDF, phase 3: a dispensing record and repeat control that work before any pharmacy partner is live (founder decision D3, 2026-10-01).
--
-- A pharmacy that scans the QR (phase 2) can now RECORD that it supplied the prescription, with no account. This is what stops one printed
-- prescription being filled at several pharmacies, and what lets the check say whether a supply is still available.
--
-- Rules (all enforced in public.record_prescription_supply_public, SECURITY DEFINER, anon-executable on purpose):
--  * Only an ACTIVE prescription (not superseded, expired or stopped) can be supplied.
--  * Supplies permitted = 1 + the repeats a clinician has APPROVED (capped at repeats_allowed). The first supply needs no request; every later
--    one needs the patient's repeat request to have been approved (medication_repeat_requests, unchanged), so a pharmacy can never run through
--    the repeats on its own. The clinical gate stays exactly where it was.
--  * Supplies dispensed = rows in pharmacy_order_dispenses with source 'pharmacy' for the medication. A patient's own "I picked this up" row
--    (source 'patient') is a claim, not a supply, and is not counted.
--  * The same prescription cannot be recorded twice inside 10 minutes (double submit, or two counters at once). The medication row is locked
--    for the check and insert so two simultaneous recordings cannot both take the last supply.
--  * Who recorded it is free text the pharmacy types (pharmacy name, pharmacist name, optional registration). It is self-declared and stored
--    as such (recorded_via = 'public_verification'); it is not an identity check.
--
-- verify_prescription_public gains supplies_dispensed / supplies_permitted / supply_available / last_supplied_on and its repeats_used /
-- repeats_remaining now count real supplies (repeats_used = supplies dispensed after the first). OUT parameters change, so the function is
-- dropped and recreated with the same grants (the release-integrity allowlist entry is unchanged: same name and argument list).
-- pharmacy_order_dispenses had 0 rows when written, so the new NOT NULL-free columns need no backfill.

alter table public.pharmacy_order_dispenses
  add column if not exists pharmacist_name text,
  add column if not exists pharmacist_registration text,
  add column if not exists recorded_via text not null default 'app';

alter table public.pharmacy_order_dispenses
  add constraint pharmacy_order_dispenses_pharmacist_name_length check (char_length(pharmacist_name) <= 120),
  add constraint pharmacy_order_dispenses_pharmacist_registration_length check (char_length(pharmacist_registration) <= 40),
  add constraint pharmacy_order_dispenses_recorded_via_values check (recorded_via in ('app', 'partner', 'public_verification'));

comment on column public.pharmacy_order_dispenses.recorded_via is
  'How the row was created: app (patient or Tarragon staff), partner (a logged-in pharmacy partner), public_verification (a pharmacy that scanned the prescription QR; pharmacy and pharmacist names are self-declared).';

drop function if exists public.verify_prescription_public(text);

create function public.verify_prescription_public(p_token text)
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
  supplies_dispensed integer,
  supplies_permitted integer,
  supply_available boolean,
  last_supplied_on date,
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
  v_approved integer;
  v_dispensed integer;
  v_last date;
  v_permitted integer;
  v_status text;
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

  select count(*) into v_approved from public.medication_repeat_requests mrr
   where mrr.medication_id = v_med.id and mrr.status = 'approved';
  select count(*), max(d.dispensed_on) into v_dispensed, v_last from public.pharmacy_order_dispenses d
   where d.medication_id = v_med.id and d.source = 'pharmacy';

  v_permitted := 1 + least(coalesce(v_approved, 0), coalesce(v_med.repeats_allowed, 0));
  v_status := case
    when v_med.superseded_at is not null then 'superseded'
    when v_med.expires_at is not null and v_med.expires_at < now() then 'expired'
    when not v_med.is_active then 'cancelled'
    else 'active'
  end;

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
    v_status,
    v_med.rx_number, v_med.drug_name, v_med.dose, v_med.frequency, v_med.quantity, v_med.duration_days,
    coalesce(v_med.repeats_allowed, 0),
    greatest(coalesce(v_dispensed, 0) - 1, 0),
    greatest(coalesce(v_med.repeats_allowed, 0) - greatest(coalesce(v_dispensed, 0) - 1, 0), 0),
    coalesce(v_dispensed, 0),
    v_permitted,
    (v_status = 'active' and coalesce(v_dispensed, 0) < v_permitted),
    v_last,
    v_med.created_at, v_med.expires_at, v_med.version,
    coalesce(v_name, 'Tarragon care team'), v_cred;
end;
$$;

revoke all on function public.verify_prescription_public(text) from public;
grant execute on function public.verify_prescription_public(text) to anon, authenticated;

create function public.record_prescription_supply_public(
  p_token text,
  p_pharmacy_name text,
  p_pharmacist_name text,
  p_pharmacist_registration text default null,
  p_quantity_supplied text default null
)
returns table (outcome text, supplies_dispensed integer, supplies_permitted integer)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_med public.medications%rowtype;
  v_approved integer;
  v_dispensed integer;
  v_permitted integer;
  v_pharmacy text := btrim(coalesce(p_pharmacy_name, ''));
  v_pharmacist text := btrim(coalesce(p_pharmacist_name, ''));
  v_reg text := nullif(btrim(coalesce(p_pharmacist_registration, '')), '');
  v_qty text := nullif(btrim(coalesce(p_quantity_supplied, '')), '');
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return query select 'not_found'::text, 0, 0;
    return;
  end if;
  if char_length(v_pharmacy) not between 2 and 120
     or char_length(v_pharmacist) not between 2 and 120
     or char_length(coalesce(v_reg, '')) > 40
     or char_length(coalesce(v_qty, '')) > 100 then
    return query select 'invalid'::text, 0, 0;
    return;
  end if;

  -- Lock the prescription row so two counters recording at once cannot both take the last supply.
  select * into v_med from public.medications m
   where m.public_token = p_token and m.source = 'clinician'
   for update;
  if v_med.id is null then
    return query select 'not_found'::text, 0, 0;
    return;
  end if;

  select count(*) into v_approved from public.medication_repeat_requests mrr
   where mrr.medication_id = v_med.id and mrr.status = 'approved';
  select count(*) into v_dispensed from public.pharmacy_order_dispenses d
   where d.medication_id = v_med.id and d.source = 'pharmacy';
  v_permitted := 1 + least(coalesce(v_approved, 0), coalesce(v_med.repeats_allowed, 0));

  if v_med.superseded_at is not null or not v_med.is_active
     or (v_med.expires_at is not null and v_med.expires_at < now()) then
    return query select 'not_active'::text, v_dispensed, v_permitted;
    return;
  end if;

  if exists (select 1 from public.pharmacy_order_dispenses d
              where d.medication_id = v_med.id and d.source = 'pharmacy'
                and d.created_at > now() - interval '10 minutes') then
    return query select 'duplicate'::text, v_dispensed, v_permitted;
    return;
  end if;

  if v_dispensed >= v_permitted then
    return query select 'no_supply_available'::text, v_dispensed, v_permitted;
    return;
  end if;

  insert into public.pharmacy_order_dispenses (
    organisation_id, patient_id, medication_id, drug_name, strength, quantity, quantity_prescribed,
    dispensed_on, source, recorded_by, pharmacy_name, pharmacist_name, pharmacist_registration, recorded_via
  ) values (
    v_med.organisation_id, v_med.patient_id, v_med.id, v_med.drug_name, v_med.dose,
    coalesce(v_qty, v_med.quantity), v_med.quantity,
    (now() at time zone 'Africa/Lagos')::date, 'pharmacy', null, v_pharmacy, v_pharmacist, v_reg, 'public_verification'
  );

  return query select 'recorded'::text, v_dispensed + 1, v_permitted;
end;
$$;

revoke all on function public.record_prescription_supply_public(text, text, text, text, text) from public;
grant execute on function public.record_prescription_supply_public(text, text, text, text, text) to anon, authenticated;

do $$
begin
  if not has_function_privilege('anon', 'public.record_prescription_supply_public(text,text,text,text,text)', 'EXECUTE') then
    raise exception 'record_prescription_supply_public must be anon-executable: that is the feature';
  end if;
  if not has_function_privilege('anon', 'public.verify_prescription_public(text)', 'EXECUTE') then
    raise exception 'verify_prescription_public lost its anon grant';
  end if;
end $$;
