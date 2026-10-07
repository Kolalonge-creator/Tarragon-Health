-- S37 guard enforcement (OQ-184, INV-14): the three guards that govern features with no real use yet. Live check on 2026-10-07: 4 real
-- patients, 0 real prescriptions, 0 real lab orders, 0 payouts, so closing them changes nothing for anyone today and removes the risk of a
-- real prescription, a Tarragon-billed lab booking or a payout going out before its conditions are met. Test accounts stay open.
--
-- prescribing_enabled  signing a prescription (draft to signed) is refused for a signed-in clinician unless the guard is on, or patient and
--                      clinician are both test accounts. The pharmacy side was already behind this guard (S28c).
-- lab_booking_enabled  a patient-initiated, Tarragon-billed (partner) lab order is refused at insert for a signed-in user unless the guard is
--                      on or the patient is a test account. Clinician-ordered tests and self-arranged guidance orders are never "sales" and
--                      stay open.
-- payouts_enabled      NO CODE CHANGE: public.payout_prepare_send already refuses with payout_guard_off (S31). Only the guard's own status text
--                      was stale ("payout sending is not built yet"); it is corrected below so the dashboard tells the truth.
-- Not covered, on purpose: sessions with no user (migrations, owner scripts, the service role), which are not a patient or clinician acting.

CREATE OR REPLACE FUNCTION private.enforce_prescription_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if v_uid is not null then
      new.recorded_by := v_uid;
      new.source := 'clinician';
    end if;
    if v_uid is not null and new.state <> 'draft' then
      raise exception 'a prescription is created as a draft and signed afterwards' using errcode = '23514';
    end if;
  else
    -- S37 (OQ-184, INV-14): signing is the act that makes a prescription real, so the prescribing guard closes it for a signed-in user.
    -- A draft is only a draft and stays allowed. Test accounts (patient and signer both is_test) are open while the guard is off, like every
    -- other S37 guard; sessions with no user (migrations, owner scripts, service role) are not a clinician acting and are not covered.
    if v_uid is not null and old.state = 'draft' and new.state = 'signed'
       and not private.go_live_open('prescribing_enabled', new.patient_id, v_uid) then
      raise exception 'prescribing_guard_off' using errcode = '55000';
    end if;
    -- Forward-only state machine. cancelled is terminal.
    if new.state is distinct from old.state and not (
         (old.state = 'draft'  and new.state in ('signed', 'cancelled'))
      or (old.state = 'signed' and new.state in ('sent', 'cancelled'))
      or (old.state = 'sent'   and new.state in ('dispensed', 'cancelled'))
      -- S28c: the patient's own send functions (flag on, one statement) may take a collected prescription back to sent for a repeat supply (OQ-280),
      -- and a waiting one back to signed when she withdraws her consent. Nobody else can.
      or (coalesce(current_setting('tarragon.rx_route', true), '') = 'on'
          and ((old.state = 'dispensed' and new.state = 'sent') or (old.state = 'sent' and new.state = 'signed')))
    ) then
      raise exception 'invalid prescription state change % -> %', old.state, new.state using errcode = '23514';
    end if;
    -- Signed content is frozen: a change to a medicine or dose needs a new, newly signed prescription.
    if old.signed_at is not null and (
         new.items is distinct from old.items or new.patient_id is distinct from old.patient_id
      or new.encounter_note_id is distinct from old.encounter_note_id
      or new.signed_by is distinct from old.signed_by or new.signed_at is distinct from old.signed_at) then
      raise exception 'a signed prescription cannot be altered; issue a new one' using errcode = '42501';
    end if;
  end if;

  -- Signing: moving out of draft is the prescriber's act, stamped as herself. Anyone else leaves the columns null
  -- and the CHECK refuses the row.
  if new.state not in ('draft', 'cancelled') and (new.signed_by is null or new.signed_at is null) then
    if v_uid is not null and private.has_prescribing_authority(new.organisation_id) then
      new.signed_by := v_uid;
      new.signed_at := now();
    end if;
  end if;
  if new.signed_by is not null and v_uid is not null and new.signed_by <> v_uid
     and (tg_op = 'INSERT' or old.signed_by is distinct from new.signed_by) then
    raise exception 'a prescription can only be signed by the clinician acting' using errcode = '42501';
  end if;

  -- The named pharmacy may move a sent prescription to dispensed and nothing else: routing, pickup code and the other
  -- timestamps are the prescriber's.
  if tg_op = 'UPDATE' and v_uid is not null and not private.has_prescribing_authority(old.organisation_id) then
    -- S28: the patient's own choice of pharmacy is the one other door to routing; public.patient_choose_pharmacy sets this flag for its
    -- single statement. Everything else in this block stays the prescriber's.
    if (new.pharmacy_partner_id is distinct from old.pharmacy_partner_id or new.collection_code is distinct from old.collection_code
        or new.pharmacy_location_id is distinct from old.pharmacy_location_id or new.chosen_by_patient_at is distinct from old.chosen_by_patient_at
        or new.sent_at is distinct from old.sent_at)
       and coalesce(current_setting('tarragon.rx_route', true), '') <> 'on' then
      raise exception 'only the prescriber can change routing or pickup details' using errcode = '42501';
    end if;
    if new.cancelled_at is distinct from old.cancelled_at
       or new.recorded_by is distinct from old.recorded_by or new.source is distinct from old.source
       or (coalesce(current_setting('tarragon.rx_route', true), '') <> 'on' and new.dispensed_at is distinct from old.dispensed_at and old.dispensed_at is not null) then
      raise exception 'only the prescriber can change routing or pickup details' using errcode = '42501';
    end if;
  end if;
  if new.state = 'sent'      and new.sent_at      is null then new.sent_at      := now(); end if;
  if new.state = 'dispensed' and new.dispensed_at is null then new.dispensed_at := now(); end if;
  if new.state = 'cancelled' and new.cancelled_at is null then new.cancelled_at := now(); end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end;
