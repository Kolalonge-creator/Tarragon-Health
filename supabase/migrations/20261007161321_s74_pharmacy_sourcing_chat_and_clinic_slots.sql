-- S74 part 3: pharmacy verified sourcing and in-app pharmacist chat (spec 21.2), clinic booking-calendar contract (21.3).
-- Design: docs/design/S74.md. Not built here, on purpose: home test kits (21.1, needs a partner and D-06 treatment), HMO billing and capitation (21.4, I8 and
-- S71), the device shop (21.5, decision S74-1), pharmacy price lists (OQ-283), any home delivery (OQ-261, removed).
-- Live counts before this migration (2026-10-07): pharmacy_order_dispenses with a batch 0, prescriptions sent to a pharmacy 0, provider_organisations 0.

-- ===========================================================================
-- A. Verified sourcing (21.2)
-- ===========================================================================
-- The pharmacy DECLARES where its stock comes from; a Tarragon admin VERIFIES it outside the system (supplier invoices against the NAFDAC register) and
-- records that they did. Tarragon does not inspect batches (S28c says so to the pharmacist), so the claim to a patient is exactly "this pharmacy's
-- declared sources were checked", never "this medicine is genuine".
alter table public.pharmacy_partners
  add column sourcing_declared_at   timestamptz,
  add column sourcing_declared_by   uuid references public.profiles (id) on delete set null,
  add column sourcing_statement     text check (sourcing_statement is null or length(sourcing_statement) between 20 and 500),
  add column sourcing_verified_at   timestamptz,
  add column sourcing_verified_by   uuid references public.profiles (id) on delete set null,
  add column sourcing_note          text,
  add column sourcing_review_due_at timestamptz,
  add constraint pharmacy_partners_sourcing_verified_needs_declaration
    check (sourcing_verified_at is null or (sourcing_declared_at is not null and sourcing_verified_by is not null));
comment on column public.pharmacy_partners.sourcing_statement is
  'S74 (21.2): the pharmacy''s own words on which NAFDAC-registered distributors and manufacturers it buys from. Declared by the pharmacy, verified by an admin; neither is a guarantee about any one batch.';

alter table public.pharmacy_order_dispenses
  add column product_nafdac_reg_no   text check (product_nafdac_reg_no is null or product_nafdac_reg_no ~ '^[A-Z0-9]{1,3}-[0-9]{3,6}[A-Z]?$'),
  add column supplier_name           text check (supplier_name is null or length(btrim(supplier_name)) between 2 and 120),
  add column sourcing_recorded_at    timestamptz,
  add constraint pharmacy_order_dispenses_sourcing_together check ((product_nafdac_reg_no is null) = (sourcing_recorded_at is null));
comment on column public.pharmacy_order_dispenses.product_nafdac_reg_no is
  'S74 (21.2): the NAFDAC registration number printed on the product, as the pharmacist recorded it. Written once. Tarragon does not verify the batch.';

-- Write once: a recorded sourcing line is part of the supply record and is never overwritten.
create function private.guard_dispense_sourcing() returns trigger language plpgsql set search_path = ''
as $$
begin
  if old.product_nafdac_reg_no is not null and (new.product_nafdac_reg_no is distinct from old.product_nafdac_reg_no
       or new.supplier_name is distinct from old.supplier_name or new.sourcing_recorded_at is distinct from old.sourcing_recorded_at) then
    raise exception 'sourcing_already_recorded' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.guard_dispense_sourcing() from public, anon, authenticated;
create trigger pharmacy_order_dispenses_sourcing_once before update of product_nafdac_reg_no, supplier_name, sourcing_recorded_at on public.pharmacy_order_dispenses
  for each row execute function private.guard_dispense_sourcing();

create function public.pharmacist_declare_sourcing(p_statement text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_partner uuid := private.pharmacist_partner(); v_uid uuid := (select auth.uid());
begin
  if v_partner is null then raise exception 'This action is for partner pharmacies' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_statement, ''))) not between 20 and 500 then raise exception 'say which registered distributors you buy from (20 to 500 characters)' using errcode = '22023'; end if;
  -- a new declaration withdraws an earlier verification: the admin looks again
  update public.pharmacy_partners set sourcing_statement = btrim(p_statement), sourcing_declared_at = now(), sourcing_declared_by = v_uid,
         sourcing_verified_at = null, sourcing_verified_by = null, sourcing_note = null, sourcing_review_due_at = null
   where id = v_partner;
  perform private.log_audit('pharmacy.sourcing_declared', 'pharmacy_partners', v_partner, '{}'::jsonb);
