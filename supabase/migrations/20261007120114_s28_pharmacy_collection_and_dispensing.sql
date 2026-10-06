-- S28: pharmacy partner: prescriptions to a chosen pharmacy, a collection code, dispensing (spec 9.6, 8.9, Part C.2 collection only).
-- INV-02 (a signed prescription is never altered), INV-07 (every notice is neutral), INV-10 (every pharmacist read is audited),
-- INV-13 (is_test carried), INV-16 (the code rules are a versioned row).
--
-- What this adds, on top of S05 prescriptions, S24 signed prescribing, S36h flags and the QR/phone-desk supply path (all kept):
--   * the patient chooses a verified pharmacy for a signed prescription (patient_choose_pharmacy) and gets a collection code
--   * the pharmacy sees only prescriptions sent to it (pharmacist_prescriptions, now audited, no code and no other medicine)
--   * the pharmacy verifies the code (pharmacist_verify_collection: wrong tries are counted and lock the code) and records a full or
--     partial dispense (pharmacist_dispense_prescription) into the SAME pharmacy_order_dispenses table the QR and phone-desk paths use,
--     under the same row lock on the medicine, so one prescription cannot be supplied twice by two doors
--   * the old direct partner policies on prescriptions are dropped: a pharmacy reaches a prescription only through these functions
-- No home delivery (Part C.2). No payment: medicines are not in the Membership; the patient pays the pharmacy.
-- Live counts at write time: prescriptions 0, pharmacy_partners 4 (none active), pharmacy_order_dispenses 1. No backfill.
-- Counting note: a PARTIAL partner dispense is not counted by this path, but the QR and phone-desk paths count every row, so they are
-- the stricter side: a partial can only make them refuse sooner, never supply more. Repeats stay in the existing repeat flow.

-- 1. Versioned rules (PROPOSED, CMO and pharmacy lead)
create table public.pharmacy_config (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique,
  is_active boolean not null default false,
  config jsonb not null,
  created_at timestamptz not null default now()
);
create unique index pharmacy_config_one_active on public.pharmacy_config ((true)) where is_active;
alter table public.pharmacy_config enable row level security;
revoke all on public.pharmacy_config from public, anon, authenticated;
comment on table public.pharmacy_config is 'S28: versioned collection-code rules (PROPOSED). Changes are new versions, never edits. Service role and private functions only.';
-- pharmacy-rules-begin
insert into public.pharmacy_config (version, is_active, config) values (1, true, $json$
{"code_length": 8, "code_valid_days": 14, "max_wrong_attempts": 5}
$json$::jsonb);

create function private.pharmacy_cfg() returns jsonb language sql stable security definer set search_path = '' as
$$ select config from public.pharmacy_config where is_active $$;
revoke all on function private.pharmacy_cfg() from public, anon, authenticated;

-- 2. Routing columns and the patient-only code table
alter table public.prescriptions
  add column pharmacy_location_id uuid references public.pharmacy_partner_locations (id) on delete restrict,
  add column chosen_by_patient_at timestamptz;
comment on column public.prescriptions.collection_code is 'S28: no longer written. The collection code lives in prescription_collection_codes, readable by the patient only.';

