-- S54: Module 8 (2 of 2): price and stock comparison across verified partner pharmacies (8.9), partner quality rules and verified batches
-- (8.11), pharmacist chat (8.12), the refill reminder tied to the chosen pharmacy (8.10), and pickup only for pharmacy orders (decision D5).
-- INV-02 (nothing here edits a prescription), INV-07 (every notice is generic, chat text never goes in a notice), INV-10 (a pharmacist's
-- reads of a patient's words are audited), INV-13 (is_test carried), 8.16 (nothing here carries what Tarragon earns).
--
-- WHO CHOOSES THE PHARMACY: the patient, in the S28 chooser (founder decision 2026-10-07). This migration only adds the comparison the
-- patient sees before choosing, and the quality rules that decide which pharmacies can be listed at all. A clinician never picks a
-- pharmacy and never sees an earning (8.16). The signed prescription can always be downloaded and taken to any pharmacy.
--
-- LIVE COUNTS READ 2026-10-07 (read-only), before any change: pharmacy_orders 0 (so 0 with a non-pickup fulfilment_method, 0 with a courier,
-- address or fee), pharmacy_order_delivery_attempts 0, pharmacy_medications 0, pharmacy_partners 4 (none active), logistics_partners 1,
-- prescriptions 0, pharmacist profiles 0. The pickup-only CHECK therefore converts no data; no delivery table or function is dropped
-- (OQ-16, count-first removal is a later batch).
--
-- This file does not depend on any S28 object. It touches prescriptions only through a BEFORE UPDATE trigger, so it replays the same
-- whether it sorts before or after the S28 migration.

-- ---------------------------------------------------------------------------
-- 1. Partner quality (8.11): a pharmacy is "listable" only with a verified, unexpired licence AND a recorded attestation that it
--    sources only from NAFDAC-registered suppliers. Tarragon cannot verify a batch itself; it records who attested and when.
-- ---------------------------------------------------------------------------
alter table public.pharmacy_partners
  add column nafdac_source_attested_at timestamptz,
  add column nafdac_source_attested_by uuid references public.profiles (id) on delete restrict,
  add column nafdac_source_note text check (nafdac_source_note is null or char_length(nafdac_source_note) <= 500);
comment on column public.pharmacy_partners.nafdac_source_attested_at is
  'S54 8.11: when a Tarragon admin or partner manager recorded the pharmacy''s attestation that it sources only from NAFDAC-registered suppliers (with the supplier paperwork seen). Only attest_pharmacy_nafdac_source() sets it. Without it the pharmacy is never listed or compared.';

create or replace function private.pharmacy_partner_listable(p_partner uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.pharmacy_partners pp
     where pp.id = p_partner
       and pp.is_active
       and pp.approved_at is not null
       and pp.license_verified_at is not null
       and (pp.license_expires_at is null or pp.license_expires_at > now())
       and pp.nafdac_source_attested_at is not null)
$$;
revoke all on function private.pharmacy_partner_listable(uuid) from public, anon, authenticated;

create or replace function private.guard_pharmacy_partner_attestation() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.nafdac_source_attested_at is distinct from old.nafdac_source_attested_at
      or new.nafdac_source_attested_by is distinct from old.nafdac_source_attested_by
      or new.nafdac_source_note is distinct from old.nafdac_source_note)
     and (select auth.uid()) is not null
     and coalesce(current_setting('tarragon.attest_source', true), '') <> 'on' then
    raise exception 'the NAFDAC source attestation is recorded only through attest_pharmacy_nafdac_source' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger pharmacy_partners_guard_attestation before update on public.pharmacy_partners
  for each row execute function private.guard_pharmacy_partner_attestation();

