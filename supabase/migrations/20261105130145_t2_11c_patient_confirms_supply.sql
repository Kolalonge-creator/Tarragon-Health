-- T2-11c (founder decision 2026-11-05, the founder is also the CMO): "Some Nigerian pharmacies might not want to confirm this or scan the
-- code, so we can also have an alternative where the patient can also confirm that they have gotten the meds."
--
-- Counted before writing (local replay of main-dev; the live supply functions were compared by md5 of their bodies and differ from the
-- replay only in stripped comments): every supply counter on the platform counts pharmacy_order_dispenses rows with source 'pharmacy'
-- and no dispute. A patient's own "I picked this up" row (source 'patient', recorded_via 'app') has never counted, so a prescription the
-- patient collected from a pharmacy that did not scan the QR still showed a supply as available, and a second pharmacy could fill it.
--
-- What this adds.
--  1. A patient-reported supply: public.confirm_prescription_collected(medication, collected_on, pharmacy name, town, quantity), for the
--     patient's OWN signed clinician prescription only. It writes a pharmacy_order_dispenses row with source 'patient' and
--     recorded_via 'patient_confirmation', which COUNTS as a supply. Rows written the old way (recorded_via 'app') still do not count.
--  2. One definition of "counts as a supply": private.dispense_counts_as_supply(row). A pharmacy row that is not disputed, or a patient
--     confirmation that is not withdrawn and not matched to a pharmacy record. Patched into every function that counts supplies for a
--     clinician prescription: verify_prescription_public (QR page), desk_verify_prescription (phone desk), record_prescription_supply_public
--     (QR record, also used by the phone desk), and the dormant partner functions (pharmacist_verify_collection, pharmacist_verify_visit,
--     pharmacist_dispense_prescription, private.supplies_remaining). Patched in place from the live body, the anchored way: each patch
--     asserts it replaced exactly one occurrence, so a body that has drifted fails the migration instead of silently not counting.
--  3. No double count. A pharmacy record made within 7 days after a patient's report is taken to be the same supply: the pharmacy row
--     counts, the patient's row is marked matched (matched_dispense_id) and stops counting. The record functions leave that one report out
--     of their availability check, so the pharmacy that really supplied it can still record it. The other way round, a patient confirming
--     within 7 days of a pharmacy record writes a medication_receipt_confirmations row against the pharmacy record (the "patient received"
--     event) and no second supply. If the patient disputes the pharmacy record, their own report counts again.
--  4. Undo, by the patient only, within 24 hours, and only while no pharmacy has matched it: public.undo_prescription_collected. The row is
--     never deleted; withdrawn_at/withdrawn_by/withdraw_reason are set and an audit_log row is written. A trigger refuses any other change
--     to a patient confirmation from a client session, by the patient or by staff, and refuses a client insert of one.
--  5. The same trigger closes a related hole: a patient session could insert a source 'pharmacy' row, or edit a pharmacy row (source,
--     medication, dispute fields) directly through the table policy, which changes the supply count without the dispute function's audit
--     row. From a client session, a patient may now only insert their own source 'patient', recorded_via 'app' row, and no client may change
--     the columns the count depends on. The SECURITY DEFINER functions (which run as their owner) are unaffected.
--  6. verify_prescription_public gains self_reported_supplies, last_self_report_on and self_report_awaiting_pharmacy, so the QR page
--     can say "collected, as reported by the patient". Dates and counts only: nothing that identifies the patient. OUT parameters change,
--     so the function is dropped and recreated with the same grants (same name and argument list, so the anon allowlist is unchanged).
--
-- Not changed, on purpose: the medication schedule. Dose slots run from the prescription's signing (medications.schedule_effective_from, or
-- created_at), not from collection; nothing in the schedule reads a collection date today. Starting the schedule on collection would change
-- missed-dose and adherence behaviour and is left to a CMO decision (see the report and docs/DECISIONS.md T2-14).
-- No notification is sent for a patient confirmation: it is the patient's own in-app action and works with every send failing.
-- Row counts at writing (local replay): pharmacy_order_dispenses 0. Nothing to backfill; every new column is nullable.

