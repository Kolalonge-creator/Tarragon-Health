-- S28: pharmacy partner. A patient sends a signed prescription to a chosen partner pharmacy for COLLECTION (never delivery,
-- Part C.2); the pharmacy sees it, checks the code the patient shows, records the supply and can flag a problem.
-- Spec 9.6 (Pharmacy), Module 8 rows 8.9 to 8.12. Design: docs/design/S28.md. Research: docs/research/S28.md.
--
-- What was already here: `prescriptions` has pharmacy_partner_id, collection_code, state draft/signed/sent/dispensed/cancelled, the
-- signing CHECK and the frozen-items trigger. Nothing ever set sent, the partner, the code or dispensed_at. The direct partner
-- policies on it returned whole rows (patient_id, items), so they are dropped; partners read and act only through the functions below.
-- Live counts before this change: the prescriptions table has no rows in any state (checked on the live project 2026-10-06), so no data to convert.
--
-- Dormant (INV-14): platform module `pharmacy_collection` is off. Every function refuses while it is off.
-- INV-02: a prescription reaches a pharmacy only once signed; items stay frozen (existing trigger).
-- INV-07/INV-08: notifications are neutral and in-app only; no drug, name or code in any text, no SMS.
-- INV-10: a pharmacist opening a prescription writes audit_log. INV-13: events carry is_test.

-- ---------------------------------------------------------------------------
-- 1. Dormant gate and PROPOSED quality rule (mirrored in packages/shared proposed-config `pharmacy.quality`)
-- ---------------------------------------------------------------------------
insert into public.platform_modules (key, label, description)
values ('pharmacy_collection', 'Pharmacy collection',
        'Lets a patient send a signed prescription to a chosen partner pharmacy for collection, and lets that pharmacy record the supply. No delivery. Dormant until at least one partner pharmacy is approved with a verified licence and the founder confirms.')
on conflict (key) do nothing;

create table public.pharmacy_quality_config (
  version                integer primary key,
  min_licence_days_left  integer not null check (min_licence_days_left >= 0),
  is_active              boolean not null default false,
  proposed               boolean not null default true,
  note                   text,
  created_at             timestamptz not null default now()
);
create unique index pharmacy_quality_config_one_active on public.pharmacy_quality_config ((true)) where is_active;
alter table public.pharmacy_quality_config enable row level security;
revoke all on public.pharmacy_quality_config from public, anon, authenticated;
grant select on public.pharmacy_quality_config to authenticated;
create policy pharmacy_quality_config_read on public.pharmacy_quality_config for select to authenticated
  using (private.is_org_staff((select organisation_id from public.profiles where id = (select auth.uid()))));
insert into public.pharmacy_quality_config (version, min_licence_days_left, is_active, proposed, note)
values (1, 30, true, true, 'PROPOSED by the build, owner CMO. A pharmacy can be chosen only while its verified licence has at least this many days left.');

-- ---------------------------------------------------------------------------
-- 2. Append-only event log for sends, re-routes, flags and supplies
-- ---------------------------------------------------------------------------
create table public.prescription_pharmacy_events (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id),
  prescription_id      uuid not null references public.prescriptions (id) on delete cascade,
  event_type           text not null check (event_type in
                         ('sent', 'rerouted', 'withdrawn', 'flagged_out_of_stock', 'flagged_query', 'dispensed', 'dispensed_partial')),
  pharmacy_partner_id  uuid not null references public.pharmacy_partners (id),
  actor_id             uuid references public.profiles (id) on delete set null,
  note                 text check (note is null or char_length(note) <= 500),
  is_test              boolean not null default false,
  created_at           timestamptz not null default clock_timestamp()
);
create index prescription_pharmacy_events_rx_idx on public.prescription_pharmacy_events (prescription_id, created_at);
alter table public.prescription_pharmacy_events enable row level security;
revoke all on public.prescription_pharmacy_events from public, anon, authenticated;
-- No policy: closed to every API role. Reads and writes go through the functions below.

create function private.rx_events_append_only() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'prescription_pharmacy_events is append only' using errcode = '42501'; end $$;
create trigger prescription_pharmacy_events_append_only before update or delete on public.prescription_pharmacy_events
  for each row execute function private.rx_events_append_only();