create or replace function public.attest_pharmacy_nafdac_source(p_partner uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not (private.is_admin() or private.has_permission('partners.pharmacies.manage'::text)) then
    raise exception 'only an admin or a partner manager can record this' using errcode = '42501';
  end if;
  if p_note is null or char_length(btrim(p_note)) < 10 then
    raise exception 'say what was seen (supplier names and the paperwork), at least 10 characters' using errcode = '22023';
  end if;
  if not exists (select 1 from public.pharmacy_partners where id = p_partner) then
    raise exception 'no such pharmacy' using errcode = '22023';
  end if;
  perform set_config('tarragon.attest_source', 'on', true);
  update public.pharmacy_partners
     set nafdac_source_attested_at = now(), nafdac_source_attested_by = v_uid, nafdac_source_note = btrim(p_note)
   where id = p_partner;
  perform set_config('tarragon.attest_source', 'off', true);
  perform private.log_audit('pharmacy.nafdac_source_attested', 'pharmacy_partners', p_partner, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.attest_pharmacy_nafdac_source(uuid, text) from public, anon;
grant execute on function public.attest_pharmacy_nafdac_source(uuid, text) to authenticated;

-- A prescription can only be routed to a listable pharmacy, whoever routes it (the patient's chooser, or any other door).
create or replace function private.enforce_listable_pharmacy_on_prescription() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.pharmacy_partner_id is not null
     and (tg_op = 'INSERT' or new.pharmacy_partner_id is distinct from old.pharmacy_partner_id)
     and not private.pharmacy_partner_listable(new.pharmacy_partner_id) then
    raise exception 'pharmacy_not_available' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function private.enforce_listable_pharmacy_on_prescription() from public, anon, authenticated;
create trigger prescriptions_listable_pharmacy before insert or update of pharmacy_partner_id on public.prescriptions
  for each row execute function private.enforce_listable_pharmacy_on_prescription();

-- ---------------------------------------------------------------------------
-- 2. Price, stock and verified batch on the live catalogue table (D1: no new pharmacy_prices table). price_kobo, stock_status and
--    stock_updated_at already exist; this adds the verified-batch flag. Only Tarragon staff set it; a pharmacy never marks its own batch.
-- ---------------------------------------------------------------------------
alter table public.pharmacy_medications
  add column verified_batch boolean not null default false,
  add column verified_batch_at timestamptz,
  add column verified_batch_by uuid references public.profiles (id) on delete restrict,
  add constraint pharmacy_medications_verified_batch_stamped check (not verified_batch or (verified_batch_at is not null and verified_batch_by is not null));
comment on column public.pharmacy_medications.verified_batch is
  'S54 8.11: a Tarragon admin or partner manager checked this line''s current batch against the supplier paperwork. It says nothing about authenticity (NAFDAC owns that) and is shown to patients as "checked by Tarragon staff against the supplier paperwork". A pharmacy cannot set it.';

create or replace function private.guard_pharmacy_medication_verified_batch() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_staff boolean := private.is_admin() or private.has_permission('partners.pharmacies.manage'::text);
begin
  if tg_op = 'INSERT' then
    if new.verified_batch and (select auth.uid()) is not null and not v_staff then
      raise exception 'only Tarragon staff can mark a batch verified' using errcode = '42501';
    end if;
  elsif new.verified_batch is distinct from old.verified_batch
        or new.verified_batch_at is distinct from old.verified_batch_at
        or new.verified_batch_by is distinct from old.verified_batch_by then
    if (select auth.uid()) is not null and not v_staff then
      raise exception 'only Tarragon staff can mark a batch verified' using errcode = '42501';
    end if;
  end if;
  -- The check "does this pharmacy pass the quality rules" applies only when a batch BECOMES verified, so an unrelated edit (an
  -- is_active toggle, a stock update) on a line of a pharmacy whose licence has since lapsed is never blocked.
  if new.verified_batch and (tg_op = 'INSERT' or not old.verified_batch) then
    if not private.pharmacy_partner_listable(new.pharmacy_partner_id) then
      raise exception 'a batch can only be verified for a pharmacy that passes the quality rules (licence and NAFDAC source)' using errcode = '22023';
    end if;
    new.verified_batch_at := now();
    new.verified_batch_by := coalesce((select auth.uid()), new.verified_batch_by);
  end if;
  -- The flag vouches for ONE line: if what the line is (name, strength, pack) or what it costs changes, the check no longer applies.
  if tg_op = 'UPDATE' and old.verified_batch and new.verified_batch
     and (new.drug_name is distinct from old.drug_name or new.strength is distinct from old.strength
          or new.pack_size is distinct from old.pack_size or new.price_kobo is distinct from old.price_kobo
          or new.pharmacy_partner_id is distinct from old.pharmacy_partner_id) then
    new.verified_batch := false;
  end if;
  if not new.verified_batch then
    new.verified_batch_at := null;
    new.verified_batch_by := null;
  end if;
  return new;
end $$;
create trigger pharmacy_medications_verified_batch_guard before insert or update on public.pharmacy_medications
  for each row execute function private.guard_pharmacy_medication_verified_batch();

-- The patient-safe grant: the verified flag and when, never who. (Column grants, same rule as the 8.16 pre-fix: new columns are not
-- readable by default.)
grant select (verified_batch, verified_batch_at) on public.pharmacy_medications to authenticated;

-- The admin view gains the new columns at the end (create or replace may only append).
create or replace view public.pharmacy_medications_admin
  with (security_invoker = false)
  as
  select pm.id, pm.pharmacy_partner_id, pp.name as pharmacy_partner_name, pm.drug_name, pm.pack_size, pm.price_kobo, pm.is_active,
         pm.created_at, pm.commission_rate, pm.commission_rate_type, pm.commission_flat_kobo, pm.strength, pm.is_generic,
         pm.generic_equivalent_of, pm.stock_status, pm.expected_restock_at, pm.stock_updated_at, pm.requires_cold_chain,
         pm.verified_batch, pm.verified_batch_at, pm.verified_batch_by
  from public.pharmacy_medications pm
  left join public.pharmacy_partners pp on pp.id = pm.pharmacy_partner_id
  where private.is_admin() or private.has_permission('partners.pharmacies.manage'::text);

-- ---------------------------------------------------------------------------
-- The name a price line is matched on: lower case, words only, any word with a digit (a strength) and any unit or form word
-- (mg, ml, tablet, capsule and so on) dropped. "Metformin 500 mg" and
-- "Metformin" are the same medicine; "Insulin glargine" and "Insulin aspart", or "Metformin XR", are not.
create or replace function private.pharmacy_name_key(p_name text) returns text
language sql immutable set search_path = '' as $$
  select coalesce((select string_agg(w, ' ') from unnest(string_to_array(coalesce(private.normalise_term(p_name), ''), ' ')) w
                    where w !~ '[0-9]' and w not in ('mg', 'mcg', 'g', 'ml', 'iu', 'unit', 'units', 'tablet', 'tablets', 'tab', 'tabs', 'capsule', 'capsules', 'cap', 'caps', 'syrup', 'injection', 'inhaler', 'cream', 'drops', 'sachet')), '')
$$;
revoke all on function private.pharmacy_name_key(text) from public, anon, authenticated;

-- 3. price-compare (8.9): for one of the patient's prescriptions, which listable pharmacies can supply it, at what price, with what
--    stock. Ordered by how many items the pharmacy can supply, whether all are in stock, then total price, then name. It reads price, stock and the verified flag
--    only: it never reads a commission column and nothing about it can be influenced by what Tarragon earns (a test reads this
--    function's own source for the word and the proof reads its output as a patient and a clinician).
-- ---------------------------------------------------------------------------
create or replace function public.patient_price_compare(p_prescription uuid)
returns table (partner_id uuid, partner_name text, location_id uuid, location_name text, state text, address text,
               items_total integer, items_matched integer, total_kobo bigint, all_in_stock boolean, any_low_stock boolean,
               all_verified_batch boolean, prices_updated_at timestamptz, lines jsonb)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  rx public.prescriptions%rowtype;
  v_uid uuid := (select auth.uid());
  v_total integer;
begin
  select * into rx from public.prescriptions where id = p_prescription and state in ('signed', 'sent');
  if not found or v_uid is null
     or not (rx.patient_id = v_uid or private.can_act_for(rx.patient_id, 'manage_pharmacy'::public.caregiver_permission)) then
    raise exception 'Prescription not found' using errcode = '42501';
  end if;
  v_total := coalesce(jsonb_array_length(rx.items), 0);

  return query
  with items as (
    select i.ord,
           private.normalise_term(coalesce(i.item ->> 'drug', i.item ->> 'drug_name', i.item ->> 'name')) as nm,
           regexp_replace(lower(coalesce(i.item ->> 'dose', i.item ->> 'strength', '')), '[^a-z0-9.%/]+', '', 'g') as dose_n
      from jsonb_array_elements(rx.items) with ordinality as i(item, ord)),
  cand as (
    select it.ord, pm.pharmacy_partner_id as pid, pm.drug_name, pm.pack_size, pm.price_kobo,
           coalesce(pm.stock_status::text, 'unknown') as stock, pm.verified_batch, pm.strength,
           (regexp_replace(lower(coalesce(pm.strength, '')), '[^a-z0-9.%/]+', '', 'g') = it.dose_n and it.dose_n <> '') as strength_confirmed,
           (it.dose_n <> '') as dose_given,
           coalesce(pm.stock_updated_at, pm.created_at) as updated
      from items it
      join public.pharmacy_medications pm
        on pm.is_active
       and private.pharmacy_name_key(pm.drug_name) = private.pharmacy_name_key(it.nm)
       and (it.dose_n = '' or regexp_replace(lower(coalesce(pm.strength, '')), '[^a-z0-9.%/]+', '', 'g') = it.dose_n)
     where it.nm is not null and private.pharmacy_partner_listable(pm.pharmacy_partner_id)),
  best as (
    -- one line per item per pharmacy: the cheapest row that is not out of stock, else the cheapest row
    select distinct on (c.pid, c.ord) c.*
      from cand c
     order by c.pid, c.ord, (not c.strength_confirmed and c.dose_given), (c.stock = 'unavailable'), c.price_kobo, c.drug_name),
  agg as (
    select b.pid,
           count(*)::integer as matched,
           sum(b.price_kobo)::bigint as total,
           bool_and(b.stock in ('in_stock', 'low_stock')) as all_in,
           bool_or(b.stock = 'low_stock') as any_low,
           bool_and(b.verified_batch) as all_vb,
           min(b.updated) as upd,
           jsonb_agg(jsonb_build_object('item', b.ord, 'drug', b.drug_name, 'pack', b.pack_size, 'price_kobo', b.price_kobo,
                                        'stock', b.stock, 'verified_batch', b.verified_batch, 'strength_confirmed', b.strength_confirmed)
                     order by b.ord) as lines
      from best b group by b.pid)
  select pp.id, pp.name, l.id, l.name, l.state, l.address, v_total, a.matched, a.total, a.all_in, a.any_low, a.all_vb, a.upd, a.lines
    from agg a
    join public.pharmacy_partners pp on pp.id = a.pid
    join public.pharmacy_partner_locations l on l.pharmacy_partner_id = pp.id and l.is_active and l.verified_at is not null
   order by a.matched desc, a.all_in desc, a.total asc, pp.name, l.name;
end $$;
revoke all on function public.patient_price_compare(uuid) from public, anon;
grant execute on function public.patient_price_compare(uuid) to authenticated;
comment on function public.patient_price_compare(uuid) is
  'S54 8.9: the patient''s price and stock comparison across listable partner pharmacies. Reads price, stock and the verified flag only. It never reads a commission column (a test checks this function''s source). Ordering is by items supplied, stock, total price and name: nothing Tarragon earns can move a pharmacy up or down.';

-- ---------------------------------------------------------------------------
-- 4. Pharmacist chat (8.12): a thread between ONE patient and the pharmacists of ONE listable pharmacy about a medicine. In app only.
--    Patients read and write only through functions; a pharmacist only through audited functions; nobody else can read it (no staff
--    policy at all: a clinician or an admin sees no chat). A pharmacist sees the patient's first name, the words, and the one medicine
--    the thread names. Chat text never goes in a notification (INV-07).
-- ---------------------------------------------------------------------------
-- Who may use a thread as the patient: the patient herself, or the manager of a DEPENDANT account with the pharmacy permission (a child or
-- an adult who cannot manage alone), unless she is an adolescent (10 to 17): then only she herself, so a guardian can never read a young
-- person's private medicine question. A spouse or relative with an ordinary manage grant on an independent adult's profile has no access,
-- because a medicine question can be about anything, including reproductive health.
create or replace function private.pharmacist_chat_may_act(p_patient uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_patient = (select auth.uid())
      or (private.can_act_for(p_patient, 'manage_pharmacy'::public.caregiver_permission)
          and exists (select 1 from public.profiles dp where dp.id = p_patient and dp.is_dependent_account)
          and private.adolescent_age_band(p_patient) not in ('younger_adolescent', 'older_adolescent'))
$$;
revoke all on function private.pharmacist_chat_may_act(uuid) from public, anon, authenticated;
grant execute on function private.pharmacist_chat_may_act(uuid) to authenticated;

create table public.pharmacist_chat_threads (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  patient_id          uuid not null references public.profiles (id) on delete cascade,
  pharmacy_partner_id uuid not null references public.pharmacy_partners (id) on delete restrict,
  medication_id       uuid references public.medications (id) on delete set null,
  topic               text not null check (char_length(btrim(topic)) between 1 and 120),
  status              text not null default 'open' check (status in ('open', 'closed')),
  escalated_at        timestamptz,
  last_message_at     timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  closed_at           timestamptz,
  is_test             boolean not null default false
);
create index pharmacist_chat_threads_patient_idx on public.pharmacist_chat_threads (patient_id, last_message_at desc);
create index pharmacist_chat_threads_partner_idx on public.pharmacist_chat_threads (pharmacy_partner_id, last_message_at desc);
comment on table public.pharmacist_chat_threads is
  'S54 8.12: a medicine question between a patient and one partner pharmacy. The patient reads her own; pharmacists reach it only through audited functions; no staff or admin policy exists, so a clinician or admin sees nothing.';

create table public.pharmacist_chat_messages (
  id                          uuid primary key default gen_random_uuid(),
  thread_id                   uuid not null references public.pharmacist_chat_threads (id) on delete cascade,
  organisation_id             uuid not null references public.organisations (id) on delete restrict,
  patient_id                  uuid not null references public.profiles (id) on delete cascade,
  sender_profile_id           uuid not null references public.profiles (id) on delete restrict,
  sender_role                 text not null check (sender_role in ('patient', 'pharmacist')),
  body                        text not null check (char_length(btrim(body)) between 1 and 1000),
  flagged_potential_emergency boolean not null default false,
  read_at                     timestamptz,
  created_at                  timestamptz not null default now(),
  is_test                     boolean not null default false
);
create index pharmacist_chat_messages_thread_idx on public.pharmacist_chat_messages (thread_id, created_at);

alter table public.pharmacist_chat_threads enable row level security;
alter table public.pharmacist_chat_messages enable row level security;
revoke all on public.pharmacist_chat_threads, public.pharmacist_chat_messages from public, anon, authenticated;
grant select on public.pharmacist_chat_threads, public.pharmacist_chat_messages to authenticated;
-- The patient (or someone acting for her with the pharmacy permission) reads; there is deliberately NO policy for any staff role.
create policy pharmacist_chat_threads_patient_select on public.pharmacist_chat_threads for select to authenticated
  using (private.pharmacist_chat_may_act(patient_id));
create policy pharmacist_chat_messages_patient_select on public.pharmacist_chat_messages for select to authenticated
  using (private.pharmacist_chat_may_act(patient_id));

insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('pharmacist_chat_new_message', 'medication', 'routine', 'partner_pharmacy', array['in_app']::public.notification_channel[], 'immediate',
   'S54: a patient sent a question to your pharmacy. In app only. Names no medicine, condition or patient, and never carries the message (INV-07).'),
  ('pharmacist_chat_reply_patient', 'medication', 'routine', 'patient', array['in_app']::public.notification_channel[], 'immediate',
   'S54: your pharmacy replied. In app only. Never carries the message (INV-07).'),
  ('pharmacist_chat_escalated_patient', 'medication', 'important', 'patient', array['in_app']::public.notification_channel[], 'immediate',
   'S54: your pharmacist suggests you ask your care team about a question. In app only. Never carries the message (INV-07).')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('pharmacist_chat_new_message', 'en', 'in_app', 'A question is waiting', 'A patient sent a question to your pharmacy. Open your messages to read it.'),
  ('pharmacist_chat_reply_patient', 'en', 'in_app', 'You have a reply', 'Your pharmacy replied to your question. Open the app to read it.'),
  ('pharmacist_chat_escalated_patient', 'en', 'in_app', 'Your pharmacist suggests asking your care team', 'Your pharmacist thinks your care team is the best place for one of your questions. Open the app to send it.')
on conflict (template_key, locale, channel) do nothing;

-- Pharmacies a patient may ask: only listable ones (licence and NAFDAC source), with their state and city, nothing else.
create or replace function public.patient_chat_pharmacies()
returns table (partner_id uuid, partner_name text, state text, city text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not signed in' using errcode = '42501'; end if;
  return query select pp.id, pp.name, pp.state, pp.city from public.pharmacy_partners pp
    where private.pharmacy_partner_listable(pp.id) order by pp.name;
end $$;

-- One patient message. Returns the thread id and whether the words looked like an emergency (the screen then points at the emergency steps).
create or replace function private.pharmacist_chat_post_patient(p_thread uuid, p_body text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare t public.pharmacist_chat_threads%rowtype; v_uid uuid := (select auth.uid()); v_flag boolean; v_recent integer;
begin
  select * into t from public.pharmacist_chat_threads where id = p_thread for update;
  if not found or not private.pharmacist_chat_may_act(t.patient_id) then
    raise exception 'Thread not found' using errcode = '42501';
  end if;
  if t.status <> 'open' then raise exception 'thread_closed' using errcode = '22023'; end if;
  if not private.pharmacy_partner_listable(t.pharmacy_partner_id) then raise exception 'pharmacy_not_available' using errcode = '22023'; end if;
  select count(*) into v_recent from public.pharmacist_chat_messages m
   where m.thread_id = t.id and m.sender_role = 'patient' and m.created_at > now() - interval '24 hours';
  if v_recent >= 30 then raise exception 'too_many_messages' using errcode = '22023'; end if;
  v_flag := private.screen_care_message_for_emergency(p_body) is not null;
  insert into public.pharmacist_chat_messages (thread_id, organisation_id, patient_id, sender_profile_id, sender_role, body, flagged_potential_emergency, is_test)
  values (t.id, t.organisation_id, t.patient_id, v_uid, 'patient', btrim(p_body), v_flag, t.is_test);
  update public.pharmacist_chat_threads set last_message_at = now() where id = t.id;
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select pr.organisation_id, pr.id, 'in_app', 'pending', 'pharmacist_chat_new_message', '{}'::jsonb
    from public.profiles pr where pr.role = 'pharmacist' and pr.is_active and pr.pharmacy_partner_id = t.pharmacy_partner_id;
  return v_flag;
end $$;
revoke all on function private.pharmacist_chat_post_patient(uuid, text) from public, anon, authenticated;

create or replace function public.patient_start_pharmacist_chat(p_partner uuid, p_medication uuid, p_topic text, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_patient uuid; v_org uuid; v_thread uuid; v_flag boolean; v_test boolean;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_body is null or char_length(btrim(p_body)) = 0 or p_topic is null or char_length(btrim(p_topic)) = 0 then
    raise exception 'say what you want to ask' using errcode = '22023';
  end if;
  if not private.pharmacy_partner_listable(p_partner) then raise exception 'pharmacy_not_available' using errcode = '22023'; end if;
  v_patient := v_uid;
  if p_medication is not null then
    select m.patient_id into v_patient from public.medications m
     where m.id = p_medication and private.pharmacist_chat_may_act(m.patient_id);
    if v_patient is null then raise exception 'Medicine not found' using errcode = '42501'; end if;
  end if;
  if (select count(*) from public.pharmacist_chat_threads x where x.patient_id = v_patient and x.created_at > now() - interval '24 hours') >= 5 then
    raise exception 'too_many_messages' using errcode = '22023';
  end if;
  select organisation_id, is_test into v_org, v_test from public.profiles where id = v_patient;
  insert into public.pharmacist_chat_threads (organisation_id, patient_id, pharmacy_partner_id, medication_id, topic, is_test)
  values (v_org, v_patient, p_partner, p_medication, btrim(p_topic), coalesce(v_test, false)) returning id into v_thread;
  v_flag := private.pharmacist_chat_post_patient(v_thread, p_body);
  return jsonb_build_object('thread_id', v_thread, 'emergency', v_flag);
end $$;

create or replace function public.patient_send_pharmacist_chat(p_thread uuid, p_body text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_body is null or char_length(btrim(p_body)) = 0 then raise exception 'say what you want to ask' using errcode = '22023'; end if;
  return jsonb_build_object('emergency', private.pharmacist_chat_post_patient(p_thread, p_body));
end $$;

-- A patient reads a thread; the pharmacy's replies are marked read.
create or replace function public.patient_pharmacist_chat_messages(p_thread uuid)
returns table (message_id uuid, sender_role text, body text, created_at timestamptz, flagged_potential_emergency boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare t public.pharmacist_chat_threads%rowtype; v_uid uuid := (select auth.uid());
begin
  select * into t from public.pharmacist_chat_threads where id = p_thread;
  if not found or v_uid is null or not private.pharmacist_chat_may_act(t.patient_id) then
    raise exception 'Thread not found' using errcode = '42501';
  end if;
  update public.pharmacist_chat_messages set read_at = now() where thread_id = t.id and sender_role = 'pharmacist' and read_at is null;
  return query select m.id, m.sender_role, m.body, m.created_at, m.flagged_potential_emergency
    from public.pharmacist_chat_messages m where m.thread_id = t.id order by m.created_at;
end $$;

create or replace function public.patient_pharmacist_chat_threads()
returns table (thread_id uuid, partner_name text, topic text, status text, escalated boolean, last_message_at timestamptz, unread integer)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  return query select t.id, pp.name, t.topic, t.status, t.escalated_at is not null, t.last_message_at,
         (select count(*)::integer from public.pharmacist_chat_messages m where m.thread_id = t.id and m.sender_role = 'pharmacist' and m.read_at is null)
    from public.pharmacist_chat_threads t join public.pharmacy_partners pp on pp.id = t.pharmacy_partner_id
   where private.pharmacist_chat_may_act(t.patient_id)
   order by t.last_message_at desc limit 100;
end $$;

-- Pharmacy side: audited, own pharmacy only, first name only.
create or replace function public.pharmacist_chat_threads()
returns table (thread_id uuid, patient_first_name text, topic text, status text, escalated boolean, last_message_at timestamptz, waiting boolean, possible_emergency boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_partner uuid := private.pharmacist_partner(); v_ids uuid[];
begin
  if v_partner is null or not private.pharmacy_partner_listable(v_partner) then raise exception 'This action is for partner pharmacies' using errcode = '42501'; end if;
  select coalesce(array_agg(x.id), '{}') into v_ids from (
    select t.id from public.pharmacist_chat_threads t where t.pharmacy_partner_id = v_partner order by t.last_message_at desc limit 100) x;
  if cardinality(v_ids) > 0 then
    perform private.log_audit('pharmacy.chat_listed', 'pharmacist_chat_threads', null, jsonb_build_object('thread_ids', to_jsonb(v_ids), 'pharmacy_partner_id', v_partner));
  end if;
  return query select t.id, split_part(btrim(p.full_name), ' ', 1), t.topic, t.status, t.escalated_at is not null, t.last_message_at,
         coalesce((select m.sender_role = 'patient' from public.pharmacist_chat_messages m where m.thread_id = t.id order by m.created_at desc limit 1), false),
         exists (select 1 from public.pharmacist_chat_messages m where m.thread_id = t.id and m.sender_role = 'patient' and m.flagged_potential_emergency)
    from public.pharmacist_chat_threads t join public.profiles p on p.id = t.patient_id
   where t.id = any (v_ids) order by t.last_message_at desc;
end $$;

create or replace function public.pharmacist_chat_read(p_thread uuid)
returns table (message_id uuid, sender_role text, body text, created_at timestamptz, patient_first_name text, medicine text, dose text, possible_emergency boolean)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_partner uuid := private.pharmacist_partner(); t public.pharmacist_chat_threads%rowtype;
begin
  if v_partner is null or not private.pharmacy_partner_listable(v_partner) then raise exception 'This action is for partner pharmacies' using errcode = '42501'; end if;
  select * into t from public.pharmacist_chat_threads where id = p_thread and pharmacy_partner_id = v_partner;
  if not found then raise exception 'Thread not found' using errcode = '42501'; end if;
  perform private.log_audit('pharmacy.chat_opened', 'pharmacist_chat_threads', t.id, jsonb_build_object('pharmacy_partner_id', v_partner));
  update public.pharmacist_chat_messages set read_at = now() where thread_id = t.id and sender_role = 'patient' and read_at is null;
  return query select m.id, m.sender_role, m.body, m.created_at, split_part(btrim(p.full_name), ' ', 1), md.drug_name, md.dose, m.flagged_potential_emergency
    from public.pharmacist_chat_messages m
    join public.profiles p on p.id = t.patient_id
    left join public.medications md on md.id = t.medication_id
   where m.thread_id = t.id order by m.created_at;
end $$;

create or replace function public.pharmacist_chat_reply(p_thread uuid, p_body text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_partner uuid := private.pharmacist_partner(); v_uid uuid := (select auth.uid()); t public.pharmacist_chat_threads%rowtype;
begin
  if v_partner is null or not private.pharmacy_partner_listable(v_partner) then raise exception 'This action is for partner pharmacies' using errcode = '42501'; end if;
  if p_body is null or char_length(btrim(p_body)) = 0 then raise exception 'write a reply' using errcode = '22023'; end if;
  select * into t from public.pharmacist_chat_threads where id = p_thread and pharmacy_partner_id = v_partner for update;
  if not found then raise exception 'Thread not found' using errcode = '42501'; end if;
  if t.status <> 'open' then raise exception 'thread_closed' using errcode = '22023'; end if;
  insert into public.pharmacist_chat_messages (thread_id, organisation_id, patient_id, sender_profile_id, sender_role, body, is_test)
  values (t.id, t.organisation_id, t.patient_id, v_uid, 'pharmacist', btrim(p_body), t.is_test);
  update public.pharmacist_chat_threads set last_message_at = now() where id = t.id;
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (t.organisation_id, t.patient_id, 'in_app', 'pending', 'pharmacist_chat_reply_patient', '{}'::jsonb);
  perform private.log_audit('pharmacy.chat_replied', 'pharmacist_chat_threads', t.id, jsonb_build_object('pharmacy_partner_id', v_partner));
  return true;
end $$;

-- The pharmacist suggests the question belongs with the care team. Nothing is sent for the patient: the patient chooses to send it
-- through the existing care messages (her own words, her own thread), so the care team only ever hears what she decided to share.
create or replace function public.pharmacist_chat_escalate(p_thread uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_partner uuid := private.pharmacist_partner(); t public.pharmacist_chat_threads%rowtype;
begin
  if v_partner is null or not private.pharmacy_partner_listable(v_partner) then raise exception 'This action is for partner pharmacies' using errcode = '42501'; end if;
  select * into t from public.pharmacist_chat_threads where id = p_thread and pharmacy_partner_id = v_partner for update;
  if not found then raise exception 'Thread not found' using errcode = '42501'; end if;
  if t.escalated_at is null then
    update public.pharmacist_chat_threads set escalated_at = now() where id = t.id;
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (t.organisation_id, t.patient_id, 'in_app', 'pending', 'pharmacist_chat_escalated_patient', '{}'::jsonb);
    perform private.log_audit('pharmacy.chat_escalated', 'pharmacist_chat_threads', t.id, jsonb_build_object('pharmacy_partner_id', v_partner));
  end if;
  return true;
end $$;

create or replace function public.pharmacist_chat_close(p_thread uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_partner uuid := private.pharmacist_partner();
begin
  if v_partner is null or not private.pharmacy_partner_listable(v_partner) then raise exception 'This action is for partner pharmacies' using errcode = '42501'; end if;
  update public.pharmacist_chat_threads set status = 'closed', closed_at = now() where id = p_thread and pharmacy_partner_id = v_partner and status = 'open';
  if not found then raise exception 'Thread not found' using errcode = '42501'; end if;
  perform private.log_audit('pharmacy.chat_closed', 'pharmacist_chat_threads', p_thread, jsonb_build_object('pharmacy_partner_id', v_partner));
  return true;
end $$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.patient_chat_pharmacies()', 'public.patient_start_pharmacist_chat(uuid,uuid,text,text)', 'public.patient_send_pharmacist_chat(uuid,text)',
    'public.patient_pharmacist_chat_messages(uuid)', 'public.patient_pharmacist_chat_threads()', 'public.pharmacist_chat_threads()',
    'public.pharmacist_chat_read(uuid)', 'public.pharmacist_chat_reply(uuid,text)', 'public.pharmacist_chat_escalate(uuid)', 'public.pharmacist_chat_close(uuid)'] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. The refill reminder tied to the chosen pharmacy (8.10). The notice text stays generic; its payload gains the pharmacy id so the app
--    can say where to collect. The function body is edited in place from whatever definition is current (same method as S53).
-- ---------------------------------------------------------------------------
create or replace function private.refill_pharmacy_payload(p_medication uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select jsonb_build_object('pharmacy_partner_id', rx.pharmacy_partner_id)
       from public.medications m
       join public.prescriptions rx on rx.id = m.prescription_id
      where m.id = p_medication and rx.pharmacy_partner_id is not null and rx.state in ('sent', 'dispensed')
      limit 1), '{}'::jsonb)
$$;
revoke all on function private.refill_pharmacy_payload(uuid) from public, anon, authenticated;

do $$
declare
  v_def text;
  v_old text := $o$jsonb_build_object('medication_id', r.medication_id, 'refill_date', r.due_date)$o$;
begin
  v_def := pg_get_functiondef('private.queue_medication_refill_reminders()'::regprocedure);
  if v_def like '%refill_pharmacy_payload%' then return; end if;
  if position(v_old in v_def) = 0 then
    raise exception 'queue_medication_refill_reminders has no recognisable payload; add private.refill_pharmacy_payload(r.medication_id) to its two payloads by hand';
  end if;
  execute replace(v_def, v_old, v_old || ' || private.refill_pharmacy_payload(r.medication_id)');
end $$;

create or replace function public.medication_refill_pharmacy(p_medication uuid)
returns table (partner_id uuid, partner_name text, location_name text, address text)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_patient uuid;
begin
  select m.patient_id into v_patient from public.medications m where m.id = p_medication;
  if v_uid is null or v_patient is null or not (v_patient = v_uid or private.can_act_for(v_patient, 'manage_pharmacy'::public.caregiver_permission)) then
    raise exception 'Medicine not found' using errcode = '42501';
  end if;
  return query
    select pp.id, pp.name, l.name, l.address
      from public.medications m
      join public.prescriptions rx on rx.id = m.prescription_id and rx.pharmacy_partner_id is not null and rx.state in ('sent', 'dispensed')
      join public.pharmacy_partners pp on pp.id = rx.pharmacy_partner_id
      left join public.pharmacy_partner_locations l on l.id = rx.pharmacy_location_id
     where m.id = p_medication
     order by rx.updated_at desc limit 1;
end $$;
revoke all on function public.medication_refill_pharmacy(uuid) from public, anon;
grant execute on function public.medication_refill_pharmacy(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The older pay-through-Tarragon order path follows the same quality rule: an order cannot name an unlisted pharmacy.
create or replace function private.enforce_listable_pharmacy_on_order() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.pharmacy_partner_id is not null and not private.pharmacy_partner_listable(new.pharmacy_partner_id) then
    raise exception 'pharmacy_not_available' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function private.enforce_listable_pharmacy_on_order() from public, anon, authenticated;
create trigger pharmacy_orders_listable_pharmacy before insert on public.pharmacy_orders
  for each row execute function private.enforce_listable_pharmacy_on_order();

-- 6. D5: no home delivery. Pharmacy orders are pickup only. 0 rows to convert (see the header). The delivery tables and functions stay
--    (OQ-16); nothing can create a delivery order, a courier assignment or a delivery fee any more.
-- ---------------------------------------------------------------------------
alter table public.pharmacy_orders
  add constraint pharmacy_orders_pickup_only check (fulfilment_method = 'pickup'::public.pharmacy_fulfilment_method);
comment on constraint pharmacy_orders_pickup_only on public.pharmacy_orders is
  'S54 D5 (founder): no home delivery. Counted before adding: 0 orders, 0 non-pickup. Remove only with the OQ-16 batch.';

-- ---------------------------------------------------------------------------
-- 7. Assertions
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.patient_price_compare(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.attest_pharmacy_nafdac_source(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.pharmacist_chat_read(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.medication_refill_pharmacy(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute an S54 function';
  end if;
  if has_table_privilege('anon', 'public.pharmacist_chat_threads', 'SELECT') or has_table_privilege('anon', 'public.pharmacist_chat_messages', 'SELECT') then
    raise exception 'FAIL: anon can read the pharmacist chat';
  end if;
  if has_table_privilege('authenticated', 'public.pharmacist_chat_messages', 'INSERT') or has_table_privilege('authenticated', 'public.pharmacist_chat_threads', 'UPDATE') then
    raise exception 'FAIL: a client can write the pharmacist chat directly';
  end if;
  if pg_get_functiondef('public.patient_price_compare(uuid)'::regprocedure) ~* 'commission' then
    raise exception 'FAIL: the price comparison reads or names a commission column';
  end if;
  if pg_get_functiondef('private.queue_medication_refill_reminders()'::regprocedure) not like '%refill_pharmacy_payload%' then
    raise exception 'FAIL: the refill reminder does not carry the chosen pharmacy';
  end if;
  if (select count(*) from public.pharmacy_orders where fulfilment_method <> 'pickup') <> 0 then
    raise exception 'FAIL: a delivery order exists';
  end if;
  raise notice 'PASS: S54 pharmacy quality, price compare, chat and pickup-only in place';
end $$;