-- 1. Columns -----------------------------------------------------------------------------------------------------------------------
alter table public.pharmacy_order_dispenses
  add column if not exists pharmacy_town text,
  add column if not exists withdrawn_at timestamptz,
  add column if not exists withdrawn_by uuid references public.profiles (id) on delete restrict,
  add column if not exists withdraw_reason text,
  add column if not exists matched_dispense_id uuid references public.pharmacy_order_dispenses (id) on delete set null,
  add column if not exists matched_at timestamptz;

alter table public.pharmacy_order_dispenses drop constraint if exists pharmacy_order_dispenses_recorded_via_values;
alter table public.pharmacy_order_dispenses
  add constraint pharmacy_order_dispenses_recorded_via_values
    check (recorded_via in ('app', 'partner', 'public_verification', 'desk_phone', 'patient_confirmation')),
  add constraint pharmacy_order_dispenses_pharmacy_town_length check (char_length(pharmacy_town) <= 80),
  add constraint pharmacy_order_dispenses_withdraw_reason_length check (char_length(withdraw_reason) <= 300),
  -- only a patient confirmation can be withdrawn or matched, and only a patient confirmation is source 'patient' AND counted
  add constraint pharmacy_order_dispenses_patient_confirmation_shape check (
    recorded_via <> 'patient_confirmation' or (source = 'patient' and medication_id is not null)),
  add constraint pharmacy_order_dispenses_withdraw_only_patient_confirmation check (
    (withdrawn_at is null and matched_dispense_id is null) or recorded_via = 'patient_confirmation'),
  add constraint pharmacy_order_dispenses_withdrawn_together check ((withdrawn_at is null) = (withdrawn_by is null));

comment on column public.pharmacy_order_dispenses.recorded_via is
  'How the row was created: app (patient or Tarragon staff; a patient row made this way does not count as a supply), partner (a logged-in pharmacy partner), public_verification (a pharmacy that scanned the prescription QR; pharmacy and pharmacist names are self-declared), desk_phone (Tarragon staff for a pharmacy that phoned), patient_confirmation (T2-11c: the patient says they collected it; counts as a supply, labelled patient-reported everywhere).';
comment on column public.pharmacy_order_dispenses.matched_dispense_id is
  'T2-11c: on a patient confirmation, the pharmacy record that later confirmed the same supply. A matched confirmation no longer counts (the pharmacy row does).';
comment on column public.pharmacy_order_dispenses.withdrawn_at is
  'T2-11c: the patient took back their own confirmation (within 24 hours, before any pharmacy matched it). The row is kept; it no longer counts.';

create index if not exists pharmacy_order_dispenses_patient_confirmation_idx
  on public.pharmacy_order_dispenses (medication_id, created_at)
  where recorded_via = 'patient_confirmation' and withdrawn_at is null and matched_dispense_id is null;

-- 2. The one definition of a counted supply ----------------------------------------------------------------------------------------
create or replace function private.dispense_counts_as_supply(d public.pharmacy_order_dispenses) returns boolean
language sql immutable set search_path = '' as $$
  select (d.source = 'pharmacy'::public.dispense_source and d.disputed_at is null)
      or (d.recorded_via = 'patient_confirmation' and d.withdrawn_at is null and d.matched_dispense_id is null)
$$;
revoke all on function private.dispense_counts_as_supply(public.pharmacy_order_dispenses) from public, anon, authenticated;
comment on function private.dispense_counts_as_supply(public.pharmacy_order_dispenses) is
  'T2-11c: a supply counts if a pharmacy recorded it (and it is not disputed), or the patient confirmed it (and has not withdrawn it, and no pharmacy record has since matched it).';