end $$;

create function public.verify_pharmacy_sourcing(p_partner uuid, p_note text, p_review_months integer default 12) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if not private.is_admin() then raise exception 'only an admin can verify a pharmacy''s sourcing' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_note, ''))) < 20 then raise exception 'record what you checked in at least 20 characters' using errcode = '22023'; end if;
  if p_review_months not between 1 and 24 then raise exception 'review between 1 and 24 months' using errcode = '22023'; end if;
  update public.pharmacy_partners set sourcing_verified_at = now(), sourcing_verified_by = v_uid, sourcing_note = btrim(p_note),
         sourcing_review_due_at = now() + make_interval(months => p_review_months)
   where id = p_partner and sourcing_declared_at is not null;
  if not found then raise exception 'the pharmacy has not declared its sources yet' using errcode = '22023'; end if;
  perform private.log_audit('pharmacy.sourcing_verified', 'pharmacy_partners', p_partner, jsonb_build_object('review_months', p_review_months));
end $$;

create function public.clear_pharmacy_sourcing(p_partner uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'only an admin can clear a pharmacy''s sourcing check' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 20 then raise exception 'say why in at least 20 characters' using errcode = '22023'; end if;
  update public.pharmacy_partners set sourcing_verified_at = null, sourcing_verified_by = null, sourcing_review_due_at = null, sourcing_note = btrim(p_reason) where id = p_partner;
  perform private.log_audit('pharmacy.sourcing_cleared', 'pharmacy_partners', p_partner, '{}'::jsonb);
end $$;

-- Patient-safe: true only while the check stands and is not past its review date.
create function public.pharmacy_sourcing_verified(p_partner uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and coalesce((select pp.sourcing_verified_at is not null and (pp.sourcing_review_due_at is null or pp.sourcing_review_due_at > now())
                                                         from public.pharmacy_partners pp where pp.id = p_partner), false)
$$;

-- The pharmacy's own view of its sourcing check, and the admin's list of what is waiting to be checked.
create function public.pharmacist_my_sourcing() returns table (statement text, declared_at timestamptz, verified_at timestamptz, review_due_at timestamptz, is_verified boolean)
language sql stable security definer set search_path = ''
as $$
  select pp.sourcing_statement, pp.sourcing_declared_at, pp.sourcing_verified_at, pp.sourcing_review_due_at,
         (pp.sourcing_verified_at is not null and (pp.sourcing_review_due_at is null or pp.sourcing_review_due_at > now()))
    from public.pharmacy_partners pp where pp.id = private.pharmacist_partner()
$$;

create function public.admin_pharmacy_sourcing() returns table (
  partner_id uuid, partner_name text, is_active boolean, statement text, declared_at timestamptz, verified_at timestamptz, review_due_at timestamptz, is_verified boolean)
language sql stable security definer set search_path = ''
as $$
  select pp.id, pp.name, pp.is_active, pp.sourcing_statement, pp.sourcing_declared_at, pp.sourcing_verified_at, pp.sourcing_review_due_at,
         (pp.sourcing_verified_at is not null and (pp.sourcing_review_due_at is null or pp.sourcing_review_due_at > now()))
    from public.pharmacy_partners pp where private.is_admin() order by pp.name
$$;

-- The pharmacist records the NAFDAC number and supplier of the batch they supplied, for their own supply only, once.
create function public.pharmacist_record_dispense_sourcing(p_dispense uuid, p_nafdac_reg text, p_supplier text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_partner uuid := private.pharmacist_partner(); d public.pharmacy_order_dispenses%rowtype; v_reg text := upper(btrim(coalesce(p_nafdac_reg, '')));
begin
  if v_partner is null then raise exception 'This action is for partner pharmacies' using errcode = '42501'; end if;
  select d2.* into d from public.pharmacy_order_dispenses d2
    join public.medications m on m.id = d2.medication_id
    join public.prescriptions rx on rx.id = m.prescription_id
   where d2.id = p_dispense and d2.source = 'pharmacy' and rx.pharmacy_partner_id = v_partner for update of d2;
  if not found then raise exception 'Supply not found for this pharmacy' using errcode = '42501'; end if;
  if d.product_nafdac_reg_no is not null then raise exception 'sourcing_already_recorded' using errcode = '22023'; end if;
  if v_reg !~ '^[A-Z0-9]{1,3}-[0-9]{3,6}[A-Z]?$' then raise exception 'nafdac_number_invalid' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_supplier, ''))) not between 2 and 120 then raise exception 'supplier_invalid' using errcode = '22023'; end if;
  update public.pharmacy_order_dispenses set product_nafdac_reg_no = v_reg, supplier_name = btrim(p_supplier), sourcing_recorded_at = now() where id = p_dispense;
  perform private.log_audit('pharmacy.dispense_sourcing_recorded', 'pharmacy_order_dispenses', p_dispense, jsonb_build_object('pharmacy_partner_id', v_partner));
