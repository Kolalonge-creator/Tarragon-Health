-- Prescription supply record, hardening (follow-up to the phase 3 review, founder instruction 2026-10-01 "fix all").
--
-- Three gaps the review flagged and left:
--  1. Unverified recording. There is no register to check a pharmacist against (no PCN lookup exists to call), so the honest fix is to make the
--     claim harder to fake and visible: the pharmacist registration number is now REQUIRED (3 to 40 letters, digits, space, / - .), the row stores
--     pharmacist_registration_verified = false (always, until a real register check exists), and the patient is shown the pharmacy, pharmacist and
--     registration so they can see a recording that looks wrong.
--  2. A fake supply from a QR holder. Two controls: the patient is told at once (in-app notification, template prescription_supply_recorded, which
--     the web bell renders; in_app rows never pass through the send-pending-notifications edge function, so nothing is redeployed), and the patient
--     can DISPUTE a supply (public.dispute_prescription_supply). A disputed supply stops counting toward the permitted supplies, so the real next
--     pharmacy sees a supply available again, and an audit_log row records the dispute for the care team.
--  3. Refused attempts left no trace. Every refusal against a real prescription (not_active, duplicate, no_supply_available, invalid names) is now
--     written to prescription_supply_attempts with only a hash of the token, never the token. Capped at 20 rows per prescription per hour so the log
--     cannot be used to fill the table. Unknown or malformed tokens are not logged (they resolve to nothing, and logging them would let an anonymous
--     caller write unlimited rows).
-- pharmacy_order_dispenses had 0 rows when written; the new columns need no backfill.

alter table public.pharmacy_order_dispenses
  add column if not exists pharmacist_registration_verified boolean not null default false,
  add column if not exists disputed_at timestamptz,
  add column if not exists disputed_by uuid references public.profiles (id) on delete set null,
  add column if not exists dispute_note text;

alter table public.pharmacy_order_dispenses
  add constraint pharmacy_order_dispenses_dispute_note_length check (char_length(dispute_note) <= 500);

comment on column public.pharmacy_order_dispenses.pharmacist_registration_verified is
  'Always false for recorded_via = public_verification: the registration number is typed by the pharmacy and is not checked against a register. Set true only by a future real verification.';
comment on column public.pharmacy_order_dispenses.disputed_at is
  'Set when the patient says this supply did not happen. A disputed supply is excluded from the permitted-supplies count (verify_prescription_public, record_prescription_supply_public).';

create table public.prescription_supply_attempts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id uuid not null references public.profiles (id) on delete cascade,
  medication_id uuid not null references public.medications (id) on delete cascade,
  outcome text not null check (outcome in ('not_active', 'duplicate', 'no_supply_available', 'invalid')),
  token_hash text not null,
  pharmacy_name text,
  pharmacist_name text,
  created_at timestamptz not null default now(),
  constraint prescription_supply_attempts_name_lengths check (char_length(pharmacy_name) <= 120 and char_length(pharmacist_name) <= 120)
);
create index prescription_supply_attempts_medication_idx on public.prescription_supply_attempts (medication_id, created_at desc);

alter table public.prescription_supply_attempts enable row level security;
revoke all on public.prescription_supply_attempts from anon;
grant select on public.prescription_supply_attempts to authenticated;

create policy prescription_supply_attempts_select on public.prescription_supply_attempts
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

comment on table public.prescription_supply_attempts is
  'Refused attempts to record a supply against a REAL prescription (public.record_prescription_supply_public). Written only by that function; token_hash is a hash, never the token.';

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
   where d.medication_id = v_med.id and d.source = 'pharmacy' and d.disputed_at is null;

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