-- The one patient report a pharmacy record would match: the oldest live report made in the last 7 days.
create or replace function private.absorbable_patient_report(p_medication uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select d.id from public.pharmacy_order_dispenses d
   where d.medication_id = p_medication and d.recorded_via = 'patient_confirmation'
     and d.withdrawn_at is null and d.matched_dispense_id is null
     and d.created_at > now() - interval '7 days'
   order by d.created_at, d.id
   limit 1
$$;
revoke all on function private.absorbable_patient_report(uuid) from public, anon, authenticated;

-- 3. Patch the counters in place ---------------------------------------------------------------------------------------------------
do $patch$
declare
  v_old constant text := $o$d.source = 'pharmacy' and d.disputed_at is null$o$;
  v_count constant text := $n$private.dispense_counts_as_supply(d)$n$;
  v_record constant text := $n$private.dispense_counts_as_supply(d) and d.id is distinct from private.absorbable_patient_report(v_med.id)$n$;
  r record;
  v_def text;
  v_hits integer;
begin
  for r in
    select * from (values
      ('public.desk_verify_prescription(text,text,text)', v_count),
      ('public.pharmacist_verify_collection(uuid,text)', v_count),
      ('public.pharmacist_verify_visit(uuid,text)', v_count),
      ('private.supplies_remaining(uuid)', v_count),
      ('public.record_prescription_supply_public(text,text,text,text,text)', v_record),
      ('public.pharmacist_dispense_prescription(uuid,text,text,boolean,text,text,date,text,text)', v_record)
    ) as t(fn, repl)
  loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    if v_def like '%dispense_counts_as_supply%' then continue; end if;
    v_hits := (char_length(v_def) - char_length(replace(v_def, v_old, ''))) / char_length(v_old);
    if v_hits <> 1 then
      raise exception 'T2-11c: % has % occurrences of the supply count, expected 1; patch it by hand', r.fn, v_hits using errcode = '55000';
    end if;
    execute replace(v_def, v_old, r.repl);
  end loop;
end $patch$;

-- 4. The QR page's view of the prescription (dropped and recreated: OUT parameters change) ----------------------------------------
drop function if exists public.verify_prescription_public(text);
create function public.verify_prescription_public(p_token text)
returns table(status text, rx_number text, drug_name text, dose text, frequency text, quantity text, duration_days integer, repeats_allowed integer, repeats_used integer,
              repeats_remaining integer, supplies_dispensed integer, supplies_permitted integer, supply_available boolean, last_supplied_on date, signed_at timestamp with time zone,
              expires_at timestamp with time zone, version integer, prescriber_name text, prescriber_credential text,
              self_reported_supplies integer, last_self_report_on date, self_report_awaiting_pharmacy boolean)
language plpgsql stable security definer set search_path = '' as $function$
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
  v_patient integer;
  v_patient_last date;
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
  select count(*), max(d.dispensed_on),
         count(*) filter (where d.recorded_via = 'patient_confirmation'),
         max(d.dispensed_on) filter (where d.recorded_via = 'patient_confirmation')
    into v_dispensed, v_last, v_patient, v_patient_last
    from public.pharmacy_order_dispenses d
   where d.medication_id = v_med.id and private.dispense_counts_as_supply(d);

  v_permitted := 1 + least(coalesce(v_approved, 0), coalesce(v_med.repeats_allowed, 0));
  v_status := case
    when private.is_controlled_medicine(v_med.drug_name) then 'controlled_medicine'
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
    coalesce(v_name, 'Tarragon care team'), v_cred,
    coalesce(v_patient, 0),
    v_patient_last,
    (v_status = 'active' and private.absorbable_patient_report(v_med.id) is not null);
end;
$function$;
revoke all on function public.verify_prescription_public(text) from public;
grant execute on function public.verify_prescription_public(text) to anon, authenticated;

-- 5. Guard: history the clients cannot rewrite -------------------------------------------------------------------------------------
-- SECURITY INVOKER on purpose: inside a SECURITY DEFINER function current_user is the function's owner, so the writes the RPCs make
-- pass, and only a client session writing through the table policy (current_user authenticated or anon) is checked. The 'role' setting
-- would not do: it still says authenticated inside a definer function.
create or replace function private.guard_dispense_history() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_staff boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;

  if tg_op = 'INSERT' then
    v_staff := private.is_org_staff(new.organisation_id);
    if new.recorded_via = 'patient_confirmation' or new.withdrawn_at is not null or new.matched_dispense_id is not null then
      raise exception 'A patient confirmation is recorded with confirm_prescription_collected' using errcode = '42501';
    end if;
    if not v_staff and (new.source <> 'patient'::public.dispense_source or new.recorded_via <> 'app' or new.disputed_at is not null) then
      raise exception 'A patient can only record their own collection here' using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.recorded_via = 'patient_confirmation' or old.source = 'pharmacy'::public.dispense_source then
      raise exception 'A supply record cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;

  -- UPDATE
  if old.recorded_via = 'patient_confirmation' then
    raise exception 'A patient confirmation can only be taken back with undo_prescription_collected' using errcode = '42501';
  end if;
  if new.source is distinct from old.source or new.medication_id is distinct from old.medication_id
     or new.recorded_via is distinct from old.recorded_via
     or new.disputed_at is distinct from old.disputed_at or new.disputed_by is distinct from old.disputed_by
     or new.withdrawn_at is distinct from old.withdrawn_at or new.withdrawn_by is distinct from old.withdrawn_by
     or new.matched_dispense_id is distinct from old.matched_dispense_id or new.matched_at is distinct from old.matched_at then
    raise exception 'These supply fields cannot be changed directly' using errcode = '42501';
  end if;
  if old.source = 'pharmacy'::public.dispense_source and not private.is_org_staff(old.organisation_id) then
    raise exception 'A pharmacy supply record cannot be edited by the patient; use This wasn''t me' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_dispense_history() from public, anon, authenticated;

drop trigger if exists pharmacy_order_dispenses_guard_history on public.pharmacy_order_dispenses;
create trigger pharmacy_order_dispenses_guard_history
  before insert or update or delete on public.pharmacy_order_dispenses
  for each row execute function private.guard_dispense_history();

-- 6. A pharmacy record matches a recent patient report; a dispute un-matches it ---------------------------------------------------
create or replace function private.match_patient_report_to_pharmacy_record() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_report uuid;
begin
  if tg_op = 'INSERT' then
    if new.source = 'pharmacy'::public.dispense_source and new.medication_id is not null and new.disputed_at is null
       and not coalesce(new.is_partial, false) then
      v_report := private.absorbable_patient_report(new.medication_id);
      if v_report is not null then
        update public.pharmacy_order_dispenses set matched_dispense_id = new.id, matched_at = now() where id = v_report;
        insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, subject_patient_id, result, event)
        values (new.organisation_id, (select auth.uid()), 'prescription.patient_report_matched', 'pharmacy_order_dispenses', v_report,
                new.patient_id, 'success', jsonb_build_object('medication_id', new.medication_id, 'pharmacy_dispense_id', new.id,
                                                               'recorded_via', new.recorded_via));
      end if;
    end if;
  elsif tg_op = 'UPDATE' then
    if old.disputed_at is null and new.disputed_at is not null then
      update public.pharmacy_order_dispenses set matched_dispense_id = null, matched_at = null
       where matched_dispense_id = new.id and recorded_via = 'patient_confirmation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.match_patient_report_to_pharmacy_record() from public, anon, authenticated;