end $$;

-- ===========================================================================
-- B. In-app pharmacist <-> patient chat (21.2). In app only (no SMS, no WhatsApp). Two people only: the patient and the pharmacy the prescription was
--    sent to. No table grant to anyone: every read and write is a function that checks both ends. Staff of Tarragon have no read path.
-- ===========================================================================
create table public.pharmacy_chat_config (
  id uuid primary key default gen_random_uuid(),
  version integer not null unique,
  is_active boolean not null default false,
  effective_from date not null,
  rules jsonb not null,
  created_at timestamptz not null default now()
);
create unique index pharmacy_chat_config_one_active on public.pharmacy_chat_config (is_active) where is_active;
alter table public.pharmacy_chat_config enable row level security;
revoke all on public.pharmacy_chat_config from public, anon, authenticated;
-- pharmacy-chat-begin
insert into public.pharmacy_chat_config (version, is_active, effective_from, rules) values (1, true, '2026-10-07', $json$
{ "max_body_chars": 1000, "max_per_sender_per_day": 20, "open_days_after_supply": 14 }
$json$::jsonb);
-- pharmacy-chat-end
create function private.pharmacy_chat_setting(p_key text) returns jsonb language sql stable security definer set search_path = ''
as $$ select rules -> p_key from public.pharmacy_chat_config where is_active $$;
revoke all on function private.pharmacy_chat_setting(text) from public, anon, authenticated;

create table public.pharmacy_threads (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  prescription_id     uuid not null references public.prescriptions (id) on delete restrict,
  patient_id          uuid not null references public.profiles (id) on delete restrict,
  pharmacy_partner_id uuid not null references public.pharmacy_partners (id) on delete restrict,
  last_message_at     timestamptz,
  patient_read_at     timestamptz,
  pharmacy_read_at    timestamptz,
  is_test             boolean not null default false,
  created_at          timestamptz not null default now(),
  unique (prescription_id, pharmacy_partner_id)   -- one conversation per prescription and pharmacy: a patient who changes pharmacy starts a fresh one
);
create index pharmacy_threads_partner_idx on public.pharmacy_threads (pharmacy_partner_id, last_message_at desc);
create index pharmacy_threads_patient_idx on public.pharmacy_threads (patient_id);
alter table public.pharmacy_threads enable row level security;
revoke all on public.pharmacy_threads from public, anon, authenticated;

create table public.pharmacy_messages (
  id               uuid primary key default gen_random_uuid(),
  thread_id        uuid not null references public.pharmacy_threads (id) on delete restrict,
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  sender_kind      text not null check (sender_kind in ('patient', 'pharmacist')),
  sender_id        uuid not null references public.profiles (id) on delete restrict,
  body             text not null check (length(btrim(body)) between 1 and 1000),
  is_test          boolean not null default false,
  created_at       timestamptz not null default now()
);
create index pharmacy_messages_thread_idx on public.pharmacy_messages (thread_id, created_at);
alter table public.pharmacy_messages enable row level security;
revoke all on public.pharmacy_messages from public, anon, authenticated;
create function private.pharmacy_message_immutable() returns trigger language plpgsql set search_path = ''
as $$ begin raise exception 'a pharmacy message is never edited or removed' using errcode = '42501'; end $$;
create trigger pharmacy_messages_append_only before update or delete on public.pharmacy_messages for each row execute function private.pharmacy_message_immutable();
create trigger pharmacy_messages_no_truncate before truncate on public.pharmacy_messages for each statement execute function private.pharmacy_message_immutable();
comment on table public.pharmacy_messages is
  'S74 (21.2): one message between a patient and the pharmacy their prescription was sent to. Append only. No table grant: read and written only through the chat functions, which check both ends. A notice about a message never carries its words (INV-07).';

insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('pharmacy_message_patient', 'operational', 'routine', 'patient', array['in_app']::public.notification_channel[], 'immediate', 'S74: your pharmacy sent you a message. Names nothing (INV-07).'),
  ('pharmacy_message_pharmacy', 'operational', 'routine', 'partner_pharmacy', array['in_app']::public.notification_channel[], 'immediate', 'S74: a patient sent your pharmacy a message. Names nothing (INV-07).')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('pharmacy_message_patient', 'en', 'in_app', 'Your pharmacy sent you a message', 'Your pharmacy sent you a message. Open the app to read it.'),
  ('pharmacy_message_pharmacy', 'en', 'in_app', 'A patient sent you a message', 'A patient sent your pharmacy a message. Open the portal to read it.')
on conflict (template_key, locale, channel) do nothing;

-- Is the conversation open: the prescription is with this pharmacy and either still waiting to be collected or collected recently.
create function private.pharmacy_chat_open(p_prescription uuid, p_partner uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.prescriptions rx
     where rx.id = p_prescription and rx.pharmacy_partner_id = p_partner
       and (rx.state = 'sent'
            or (rx.state = 'dispensed' and exists (
                  select 1 from public.medications m join public.pharmacy_order_dispenses d on d.medication_id = m.id
                   where m.prescription_id = rx.id and d.source = 'pharmacy'
                     and d.created_at > now() - make_interval(days => (private.pharmacy_chat_setting('open_days_after_supply'))::integer)))))
$$;
revoke all on function private.pharmacy_chat_open(uuid, uuid) from public, anon, authenticated;

create function private.pharmacy_chat_send(p_prescription uuid, p_kind text, p_body text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid()); rx public.prescriptions%rowtype; th public.pharmacy_threads%rowtype; v_body text := btrim(coalesce(p_body, ''));
  v_max integer := (private.pharmacy_chat_setting('max_body_chars'))::integer; v_day integer := (private.pharmacy_chat_setting('max_per_sender_per_day'))::integer;
  v_id uuid; v_test boolean;
begin
  select * into rx from public.prescriptions where id = p_prescription;
  if not found or rx.pharmacy_partner_id is null then raise exception 'Prescription not found' using errcode = '42501'; end if;
  if p_kind = 'patient' and rx.patient_id is distinct from v_uid then raise exception 'Prescription not found' using errcode = '42501'; end if;
  if p_kind = 'pharmacist' and rx.pharmacy_partner_id is distinct from private.pharmacist_partner() then raise exception 'Prescription not found' using errcode = '42501'; end if;
  if not private.pharmacy_chat_open(p_prescription, rx.pharmacy_partner_id) then raise exception 'chat_closed' using errcode = '22023'; end if;
  if length(v_body) = 0 or length(v_body) > v_max then raise exception 'message_invalid' using errcode = '22023'; end if;
  select coalesce(is_test, false) into v_test from public.profiles where id = rx.patient_id;
  -- a pharmacist may only answer: the patient opens the conversation
  select * into th from public.pharmacy_threads where prescription_id = p_prescription and pharmacy_partner_id = rx.pharmacy_partner_id for update;
  if not found then
    if p_kind <> 'patient' then raise exception 'the patient starts the conversation' using errcode = '22023'; end if;
    insert into public.pharmacy_threads (organisation_id, prescription_id, patient_id, pharmacy_partner_id, is_test)
    values (rx.organisation_id, rx.id, rx.patient_id, rx.pharmacy_partner_id, v_test) returning * into th;
  end if;
  if (select count(*) from public.pharmacy_messages where thread_id = th.id and sender_kind = p_kind and created_at > now() - interval '24 hours') >= v_day then
    raise exception 'message_limit_reached' using errcode = '22023';
  end if;
  insert into public.pharmacy_messages (thread_id, organisation_id, sender_kind, sender_id, body, is_test) values (th.id, th.organisation_id, p_kind, v_uid, v_body, th.is_test) returning id into v_id;
  update public.pharmacy_threads set last_message_at = now(),
         patient_read_at = case when p_kind = 'patient' then now() else patient_read_at end,
         pharmacy_read_at = case when p_kind = 'pharmacist' then now() else pharmacy_read_at end where id = th.id;
  if p_kind = 'patient' then
    perform private.rx_notify_pharmacy(th.pharmacy_partner_id, 'pharmacy_message_pharmacy');
  else
    perform private.rx_notify(th.patient_id, th.organisation_id, 'pharmacy_message_patient');
  end if;
  perform private.log_audit('pharmacy.message_sent', 'pharmacy_threads', th.id, jsonb_build_object('sender_kind', p_kind));   -- the fact of a message, never its words
  return v_id;