-- The patient's most recent pharmacy, so a repeat defaults to it. A preference, not a balance (INV-09).
create table public.patient_pharmacy_preference (
  patient_id           uuid primary key references public.profiles (id) on delete cascade,
  organisation_id      uuid not null references public.organisations (id),
  pharmacy_partner_id  uuid not null references public.pharmacy_partners (id),
  updated_at           timestamptz not null default now()
);
alter table public.patient_pharmacy_preference enable row level security;
revoke all on public.patient_pharmacy_preference from public, anon, authenticated;
grant select on public.patient_pharmacy_preference to authenticated;
create policy patient_pharmacy_preference_own on public.patient_pharmacy_preference for select to authenticated
  using (patient_id = (select auth.uid()));

-- One live collection code per pharmacy at a time.
create unique index prescriptions_live_code_per_pharmacy on public.prescriptions (pharmacy_partner_id, collection_code)
  where state = 'sent' and collection_code is not null;

-- ---------------------------------------------------------------------------
-- 3. The forward-only trigger: let the definer functions below set routing and the signed -> sent step, nothing else.
--    (Same transaction-local flag idiom as tarragon.task_transition.) Everything else in the body is unchanged.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_prescription_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_routing boolean := coalesce(current_setting('tarragon.rx_routing', true), '') = 'on';
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
      -- S28: the patient takes it back from the pharmacy. Only the definer function (flag on) may do this, and it clears the routing.
      or (v_routing and old.state = 'sent' and new.state = 'signed')
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
  -- timestamps are the prescriber's. S28: the patient's send and re-route functions set the flag for routing and the
  -- pickup code only; they still cannot touch the timestamps or the author.
  if tg_op = 'UPDATE' and v_uid is not null and not private.has_prescribing_authority(old.organisation_id) then
    if (not v_routing and (new.pharmacy_partner_id is distinct from old.pharmacy_partner_id or new.collection_code is distinct from old.collection_code
                           or new.sent_at is distinct from old.sent_at))
       or new.cancelled_at is distinct from old.cancelled_at
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
$$;
revoke all on function private.enforce_prescription_rules() from public, anon;

-- A pharmacy never reads or writes the table directly any more (it returned whole rows).
drop policy if exists prescriptions_select_partner on public.prescriptions;
drop policy if exists prescriptions_update_partner_dispense on public.prescriptions;

-- ---------------------------------------------------------------------------
-- 4. Helpers (not callable by API roles)
-- ---------------------------------------------------------------------------
create function private.pharmacy_collection_on() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select is_enabled from public.platform_modules where key = 'pharmacy_collection'), false)
$$;
revoke all on function private.pharmacy_collection_on() from public, anon, authenticated;

-- Can this pharmacy be chosen right now? Active, approved, licence verified and with enough days left.
create function private.pharmacy_choosable(p_partner uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.pharmacy_partners pp
     where pp.id = p_partner and pp.is_active and pp.approved_at is not null
       and pp.license_verified_at is not null
       and pp.license_expires_at is not null
       and pp.license_expires_at >= current_date + (select q.min_licence_days_left from public.pharmacy_quality_config q where q.is_active))
$$;
revoke all on function private.pharmacy_choosable(uuid) from public, anon, authenticated;

-- A prescription is current while the medicine it created is still active, not replaced, not stopped and not expired. An amended
-- or stopped medicine leaves its OLD prescription row 'signed', so state alone is not enough to say "send this".
create function private.prescription_is_current(p_prescription uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.medications m
     where m.prescription_id = p_prescription and m.is_active and m.superseded_at is null
       and (m.expires_at is null or m.expires_at > now()))
$$;
revoke all on function private.prescription_is_current(uuid) from public, anon, authenticated;

