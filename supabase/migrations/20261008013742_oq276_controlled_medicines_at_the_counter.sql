-- OQ-276 (CMO decision 2026-10-07, decision sheet item 5): a second check at the pharmacy counter against the controlled-medicines list.
--
-- Before: only SIGNING hard-stopped a controlled medicine (private.prescription_safety_findings, OQ-170). The S28 counter, the QR page, the phone desk and
-- the older order screen added no check, and the older order screen even let a pharmacist record a controlled supply with a tick-box "enhanced verification".
-- Tarragon's policy (2026-10-01) is that it does not prescribe controlled medicines, so the counter check is defence in depth.
--
-- What this does
--   1. ONE list. The regex that lived inline in private.prescription_safety_findings moves, unchanged, into private.is_controlled_medicine(text);
--      signing now calls it, and so does every counter path. Change the list in one place.
--   2. Counter refusals. A controlled medicine is refused with the plain outcome 'controlled_medicine' (never an exception, so the audit row survives)
--      on: pharmacist_verify_collection and pharmacist_dispense_prescription (S28), verify_prescription (status), pharmacist_record_dispense (order
--      screen; return type void -> text), and record_prescription_supply_public (QR page; the phone desk passes the outcome through). Every refusal
--      writes an audit row (audit_log, or prescription_supply_attempts for the anonymous QR page).
--   3. Approved repeats are untouched: the supply count, repeats_allowed and approved repeat requests are read exactly as before. A repeat of an
--      ordinary medicine still goes through the same door; a controlled one is refused whatever its repeat count.
--
-- Rows affected live (checked 2026-10-07): 0 clinician medications match the list, 0 dispenses carry a controlled tier, 0 supply attempts. So no
-- conversion step exists; this is structural only. UK reference: Schedule 2 and 3 are not repeatable and valid 28 days; NAFDAC Controlled Medicines
-- Regulations 2019; tramadol nationally controlled since 2013. The list stays illustrative (OQ-170), not a verified NDLEA schedule.
-- Word boundaries below are \m and \M (Postgres); \b would be a backspace.

-- ---------------------------------------------------------------------------
-- 1. The single list
-- ---------------------------------------------------------------------------
create or replace function private.is_controlled_medicine(p_name text)
returns boolean
language sql immutable security definer set search_path = ''
as $$
  select lower(btrim(coalesce(p_name, ''))) ~* '\m(morphine|pethidine|meperidine|fentanyl|oxycodone|hydrocodone|methadone|diamorphine|codeine|tramadol|dihydrocodeine|diazepam|lorazepam|alprazolam|midazolam|clonazepam|chlordiazepoxide|methylphenidate|amphetamine|dexamfetamine|dextroamphetamine|lisdexamfetamine|phenobarbital|phenobarbitone|ketamine)\M'
$$;
revoke all on function private.is_controlled_medicine(text) from public, anon, authenticated;
grant execute on function private.is_controlled_medicine(text) to service_role;

-- True when the medicine row or any signed item on the prescription is on the list. Signing writes the name under drug_name; older rows used drug, name
-- or medication, so every string value of an item is checked rather than guessing the key.
create or replace function private.prescription_has_controlled_item(p_drug text, p_items jsonb)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.is_controlled_medicine(p_drug)
      or exists (
        select 1 from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) e
         where jsonb_typeof(e) = 'object'
           and exists (select 1 from jsonb_each_text(e) kv where private.is_controlled_medicine(kv.value)));
$$;
revoke all on function private.prescription_has_controlled_item(text, jsonb) from public, anon, authenticated;
grant execute on function private.prescription_has_controlled_item(text, jsonb) to service_role;