drop trigger if exists pharmacy_order_dispenses_match_patient_report on public.pharmacy_order_dispenses;
create trigger pharmacy_order_dispenses_match_patient_report
  after insert or update of disputed_at on public.pharmacy_order_dispenses
  for each row execute function private.match_patient_report_to_pharmacy_record();

-- 7. The patient's two actions ----------------------------------------------------------------------------------------------------
create or replace function public.confirm_prescription_collected(
  p_medication_id uuid,
  p_collected_on date default null,
  p_pharmacy_name text default null,
  p_pharmacy_town text default null,
  p_quantity text default null
)
returns table (outcome text, dispense_id uuid, supplies_dispensed integer, supplies_permitted integer)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_caller uuid := (select auth.uid());
  v_med public.medications%rowtype;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_on date := coalesce(p_collected_on, (now() at time zone 'Africa/Lagos')::date);
  v_pharmacy text := nullif(btrim(coalesce(p_pharmacy_name, '')), '');
  v_town text := nullif(btrim(coalesce(p_pharmacy_town, '')), '');
  v_qty text := nullif(btrim(coalesce(p_quantity, '')), '');
  v_approved integer;
  v_dispensed integer;
  v_permitted integer;
  v_pharmacy_row uuid;
  v_new uuid;
begin
  if v_caller is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  -- Only the patient's own signed clinician prescription. Locked, the same row every supply path locks.
  select * into v_med from public.medications m
   where m.id = p_medication_id and m.patient_id = v_caller and m.source = 'clinician' and m.rx_number is not null
   for update;
  if v_med.id is null then
    return query select 'not_found'::text, null::uuid, 0, 0;
    return;
  end if;

  select count(*) into v_approved from public.medication_repeat_requests mrr
   where mrr.medication_id = v_med.id and mrr.status = 'approved';
  select count(*) into v_dispensed from public.pharmacy_order_dispenses d
   where d.medication_id = v_med.id and private.dispense_counts_as_supply(d);
  v_permitted := 1 + least(coalesce(v_approved, 0), coalesce(v_med.repeats_allowed, 0));

  if v_on > v_today or v_on < (v_med.created_at at time zone 'Africa/Lagos')::date
     or char_length(coalesce(v_pharmacy, '')) > 120 or char_length(coalesce(v_town, '')) > 80 or char_length(coalesce(v_qty, '')) > 100 then
    return query select 'invalid'::text, null::uuid, v_dispensed, v_permitted;
    return;
  end if;
  if v_med.superseded_at is not null or not v_med.is_active
     or (v_med.expires_at is not null and v_med.expires_at < now()) then
    return query select 'not_active'::text, null::uuid, v_dispensed, v_permitted;
    return;
  end if;

  -- A pharmacy already recorded this supply (within 7 days either side): the patient is confirming receipt, not a second supply.
  select d.id into v_pharmacy_row from public.pharmacy_order_dispenses d
   where d.medication_id = v_med.id and d.source = 'pharmacy'::public.dispense_source and d.disputed_at is null
     and not coalesce(d.is_partial, false)
     and abs(d.dispensed_on - v_on) <= 7
     and not exists (select 1 from public.medication_receipt_confirmations c where c.pharmacy_order_dispense_id = d.id)
   order by abs(d.dispensed_on - v_on), d.created_at desc
   limit 1;
  if v_pharmacy_row is not null then
    insert into public.medication_receipt_confirmations
      (organisation_id, patient_id, medication_id, pharmacy_order_dispense_id, received_at, confirmation_source, confirmed_by, notes)
    values (v_med.organisation_id, v_caller, v_med.id, v_pharmacy_row, (v_on::timestamp + interval '12 hours') at time zone 'Africa/Lagos',
            'patient_self_report', v_caller, null);
    return query select 'matched_pharmacy_record'::text, v_pharmacy_row, v_dispensed, v_permitted;
    return;
  end if;
  if exists (select 1 from public.pharmacy_order_dispenses d
              where d.medication_id = v_med.id and d.source = 'pharmacy'::public.dispense_source and d.disputed_at is null
                and abs(d.dispensed_on - v_on) <= 7) then
    return query select 'already_recorded'::text, null::uuid, v_dispensed, v_permitted;
    return;
  end if;

  if exists (select 1 from public.pharmacy_order_dispenses d
              where d.medication_id = v_med.id and d.recorded_via = 'patient_confirmation' and d.withdrawn_at is null
                and d.created_at > now() - interval '10 minutes') then
    return query select 'duplicate'::text, null::uuid, v_dispensed, v_permitted;
    return;
  end if;

  if v_dispensed >= v_permitted then
    return query select 'no_supply_available'::text, null::uuid, v_dispensed, v_permitted;
    return;
  end if;

  insert into public.pharmacy_order_dispenses (
    organisation_id, patient_id, medication_id, drug_name, strength, quantity, quantity_prescribed,
    dispensed_on, source, recorded_by, pharmacy_name, pharmacy_town, recorded_via
  ) values (
    v_med.organisation_id, v_caller, v_med.id, v_med.drug_name, v_med.dose, coalesce(v_qty, v_med.quantity), v_med.quantity,
    v_on, 'patient', v_caller, v_pharmacy, v_town, 'patient_confirmation'
  ) returning id into v_new;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, subject_patient_id, result, event)
  values (v_med.organisation_id, v_caller, 'prescription.patient_reported_supply', 'pharmacy_order_dispenses', v_new, v_caller, 'success',
          jsonb_build_object('medication_id', v_med.id, 'rx_number', v_med.rx_number, 'collected_on', v_on,
                             'supplies_dispensed', v_dispensed + 1, 'supplies_permitted', v_permitted));

  return query select 'recorded'::text, v_new, v_dispensed + 1, v_permitted;
