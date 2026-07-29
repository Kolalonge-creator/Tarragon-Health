-- Tarragon Health — auto-notify the region waitlist when a state goes live
--
-- When an admin flips public.service_regions.is_active false→true, everyone who asked to be
-- told when partner services reach that state gets a "we're live near you — book now"
-- message. Same mechanism as every other alert: enqueue rows into public.notifications and
-- let the existing send-pending-notifications Edge Function (every 5 min, WhatsApp→SMS
-- fallback + Resend email) deliver them. No account is created, nothing is auto-purchased —
-- it's a notification only, squarely inside the "WhatsApp/SMS is notifications, never a
-- required interface" rule.
--
-- Aggregated to ONE message per requester+care-recipient pair (not one per waitlisted
-- service) so a patient who waited on lab + pharmacy + delivery gets a single alert listing
-- them. recipient_id is the requester's profile (NOT NULL → profiles); the contact snapshot
-- captured at waitlist time travels in payload.to_phone/to_email (dispatcher prefers those,
-- else falls back to the requester's profile phone / auth email).

create or replace function private.notify_region_waitlist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_requester       public.profiles%rowtype;
  v_requester_email text;
  v_recipient_name  text;
begin
  for v_row in
    select
      w.requester_id,
      coalesce(w.care_recipient_id, w.requester_id) as care_recipient_key,
      max(w.care_recipient_id::text)::uuid          as care_recipient_id,
      string_agg(distinct w.service_type, ', ')      as services,
      max(w.to_email)                                as to_email,
      max(w.to_phone)                                as to_phone
    from public.region_waitlist w
    where w.state = new.state and w.notified_at is null
    group by w.requester_id, coalesce(w.care_recipient_id, w.requester_id)
  loop
    select * into v_requester from public.profiles where id = v_row.requester_id;
    if v_requester.id is null then
      continue;  -- requester profile gone (cascade) — skip; row is stamped below regardless
    end if;

    select email into v_requester_email from auth.users where id = v_row.requester_id;

    v_recipient_name := null;
    if v_row.care_recipient_id is not null and v_row.care_recipient_id <> v_row.requester_id then
      select full_name into v_recipient_name from public.profiles where id = v_row.care_recipient_id;
    end if;

    -- WhatsApp (dispatcher falls back to SMS if the template is unapproved / send fails).
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    values (
      v_requester.organisation_id, v_row.requester_id, 'whatsapp', 'pending',
      'region_now_available',
      jsonb_build_object(
        'state',            new.state,
        'display_name',     new.display_name,
        'services',         v_row.services,
        'requester_name',   coalesce(v_requester.full_name, 'there'),
        'care_recipient',   v_recipient_name,
        'to_phone',         v_row.to_phone
      )
    );

    -- Email, if a contact email is resolvable (snapshot first, else the account email).
    if coalesce(v_row.to_email, v_requester_email) is not null then
      insert into public.notifications
        (organisation_id, recipient_id, channel, status, template, payload)
      values (
        v_requester.organisation_id, v_row.requester_id, 'email', 'pending',
        'region_now_available',
        jsonb_build_object(
          'to_email',         coalesce(v_row.to_email, v_requester_email),
          'state',            new.state,
          'display_name',     new.display_name,
          'services',         v_row.services,
          'requester_name',   coalesce(v_requester.full_name, 'there'),
          'care_recipient',   v_recipient_name
        )
      );
    end if;
  end loop;

  -- Stamp every open row for this state as notified (idempotent: a re-toggle only alerts
  -- rows added since, since notified ones are excluded above and here).
  update public.region_waitlist
  set notified_at = now()
  where state = new.state and notified_at is null;

  return new;
end;
$$;

-- Fire only on the false→true transition (a deactivation enqueues nothing).
drop trigger if exists service_regions_notify_waitlist on public.service_regions;
create trigger service_regions_notify_waitlist
  after update on public.service_regions
  for each row
  when (old.is_active is distinct from new.is_active and new.is_active)
  execute function private.notify_region_waitlist();