end $$;
revoke all on function private.pharmacy_chat_send(uuid, text, text) from public, anon, authenticated;

create function public.patient_send_pharmacy_message(p_prescription uuid, p_body text) returns uuid
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'patient') then
    raise exception 'This action is for patients' using errcode = '42501';
  end if;
  return private.pharmacy_chat_send(p_prescription, 'patient', p_body);
end $$;

create function public.pharmacist_send_message(p_prescription uuid, p_body text) returns uuid
language plpgsql security definer set search_path = ''
as $$
begin
  if private.pharmacist_partner() is null then raise exception 'This action is for partner pharmacies' using errcode = '42501'; end if;
  return private.pharmacy_chat_send(p_prescription, 'pharmacist', p_body);
end $$;

-- Reads. The patient reads their own conversation; the pharmacy reads conversations on prescriptions sent to it. Each read is audited (INV-10) and marks the
-- reader's side as read.
create function public.patient_pharmacy_conversation(p_prescription uuid) returns table (message_id uuid, sender_kind text, body text, sent_at timestamptz, is_open boolean)
language plpgsql security definer set search_path = ''
as $$
declare th public.pharmacy_threads%rowtype;
begin
  select t.* into th from public.pharmacy_threads t join public.prescriptions rx on rx.id = t.prescription_id and rx.pharmacy_partner_id = t.pharmacy_partner_id
   where t.prescription_id = p_prescription and t.patient_id = (select auth.uid());
  if not found then return; end if;
  update public.pharmacy_threads set patient_read_at = now() where id = th.id;
  perform private.log_audit('pharmacy.thread_read', 'pharmacy_threads', th.id, jsonb_build_object('reader', 'patient'));
  return query select m.id, m.sender_kind, m.body, m.created_at, private.pharmacy_chat_open(th.prescription_id, th.pharmacy_partner_id)
                 from public.pharmacy_messages m where m.thread_id = th.id order by m.created_at;
end $$;

create function public.pharmacist_conversation(p_prescription uuid) returns table (message_id uuid, sender_kind text, body text, sent_at timestamptz, is_open boolean)
language plpgsql security definer set search_path = ''
as $$
declare th public.pharmacy_threads%rowtype; v_partner uuid := private.pharmacist_partner();
begin
  if v_partner is null then raise exception 'This action is for partner pharmacies' using errcode = '42501'; end if;
  select t.* into th from public.pharmacy_threads t join public.prescriptions rx on rx.id = t.prescription_id and rx.pharmacy_partner_id = t.pharmacy_partner_id
   where t.prescription_id = p_prescription and t.pharmacy_partner_id = v_partner;      -- the prescription must still be with this pharmacy: a patient who moved or took it back ends its access
  if not found then return; end if;
  update public.pharmacy_threads set pharmacy_read_at = now() where id = th.id;
  perform private.log_audit('pharmacy.thread_read', 'pharmacy_threads', th.id, jsonb_build_object('reader', 'pharmacist', 'pharmacy_partner_id', v_partner));
  return query select m.id, m.sender_kind, m.body, m.created_at, private.pharmacy_chat_open(th.prescription_id, th.pharmacy_partner_id)
                 from public.pharmacy_messages m where m.thread_id = th.id order by m.created_at;
end $$;

-- The pharmacy's inbox: which of its prescriptions have a conversation, and which has something unread. No message text, no medicine.
create function public.pharmacist_conversation_list() returns table (prescription_id uuid, last_message_at timestamptz, unread boolean, is_open boolean)
language sql stable security definer set search_path = ''
as $$
  select t.prescription_id, t.last_message_at, (t.last_message_at is not null and (t.pharmacy_read_at is null or t.pharmacy_read_at < t.last_message_at)),
         private.pharmacy_chat_open(t.prescription_id, t.pharmacy_partner_id)
    from public.pharmacy_threads t join public.prescriptions rx on rx.id = t.prescription_id and rx.pharmacy_partner_id = t.pharmacy_partner_id
   where private.pharmacist_partner() is not null and t.pharmacy_partner_id = private.pharmacist_partner()
   order by t.last_message_at desc nulls last
