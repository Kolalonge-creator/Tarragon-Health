-- S65b: facility bookings with reminders, verified-visit ratings with moderation and a facility reply, and `directory_search`
-- (spec 15.9, 15.10, 15.11). Builds on S65a (hide-stale rule, tier, report queue) and the S10 outbox.
--
-- Reconciled first. Live: `booking_requests` (a patient asks a facility for a service on a date; kept as is), `lab_location_reviews`
-- (a lab review tied to a resulted lab order; kept as is, labs keep it), `facilities`, `facility_services`.
-- `facility_bookings` sits BESIDE booking_requests (a real slot with a state and reminders), it does not replace it.
--
-- Q22 (CMO, 2026-10-07): ratings are for a verified visit only. A visit is (a) a lab order that reached 'resulted' at a branch of the
-- facility's lab provider, or (b) a facility booking a staff member marked 'completed'. One rating per visit (unique). There is no rating
-- of a clinician's clinical judgement: the form has a score and an optional short comment only; a comment that touches the judgement of a
-- doctor, a diagnosis or a prescription is HELD and can only be published with the comment removed, or rejected. Every rating is
-- moderated: it shows the patient its status and the date by which moderation is due (target hours are PROPOSED config). The facility has
-- a reply right, recorded by staff for now (a signed-in facility portal does not exist).
--
-- Encounters (consultations) are NOT accepted as a visit proof here: an encounter has no facility column, so there is nothing to tie it
-- to. Recorded in docs/OPEN-QUESTIONS.md.
--
-- Q23: dietitian, pharmacist and specialist bookings are priced per item. `directory_search` returns a price only where it is known
-- (the lowest active facility service price, or the specialist's fee) and says price_basis = 'per_item'; it never invents one.
--
-- Events through the S10 outbox: booking.created, booking.reminder_due, rating.submitted. Payloads carry ids only (INV-07).
-- No partner calendar exists beyond Synlab: the sync is an adapter interface with a mock in packages/integrations, nothing fabricated.

-- ---------------------------------------------------------------------------
-- 1. Event types
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('booking.created', 'A patient asked a facility for a slot', 'S65', false),
  ('booking.reminder_due', 'A reminder for a facility booking is due', 'S65', false),
  ('rating.submitted', 'A patient submitted a verified-visit facility rating', 'S65', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys) values
  ('booking.created', 1, array['booking_id', 'facility_id']),
  ('booking.reminder_due', 1, array['booking_id', 'reminder_id', 'milestone_minutes']),
  ('rating.submitted', 1, array['rating_id', 'facility_id'])
on conflict (event_type, version) do nothing;

-- ---------------------------------------------------------------------------
-- 2. facility_bookings and their reminders
-- ---------------------------------------------------------------------------
create table public.facility_bookings (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  patient_id           uuid not null references public.profiles (id) on delete cascade,
  facility_id          uuid not null references public.facilities (id) on delete restrict,
  slot_at              timestamptz not null,
  service_name         text check (service_name is null or char_length(btrim(service_name)) between 1 and 120),
  price_shown_kobo     bigint check (price_shown_kobo is null or price_shown_kobo >= 0),
  state                text not null default 'requested' check (state in ('requested', 'confirmed', 'cancelled', 'completed', 'missed')),
  patient_response     text check (patient_response in ('coming', 'cancelling')),
  patient_responded_at timestamptz,
  confirmed_by         uuid references public.profiles (id) on delete set null,
  confirmed_at         timestamptz,
  confirmation_source  text check (confirmation_source in ('partner_calendar', 'staff_phone')),
  completed_by         uuid references public.profiles (id) on delete set null,
  completed_at         timestamptz,
  booking_request_id   uuid references public.booking_requests (id) on delete set null,
  is_test              boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check ((state = 'confirmed') = (confirmed_at is not null) or state in ('cancelled', 'completed', 'missed')),
  check (state <> 'completed' or completed_at is not null)
);
create unique index facility_bookings_no_double on public.facility_bookings (patient_id, facility_id, slot_at) where state in ('requested', 'confirmed');
create index facility_bookings_patient_idx on public.facility_bookings (patient_id, slot_at desc);
create index facility_bookings_facility_idx on public.facility_bookings (facility_id, slot_at) where state in ('requested', 'confirmed');
create trigger facility_bookings_set_updated_at before update on public.facility_bookings
  for each row execute function private.set_updated_at();

create table public.facility_booking_reminders (
  id                uuid primary key default gen_random_uuid(),
  booking_id        uuid not null references public.facility_bookings (id) on delete cascade,
  milestone_minutes integer not null check (milestone_minutes > 0),
  due_at            timestamptz not null,
  sent_at           timestamptz,
  skipped_at        timestamptz,
  unique (booking_id, milestone_minutes),
  check (not (sent_at is not null and skipped_at is not null))
);
create index facility_booking_reminders_due_idx on public.facility_booking_reminders (due_at) where sent_at is null and skipped_at is null;

alter table public.facility_bookings enable row level security;
alter table public.facility_booking_reminders enable row level security;
-- A booking is the patient's own record (and a caregiver acting for them, same permission as lab reviews). Staff read the booking queue
-- through facility_booking_queue(), which writes an audit line; there is no staff table policy on purpose (INV-10, INV-12).
create policy facility_bookings_own on public.facility_bookings for select to authenticated
  using (patient_id = (select auth.uid()) or private.can_act_for(patient_id, 'book_appointments'::public.caregiver_permission));
revoke all on public.facility_bookings, public.facility_booking_reminders from public, anon, authenticated;
grant select on public.facility_bookings to authenticated;
-- No write grant: create_facility_booking, respond_facility_booking and the staff RPCs are the only doors. Reminders are internal.

create function private.go_live_directory_open(p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select private.go_live_open_patient('directory_enabled', p_patient) $$;
revoke all on function private.go_live_directory_open(uuid) from public, anon, authenticated;

create function public.create_facility_booking(p_facility uuid, p_slot timestamptz, p_service text default null, p_patient uuid default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_patient uuid := coalesce(p_patient, (select auth.uid()));
  v_org     uuid;
  v_test    boolean;
  v_rules   jsonb := private.directory_rules() -> 'booking';
  v_price   bigint;
  v_id      uuid;
  v_m       integer;
begin
  if v_uid is null then raise exception 'sign in to book' using errcode = '42501'; end if;
  if v_patient <> v_uid and not private.can_act_for(v_patient, 'book_appointments'::public.caregiver_permission) then
    raise exception 'you may not book for this person' using errcode = '42501';
  end if;
  if not private.go_live_directory_open(v_patient) then raise exception 'facility booking is not open yet' using errcode = '55000'; end if;
  select organisation_id, coalesce(is_test, false) into v_org, v_test from public.profiles where id = v_patient;
  if not exists (select 1 from public.facilities where id = p_facility and is_active) or not private.directory_listing_visible('facilities', p_facility) then
    raise exception 'that facility is not available to book' using errcode = '22023';
  end if;
  if p_slot < now() + make_interval(mins => (v_rules ->> 'min_lead_minutes')::integer)
     or p_slot > now() + make_interval(days => (v_rules ->> 'max_days_ahead')::integer) then
    raise exception 'choose a time between one hour and % days from now', (v_rules ->> 'max_days_ahead') using errcode = '22023';
  end if;
  if p_service is not null then
    select min(price_kobo) into v_price from public.facility_services
     where facility_id = p_facility and is_active and position(lower(btrim(p_service)) in lower(name)) > 0;
  end if;

  insert into public.facility_bookings (organisation_id, patient_id, facility_id, slot_at, service_name, price_shown_kobo, is_test)
  values (v_org, v_patient, p_facility, p_slot, nullif(btrim(coalesce(p_service, '')), ''), v_price, v_test)
  returning id into v_id;

  for v_m in select (jsonb_array_elements_text(v_rules -> 'reminder_minutes_before'))::integer loop
    if p_slot - make_interval(mins => v_m) > now() then
      insert into public.facility_booking_reminders (booking_id, milestone_minutes, due_at) values (v_id, v_m, p_slot - make_interval(mins => v_m));
    end if;
  end loop;

  perform private.emit_domain_event('booking.created', v_org, jsonb_build_object('booking_id', v_id, 'facility_id', p_facility),
                                    'booking.created:' || v_id, v_patient, 'facility_booking', v_id);
  return jsonb_build_object('booking_id', v_id, 'state', 'requested', 'price_shown_kobo', v_price);
end $$;
revoke all on function public.create_facility_booking(uuid, timestamptz, text, uuid) from public, anon;
grant execute on function public.create_facility_booking(uuid, timestamptz, text, uuid) to authenticated;

-- "I come" or "I cancel": the one tap on a reminder. No ban and no penalty for cancelling.
create function public.respond_facility_booking(p_booking uuid, p_response text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare b public.facility_bookings%rowtype;
begin
  if p_response not in ('coming', 'cancelling') then raise exception 'answer coming or cancelling' using errcode = '22023'; end if;
  select * into b from public.facility_bookings where id = p_booking for update;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
  if b.patient_id <> (select auth.uid()) and not private.can_act_for(b.patient_id, 'book_appointments'::public.caregiver_permission) then
    raise exception 'not your booking' using errcode = '42501';
  end if;
  if b.state not in ('requested', 'confirmed') then raise exception 'this booking can no longer be changed' using errcode = '23514'; end if;
  update public.facility_bookings
     set patient_response = p_response, patient_responded_at = now(), state = case when p_response = 'cancelling' then 'cancelled' else state end
   where id = p_booking;
  if p_response = 'cancelling' then
    update public.facility_booking_reminders set skipped_at = now() where booking_id = p_booking and sent_at is null and skipped_at is null;
  end if;
  return jsonb_build_object('booking_id', p_booking, 'response', p_response);
end $$;
revoke all on function public.respond_facility_booking(uuid, text) from public, anon;
grant execute on function public.respond_facility_booking(uuid, text) to authenticated;

create function public.confirm_facility_booking(p_booking uuid, p_source text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.directory_can_record('facilities') then raise exception 'you may not confirm bookings' using errcode = '42501'; end if;
  if p_source not in ('partner_calendar', 'staff_phone') then raise exception 'unknown confirmation source' using errcode = '22023'; end if;
  update public.facility_bookings set state = 'confirmed', confirmed_by = (select auth.uid()), confirmed_at = now(), confirmation_source = p_source
   where id = p_booking and state = 'requested';
  if not found then raise exception 'only a requested booking can be confirmed' using errcode = '23514'; end if;
  perform private.log_audit('facility_booking.confirmed', 'facility_bookings', p_booking, jsonb_build_object('source', p_source));
end $$;
revoke all on function public.confirm_facility_booking(uuid, text) from public, anon;
grant execute on function public.confirm_facility_booking(uuid, text) to authenticated;

-- A staff member marks the visit done after checking with the facility. This is what lets the patient rate it.
create function public.complete_facility_booking(p_booking uuid, p_attended boolean) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.directory_can_record('facilities') then raise exception 'you may not complete bookings' using errcode = '42501'; end if;
  update public.facility_bookings
     set state = case when p_attended then 'completed' else 'missed' end,
         completed_by = case when p_attended then (select auth.uid()) end, completed_at = case when p_attended then now() end
   where id = p_booking and state in ('requested', 'confirmed') and slot_at <= now();
  if not found then raise exception 'only a booking whose time has passed can be completed' using errcode = '23514'; end if;
  perform private.log_audit('facility_booking.completed', 'facility_bookings', p_booking, jsonb_build_object('attended', p_attended));
end $$;
revoke all on function public.complete_facility_booking(uuid, boolean) from public, anon;
grant execute on function public.complete_facility_booking(uuid, boolean) to authenticated;

create function public.facility_booking_queue() returns table (booking_id uuid, facility_id uuid, facility_name text, slot_at timestamptz, state text, service_name text)
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.directory_can_record('facilities') then raise exception 'you may not see the booking queue' using errcode = '42501'; end if;
  perform private.log_audit('facility_booking.queue_read', 'facility_bookings', null, '{}'::jsonb);
  return query select b.id, b.facility_id, f.name, b.slot_at, b.state, b.service_name
    from public.facility_bookings b join public.facilities f on f.id = b.facility_id
   where b.state in ('requested', 'confirmed') and (not b.is_test or private.directory_can_view())
   order by b.slot_at, b.id;
end $$;
revoke all on function public.facility_booking_queue() from public, anon;
grant execute on function public.facility_booking_queue() to authenticated;

-- Reminders: one neutral notice per booking per sweep, the nearest milestone only (no stack of reminders for a late booking).
create function private.facility_booking_reminder_sweep() returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; n integer := 0;
begin
  update public.facility_booking_reminders a set skipped_at = now()
   where a.sent_at is null and a.skipped_at is null and a.due_at <= now()
     and exists (select 1 from public.facility_booking_reminders z
                  where z.booking_id = a.booking_id and z.milestone_minutes < a.milestone_minutes and z.due_at <= now() and z.skipped_at is null);
  for r in
    select rem.id as reminder_id, rem.milestone_minutes, b.id as booking_id, b.patient_id, b.organisation_id, b.slot_at, b.state, b.is_test
      from public.facility_booking_reminders rem join public.facility_bookings b on b.id = rem.booking_id
     where rem.sent_at is null and rem.skipped_at is null and rem.due_at <= now()
     order by rem.due_at for update of rem skip locked
  loop
    if r.state not in ('requested', 'confirmed') or r.slot_at <= now() then
      update public.facility_booking_reminders set skipped_at = now() where id = r.reminder_id;
      continue;
    end if;
    begin
      perform private.circle_notify(r.patient_id, r.organisation_id, 'facility_booking_reminder', 'facility_booking_reminders', r.reminder_id,
                                    array['in_app', 'push'], 'routine', r.is_test);
      perform private.emit_domain_event('booking.reminder_due', r.organisation_id,
                jsonb_build_object('booking_id', r.booking_id, 'reminder_id', r.reminder_id, 'milestone_minutes', r.milestone_minutes),
                'booking.reminder_due:' || r.reminder_id, r.patient_id, 'facility_booking', r.booking_id);
      update public.facility_booking_reminders set sent_at = now() where id = r.reminder_id;
      n := n + 1;
    exception when others then
      -- never lose a reminder quietly: raise an ops incident and leave it unsent so the next sweep retries
      begin
        perform private.page_incident(r.organisation_id, 'booking_reminder_failed:' || r.reminder_id, 'A booking reminder could not be sent',
                                      'Reminder ' || r.reminder_id || ' for a facility booking failed: ' || sqlerrm);
      exception when others then
        raise warning 'booking reminder % and its incident both failed: %', r.reminder_id, sqlerrm;
      end;
    end;
  end loop;
  return n;
end $$;
revoke all on function private.facility_booking_reminder_sweep() from public, anon, authenticated;
select cron.schedule('facility-booking-reminders', '*/10 * * * *', $c$select private.facility_booking_reminder_sweep()$c$);

-- ---------------------------------------------------------------------------
-- 3. facility_ratings (Q22): verified visit, moderated, with a facility reply
-- ---------------------------------------------------------------------------
create table public.facility_ratings (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  facility_id       uuid not null references public.facilities (id) on delete cascade,
  lab_order_id      uuid unique references public.lab_orders (id) on delete cascade,
  facility_booking_id uuid unique references public.facility_bookings (id) on delete cascade,
  rating            smallint not null check (rating between 1 and 5),
  comment           text check (comment is null or char_length(btrim(comment)) between 1 and 500),
  public_comment    text check (public_comment is null or char_length(btrim(public_comment)) between 1 and 500),
  status            text not null default 'pending' check (status in ('pending', 'published', 'rejected')),
  held_reason       text check (held_reason in ('clinical_judgement')),
  respond_by        timestamptz not null,
  moderated_by      uuid references public.profiles (id) on delete set null,
  moderated_at      timestamptz,
  moderation_reason text,
  is_test           boolean not null default false,
  created_at        timestamptz not null default now(),
  -- the verified-visit rule, as a constraint: exactly one proof of a visit
  constraint facility_ratings_one_visit_proof check ((lab_order_id is not null) <> (facility_booking_id is not null)),
  constraint facility_ratings_moderated_consistency check ((status = 'pending') = (moderated_at is null)),
  constraint facility_ratings_reject_needs_reason check (status <> 'rejected' or char_length(btrim(coalesce(moderation_reason, ''))) >= 10),
  constraint facility_ratings_public_comment_only_published check (public_comment is null or status = 'published')
);
create index facility_ratings_facility_idx on public.facility_ratings (facility_id) where status = 'published';
create index facility_ratings_pending_idx on public.facility_ratings (respond_by) where status = 'pending';

create table public.facility_rating_replies (
  id           uuid primary key default gen_random_uuid(),
  rating_id    uuid not null unique references public.facility_ratings (id) on delete cascade,
  body         text not null check (char_length(btrim(body)) between 1 and 1000),
  channel      text not null check (channel in ('portal', 'phone', 'email')),
  recorded_by  uuid not null references public.profiles (id) on delete restrict,
  created_at   timestamptz not null default now()
);

alter table public.facility_ratings enable row level security;
alter table public.facility_rating_replies enable row level security;
-- A patient reads their own ratings (with their status and due date); a caregiver with the booking permission may too, the same shape as
-- lab_location_reviews. Nobody else reads the table: the public read is facility_ratings_public (identity-free), staff use the queue RPC.
create policy facility_ratings_own on public.facility_ratings for select to authenticated
  using (patient_id = (select auth.uid()) or private.can_act_for(patient_id, 'book_appointments'::public.caregiver_permission));
revoke all on public.facility_ratings, public.facility_rating_replies from public, anon, authenticated;
grant select on public.facility_ratings to authenticated;

create function private.facility_rating_visit_ok(p_patient uuid, p_facility uuid, p_lab_order uuid, p_booking uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case
    when p_lab_order is not null then exists (
      select 1 from public.lab_orders lo
        join public.lab_provider_locations l on l.id = lo.location_id
        join public.facilities f on f.lab_provider_id = l.lab_provider_id
       where lo.id = p_lab_order and lo.patient_id = p_patient and lo.status = 'resulted' and f.id = p_facility)
    when p_booking is not null then exists (
      select 1 from public.facility_bookings b
       where b.id = p_booking and b.patient_id = p_patient and b.facility_id = p_facility and b.state = 'completed')
    else false end
$$;
revoke all on function private.facility_rating_visit_ok(uuid, uuid, uuid, uuid) from public, anon, authenticated;

create function public.submit_facility_rating(p_facility uuid, p_rating integer, p_comment text default null,
                                              p_lab_order uuid default null, p_booking uuid default null, p_patient uuid default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_patient uuid := coalesce(p_patient, (select auth.uid()));
  v_org     uuid;
  v_test    boolean;
  v_rules   jsonb := private.directory_rules() -> 'ratings';
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_held    text;
  v_term    text;
  v_id      uuid;
begin
  if v_uid is null then raise exception 'sign in to rate' using errcode = '42501'; end if;
  if v_patient <> v_uid and not private.can_act_for(v_patient, 'book_appointments'::public.caregiver_permission) then
    raise exception 'you may not rate for this person' using errcode = '42501';
  end if;
  if not private.go_live_directory_open(v_patient) then raise exception 'ratings are not open yet' using errcode = '55000'; end if;
  if (p_lab_order is null) = (p_booking is null) then
    raise exception 'a rating needs one completed visit' using errcode = '23514';
  end if;
  if not private.facility_rating_visit_ok(v_patient, p_facility, p_lab_order, p_booking) then
    raise exception 'you can only rate a visit that has been completed at this facility' using errcode = '23514';
  end if;
  if v_comment is not null and char_length(v_comment) > 500 then raise exception 'keep the comment under 500 characters' using errcode = '22023'; end if;
  if v_comment is not null then
    for v_term in select jsonb_array_elements_text(v_rules -> 'hold_terms') loop
      if position(lower(v_term) in lower(v_comment)) > 0 then v_held := 'clinical_judgement'; exit; end if;
    end loop;
  end if;
  select organisation_id, coalesce(is_test, false) into v_org, v_test from public.profiles where id = v_patient;
  begin
    insert into public.facility_ratings (organisation_id, patient_id, facility_id, lab_order_id, facility_booking_id, rating, comment, held_reason, respond_by, is_test)
    values (v_org, v_patient, p_facility, p_lab_order, p_booking, p_rating, v_comment, v_held,
            now() + make_interval(hours => (v_rules ->> 'moderation_target_hours')::integer), v_test)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'this visit has already been rated' using errcode = '23505';
  end;
  perform private.emit_domain_event('rating.submitted', v_org, jsonb_build_object('rating_id', v_id, 'facility_id', p_facility),
                                    'rating.submitted:' || v_id, v_patient, 'facility_rating', v_id);
  return jsonb_build_object('rating_id', v_id, 'status', 'pending', 'held', v_held is not null);
end $$;
revoke all on function public.submit_facility_rating(uuid, integer, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.submit_facility_rating(uuid, integer, text, uuid, uuid, uuid) to authenticated;

create function public.moderate_facility_rating(p_rating uuid, p_decision text, p_reason text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.facility_ratings%rowtype;
begin
  if (select auth.uid()) is null or not private.directory_can_record('facilities') then raise exception 'you may not moderate ratings' using errcode = '42501'; end if;
  if p_decision not in ('publish', 'publish_without_comment', 'reject') then raise exception 'unknown decision' using errcode = '22023'; end if;
  select * into r from public.facility_ratings where id = p_rating for update;
  if not found then raise exception 'rating not found' using errcode = 'P0002'; end if;
  if r.status <> 'pending' then raise exception 'this rating has already been moderated' using errcode = '23514'; end if;
  if p_decision = 'publish' and r.held_reason is not null then
    raise exception 'this comment was held (it may judge a clinician); publish without the comment or reject' using errcode = '23514';
  end if;
  update public.facility_ratings
     set status = case when p_decision = 'reject' then 'rejected' else 'published' end,
         public_comment = case when p_decision = 'publish' then comment end,
         moderated_by = (select auth.uid()), moderated_at = now(), moderation_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_rating;
  perform private.log_audit('facility_rating.moderated', 'facility_ratings', p_rating, jsonb_build_object('decision', p_decision));
end $$;
revoke all on function public.moderate_facility_rating(uuid, text, text) from public, anon;
grant execute on function public.moderate_facility_rating(uuid, text, text) to authenticated;

create function public.reply_to_facility_rating(p_rating uuid, p_body text, p_channel text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.directory_can_record('facilities') then raise exception 'you may not record a facility reply' using errcode = '42501'; end if;
  if not exists (select 1 from public.facility_ratings where id = p_rating and status = 'published') then
    raise exception 'a facility can reply only to a published rating' using errcode = '23514';
  end if;
  insert into public.facility_rating_replies (rating_id, body, channel, recorded_by) values (p_rating, btrim(p_body), p_channel, (select auth.uid()));
  perform private.log_audit('facility_rating.reply_recorded', 'facility_ratings', p_rating, jsonb_build_object('channel', p_channel));
end $$;
revoke all on function public.reply_to_facility_rating(uuid, text, text) from public, anon;
grant execute on function public.reply_to_facility_rating(uuid, text, text) to authenticated;

-- Staff moderation queue: no patient identity, oldest due first, with the held reason. The read is audited.
create function public.facility_rating_queue() returns table (rating_id uuid, facility_id uuid, facility_name text, rating smallint, comment text,
                                                              held_reason text, created_at timestamptz, respond_by timestamptz, overdue boolean)
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.directory_can_record('facilities') then raise exception 'you may not see the moderation queue' using errcode = '42501'; end if;
  perform private.log_audit('facility_rating.queue_read', 'facility_ratings', null, '{}'::jsonb);
  return query select r.id, r.facility_id, f.name, r.rating, r.comment, r.held_reason, r.created_at, r.respond_by, r.respond_by < now()
    from public.facility_ratings r join public.facilities f on f.id = r.facility_id
   where r.status = 'pending' and (not r.is_test or private.directory_can_view())
   order by r.respond_by, r.id;
end $$;
revoke all on function public.facility_rating_queue() from public, anon;
grant execute on function public.facility_rating_queue() to authenticated;

-- The public read: published ratings only, no patient, month not day.
create function public.facility_ratings_public(p_facility uuid, p_limit integer default 20) returns table (rating smallint, public_comment text, month date,
                                                                                                          reply_body text, reply_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.go_live_directory_open((select auth.uid())) then raise exception 'ratings are not open yet' using errcode = '55000'; end if;
  return query select r.rating, r.public_comment, date_trunc('month', r.created_at at time zone 'Africa/Lagos')::date, rp.body, rp.created_at
    from public.facility_ratings r left join public.facility_rating_replies rp on rp.rating_id = r.id
   where r.facility_id = p_facility and r.status = 'published'
     and (not r.is_test or coalesce((select is_test from public.profiles where id = (select auth.uid())), false))
   order by r.created_at desc, r.id limit least(greatest(coalesce(p_limit, 20), 1), 50);
end $$;
revoke all on function public.facility_ratings_public(uuid, integer) from public, anon;
grant execute on function public.facility_ratings_public(uuid, integer) to authenticated;

-- The patient's own visits, with the facts the screen needs to offer directions, a call, "I come / I cancel" and a rating.
create function public.my_facility_bookings() returns table (
  booking_id uuid, facility_id uuid, facility_name text, facility_phone text, latitude double precision, longitude double precision, address text,
  slot_at timestamptz, state text, service_name text, price_shown_kobo bigint, patient_response text,
  rating_status text, rating_respond_by timestamptz, rating_held boolean
)
language sql stable security definer set search_path = ''
as $$
  select b.id, f.id, f.name, f.contact_phone, f.latitude::double precision, f.longitude::double precision, f.address, b.slot_at, b.state, b.service_name,
         b.price_shown_kobo, b.patient_response, r.status, r.respond_by, (r.held_reason is not null)
    from public.facility_bookings b
    join public.facilities f on f.id = b.facility_id
    left join public.facility_ratings r on r.facility_booking_id = b.id
   where b.patient_id = (select auth.uid())
   order by b.slot_at desc, b.id
   limit 100
$$;
revoke all on function public.my_facility_bookings() from public, anon;
grant execute on function public.my_facility_bookings() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. directory_search (15.8, 15.10, 15.16)
-- ---------------------------------------------------------------------------
create function private.facility_open_at(p_hours jsonb, p_open_24h boolean, p_at timestamptz) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  v_local timestamp := p_at at time zone 'Africa/Lagos';
  v_day   text := (array['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'])[extract(dow from v_local)::integer + 1];
  v_t     time := v_local::time;
  w       jsonb;
begin
  if p_open_24h then return true; end if;
  if p_hours is null then return null; end if;
  for w in select * from jsonb_array_elements(coalesce(p_hours -> v_day, '[]'::jsonb)) loop
    if v_t >= (w ->> 0)::time and ((w ->> 1) = '24:00' or v_t < (w ->> 1)::time) then return true; end if;
  end loop;
  return false;
end $$;
revoke all on function private.facility_open_at(jsonb, boolean, timestamptz) from public, anon, authenticated;

create function public.directory_search(
  p_lat double precision default null, p_lng double precision default null, p_radius_km numeric default null,
  p_state text default null, p_service text default null, p_open_at timestamptz default null,
  p_language text default null, p_hmo text default null, p_nhia boolean default null, p_kind text default null,
  p_limit integer default 50
) returns table (
  listing_table text, listing_id uuid, name text, kind text, state text, city text, address text, phone text,
  latitude double precision, longitude double precision, distance_km double precision,
  services text[], languages text[], accepts_hmo text[], hmo_status text, nhia_status text,
  hours_text text, open_now boolean, last_verified_at timestamptz, tier text,
  price_kobo bigint, price_basis text, rating_average numeric, rating_count integer, emergency_capable boolean, is_test boolean
)
language plpgsql stable security definer set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid   uuid := (select auth.uid());
  v_test  boolean;
  v_minr  integer := coalesce((private.directory_rules() -> 'ratings' ->> 'min_ratings_to_show_average')::integer, 3);
begin
  if v_uid is null then raise exception 'sign in to search the directory' using errcode = '42501'; end if;
  if not private.go_live_directory_open(v_uid) then raise exception 'the directory is not open yet' using errcode = '55000'; end if;
  select coalesce(pr.is_test, false) into v_test from public.profiles pr where pr.id = v_uid;

  return query
  with base as (
    select 'facilities'::text as lt, f.id as lid, f.name as nm, f.type::text as kd, f.state as st, f.city as ct, f.address as ad, f.contact_phone as ph,
           f.latitude::double precision as lat, f.longitude::double precision as lng, f.services as svc, f.languages as lang, f.accepts_hmo as hmo,
           f.nhia as nh, f.nhia_confirmed_at as nhc, f.hours as ht, f.hours_structured as hs, f.open_24h as o24, f.emergency_capable as em, f.is_test as tst
      from public.facilities f where f.is_active
    union all
    select 'specialist_providers', s.id, s.name, 'specialist', s.state, s.city, s.location, s.contact_phone,
           null::double precision, null::double precision, array[s.specialist_type::text], coalesce(s.languages, '{}'::text[]), coalesce(s.accepted_hmos, '{}'::text[]),
           null::boolean, null::timestamptz, null::text, null::jsonb, false, false, false
      from public.specialist_providers s where s.is_active
  ), enriched as (
    select b.*, fr.last_verified_at as lv, coalesce(fr.tier, 'seed_only') as tr,
           case when p_lat is not null and p_lng is not null and b.lat is not null and b.lng is not null then
             2 * 6371 * asin(sqrt(least(1, power(sin(radians((b.lat - p_lat) / 2)), 2)
               + cos(radians(p_lat)) * cos(radians(b.lat)) * power(sin(radians((b.lng - p_lng) / 2)), 2)))) end as dist,
           (select array_agg(distinct c.hmo_name) from public.facility_hmo_confirmations c where b.lt = 'facilities' and c.facility_id = b.lid) as confirmed
      from base b
      left join public.directory_freshness fr on fr.listing_table = b.lt and fr.listing_id = b.lid
     where (not b.tst or v_test)
       and private.directory_listing_visible(b.lt, b.lid)
  )
  select e.lt, e.lid, e.nm, e.kd, e.st, e.ct, e.ad, e.ph, e.lat, e.lng, e.dist,
         e.svc, e.lang, e.hmo,
         case when p_hmo is null then null
              when exists (select 1 from unnest(coalesce(e.confirmed, '{}'::text[])) x where lower(btrim(x)) = lower(btrim(p_hmo))) then 'confirmed'
              when exists (select 1 from unnest(e.hmo) x where lower(btrim(x)) = lower(btrim(p_hmo))) then 'claimed' end,
         case when e.nh is not true then null when e.nhc is not null then 'confirmed' else 'claimed' end,
         e.ht, private.facility_open_at(e.hs, e.o24, now()),
         e.lv, e.tr,
         case when e.lt = 'facilities' then (select min(fs.price_kobo) from public.facility_services fs
                                              where fs.facility_id = e.lid and fs.is_active and (p_service is null or position(lower(btrim(p_service)) in lower(fs.name)) > 0))
              else (select s.consultation_fee_kobo from public.specialist_providers s where s.id = e.lid) end,
         'per_item'::text,
         (select case when count(*) >= v_minr then round(avg(r.rating)::numeric, 1) end from public.facility_ratings r where r.facility_id = e.lid and r.status = 'published'),
         (select count(*)::integer from public.facility_ratings r where r.facility_id = e.lid and r.status = 'published'),
         e.em, e.tst
    from enriched e
   where (p_state is null or lower(e.st) = lower(btrim(p_state)))
     and (p_kind is null or e.kd = p_kind)
     and (p_radius_km is null or p_lat is null or (e.dist is not null and e.dist <= p_radius_km))
     and (p_service is null
          or exists (select 1 from unnest(e.svc) x where position(lower(btrim(p_service)) in lower(x)) > 0)
          or (e.lt = 'facilities' and exists (select 1 from public.facility_services fs where fs.facility_id = e.lid and fs.is_active and position(lower(btrim(p_service)) in lower(fs.name)) > 0)))
     and (p_language is null or exists (select 1 from unnest(e.lang) x where lower(btrim(x)) = lower(btrim(p_language))))
     and (p_hmo is null
          or exists (select 1 from unnest(e.hmo) x where lower(btrim(x)) = lower(btrim(p_hmo)))
          or exists (select 1 from unnest(coalesce(e.confirmed, '{}'::text[])) x where lower(btrim(x)) = lower(btrim(p_hmo))))
     and (p_nhia is not true or e.nh is true)
     and (p_open_at is null or private.facility_open_at(e.hs, e.o24, p_open_at) is true)
   order by e.dist nulls last, e.nm, e.lid
   limit least(greatest(coalesce(p_limit, 50), 1), 100);
end $$;
revoke all on function public.directory_search(double precision, double precision, numeric, text, text, timestamptz, text, text, boolean, text, integer) from public, anon;
grant execute on function public.directory_search(double precision, double precision, numeric, text, text, timestamptz, text, text, boolean, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Assertions
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.directory_search(double precision, double precision, numeric, text, text, timestamptz, text, text, boolean, text, integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.submit_facility_rating(uuid, integer, text, uuid, uuid, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_facility_booking(uuid, timestamptz, text, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.facility_booking_reminder_sweep()', 'EXECUTE') then
    raise exception 'S65b: a function is executable by a role that must not run it';
  end if;
  if has_table_privilege('authenticated', 'public.facility_ratings', 'INSERT') or has_table_privilege('authenticated', 'public.facility_ratings', 'UPDATE')
     or has_table_privilege('authenticated', 'public.facility_bookings', 'INSERT') or has_table_privilege('authenticated', 'public.facility_bookings', 'UPDATE')
     or has_table_privilege('authenticated', 'public.facility_booking_reminders', 'SELECT') or has_table_privilege('authenticated', 'public.facility_rating_replies', 'SELECT')
     or has_table_privilege('anon', 'public.facility_ratings', 'SELECT') then
    raise exception 'S65b: a table has a grant it must not have';
  end if;
  if not exists (select 1 from cron.job where jobname = 'facility-booking-reminders') then raise exception 'S65b: reminders not scheduled'; end if;
end $$;