$function$;

create or replace function private.enforce_lab_booking_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select auth.uid()) is not null
     and new.origin = 'patient_initiated' and new.fulfilment = 'partner'
     and not private.go_live_open_patient('lab_booking_enabled', new.patient_id) then
    raise exception 'lab_booking_guard_off' using errcode = '55000';
  end if;
  return new;
end $$;
revoke all on function private.enforce_lab_booking_guard() from public, anon, authenticated;

drop trigger if exists lab_orders_a0_go_live_guard on public.lab_orders;
create trigger lab_orders_a0_go_live_guard before insert on public.lab_orders
  for each row execute function private.enforce_lab_booking_guard();

-- The dashboard's own account of what each guard blocks (not is_on or any switch state, which only set_go_live_guard may change).
update public.go_live_guards set
  enforced_in = array['public.payout_prepare_send (every payout send and retry)'],
  not_enforced_in = 'Building drafts and approving a payout are not behind it, only sending money. Test-account payouts are always refused.'
where key = 'payouts_enabled';
update public.go_live_guards set
  enforced_in = array['private.pharmacy_collection_on (every patient choice, every pharmacy list, counter check and supply, every question)',
                      'private.enforce_prescription_rules (signing a prescription, draft to signed, for a signed-in clinician)'],
  not_enforced_in = 'Writing a draft prescription, the downloadable prescription form, taking a prescription back from a pharmacy, and the QR and phone-desk supply paths are never behind it.'
where key = 'prescribing_enabled';
update public.go_live_guards set
  enforced_in = array['private.enforce_lab_booking_guard (a patient-initiated, Tarragon-billed lab order insert by a signed-in user)'],
  not_enforced_in = 'Clinician-ordered tests, self-arranged guidance orders and anything inserted with no signed-in user are not behind it.'
where key = 'lab_booking_enabled';