$$;

-- ===========================================================================
-- C. Clinic booking-calendar contract (21.3): slots and reservations only. No practice software, no clinical content.
--    Dormant under the provider_org_platform module and the per-organisation is_operational switch, exactly like the rest of module 28.
-- ===========================================================================
create table public.clinic_booking_slots (
  id                uuid primary key default gen_random_uuid(),
  clinic_partner_id uuid not null references public.provider_organisations (id) on delete restrict,
  location_id       uuid references public.provider_org_locations (id) on delete set null,
  service_id        uuid references public.provider_org_services (id) on delete set null,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  capacity          integer not null default 1 check (capacity between 1 and 50),
  state             text not null default 'open' check (state in ('open', 'closed')),
  created_by        uuid references public.profiles (id) on delete set null,
  is_test           boolean not null default false,
  created_at        timestamptz not null default now(),
  check (ends_at > starts_at and ends_at - starts_at <= interval '8 hours'),
  unique (clinic_partner_id, location_id, starts_at)
);
create index clinic_booking_slots_open_idx on public.clinic_booking_slots (clinic_partner_id, starts_at) where state = 'open';
alter table public.clinic_booking_slots enable row level security;
revoke all on public.clinic_booking_slots from public, anon, authenticated;

create table public.clinic_slot_reservations (
  id               uuid primary key default gen_random_uuid(),
  slot_id          uuid not null references public.clinic_booking_slots (id) on delete restrict,
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete restrict,
  state            text not null default 'held' check (state in ('held', 'confirmed', 'cancelled', 'attended', 'no_show')),
  hold_expires_at  timestamptz,
  confirmed_at     timestamptz,
  cancelled_at     timestamptz,
  is_test          boolean not null default false,
  created_at       timestamptz not null default now(),
  check (state <> 'held' or hold_expires_at is not null)
);
create unique index clinic_slot_reservations_one_live on public.clinic_slot_reservations (slot_id, patient_id) where state in ('held', 'confirmed');
create index clinic_slot_reservations_patient_idx on public.clinic_slot_reservations (patient_id, created_at desc);
alter table public.clinic_slot_reservations enable row level security;
revoke all on public.clinic_slot_reservations from public, anon, authenticated;
comment on table public.clinic_slot_reservations is
  'S74 (21.3): a patient''s place in a clinic slot. Carries no reason, symptom or note: the clinic learns who is coming and when, nothing else. Written only by the reservation functions.';

insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('clinic_booking_confirmed', 'operational', 'routine', 'patient', array['in_app']::public.notification_channel[], 'immediate', 'S74: your clinic visit is confirmed. Names no clinic reason (INV-07).')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('clinic_booking_confirmed', 'en', 'in_app', 'Your clinic visit is booked', 'Your clinic visit is booked. Open the app to see the time.')
on conflict (template_key, locale, channel) do nothing;

-- Clinic staff who may manage the calendar of their own clinic (any seat except none; an admin always may).
create function private.clinic_calendar_staff(p_clinic uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.provider_organisations po where po.id = p_clinic
                   and private.is_provider_org_staff_for(po.organisation_id, array['operations_manager', 'clinical_lead', 'receptionist']::public.provider_org_role[]))
$$;
revoke all on function private.clinic_calendar_staff(uuid) from public, anon;
grant execute on function private.clinic_calendar_staff(uuid) to authenticated;