create table public.prescription_collection_codes (
  prescription_id uuid primary key references public.prescriptions (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id uuid not null references public.profiles (id) on delete restrict,
  pharmacy_partner_id uuid not null references public.pharmacy_partners (id) on delete restrict,
  pharmacy_location_id uuid references public.pharmacy_partner_locations (id) on delete restrict,
  code text not null,
  code_expires_at timestamptz not null,
  wrong_attempts integer not null default 0,
  locked_at timestamptz,
  used_at timestamptz,
  is_test boolean not null default false,
  created_at timestamptz not null default now()
);
comment on table public.prescription_collection_codes is 'S28: the pick-up code for a prescription sent to a pharmacy. The patient reads her own; the pharmacy never reads it, it can only test a code through pharmacist_verify_collection.';
alter table public.prescription_collection_codes enable row level security;
revoke all on public.prescription_collection_codes from public, anon, authenticated;
grant select on public.prescription_collection_codes to authenticated;
create policy prescription_collection_codes_patient_select on public.prescription_collection_codes
  for select to authenticated using (patient_id = (select auth.uid()));

-- 3. Event types and neutral in-app notices (INV-07: no medicine, condition or patient in any of them)
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('prescription.sent', 'A patient chose a pharmacy and a prescription was sent to it for collection', 'S28', false),
  ('prescription.dispensed', 'A pharmacy recorded the supply of a prescription', 'S28', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys) values
  ('prescription.sent', 1, array['prescription_id']),
  ('prescription.dispensed', 1, array['prescription_id'])
on conflict (event_type, version) do nothing;
insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('pharmacy_new_prescription', 'medication', 'routine', 'partner_pharmacy', array['in_app']::public.notification_channel[], 'immediate', 'S28: an item was sent to your pharmacy for collection. Names no medicine, condition or patient (INV-07).'),
  ('prescription_sent_patient', 'administrative', 'important', 'patient', array['in_app']::public.notification_channel[], 'immediate', 'S28: your item was sent to the pharmacy you chose. Names no medicine or condition (INV-07).'),
  ('prescription_collected_patient', 'administrative', 'routine', 'patient', array['in_app']::public.notification_channel[], 'immediate', 'S28: your pharmacy recorded your collection. Names no medicine or condition (INV-07).')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('pharmacy_new_prescription', 'en', 'in_app', 'Something is waiting for collection', 'A new item was sent to your pharmacy. Open your pharmacy page to see it.'),
  ('prescription_sent_patient', 'en', 'in_app', 'Sent to your pharmacy', 'Your care team''s item was sent to the pharmacy you chose. Open the app to see your collection code.'),
  ('prescription_collected_patient', 'en', 'in_app', 'Your collection was recorded', 'Your pharmacy recorded your collection. Open the app to see the details.')
on conflict (template_key, locale, channel) do nothing;

-- 4. The trigger: the patient's choice of pharmacy is the one other door to routing (flag set for one statement)
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
    -- Forward-only state machine. cancelled is terminal.
    if new.state is distinct from old.state and not (
         (old.state = 'draft'  and new.state in ('signed', 'cancelled'))
      or (old.state = 'signed' and new.state in ('sent', 'cancelled'))
      or (old.state = 'sent'   and new.state in ('dispensed', 'cancelled'))
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
       or (new.dispensed_at is distinct from old.dispensed_at and old.dispensed_at is not null) then
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


-- 5. A pharmacy reaches a prescription only through the functions below (audited, own pharmacy only)
drop policy prescriptions_update_partner_dispense on public.prescriptions;
drop policy prescriptions_select_partner on public.prescriptions;

-- 6. Helpers
create function private.new_collection_code(p_len integer) returns text language plpgsql volatile set search_path = '' as $$
declare v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; v_bytes bytea := extensions.gen_random_bytes(p_len); v_out text := ''; i integer;
begin
  for i in 0 .. p_len - 1 loop v_out := v_out || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1); end loop;
  return v_out;
end $$;

-- Tests a code for one prescription at one pharmacy. A wrong try is counted and locks the code at the limit; the caller must RETURN (not raise)
-- so the count is kept. Outcomes: ok, not_found, expired, locked, wrong_code, already_collected.
create function private.check_collection_code(p_rx uuid, p_code text, p_partner uuid) returns text language plpgsql security definer set search_path = '' as $$
declare c public.prescription_collection_codes%rowtype; v_max integer := (private.pharmacy_cfg() ->> 'max_wrong_attempts')::integer; v_in text := upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g')); v_n integer;
begin
  select * into c from public.prescription_collection_codes where prescription_id = p_rx and pharmacy_partner_id = p_partner for update;
  if not found then return 'not_found'; end if;
  if c.used_at is not null then return 'already_collected'; end if;
  if c.locked_at is not null then return 'locked'; end if;
  if c.code_expires_at < now() then return 'expired'; end if;
  if v_in <> c.code then
    v_n := c.wrong_attempts + 1;
    update public.prescription_collection_codes set wrong_attempts = v_n, locked_at = case when v_n >= v_max then now() end where prescription_id = p_rx;
    perform private.log_audit('pharmacy.collection_code_failed', 'prescriptions', p_rx, jsonb_build_object('pharmacy_partner_id', p_partner, 'attempt', v_n, 'locked', v_n >= v_max));
    return case when v_n >= v_max then 'locked' else 'wrong_code' end;
  end if;
  return 'ok';
end $$;
revoke all on function private.new_collection_code(integer) from public, anon, authenticated;
revoke all on function private.check_collection_code(uuid, text, uuid) from public, anon, authenticated;

-- 7. Patient: which verified pharmacies can I collect from
create function public.patient_collection_pharmacies(p_prescription uuid)
returns table (partner_id uuid, partner_name text, location_id uuid, location_name text, state text, address text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.prescriptions rx where rx.id = p_prescription and rx.patient_id = (select auth.uid()) and rx.state in ('signed', 'sent')) then
    raise exception 'Prescription not found' using errcode = '42501';
  end if;
  return query
    select pp.id, pp.name, l.id, l.name, l.state, l.address
      from public.pharmacy_partners pp join public.pharmacy_partner_locations l on l.pharmacy_partner_id = pp.id
     where pp.is_active and pp.approved_at is not null and pp.license_verified_at is not null
       and (pp.license_expires_at is null or pp.license_expires_at > now())
       and l.is_active and l.verified_at is not null
     order by pp.name, l.name;
end $$;

-- 8. Patient: choose (or change) the pharmacy. Returns the collection code. Not once a supply has started.
create function public.patient_choose_pharmacy(p_prescription uuid, p_partner uuid, p_location uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  rx public.prescriptions%rowtype; v_cfg jsonb := private.pharmacy_cfg(); v_code text; v_med uuid;
begin
  select * into rx from public.prescriptions where id = p_prescription and patient_id = (select auth.uid()) for update;
  if not found then raise exception 'Prescription not found' using errcode = '42501'; end if;
  if rx.state not in ('signed', 'sent') then raise exception 'collection_not_open' using errcode = '22023'; end if;
  select m.id into v_med from public.medications m where m.prescription_id = rx.id and m.source = 'clinician' for update;
  if v_med is not null and exists (select 1 from public.pharmacy_order_dispenses d where d.medication_id = v_med and d.source = 'pharmacy' and d.disputed_at is null) then
    raise exception 'collection_already_started' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.pharmacy_partners pp join public.pharmacy_partner_locations l on l.pharmacy_partner_id = pp.id
     where pp.id = p_partner and l.id = p_location and pp.is_active and pp.approved_at is not null and pp.license_verified_at is not null
       and (pp.license_expires_at is null or pp.license_expires_at > now()) and l.is_active and l.verified_at is not null) then
    raise exception 'pharmacy_not_available' using errcode = '22023';
  end if;
  v_code := private.new_collection_code((v_cfg ->> 'code_length')::integer);
  perform set_config('tarragon.rx_route', 'on', true);
  update public.prescriptions set pharmacy_partner_id = p_partner, pharmacy_location_id = p_location, chosen_by_patient_at = now(),
         state = 'sent', collection_code = null where id = rx.id;
  perform set_config('tarragon.rx_route', 'off', true);
  insert into public.prescription_collection_codes (prescription_id, organisation_id, patient_id, pharmacy_partner_id, pharmacy_location_id, code, code_expires_at, is_test)
  values (rx.id, rx.organisation_id, rx.patient_id, p_partner, p_location, v_code, now() + make_interval(days => (v_cfg ->> 'code_valid_days')::integer), rx.is_test)
  on conflict (prescription_id) do update set pharmacy_partner_id = excluded.pharmacy_partner_id, pharmacy_location_id = excluded.pharmacy_location_id,
    code = excluded.code, code_expires_at = excluded.code_expires_at, wrong_attempts = 0, locked_at = null, used_at = null, created_at = now();
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select pr.organisation_id, pr.id, 'in_app', 'pending', 'pharmacy_new_prescription', '{}'::jsonb
    from public.profiles pr where pr.role = 'pharmacist' and pr.is_active and pr.pharmacy_partner_id = p_partner;
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (rx.organisation_id, rx.patient_id, 'in_app', 'pending', 'prescription_sent_patient', '{}'::jsonb);
  perform private.emit_domain_event('prescription.sent', rx.organisation_id, jsonb_build_object('prescription_id', rx.id),
    'prescription_sent:' || rx.id || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'), rx.patient_id, 'prescription', rx.id);
  perform private.log_audit('prescription.pharmacy_chosen', 'prescriptions', rx.id, jsonb_build_object('pharmacy_partner_id', p_partner, 'pharmacy_location_id', p_location, 'changed', rx.state = 'sent'));
  return v_code;
end $$;

-- 9. Patient: my collection details and a fresh code if mine is locked or expired
create function public.patient_prescription_collection(p_prescription uuid)
returns table (state text, pharmacy_name text, location_name text, address text, code text, code_expires_at timestamptz, locked boolean, expired boolean, collected boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  return query
    select rx.state::text, pp.name, l.name, l.address, c.code, c.code_expires_at, c.locked_at is not null, c.code_expires_at < now(), c.used_at is not null
      from public.prescriptions rx
      left join public.prescription_collection_codes c on c.prescription_id = rx.id
      left join public.pharmacy_partners pp on pp.id = rx.pharmacy_partner_id
      left join public.pharmacy_partner_locations l on l.id = rx.pharmacy_location_id
     where rx.id = p_prescription and rx.patient_id = (select auth.uid()) and rx.state <> 'draft';
end $$;

create function public.patient_new_collection_code(p_prescription uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare c public.prescription_collection_codes%rowtype; v_cfg jsonb := private.pharmacy_cfg(); v_code text;
begin
  select cc.* into c from public.prescription_collection_codes cc join public.prescriptions rx on rx.id = cc.prescription_id
   where cc.prescription_id = p_prescription and cc.patient_id = (select auth.uid()) and rx.state = 'sent' and cc.used_at is null for update of cc;
  if not found then raise exception 'collection_not_open' using errcode = '22023'; end if;
  v_code := private.new_collection_code((v_cfg ->> 'code_length')::integer);
  update public.prescription_collection_codes set code = v_code, code_expires_at = now() + make_interval(days => (v_cfg ->> 'code_valid_days')::integer),
         wrong_attempts = 0, locked_at = null where prescription_id = p_prescription;
  perform private.log_audit('prescription.collection_code_renewed', 'prescriptions', p_prescription, '{}'::jsonb);
  return v_code;
end $$;

-- 10. Pharmacy: prescriptions sent to my pharmacy (audited read; no code, no allergies, no other medicine)
drop function public.pharmacist_prescriptions();
create function public.pharmacist_prescriptions()
returns table (prescription_id uuid, state text, sent_at timestamptz, dispensed_at timestamptz, patient_name text, patient_number text,
               items jsonb, open_flags integer, location_name text, code_locked boolean)
language plpgsql security definer set search_path = '' as $$
declare v_partner uuid := private.pharmacist_partner(); v_ids uuid[];
begin
  if v_partner is null then raise exception 'This action is for partner pharmacies' using errcode = '42501'; end if;
  select coalesce(array_agg(x.id), '{}') into v_ids from (
    select rx.id from public.prescriptions rx where rx.pharmacy_partner_id = v_partner and rx.state in ('sent', 'dispensed')
     order by coalesce(rx.sent_at, rx.created_at) desc limit 200) x;
  if cardinality(v_ids) > 0 then
    perform private.log_audit('pharmacy.prescriptions_listed', 'prescriptions', null, jsonb_build_object('prescription_ids', to_jsonb(v_ids), 'pharmacy_partner_id', v_partner));
  end if;
  return query
    select rx.id, rx.state::text, rx.sent_at, rx.dispensed_at, p.full_name, p.patient_number, rx.items,
           (select count(*)::integer from public.prescription_pharmacy_flags f where f.prescription_id = rx.id),
           l.name, coalesce(c.locked_at is not null, false)
      from public.prescriptions rx
      join public.profiles p on p.id = rx.patient_id
      left join public.pharmacy_partner_locations l on l.id = rx.pharmacy_location_id
      left join public.prescription_collection_codes c on c.prescription_id = rx.id
     where rx.id = any (v_ids)
     order by coalesce(rx.sent_at, rx.created_at) desc;
end $$;

-- 11. Pharmacy: check the code at the counter. Shows the allergies the pharmacist needs, once, audited.
create function public.pharmacist_verify_collection(p_prescription uuid, p_code text)
returns table (outcome text, patient_name text, patient_number text, items jsonb, allergies jsonb, supplies_dispensed integer, supplies_permitted integer, outstanding_note text)
language plpgsql security definer set search_path = '' as $$
declare v_partner uuid := private.pharmacist_partner(); rx public.prescriptions%rowtype; v_out text; v_med public.medications%rowtype; v_disp integer; v_perm integer; v_appr integer;
begin
  if v_partner is null then raise exception 'This action is for partner pharmacies' using errcode = '42501'; end if;
  select * into rx from public.prescriptions where id = p_prescription and pharmacy_partner_id = v_partner and state = 'sent' for update;
  if not found then return query select 'not_found'::text, null::text, null::text, null::jsonb, null::jsonb, 0, 0, null::text; return; end if;
  v_out := private.check_collection_code(rx.id, p_code, v_partner);
  if v_out <> 'ok' then return query select v_out, null::text, null::text, null::jsonb, null::jsonb, 0, 0, null::text; return; end if;
  select * into v_med from public.medications m where m.prescription_id = rx.id and m.source = 'clinician';
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
end $$;

-- 12. Pharmacy: record the supply, full or partial. Same table and same row lock as the QR and phone-desk paths.
create function public.pharmacist_dispense_prescription(
  p_prescription uuid, p_code text, p_quantity text, p_is_partial boolean, p_outstanding_note text,
  p_batch text, p_expiry date, p_registration text, p_pharmacist_name text)
returns table (outcome text, supplies_dispensed integer, supplies_permitted integer)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_partner uuid := private.pharmacist_partner(); rx public.prescriptions%rowtype; v_out text; v_med public.medications%rowtype;
  v_disp integer; v_perm integer; v_appr integer; v_dispense uuid; v_pname text; v_partial boolean := coalesce(p_is_partial, false);
  v_reg text := nullif(btrim(coalesce(p_registration, '')), ''); v_who text := btrim(coalesce(p_pharmacist_name, ''));
  v_qty text := nullif(btrim(coalesce(p_quantity, '')), ''); v_note text := nullif(btrim(coalesce(p_outstanding_note, '')), '');
  v_batch text := nullif(btrim(coalesce(p_batch, '')), '');
begin
  if v_partner is null then raise exception 'This action is for partner pharmacies' using errcode = '42501'; end if;
  select * into rx from public.prescriptions where id = p_prescription and pharmacy_partner_id = v_partner and state = 'sent' for update;
  if not found then return query select 'not_found'::text, 0, 0; return; end if;
  -- the medicine row is the shared lock: the QR path and the phone desk lock the same row, so two doors cannot both take the last supply
  select * into v_med from public.medications m where m.prescription_id = rx.id and m.source = 'clinician' for update;
  if v_med.id is null then return query select 'no_medication'::text, 0, 0; return; end if;
  v_out := private.check_collection_code(rx.id, p_code, v_partner);
  if v_out <> 'ok' then return query select v_out, 0, 0; return; end if;
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
end $$;

revoke all on function public.patient_collection_pharmacies(uuid) from public, anon;
revoke all on function public.patient_choose_pharmacy(uuid, uuid, uuid) from public, anon;
revoke all on function public.patient_prescription_collection(uuid) from public, anon;
revoke all on function public.patient_new_collection_code(uuid) from public, anon;
revoke all on function public.pharmacist_prescriptions() from public, anon;
revoke all on function public.pharmacist_verify_collection(uuid, text) from public, anon;
revoke all on function public.pharmacist_dispense_prescription(uuid, text, text, boolean, text, text, date, text, text) from public, anon;
grant execute on function public.patient_collection_pharmacies(uuid) to authenticated;
grant execute on function public.patient_choose_pharmacy(uuid, uuid, uuid) to authenticated;
grant execute on function public.patient_prescription_collection(uuid) to authenticated;
grant execute on function public.patient_new_collection_code(uuid) to authenticated;
grant execute on function public.pharmacist_prescriptions() to authenticated;
grant execute on function public.pharmacist_verify_collection(uuid, text) to authenticated;
grant execute on function public.pharmacist_dispense_prescription(uuid, text, text, boolean, text, text, date, text, text) to authenticated;

do $$
declare f text;
begin
  foreach f in array array['public.patient_collection_pharmacies(uuid)', 'public.patient_choose_pharmacy(uuid,uuid,uuid)', 'public.patient_prescription_collection(uuid)',
    'public.patient_new_collection_code(uuid)', 'public.pharmacist_prescriptions()', 'public.pharmacist_verify_collection(uuid,text)',
    'public.pharmacist_dispense_prescription(uuid,text,text,boolean,text,text,date,text,text)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'S28: anon can execute %', f; end if;
  end loop;
  if has_table_privilege('anon', 'public.prescription_collection_codes', 'SELECT') or has_table_privilege('authenticated', 'public.prescription_collection_codes', 'INSERT, UPDATE, DELETE') then
    raise exception 'S28: collection code table is exposed';
  end if;
  if exists (select 1 from pg_policies where tablename = 'prescriptions' and policyname in ('prescriptions_update_partner_dispense', 'prescriptions_select_partner')) then
    raise exception 'S28: a direct partner policy is still on prescriptions';
  end if;
  if (select count(*) from public.pharmacy_config where is_active) <> 1 then raise exception 'S28: exactly one active pharmacy config'; end if;
end $$;