-- Signing now reads the same list. Everything else in the body is the live definition, unchanged.
create or replace function private.prescription_safety_findings(p_patient uuid, p_drug text, p_replacing uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_f jsonb := '[]'::jsonb;
  v_name text := lower(btrim(coalesce(p_drug, '')));
  r record;
begin
  -- TarragonHealth does not prescribe these (the prescription PDF says so). A hard stop: no override. The list is private.is_controlled_medicine.
  if private.is_controlled_medicine(v_name) then
    v_f := v_f || jsonb_build_array(jsonb_build_object('code', 'controlled_medicine', 'blocking', true));
  end if;
  for r in select allergen from public.patient_allergies
            where patient_id = p_patient and length(btrim(allergen)) >= 3 and strpos(v_name, lower(btrim(allergen))) > 0 loop
    v_f := v_f || jsonb_build_array(jsonb_build_object('code', 'allergy_match', 'allergen', r.allergen));
  end loop;
  if not exists (select 1 from public.patient_allergies where patient_id = p_patient) then
    v_f := v_f || jsonb_build_array(jsonb_build_object('code', 'allergies_unrecorded'));
  end if;
  if exists (select 1 from public.medications m
              where m.patient_id = p_patient and m.is_active and m.superseded_at is null
                and lower(btrim(m.drug_name)) = v_name and m.id is distinct from p_replacing) then
    v_f := v_f || jsonb_build_array(jsonb_build_object('code', 'duplicate_active'));
  end if;
  return v_f;
end;
$$;
revoke all on function private.prescription_safety_findings(uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. S28 counter: check the code, then refuse a controlled medicine before anything is shown or recorded
-- ---------------------------------------------------------------------------
create or replace function public.pharmacist_verify_collection(p_prescription uuid, p_code text)
returns table(outcome text, patient_name text, patient_number text, items jsonb, allergies jsonb, supplies_dispensed integer, supplies_permitted integer, outstanding_note text)
language plpgsql security definer set search_path = '' as $function$
declare v_partner uuid := private.pharmacist_partner(); rx public.prescriptions%rowtype; v_out text; v_med public.medications%rowtype; v_disp integer; v_perm integer; v_appr integer;
begin
  if v_partner is null then raise exception 'This action is for partner pharmacies' using errcode = '42501'; end if;
  if not private.pharmacy_collection_on() then raise exception 'pharmacy_collection_off' using errcode = '55000'; end if;
  select * into rx from public.prescriptions where id = p_prescription and pharmacy_partner_id = v_partner and state = 'sent' for update;
  if not found then return query select 'not_found'::text, null::text, null::text, null::jsonb, null::jsonb, 0, 0, null::text; return; end if;
  v_out := private.check_collection_code(rx.id, p_code, v_partner);
  if v_out <> 'ok' then return query select v_out, null::text, null::text, null::jsonb, null::jsonb, 0, 0, null::text; return; end if;
  select * into v_med from public.medications m where m.prescription_id = rx.id and m.source = 'clinician';
  if v_med.id is null then return query select 'no_medication'::text, null::text, null::text, null::jsonb, null::jsonb, 0, 0, null::text; return; end if;
  -- OQ-276: the second check. The code was right, so the pharmacist learns only that this is not supplied here; nothing about the patient is shown.
  if private.prescription_has_controlled_item(v_med.drug_name, rx.items) then
    perform private.log_audit('pharmacy.controlled_medicine_refused', 'prescriptions', rx.id, jsonb_build_object('step', 'verify', 'pharmacy_partner_id', v_partner));
    return query select 'controlled_medicine'::text, null::text, null::text, null::jsonb, null::jsonb, 0, 0, null::text; return;
  end if;
  select count(*) into v_appr from public.medication_repeat_requests r where r.medication_id = v_med.id and r.status = 'approved';
  select count(*) into v_disp from public.pharmacy_order_dispenses d where d.medication_id = v_med.id and d.source = 'pharmacy' and d.disputed_at is null and not coalesce(d.is_partial, false);
  v_perm := 1 + least(coalesce(v_appr, 0), coalesce(v_med.repeats_allowed, 0));
  perform private.log_audit('pharmacy.prescription_opened', 'prescriptions', rx.id, jsonb_build_object('pharmacy_partner_id', v_partner));
  return query
    select 'ok'::text, p.full_name, p.patient_number, rx.items,
           coalesce((select jsonb_agg(jsonb_build_object('allergen', a.allergen, 'reaction', a.reaction, 'severity', a.severity) order by a.allergen)
                       from public.patient_allergies a where a.patient_id = rx.patient_id), '[]'::jsonb),
           v_disp, v_perm,
           (select d.outstanding_note from public.pharmacy_order_dispenses d where d.medication_id = v_med.id and d.source = 'pharmacy' and d.is_partial and d.disputed_at is null order by d.created_at desc limit 1)
      from public.profiles p where p.id = rx.patient_id;
end $function$;

create or replace function public.pharmacist_dispense_prescription(
  p_prescription uuid, p_code text, p_quantity text, p_is_partial boolean, p_outstanding_note text, p_batch text, p_expiry date, p_registration text, p_pharmacist_name text)
returns table(outcome text, supplies_dispensed integer, supplies_permitted integer)
language plpgsql security definer set search_path = '' as $function$
#variable_conflict use_column
declare
  v_partner uuid := private.pharmacist_partner(); rx public.prescriptions%rowtype; v_out text; v_med public.medications%rowtype;
  v_disp integer; v_perm integer; v_appr integer; v_dispense uuid; v_pname text; v_partial boolean := coalesce(p_is_partial, false);
  v_reg text := nullif(btrim(coalesce(p_registration, '')), ''); v_who text := btrim(coalesce(p_pharmacist_name, ''));
  v_qty text := nullif(btrim(coalesce(p_quantity, '')), ''); v_note text := nullif(btrim(coalesce(p_outstanding_note, '')), '');
  v_batch text := nullif(btrim(coalesce(p_batch, '')), '');
begin
  if v_partner is null then raise exception 'This action is for partner pharmacies' using errcode = '42501'; end if;
  if not private.pharmacy_collection_on() then raise exception 'pharmacy_collection_off' using errcode = '55000'; end if;
  select * into rx from public.prescriptions where id = p_prescription and pharmacy_partner_id = v_partner and state = 'sent' for update;
  if not found then return query select 'not_found'::text, 0, 0; return; end if;
  -- the medicine row is the shared lock: the QR path and the phone desk lock the same row, so two doors cannot both take the last supply
  select * into v_med from public.medications m where m.prescription_id = rx.id and m.source = 'clinician' for update;
  if v_med.id is null then return query select 'no_medication'::text, 0, 0; return; end if;
  v_out := private.check_collection_code(rx.id, p_code, v_partner);
  if v_out <> 'ok' then return query select v_out, 0, 0; return; end if;
  -- OQ-276: the second check, before any supply is recorded. Refused with an outcome (not an exception) so the audit row is kept.
  if private.prescription_has_controlled_item(v_med.drug_name, rx.items) then
    perform private.log_audit('pharmacy.controlled_medicine_refused', 'prescriptions', rx.id, jsonb_build_object('step', 'dispense', 'pharmacy_partner_id', v_partner));
    return query select 'controlled_medicine'::text, 0, 0; return;
  end if;
  -- S28c: batch and expiry are the pharmacy's own record of what it handed over, required for any supply. An out-of-date batch is never recorded
  -- as supplied. Tarragon does not check that a batch is genuine and says so.
  if v_batch is null or p_expiry is null then return query select 'batch_required'::text, 0, 0; return; end if;
  if p_expiry <= (now() at time zone 'Africa/Lagos')::date then return query select 'batch_expired'::text, 0, 0; return; end if;
  if char_length(v_who) not between 2 and 120 or v_reg is null or v_reg !~ '^[A-Za-z0-9][A-Za-z0-9 /.\-]{1,38}[A-Za-z0-9]$'
     or char_length(coalesce(v_qty, '')) > 100 or char_length(coalesce(v_batch, '')) > 60
     or (p_expiry is not null and p_expiry <= (now() at time zone 'Africa/Lagos')::date)
     or (v_partial and (v_note is null or char_length(v_note) not between 5 and 300)) then
    return query select 'invalid'::text, 0, 0; return;
  end if;
  if v_med.superseded_at is not null or not v_med.is_active or (v_med.expires_at is not null and v_med.expires_at < now()) then
    return query select 'not_active'::text, 0, 0; return;
  end if;
  select count(*) into v_appr from public.medication_repeat_requests r where r.medication_id = v_med.id and r.status = 'approved';
  select count(*) into v_disp from public.pharmacy_order_dispenses d where d.medication_id = v_med.id and d.source = 'pharmacy' and d.disputed_at is null and not coalesce(d.is_partial, false);
  v_perm := 1 + least(coalesce(v_appr, 0), coalesce(v_med.repeats_allowed, 0));
  if v_disp >= v_perm then return query select 'no_supply_available'::text, v_disp, v_perm; return; end if;
  select name into v_pname from public.pharmacy_partners where id = v_partner;
  insert into public.pharmacy_order_dispenses (
    organisation_id, patient_id, medication_id, drug_name, strength, quantity, quantity_prescribed, dispensed_on, source, recorded_by,
    pharmacy_name, pharmacist_name, pharmacist_registration, pharmacist_registration_verified, recorded_via, is_partial, outstanding_note, batch_number, expiry_date)
  values (v_med.organisation_id, v_med.patient_id, v_med.id, v_med.drug_name, v_med.dose, coalesce(v_qty, v_med.quantity), v_med.quantity,
          (now() at time zone 'Africa/Lagos')::date, 'pharmacy', (select auth.uid()), v_pname, v_who, v_reg, false, 'partner',
          v_partial, case when v_partial then v_note end, v_batch, p_expiry)
  returning id into v_dispense;
  if not v_partial then
    update public.prescriptions set state = 'dispensed' where id = rx.id;
    update public.prescription_collection_codes set used_at = now() where prescription_id = rx.id;
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (rx.organisation_id, rx.patient_id, 'in_app', 'pending', 'prescription_collected_patient', jsonb_build_object('dispense_id', v_dispense));
    perform private.emit_domain_event('prescription.dispensed', rx.organisation_id, jsonb_build_object('prescription_id', rx.id, 'dispense_id', v_dispense),
      'prescription_dispensed:' || rx.id, rx.patient_id, 'prescription', rx.id);
  end if;
  perform private.log_audit('pharmacy.dispensed', 'prescriptions', rx.id, jsonb_build_object('dispense_id', v_dispense, 'partial', v_partial, 'pharmacy_partner_id', v_partner));
  return query select case when v_partial then 'partial_recorded' else 'recorded' end, v_disp + case when v_partial then 0 else 1 end, v_perm;
end $function$;

-- ---------------------------------------------------------------------------
-- 3. QR check by a pharmacist (verify_prescription): the status says so, and the check is audited
-- ---------------------------------------------------------------------------
create or replace function public.verify_prescription(p_rx_number text, p_verification_code text)
returns table(drug_name text, dose text, frequency text, route text, quantity text, duration_days integer, repeats_allowed integer, repeats_used integer, indication text,
              instructions text, status text, signed_at timestamp with time zone, expires_at timestamp with time zone, version integer, prescriber_name text, patient_name text)
language plpgsql security definer set search_path = '' as $$
declare
  v_med public.medications%rowtype;
  v_prescriber text;
  v_patient text;
  v_used integer;
  v_controlled boolean;
begin
  if (select p.role from public.profiles p where p.id = (select auth.uid())) <> 'pharmacist' then
    return;
  end if;

  select * into v_med
  from public.medications m
  where m.rx_number = btrim(p_rx_number)
    and m.verification_code = upper(btrim(coalesce(p_verification_code, '')))
    and m.source = 'clinician';

  if v_med.id is null then
    return;
  end if;
  perform private.log_audit('pharmacist.prescription_verified', 'medications', v_med.id, '{}'::jsonb);
  v_controlled := private.is_controlled_medicine(v_med.drug_name);
  if v_controlled then
    perform private.log_audit('pharmacy.controlled_medicine_refused', 'medications', v_med.id, jsonb_build_object('step', 'qr_verify'));
  end if;

  select full_name into v_prescriber from public.profiles where id = v_med.added_by;
  select full_name into v_patient from public.profiles where id = v_med.patient_id;

  -- Table alias + qualified columns required: this function's own RETURNS TABLE clause implicitly declares a plpgsql variable named
  -- `status` (among others), which would otherwise collide with medication_repeat_requests.status ("column reference status is ambiguous").
  select count(*) into v_used
  from public.medication_repeat_requests mrr
  where mrr.medication_id = v_med.id and mrr.status = 'approved';

  return query select
    v_med.drug_name, v_med.dose, v_med.frequency, v_med.route, v_med.quantity,
    v_med.duration_days, v_med.repeats_allowed, coalesce(v_used, 0),
    v_med.indication, v_med.instructions,
    case
      when v_controlled then 'controlled_medicine'
      when v_med.superseded_at is not null then 'superseded'
      when v_med.expires_at is not null and v_med.expires_at < now() then 'expired'
      when not v_med.is_active then 'cancelled'
      else 'active'
    end,
    v_med.created_at, v_med.expires_at, v_med.version,
    coalesce(v_prescriber, 'Tarragon care team'), coalesce(v_patient, 'Unknown patient');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Order screen: the "enhanced verification" tick-box no longer lets a controlled supply through. Return type void -> text so a refusal can be
--    returned (and audited) instead of raised. The two controlled parameters stay so a page still on the old call keeps working; they are only read
--    as a signal that the pharmacist says the medicine is controlled. No function body calls this one (scanned with \y); callers are the web app only.
-- ---------------------------------------------------------------------------
drop function public.pharmacist_record_dispense(uuid, text, text, date, text, boolean, text, text, text, text, text, boolean);
create function public.pharmacist_record_dispense(
  p_order_id uuid, p_drug_name text, p_quantity text, p_dispensed_on date, p_quantity_prescribed text default null::text, p_is_partial boolean default false,
  p_outstanding_note text default null::text, p_batch_number text default null::text, p_substituted_for text default null::text, p_substitution_reason text default null::text,
  p_controlled_tier text default null::text, p_enhanced_verification_confirmed boolean default false)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_order public.pharmacy_orders%rowtype;
begin
  select * into v_order from public.pharmacy_orders where id = p_order_id and pharmacy_partner_id = private.pharmacist_partner();
  if v_order.id is null then
    raise exception 'Order not found for this pharmacy' using errcode = '42501';
  end if;
  if coalesce(btrim(p_drug_name), '') = '' then
    raise exception 'Drug name is required' using errcode = '22023';
  end if;
  -- OQ-276: no tick-box passes a controlled medicine. Named in the supply, named as the original it replaces, or flagged by the page.
  if private.is_controlled_medicine(p_drug_name) or private.is_controlled_medicine(p_substituted_for) or nullif(btrim(coalesce(p_controlled_tier, '')), '') is not null then
    perform private.log_audit('pharmacy.controlled_medicine_refused', 'pharmacy_orders', p_order_id, jsonb_build_object('step', 'order_dispense'));
    return 'controlled_medicine';
  end if;

  insert into public.pharmacy_order_dispenses
    (organisation_id, patient_id, pharmacy_order_id, drug_name, quantity, dispensed_on, source, recorded_by,
     quantity_prescribed, is_partial, outstanding_note, batch_number,
     substituted_for, substitution_reason)
  values
    (v_order.organisation_id, v_order.patient_id, p_order_id, btrim(p_drug_name),
     nullif(btrim(coalesce(p_quantity, '')), ''), coalesce(p_dispensed_on, current_date),
     'pharmacy', (select auth.uid()),
     nullif(btrim(coalesce(p_quantity_prescribed, '')), ''), coalesce(p_is_partial, false),
     nullif(btrim(coalesce(p_outstanding_note, '')), ''), nullif(btrim(coalesce(p_batch_number, '')), ''),
     nullif(btrim(coalesce(p_substituted_for, '')), ''), nullif(btrim(coalesce(p_substitution_reason, '')), ''));

  if v_order.status in ('requested', 'confirmed', 'unavailable') then
    update public.pharmacy_orders set status = 'dispensed' where id = p_order_id;
  end if;
  perform private.log_audit('pharmacist.dispense_recorded', 'pharmacy_orders', p_order_id, jsonb_build_object('partial', coalesce(p_is_partial, false)));
  return 'recorded';
end;
$$;
revoke all on function public.pharmacist_record_dispense(uuid, text, text, date, text, boolean, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.pharmacist_record_dispense(uuid, text, text, date, text, boolean, text, text, text, text, text, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. QR page and phone desk (record_prescription_supply_public; desk_record_prescription_supply passes its outcome through)
--    A refusal is logged in prescription_supply_attempts, the audit trail this anonymous door already has, so that table accepts the new outcome.
-- ---------------------------------------------------------------------------
alter table public.prescription_supply_attempts drop constraint prescription_supply_attempts_outcome_check;
alter table public.prescription_supply_attempts add constraint prescription_supply_attempts_outcome_check
  check (outcome in ('not_active', 'duplicate', 'no_supply_available', 'invalid', 'controlled_medicine'));

create or replace function public.record_prescription_supply_public(
  p_token text, p_pharmacy_name text, p_pharmacist_name text, p_pharmacist_registration text default null::text, p_quantity_supplied text default null::text)
returns table(outcome text, supplies_dispensed integer, supplies_permitted integer)
language plpgsql security definer set search_path = '' as $function$
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
    when private.is_controlled_medicine(v_med.drug_name) then 'controlled_medicine'
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
    -- the hourly cap keeps the anonymous door from filling the table; a controlled refusal is always logged (it is the audit row, OQ-276)
    if v_recent < 20 or v_outcome = 'controlled_medicine' then
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
$function$;

-- ---------------------------------------------------------------------------
-- 6. Closing self-check: the list is single, every changed function is present with the right shape and access
-- ---------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  if not private.is_controlled_medicine('Tramadol 50mg') or private.is_controlled_medicine('Amlodipine 5mg') or private.is_controlled_medicine(null) then
    raise exception 'OQ-276: controlled list not behaving';
  end if;
  -- the old inline copy must be gone from signing: one list only
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'private' and p.proname = 'prescription_safety_findings' and p.prosrc ~ 'tramadol') then
    raise exception 'OQ-276: signing still carries its own copy of the controlled list';
  end if;
  -- no other function body may carry the list either (word-boundary scan with \y, not \b)
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.proname <> 'is_controlled_medicine' and p.prosrc ~* '\ytramadol\y';
  if v_bad is not null then raise exception 'OQ-276: a second copy of the controlled list lives in: %', v_bad; end if;
  if pg_get_function_result('public.pharmacist_record_dispense(uuid,text,text,date,text,boolean,text,text,text,text,text,boolean)'::regprocedure) <> 'text' then
    raise exception 'OQ-276: pharmacist_record_dispense should return text';
  end if;
  if has_function_privilege('anon', 'public.pharmacist_record_dispense(uuid,text,text,date,text,boolean,text,text,text,text,text,boolean)', 'EXECUTE') then
    raise exception 'OQ-276: anon can execute pharmacist_record_dispense';
  end if;
  if has_function_privilege('anon', 'private.is_controlled_medicine(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.prescription_has_controlled_item(text,jsonb)', 'EXECUTE') then
    raise exception 'OQ-276: a private helper is executable by a client role';
  end if;
end $$;