create function private.clinic_bookable(p_clinic uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.module_enabled('provider_org_platform')
     and exists (select 1 from public.provider_organisations po where po.id = p_clinic and po.is_operational)
     and private.partner_open_for_new_work('clinic', p_clinic)
$$;
revoke all on function private.clinic_bookable(uuid) from public, anon, authenticated;

create function public.clinic_publish_slot(p_clinic uuid, p_starts timestamptz, p_ends timestamptz, p_capacity integer default 1, p_location uuid default null, p_service uuid default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_uid uuid := (select auth.uid()); po public.provider_organisations%rowtype;
begin
  select * into po from public.provider_organisations where id = p_clinic;
  if not found or not private.clinic_calendar_staff(p_clinic) then raise exception 'Clinic not found' using errcode = '42501'; end if;
  if p_starts <= now() then raise exception 'slot_in_the_past' using errcode = '22023'; end if;
  if p_location is not null and not exists (select 1 from public.provider_org_locations l where l.id = p_location and l.organisation_id = po.organisation_id) then raise exception 'location_not_found' using errcode = '22023'; end if;
  if p_service is not null and not exists (select 1 from public.provider_org_services s where s.id = p_service and s.organisation_id = po.organisation_id) then raise exception 'service_not_found' using errcode = '22023'; end if;
  insert into public.clinic_booking_slots (clinic_partner_id, location_id, service_id, starts_at, ends_at, capacity, created_by, is_test)
  values (p_clinic, p_location, p_service, p_starts, p_ends, p_capacity, v_uid, coalesce((select is_test from public.profiles where id = v_uid), false)) returning id into v_id;
  return v_id;
end $$;

create function public.clinic_close_slot(p_slot uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare s public.clinic_booking_slots%rowtype;
begin
  select * into s from public.clinic_booking_slots where id = p_slot for update;
  if not found or not private.clinic_calendar_staff(s.clinic_partner_id) then raise exception 'Slot not found' using errcode = '42501'; end if;
  update public.clinic_booking_slots set state = 'closed' where id = p_slot;
end $$;

-- Open slots with places left. Patients only see a clinic that is bookable today (module on, operational, not suspended from new work).
create function public.list_clinic_slots(p_clinic uuid, p_from timestamptz default now(), p_to timestamptz default now() + interval '30 days')
returns table (slot_id uuid, starts_at timestamptz, ends_at timestamptz, places_left integer, location_id uuid, service_id uuid)
language sql stable security definer set search_path = ''
as $$
  select s.id, s.starts_at, s.ends_at,
         s.capacity - (select count(*)::integer from public.clinic_slot_reservations r where r.slot_id = s.id and (r.state = 'confirmed' or (r.state = 'held' and r.hold_expires_at > now()))),
         s.location_id, s.service_id
    from public.clinic_booking_slots s
   where (select auth.uid()) is not null and s.clinic_partner_id = p_clinic and s.state = 'open' and s.starts_at > now() and s.starts_at >= p_from and s.starts_at < p_to
     and private.clinic_bookable(p_clinic) and not s.is_test
     and s.capacity > (select count(*) from public.clinic_slot_reservations r where r.slot_id = s.id and (r.state = 'confirmed' or (r.state = 'held' and r.hold_expires_at > now())))
   order by s.starts_at
$$;

create function public.patient_hold_clinic_slot(p_slot uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); s public.clinic_booking_slots%rowtype; pr public.profiles%rowtype; v_taken integer; v_id uuid;
begin
  select * into pr from public.profiles where id = v_uid and role = 'patient';
  if not found then raise exception 'This action is for patients' using errcode = '42501'; end if;
  select * into s from public.clinic_booking_slots where id = p_slot for update;                       -- the slot row is the lock: two patients cannot take the last place
  if not found or s.state <> 'open' or s.starts_at <= now() then raise exception 'slot_not_available' using errcode = '22023'; end if;
  if not private.clinic_bookable(s.clinic_partner_id) then raise exception 'clinic_not_bookable' using errcode = '55000'; end if;
  select count(*) into v_taken from public.clinic_slot_reservations r where r.slot_id = s.id and (r.state = 'confirmed' or (r.state = 'held' and r.hold_expires_at > now()));
  if v_taken >= s.capacity then raise exception 'slot_full' using errcode = '22023'; end if;
  update public.clinic_slot_reservations set state = 'cancelled', cancelled_at = now() where slot_id = s.id and patient_id = v_uid and state = 'held' and hold_expires_at <= now();
  insert into public.clinic_slot_reservations (slot_id, organisation_id, patient_id, state, hold_expires_at, is_test)
  values (s.id, pr.organisation_id, v_uid, 'held', now() + interval '10 minutes', pr.is_test) returning id into v_id;
  return v_id;
end $$;

create function public.patient_confirm_clinic_reservation(p_reservation uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); r public.clinic_slot_reservations%rowtype; s public.clinic_booking_slots%rowtype;
begin
  select * into r from public.clinic_slot_reservations where id = p_reservation and patient_id = v_uid for update;
  if not found then raise exception 'Reservation not found' using errcode = '42501'; end if;
  select * into s from public.clinic_booking_slots where id = r.slot_id for update;
  if r.state <> 'held' or r.hold_expires_at <= now() then raise exception 'hold_expired' using errcode = '22023'; end if;
  if not private.clinic_bookable(s.clinic_partner_id) then raise exception 'clinic_not_bookable' using errcode = '55000'; end if;
  update public.clinic_slot_reservations set state = 'confirmed', confirmed_at = now(), hold_expires_at = null where id = r.id;
  perform private.rx_notify(v_uid, r.organisation_id, 'clinic_booking_confirmed');
  perform private.log_audit('clinic.reservation_confirmed', 'clinic_slot_reservations', r.id, '{}'::jsonb);
end $$;

create function public.patient_cancel_clinic_reservation(p_reservation uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.clinic_slot_reservations set state = 'cancelled', cancelled_at = now(), hold_expires_at = null
   where id = p_reservation and patient_id = (select auth.uid()) and state in ('held', 'confirmed');
  if not found then raise exception 'Reservation not found' using errcode = '42501'; end if;
end $$;

create function public.patient_my_clinic_reservations() returns table (reservation_id uuid, slot_id uuid, clinic_partner_id uuid, starts_at timestamptz, ends_at timestamptz, state text)
language sql stable security definer set search_path = ''
as $$
  select r.id, s.id, s.clinic_partner_id, s.starts_at, s.ends_at, r.state from public.clinic_slot_reservations r join public.clinic_booking_slots s on s.id = r.slot_id
   where r.patient_id = (select auth.uid()) order by s.starts_at desc
$$;

-- The clinic sees who is coming: name and patient number, nothing clinical. Audited (INV-10).
create function public.clinic_slot_roster(p_slot uuid) returns table (reservation_id uuid, patient_number text, patient_name text, state text)
language plpgsql security definer set search_path = ''
as $$
declare s public.clinic_booking_slots%rowtype;
begin
  select * into s from public.clinic_booking_slots where id = p_slot;
  if not found or not private.clinic_calendar_staff(s.clinic_partner_id) then raise exception 'Slot not found' using errcode = '42501'; end if;
  perform private.log_audit('clinic.roster_read', 'clinic_booking_slots', p_slot, jsonb_build_object('clinic_partner_id', s.clinic_partner_id));
  return query select r.id, p.patient_number, p.full_name, r.state from public.clinic_slot_reservations r join public.profiles p on p.id = r.patient_id
                where r.slot_id = p_slot and r.state in ('held', 'confirmed') and (r.state = 'confirmed' or r.hold_expires_at > now()) order by p.full_name;
end $$;

-- ===========================================================================
-- D. Grants and assertions
-- ===========================================================================
do $$
declare f text;
begin
  foreach f in array array[
    'public.pharmacist_declare_sourcing(text)', 'public.verify_pharmacy_sourcing(uuid,text,integer)', 'public.clear_pharmacy_sourcing(uuid,text)',
    'public.pharmacy_sourcing_verified(uuid)', 'public.pharmacist_record_dispense_sourcing(uuid,text,text)', 'public.pharmacist_my_sourcing()', 'public.admin_pharmacy_sourcing()',
    'public.patient_send_pharmacy_message(uuid,text)', 'public.pharmacist_send_message(uuid,text)', 'public.patient_pharmacy_conversation(uuid)',
    'public.pharmacist_conversation(uuid)', 'public.pharmacist_conversation_list()',
    'public.clinic_publish_slot(uuid,timestamptz,timestamptz,integer,uuid,uuid)', 'public.clinic_close_slot(uuid)', 'public.list_clinic_slots(uuid,timestamptz,timestamptz)',
    'public.patient_hold_clinic_slot(uuid)', 'public.patient_confirm_clinic_reservation(uuid)', 'public.patient_cancel_clinic_reservation(uuid)',
    'public.patient_my_clinic_reservations()', 'public.clinic_slot_roster(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

do $$
declare t text;
begin
  foreach t in array array['pharmacy_chat_config', 'pharmacy_threads', 'pharmacy_messages', 'clinic_booking_slots', 'clinic_slot_reservations'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception 'RLS is off on %', t; end if;
    if has_table_privilege('anon', 'public.' || t, 'SELECT') or has_table_privilege('authenticated', 'public.' || t, 'SELECT') then raise exception '% must have no table grant', t; end if;
  end loop;
  if has_function_privilege('anon', 'public.patient_send_pharmacy_message(uuid,text)', 'EXECUTE') then raise exception 'anon can send a pharmacy message'; end if;
end $$;