end;
$$;
revoke all on function public.confirm_prescription_collected(uuid, date, text, text, text) from public, anon;
grant execute on function public.confirm_prescription_collected(uuid, date, text, text, text) to authenticated;
comment on function public.confirm_prescription_collected(uuid, date, text, text, text) is
  'T2-11c: the patient says they collected their own signed prescription. Counts as a supply (labelled patient-reported), so the QR page shows it used. Matches a pharmacy record within 7 days instead of counting twice.';

create or replace function public.undo_prescription_collected(p_dispense_id uuid, p_reason text default null)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_caller uuid := (select auth.uid());
  v_row public.pharmacy_order_dispenses%rowtype;
begin
  if v_caller is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  select * into v_row from public.pharmacy_order_dispenses d
   where d.id = p_dispense_id and d.patient_id = v_caller and d.recorded_via = 'patient_confirmation' and d.recorded_by = v_caller
   for update;
  if v_row.id is null or v_row.withdrawn_at is not null then
    return 'not_found';
  end if;
  if v_row.matched_dispense_id is not null then
    return 'confirmed_by_pharmacy';
  end if;
  if v_row.created_at < now() - interval '24 hours' then
    return 'window_passed';
  end if;
  update public.pharmacy_order_dispenses
     set withdrawn_at = now(), withdrawn_by = v_caller, withdraw_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 300)
   where id = v_row.id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, subject_patient_id, result, event)
  values (v_row.organisation_id, v_caller, 'prescription.patient_reported_supply_withdrawn', 'pharmacy_order_dispenses', v_row.id, v_caller,
          'success', jsonb_build_object('medication_id', v_row.medication_id, 'collected_on', v_row.dispensed_on,
                                        'reason', left(nullif(btrim(coalesce(p_reason, '')), ''), 300)));
  return 'undone';