create function private.new_collection_code() returns text language plpgsql volatile set search_path = '' as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- no 0, 1, I, O
  v_bytes bytea := decode(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex');
  v_code text := '';
  i integer;
begin
  for i in 0..7 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return v_code;
end $$;
revoke all on function private.new_collection_code() from public, anon, authenticated;

create function private.rx_notify(p_recipient uuid, p_org uuid, p_template text, p_payload jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (p_org, p_recipient, 'in_app', 'pending', p_template, coalesce(p_payload, '{}'::jsonb));
end $$;
revoke all on function private.rx_notify(uuid, uuid, text, jsonb) from public, anon, authenticated;

create function private.rx_notify_pharmacy(p_partner uuid, p_template text, p_payload jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select pr.id, pr.organisation_id from public.profiles pr
            where pr.pharmacy_partner_id = p_partner and pr.role = 'pharmacist' and pr.is_active loop
    perform private.rx_notify(r.id, r.organisation_id, p_template, p_payload);
  end loop;
end $$;
revoke all on function private.rx_notify_pharmacy(uuid, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Notification templates (neutral, in-app only; the INV-07 trigger lints these rows)
-- ---------------------------------------------------------------------------
insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('pharmacy_collection_waiting', 'operational', 'routine', 'partner_pharmacy', array['in_app']::public.notification_channel[], 'immediate',
   'Something is waiting for the pharmacy in the app. Names no medicine, person or code (INV-07).'),
  ('pharmacy_collection_update', 'operational', 'routine', 'patient', array['in_app']::public.notification_channel[], 'immediate',
   'Your pharmacy has an update. Names nothing (INV-07).'),
  ('pharmacy_collection_question', 'operational', 'routine', 'clinician', array['in_app']::public.notification_channel[], 'immediate',
   'A pharmacy has a question for the signing clinician. Names nothing (INV-07).')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('pharmacy_collection_waiting', 'en', 'in_app', 'Something is waiting', 'Something is waiting for you in the Tarragon Health app.'),
  ('pharmacy_collection_update', 'en', 'in_app', 'Your pharmacy has an update', 'Your pharmacy has an update. Open the app to see it.'),
  ('pharmacy_collection_question', 'en', 'in_app', 'A pharmacy has a question', 'A pharmacy has a question for you. Open the app to answer it.')
on conflict (template_key, locale, channel) do nothing;

-- ---------------------------------------------------------------------------
-- 6. Events (S10)
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('prescription.sent', 'A patient sent a signed prescription to a partner pharmacy for collection', 'S28', false),
  ('prescription.dispensed', 'A partner pharmacy recorded the supply of a prescription', 'S28', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys) values
  ('prescription.sent', 1, array['prescription_id']),
  ('prescription.dispensed', 1, array['prescription_id'])
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 7. Patient: which pharmacies, at what price for THESE signed items (8.9). No delivery field is read or returned.
-- ---------------------------------------------------------------------------
create function public.pharmacies_for_prescription(p_prescription uuid)
returns table (
  pharmacy_partner_id uuid, name text, address text, city text, state text, area text,
  latitude double precision, longitude double precision,
  items_total integer, items_priced integer, total_kobo bigint, stock text, is_preferred boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_uid uuid := (select auth.uid());
  v_rx public.prescriptions%rowtype;
  v_pref uuid;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if not private.pharmacy_collection_on() then raise exception 'pharmacy_collection_off' using errcode = '55000'; end if;
  select * into v_rx from public.prescriptions where id = p_prescription and patient_id = v_uid and state in ('signed', 'sent');
  if not found then raise exception 'prescription_not_found' using errcode = '42501'; end if;
  if not private.prescription_is_current(p_prescription) then raise exception 'prescription_not_current' using errcode = '22023'; end if;
  select pharmacy_partner_id into v_pref from public.patient_pharmacy_preference where patient_id = v_uid;

  return query
  with items as (
    select private.normalise_term(it ->> 'drug_name') as term from jsonb_array_elements(v_rx.items) it
  ), pharm as (
    select pp.id, pp.name, pp.address, pp.city, pp.state, pp.area, pp.latitude, pp.longitude
      from public.pharmacy_partners pp where private.pharmacy_choosable(pp.id)
  ), priced as (
    select ph.id as partner_id, i.term,
           min(pm.price_kobo) as price_kobo,
           max(case pm.stock_status when 'unavailable' then 3 when 'low_stock' then 2 when 'in_stock' then 1 end) as stock_rank
      from pharm ph cross join items i
      left join public.pharmacy_medications pm
        on pm.pharmacy_partner_id = ph.id and pm.is_active and private.normalise_term(pm.drug_name) = i.term
     group by ph.id, i.term
  )
  select ph.id, ph.name, ph.address, ph.city, ph.state, ph.area, ph.latitude, ph.longitude,
         (select count(*)::integer from items),
         count(pr.price_kobo)::integer,
         coalesce(sum(pr.price_kobo), 0)::bigint,
         case coalesce(max(pr.stock_rank), 0) when 3 then 'unavailable' when 2 then 'low_stock' when 1 then 'in_stock' else 'unknown' end,
         ph.id = v_pref
    from pharm ph left join priced pr on pr.partner_id = ph.id
   group by ph.id, ph.name, ph.address, ph.city, ph.state, ph.area, ph.latitude, ph.longitude
   order by (ph.id = v_pref) desc, ph.name;
end $$;

-- Should the patient screen offer this at all? On, and at least one pharmacy can be chosen right now.
create function public.pharmacy_collection_available()
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
     and private.pharmacy_collection_on()
     and exists (select 1 from public.pharmacy_partners pp where private.pharmacy_choosable(pp.id))
$$;

-- ---------------------------------------------------------------------------
-- 8. Patient: send, and re-send to a different pharmacy while it is still waiting
-- ---------------------------------------------------------------------------
create function private.route_prescription(p_prescription uuid, p_partner uuid, p_consent boolean, p_event text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_rx public.prescriptions%rowtype;
  v_name text;
  v_code text;
  v_try integer := 0;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if not private.pharmacy_collection_on() then raise exception 'pharmacy_collection_off' using errcode = '55000'; end if;
  if p_consent is not true then raise exception 'consent_required' using errcode = '22023'; end if;

  select * into v_rx from public.prescriptions where id = p_prescription and patient_id = v_uid for update;
  if not found then raise exception 'prescription_not_found' using errcode = '42501'; end if;
  if p_event = 'sent' and v_rx.state <> 'signed' then raise exception 'prescription_not_sendable' using errcode = '22023'; end if;
  if p_event = 'rerouted' and v_rx.state <> 'sent' then raise exception 'prescription_not_waiting' using errcode = '22023'; end if;
  if p_event = 'rerouted' and v_rx.pharmacy_partner_id = p_partner then raise exception 'same_pharmacy' using errcode = '22023'; end if;
  if v_rx.signed_by is null or v_rx.signed_at is null then raise exception 'prescription_not_signed' using errcode = '22023'; end if;
  if not private.prescription_is_current(p_prescription) then raise exception 'prescription_not_current' using errcode = '22023'; end if;
  if not private.pharmacy_choosable(p_partner) then raise exception 'pharmacy_not_available' using errcode = '22023'; end if;
  select name into v_name from public.pharmacy_partners where id = p_partner;

  perform set_config('tarragon.rx_routing', 'on', true);
  loop
    v_try := v_try + 1;
    v_code := private.new_collection_code();
    begin
      update public.prescriptions
         set state = 'sent', pharmacy_partner_id = p_partner, collection_code = v_code,
             sent_at = case when p_event = 'sent' then now() else sent_at end
       where id = p_prescription;
      exit;
    exception when unique_violation then
      if v_try >= 5 then perform set_config('tarragon.rx_routing', 'off', true); raise; end if;
    end;
  end loop;
  perform set_config('tarragon.rx_routing', 'off', true);

  insert into public.prescription_pharmacy_events (organisation_id, prescription_id, event_type, pharmacy_partner_id, actor_id, is_test)
  values (v_rx.organisation_id, p_prescription, p_event, p_partner, v_uid, v_rx.is_test);
  insert into public.patient_pharmacy_preference (patient_id, organisation_id, pharmacy_partner_id) values (v_uid, v_rx.organisation_id, p_partner)
  on conflict (patient_id) do update set pharmacy_partner_id = excluded.pharmacy_partner_id, updated_at = now();
  perform private.log_audit('prescription.' || p_event, 'prescriptions', p_prescription,
    jsonb_build_object('pharmacy_partner_id', p_partner, 'consent', true));
  perform private.emit_domain_event('prescription.sent', v_rx.organisation_id, jsonb_build_object('prescription_id', p_prescription),
    'prescription.sent:' || p_prescription || ':' || v_code, v_rx.patient_id, 'prescription', p_prescription);
  perform private.rx_notify_pharmacy(p_partner, 'pharmacy_collection_waiting');
  return jsonb_build_object('collection_code', v_code, 'pharmacy_name', v_name);
end $$;
revoke all on function private.route_prescription(uuid, uuid, boolean, text) from public, anon, authenticated;

create function public.send_prescription_to_pharmacy(p_prescription uuid, p_partner uuid, p_consent boolean)
returns jsonb language sql security definer set search_path = '' as $$
  select private.route_prescription(p_prescription, p_partner, p_consent, 'sent')
$$;
create function public.reroute_prescription_pharmacy(p_prescription uuid, p_partner uuid, p_consent boolean)
returns jsonb language sql security definer set search_path = '' as $$
  select private.route_prescription(p_prescription, p_partner, p_consent, 'rerouted')
$$;

-- The patient's own view: where it went, the code to show, and whether the pharmacy said it cannot supply.
create function public.my_prescription_pharmacy(p_prescription uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_rx public.prescriptions%rowtype;
  v_name text; v_area text;
  v_last text;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into v_rx from public.prescriptions where id = p_prescription and patient_id = v_uid and state <> 'draft';
  if not found then raise exception 'prescription_not_found' using errcode = '42501'; end if;
  if v_rx.pharmacy_partner_id is null then
    return jsonb_build_object('state', v_rx.state, 'sent', false);
  end if;
  select name, coalesce(area, city) into v_name, v_area from public.pharmacy_partners where id = v_rx.pharmacy_partner_id;
  select event_type into v_last from public.prescription_pharmacy_events
   where prescription_id = p_prescription and event_type in ('sent', 'rerouted', 'flagged_out_of_stock') order by created_at desc, id desc limit 1;
  return jsonb_build_object(
    'sent', true, 'state', v_rx.state, 'pharmacy_name', v_name, 'pharmacy_area', v_area,
    'collection_code', case when v_rx.state = 'sent' then v_rx.collection_code end,
    'sent_at', v_rx.sent_at, 'dispensed_at', v_rx.dispensed_at,
    'needs_other_pharmacy', (v_rx.state = 'sent' and v_last = 'flagged_out_of_stock'));
end $$;

-- The patient takes it back. Consent to share is revocable: the pharmacy stops seeing it at once and the prescription goes back to
-- 'signed'. Works whether or not collection is switched on, because it only removes sharing.
create function public.withdraw_prescription_from_pharmacy(p_prescription uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_rx public.prescriptions%rowtype;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into v_rx from public.prescriptions where id = p_prescription and patient_id = v_uid for update;
  if not found then raise exception 'prescription_not_found' using errcode = '42501'; end if;
  if v_rx.state <> 'sent' then raise exception 'prescription_not_waiting' using errcode = '22023'; end if;
  perform set_config('tarragon.rx_routing', 'on', true);
  update public.prescriptions set state = 'signed', pharmacy_partner_id = null, collection_code = null, sent_at = null where id = p_prescription;
  perform set_config('tarragon.rx_routing', 'off', true);
  insert into public.prescription_pharmacy_events (organisation_id, prescription_id, event_type, pharmacy_partner_id, actor_id, is_test)
  values (v_rx.organisation_id, p_prescription, 'withdrawn', v_rx.pharmacy_partner_id, v_uid, v_rx.is_test);
  perform private.log_audit('prescription.withdrawn', 'prescriptions', p_prescription, jsonb_build_object('pharmacy_partner_id', v_rx.pharmacy_partner_id));
  return jsonb_build_object('ok', true);
end $$;

-- The patient's list for the Medicines screen. Reads only her own rows, whether or not collection is on (a code she holds must stay
-- visible), and says whether each is still current so a replaced or stopped medicine is never offered for sending.
create function public.my_collection_prescriptions()
returns table (prescription_id uuid, state text, items jsonb, signed_at timestamptz, is_current boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  return query
  select rx.id, rx.state::text, rx.items, rx.signed_at, private.prescription_is_current(rx.id)
    from public.prescriptions rx
   where rx.patient_id = v_uid and rx.state in ('signed', 'sent', 'dispensed') and rx.signed_at >= now() - interval '90 days'
   order by rx.signed_at desc limit 10;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Pharmacy: inbox, detail (audited), mark supplied, flag a problem
-- ---------------------------------------------------------------------------
create function private.require_pharmacist() returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_partner uuid := private.pharmacist_partner();
begin
  if (select auth.uid()) is null or v_partner is null then raise exception 'This action is for partner pharmacies' using errcode = '42501'; end if;
  if not private.pharmacy_collection_on() then raise exception 'pharmacy_collection_off' using errcode = '55000'; end if;
  -- A pharmacy that has been switched off, or whose licence has run out, stops seeing patients' prescriptions at once.
  if not exists (select 1 from public.pharmacy_partners pp
                  where pp.id = v_partner and pp.is_active and pp.license_expires_at is not null and pp.license_expires_at >= current_date) then
    raise exception 'pharmacy_not_active' using errcode = '42501';
  end if;
  return v_partner;
end $$;
revoke all on function private.require_pharmacist() from public, anon, authenticated;

create function public.pharmacy_inbox()
returns table (prescription_id uuid, collection_code text, state text, sent_at timestamptz, dispensed_at timestamptz,
               first_name text, medicine_count integer, has_open_flag boolean, is_test boolean)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_partner uuid := private.require_pharmacist();
begin
  return query
  select rx.id, rx.collection_code, rx.state::text, rx.sent_at, rx.dispensed_at,
         split_part(coalesce(p.full_name, ''), ' ', 1),
         jsonb_array_length(rx.items),
         exists (select 1 from public.prescription_pharmacy_events e
                  where e.prescription_id = rx.id and e.event_type in ('flagged_out_of_stock', 'flagged_query')
                    and e.created_at > coalesce((select max(e2.created_at) from public.prescription_pharmacy_events e2
                                                  where e2.prescription_id = rx.id and e2.event_type in ('sent', 'rerouted')), 'epoch')),
         rx.is_test
    from public.prescriptions rx join public.profiles p on p.id = rx.patient_id
   where rx.pharmacy_partner_id = v_partner
     and (rx.state = 'sent' or (rx.state = 'dispensed' and rx.dispensed_at > now() - interval '14 days'))
   order by (rx.state = 'sent') desc, coalesce(rx.sent_at, rx.created_at) desc;
end $$;

create function public.pharmacy_prescription_detail(p_prescription uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_partner uuid := private.require_pharmacist();
  v_rx public.prescriptions%rowtype;
  v_pat public.profiles%rowtype;
  v_med public.medications%rowtype;
  v_signer text;
  v_dispensed integer := 0;
  v_permitted integer := 1;
begin
  select * into v_rx from public.prescriptions where id = p_prescription and pharmacy_partner_id = v_partner and state in ('sent', 'dispensed');
  if not found then raise exception 'prescription_not_found' using errcode = '42501'; end if;
  select * into v_pat from public.profiles where id = v_rx.patient_id;
  select full_name into v_signer from public.profiles where id = v_rx.signed_by;
  select * into v_med from public.medications where prescription_id = p_prescription limit 1;
  if v_med.id is not null then
    select count(*)::integer into v_dispensed from public.pharmacy_order_dispenses d
       where d.medication_id = v_med.id and d.source = 'pharmacy' and not coalesce(d.is_partial, false);
    v_permitted := 1 + coalesce((select count(*) from public.medication_repeat_requests r where r.medication_id = v_med.id and r.status = 'approved'), 0)::integer;
    v_permitted := least(v_permitted, 1 + coalesce(v_med.repeats_allowed, 0));
  end if;
  perform private.log_audit('prescription.pharmacy_opened', 'prescriptions', p_prescription, jsonb_build_object('pharmacy_partner_id', v_partner));
  return jsonb_build_object(
    'prescription_id', v_rx.id, 'collection_code', v_rx.collection_code, 'state', v_rx.state,
    'sent_at', v_rx.sent_at, 'dispensed_at', v_rx.dispensed_at, 'signed_at', v_rx.signed_at, 'signed_by_name', v_signer,
    'patient', jsonb_build_object('full_name', v_pat.full_name, 'age_years', case when v_pat.date_of_birth is null then null else date_part('year', age(v_pat.date_of_birth))::integer end),
    'allergies', coalesce((select jsonb_agg(jsonb_build_object('allergen', a.allergen, 'reaction', a.reaction, 'severity', a.severity) order by a.allergen)
                             from public.patient_allergies a where a.patient_id = v_rx.patient_id), '[]'::jsonb),
    'items', v_rx.items,
    'supplies_recorded', v_dispensed, 'supplies_permitted', v_permitted,
    'is_test', v_rx.is_test);
end $$;

create function public.pharmacy_mark_dispensed(
  p_prescription uuid, p_collection_code text, p_pharmacist_name text, p_pharmacist_registration text default null,
  p_quantity_supplied text default null, p_batch_number text default null, p_batch_expiry date default null,
  p_is_partial boolean default false, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_partner uuid := private.require_pharmacist();
  v_uid uuid := (select auth.uid());
  v_rx public.prescriptions%rowtype;
  v_med public.medications%rowtype;
  v_pharmacy text;
  v_name text := btrim(coalesce(p_pharmacist_name, ''));
  v_reg text := nullif(btrim(coalesce(p_pharmacist_registration, '')), '');
  v_qty text := nullif(btrim(coalesce(p_quantity_supplied, '')), '');
  v_batch text := nullif(btrim(coalesce(p_batch_number, '')), '');
  v_code text := upper(regexp_replace(coalesce(p_collection_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_dispensed integer;
  v_permitted integer;
  v_misses integer;
begin
  if char_length(v_name) not between 2 and 120 or char_length(coalesce(v_reg, '')) > 40
     or char_length(coalesce(v_qty, '')) > 100 or char_length(coalesce(v_batch, '')) > 60
     or char_length(coalesce(p_note, '')) > 500 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  -- Too many wrong codes from this account: stop guessing. Recorded, so the refusal itself is visible.
  select count(*) into v_misses from public.audit_log
   where actor_id = v_uid and action = 'prescription.pharmacy_code_mismatch' and created_at > now() - interval '10 minutes';
  if v_misses >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'too_many_attempts');
  end if;

  select * into v_rx from public.prescriptions where id = p_prescription and pharmacy_partner_id = v_partner for update;
  if not found or v_rx.state <> 'sent' then
    return jsonb_build_object('ok', false, 'reason', 'not_waiting');
  end if;
  if v_code = '' or v_code <> upper(coalesce(v_rx.collection_code, '')) then
    perform private.log_audit('prescription.pharmacy_code_mismatch', 'prescriptions', p_prescription, jsonb_build_object('pharmacy_partner_id', v_partner));
    return jsonb_build_object('ok', false, 'reason', 'code_mismatch');
  end if;

  select * into v_med from public.medications where prescription_id = p_prescription limit 1 for update;
  if v_med.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_linked');
  end if;
  -- A partial supply is part of one supply, not a supply of its own: only complete ones use up the permitted number.
  select count(*)::integer into v_dispensed from public.pharmacy_order_dispenses d
   where d.medication_id = v_med.id and d.source = 'pharmacy' and not coalesce(d.is_partial, false);
  v_permitted := least(1 + coalesce((select count(*) from public.medication_repeat_requests r where r.medication_id = v_med.id and r.status = 'approved'), 0)::integer,
                       1 + coalesce(v_med.repeats_allowed, 0));
  if v_med.superseded_at is not null or not v_med.is_active or (v_med.expires_at is not null and v_med.expires_at < now()) then
    return jsonb_build_object('ok', false, 'reason', 'not_active');
  end if;
  if v_dispensed >= v_permitted then
    return jsonb_build_object('ok', false, 'reason', 'no_supply_available');
  end if;
  select name into v_pharmacy from public.pharmacy_partners where id = v_partner;

  insert into public.pharmacy_order_dispenses (
    organisation_id, patient_id, medication_id, drug_name, strength, quantity, quantity_prescribed, dispensed_on, source, recorded_by,
    pharmacy_name, pharmacist_name, pharmacist_registration, recorded_via, batch_number, expiry_date, is_partial, outstanding_note)
  values (v_med.organisation_id, v_med.patient_id, v_med.id, v_med.drug_name, v_med.dose, coalesce(v_qty, v_med.quantity), v_med.quantity,
          (now() at time zone 'Africa/Lagos')::date, 'pharmacy', v_uid, v_pharmacy, v_name, v_reg, 'partner', v_batch, p_batch_expiry,
          coalesce(p_is_partial, false), case when coalesce(p_is_partial, false) then nullif(btrim(p_note), '') end);

  insert into public.prescription_pharmacy_events (organisation_id, prescription_id, event_type, pharmacy_partner_id, actor_id, note, is_test)
  values (v_rx.organisation_id, p_prescription, case when coalesce(p_is_partial, false) then 'dispensed_partial' else 'dispensed' end,
          v_partner, v_uid, case when coalesce(p_is_partial, false) then nullif(btrim(p_note), '') end, v_rx.is_test);

  if not coalesce(p_is_partial, false) then
    update public.prescriptions set state = 'dispensed' where id = p_prescription;
    perform private.emit_domain_event('prescription.dispensed', v_rx.organisation_id, jsonb_build_object('prescription_id', p_prescription),
      'prescription.dispensed:' || p_prescription, v_rx.patient_id, 'prescription', p_prescription);
  end if;
  perform private.log_audit('prescription.pharmacy_dispensed', 'prescriptions', p_prescription,
    jsonb_build_object('pharmacy_partner_id', v_partner, 'partial', coalesce(p_is_partial, false)));
  perform private.rx_notify(v_rx.patient_id, v_rx.organisation_id, 'pharmacy_collection_update');
  return jsonb_build_object('ok', true, 'partial', coalesce(p_is_partial, false));
end $$;

create function public.pharmacy_flag_prescription(p_prescription uuid, p_kind text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_partner uuid := private.require_pharmacist();
  v_uid uuid := (select auth.uid());
  v_rx public.prescriptions%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_kind not in ('out_of_stock', 'query_to_prescriber') then raise exception 'invalid_flag' using errcode = '22023'; end if;
  if char_length(coalesce(v_note, '')) > 500 then raise exception 'note_too_long' using errcode = '22023'; end if;
  if p_kind = 'query_to_prescriber' and v_note is null then raise exception 'note_required' using errcode = '22023'; end if;
  select * into v_rx from public.prescriptions where id = p_prescription and pharmacy_partner_id = v_partner and state = 'sent' for update;
  if not found then raise exception 'prescription_not_found' using errcode = '42501'; end if;

  insert into public.prescription_pharmacy_events (organisation_id, prescription_id, event_type, pharmacy_partner_id, actor_id, note, is_test)
  values (v_rx.organisation_id, p_prescription, case p_kind when 'out_of_stock' then 'flagged_out_of_stock' else 'flagged_query' end,
          v_partner, v_uid, v_note, v_rx.is_test);
  perform private.log_audit('prescription.pharmacy_flag', 'prescriptions', p_prescription, jsonb_build_object('kind', p_kind));
  if p_kind = 'out_of_stock' then
    perform private.rx_notify(v_rx.patient_id, v_rx.organisation_id, 'pharmacy_collection_update');
  else
    perform private.rx_notify(v_rx.signed_by, v_rx.organisation_id, 'pharmacy_collection_question', jsonb_build_object('prescription_id', p_prescription));
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- The prescriber sees the question (the note is staff-only). Tie-checked (INV-12) and audited (INV-10).
create function public.prescription_pharmacy_questions(p_prescription uuid)
returns table (asked_at timestamptz, pharmacy_name text, note text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_rx public.prescriptions%rowtype;
begin
  select * into v_rx from public.prescriptions where id = p_prescription;
  if not found or not private.clinician_has_patient_access(v_rx.patient_id) then
    raise exception 'prescription_not_found' using errcode = '42501';
  end if;
  perform private.log_audit('prescription.pharmacy_questions_read', 'prescriptions', p_prescription, '{}'::jsonb);
  return query
    select e.created_at, pp.name, e.note from public.prescription_pharmacy_events e
      join public.pharmacy_partners pp on pp.id = e.pharmacy_partner_id
     where e.prescription_id = p_prescription and e.event_type = 'flagged_query' order by e.created_at desc;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Grants. API roles get the public functions only; anon gets none (revoke from PUBLIC, not from anon).
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.pharmacies_for_prescription(uuid)', 'public.send_prescription_to_pharmacy(uuid,uuid,boolean)',
    'public.reroute_prescription_pharmacy(uuid,uuid,boolean)', 'public.my_prescription_pharmacy(uuid)',
    'public.pharmacy_inbox()', 'public.pharmacy_prescription_detail(uuid)',
    'public.pharmacy_mark_dispensed(uuid,text,text,text,text,text,date,boolean,text)',
    'public.pharmacy_flag_prescription(uuid,text,text)', 'public.prescription_pharmacy_questions(uuid)',
    'public.pharmacy_collection_available()', 'public.withdraw_prescription_from_pharmacy(uuid)', 'public.my_collection_prescriptions()']
  loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 11. Assertions: the migration proves what it claims
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.pharmacies_for_prescription(uuid)', 'public.send_prescription_to_pharmacy(uuid,uuid,boolean)',
    'public.reroute_prescription_pharmacy(uuid,uuid,boolean)', 'public.my_prescription_pharmacy(uuid)',
    'public.pharmacy_inbox()', 'public.pharmacy_prescription_detail(uuid)',
    'public.pharmacy_mark_dispensed(uuid,text,text,text,text,text,date,boolean,text)',
    'public.pharmacy_flag_prescription(uuid,text,text)', 'public.prescription_pharmacy_questions(uuid)',
    'public.pharmacy_collection_available()', 'public.withdraw_prescription_from_pharmacy(uuid)', 'public.my_collection_prescriptions()',
    'private.route_prescription(uuid,uuid,boolean,text)', 'private.rx_notify(uuid,uuid,text,jsonb)']
  loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon can execute %', f; end if;
  end loop;
  if has_table_privilege('authenticated', 'public.prescription_pharmacy_events', 'SELECT') then raise exception 'events table is readable'; end if;
  if exists (select 1 from pg_policy where polrelid = 'public.prescriptions'::regclass and polname like '%partner%') then
    raise exception 'a direct partner policy on prescriptions survived';
  end if;
  if (select is_enabled from public.platform_modules where key = 'pharmacy_collection') then raise exception 'module must start off'; end if;
end $$;