create or replace function public.record_prescription_supply_public(
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
  v_dispense_id uuid;
  v_recent integer;
  v_pharmacy text := btrim(coalesce(p_pharmacy_name, ''));
  v_pharmacist text := btrim(coalesce(p_pharmacist_name, ''));
  v_reg text := nullif(btrim(coalesce(p_pharmacist_registration, '')), '');
  v_qty text := nullif(btrim(coalesce(p_quantity_supplied, '')), '');
  v_hash text;
  v_patient_name text;
  v_outcome text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return query select 'not_found'::text, 0, 0;
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

  v_hash := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');

  select count(*) into v_approved from public.medication_repeat_requests mrr
   where mrr.medication_id = v_med.id and mrr.status = 'approved';
  select count(*) into v_dispensed from public.pharmacy_order_dispenses d
   where d.medication_id = v_med.id and d.source = 'pharmacy' and d.disputed_at is null;
  v_permitted := 1 + least(coalesce(v_approved, 0), coalesce(v_med.repeats_allowed, 0));

  v_outcome := case
    when char_length(v_pharmacy) not between 2 and 120
      or char_length(v_pharmacist) not between 2 and 120
      or v_reg is null
      or v_reg !~ '^[A-Za-z0-9][A-Za-z0-9 /.\-]{1,38}[A-Za-z0-9]$'
      or char_length(coalesce(v_qty, '')) > 100 then 'invalid'
    when v_med.superseded_at is not null or not v_med.is_active
      or (v_med.expires_at is not null and v_med.expires_at < now()) then 'not_active'
    when exists (select 1 from public.pharmacy_order_dispenses d
                  where d.medication_id = v_med.id and d.source = 'pharmacy'
                    and d.created_at > now() - interval '10 minutes') then 'duplicate'
    when v_dispensed >= v_permitted then 'no_supply_available'
    else 'recorded'
  end;

  if v_outcome <> 'recorded' then
    select count(*) into v_recent from public.prescription_supply_attempts a
     where a.medication_id = v_med.id and a.created_at > now() - interval '1 hour';
    if v_recent < 20 then
      insert into public.prescription_supply_attempts (organisation_id, patient_id, medication_id, outcome, token_hash, pharmacy_name, pharmacist_name)
      values (v_med.organisation_id, v_med.patient_id, v_med.id, v_outcome, v_hash,
              left(nullif(v_pharmacy, ''), 120), left(nullif(v_pharmacist, ''), 120));
    end if;
    return query select v_outcome, v_dispensed, v_permitted;
    return;
  end if;

  insert into public.pharmacy_order_dispenses (
    organisation_id, patient_id, medication_id, drug_name, strength, quantity, quantity_prescribed,
    dispensed_on, source, recorded_by, pharmacy_name, pharmacist_name, pharmacist_registration,
    pharmacist_registration_verified, recorded_via
  ) values (
    v_med.organisation_id, v_med.patient_id, v_med.id, v_med.drug_name, v_med.dose,
    coalesce(v_qty, v_med.quantity), v_med.quantity,
    (now() at time zone 'Africa/Lagos')::date, 'pharmacy', null, v_pharmacy, v_pharmacist, v_reg,
    false, 'public_verification'
  ) returning id into v_dispense_id;

  select full_name into v_patient_name from public.profiles where id = v_med.patient_id;
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (v_med.organisation_id, v_med.patient_id, 'in_app', 'pending', 'prescription_supply_recorded',
          jsonb_build_object(
            'drug_name', v_med.drug_name,
            'rx_number', v_med.rx_number,
            'pharmacy_name', v_pharmacy,
            'pharmacist_name', v_pharmacist,
            'pharmacist_registration', v_reg,
            'dispense_id', v_dispense_id,
            'supplies_dispensed', v_dispensed + 1,
            'supplies_permitted', v_permitted));

  return query select 'recorded'::text, v_dispensed + 1, v_permitted;
end;
$$;

create or replace function public.dispute_prescription_supply(p_dispense_id uuid, p_note text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.pharmacy_order_dispenses%rowtype;
  v_caller uuid := (select auth.uid());
begin
  if v_caller is null then
    return false;
  end if;
  select * into v_row from public.pharmacy_order_dispenses d
   where d.id = p_dispense_id and d.patient_id = v_caller and d.source = 'pharmacy' and d.disputed_at is null
   for update;
  if v_row.id is null then
    return false;
  end if;
  update public.pharmacy_order_dispenses
     set disputed_at = now(), disputed_by = v_caller, dispute_note = left(nullif(btrim(coalesce(p_note, '')), ''), 500)
   where id = v_row.id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, subject_patient_id, result, event)
  values (v_row.organisation_id, v_caller, 'prescription.supply_disputed', 'pharmacy_order_dispenses', v_row.id, v_row.patient_id, 'success',
          jsonb_build_object('medication_id', v_row.medication_id, 'pharmacy_name', v_row.pharmacy_name,
                             'pharmacist_registration', v_row.pharmacist_registration, 'recorded_via', v_row.recorded_via));
  return true;
end;
$$;

revoke all on function public.dispute_prescription_supply(uuid, text) from public;
revoke all on function public.dispute_prescription_supply(uuid, text) from anon;
grant execute on function public.dispute_prescription_supply(uuid, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.dispute_prescription_supply(uuid,text)', 'EXECUTE') then
    raise exception 'dispute_prescription_supply must not be anon-executable';
  end if;
  if not has_function_privilege('anon', 'public.record_prescription_supply_public(text,text,text,text,text)', 'EXECUTE') then
    raise exception 'record_prescription_supply_public lost its anon grant';
  end if;
  if not has_function_privilege('anon', 'public.verify_prescription_public(text)', 'EXECUTE') then
    raise exception 'verify_prescription_public lost its anon grant';
  end if;
  if has_table_privilege('anon', 'public.prescription_supply_attempts', 'SELECT') then
    raise exception 'anon can read prescription_supply_attempts';
  end if;
end $$;