end;
$$;
revoke all on function public.undo_prescription_collected(uuid, text) from public, anon;
grant execute on function public.undo_prescription_collected(uuid, text) to authenticated;
comment on function public.undo_prescription_collected(uuid, text) is
  'T2-11c: the patient takes back their own confirmation within 24 hours, before any pharmacy matched it. The row is kept and audited.';

-- 8. The migration proves what it claims ------------------------------------------------------------------------------------------
do $$
declare v_fn text;
begin
  foreach v_fn in array array['public.desk_verify_prescription(text,text,text)', 'public.pharmacist_verify_collection(uuid,text)',
    'public.pharmacist_verify_visit(uuid,text)', 'private.supplies_remaining(uuid)', 'public.verify_prescription_public(text)',
    'public.record_prescription_supply_public(text,text,text,text,text)',
    'public.pharmacist_dispense_prescription(uuid,text,text,boolean,text,text,date,text,text)'] loop
    if pg_get_functiondef(v_fn::regprocedure) not like '%dispense_counts_as_supply%' then
      raise exception 'T2-11c: % does not use the shared supply count', v_fn;
    end if;
  end loop;
  foreach v_fn in array array['public.record_prescription_supply_public(text,text,text,text,text)',
    'public.pharmacist_dispense_prescription(uuid,text,text,boolean,text,text,date,text,text)'] loop
    if pg_get_functiondef(v_fn::regprocedure) not like '%absorbable_patient_report(v_med.id)%' then
      raise exception 'T2-11c: % would refuse the pharmacy that really supplied a patient-reported supply', v_fn;
    end if;
  end loop;
  if not has_function_privilege('anon', 'public.verify_prescription_public(text)', 'EXECUTE') then
    raise exception 'verify_prescription_public lost its anon grant';
  end if;
  foreach v_fn in array array['public.confirm_prescription_collected(uuid,date,text,text,text)', 'public.undo_prescription_collected(uuid,text)'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then raise exception 'anon can call %', v_fn; end if;
    if not has_function_privilege('authenticated', v_fn, 'EXECUTE') then raise exception 'authenticated cannot call %', v_fn; end if;
  end loop;
  foreach v_fn in array array['private.dispense_counts_as_supply(public.pharmacy_order_dispenses)', 'private.absorbable_patient_report(uuid)',
    'private.guard_dispense_history()', 'private.match_patient_report_to_pharmacy_record()'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'T2-11c: % is callable by a client role', v_fn;
    end if;
  end loop;
end $$;
