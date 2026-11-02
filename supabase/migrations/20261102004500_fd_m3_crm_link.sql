-- Front Desk M3: the CRM link (spec F4 capture-lead, F5 hubspot-sync).
--
-- WHAT THIS ADDS.
--   * service_fd_capture_lead()   F4  turns an enquiry (the website form, later the chat) into ONE contact, with explicit consent recorded
--                                      (wording hash + version), the post_enquiry follow-up scheduled, and the CRM writes queued. It refuses
--                                      without consent: no consent, no capture, no CRM, no follow-up.
--   * fd_hubspot_outbox           F5  every HubSpot write is a row here, delivered by the fd-hubspot-sync Edge Function every 5 minutes, so a
--                                      HubSpot outage or a missing token never loses a lead and never blocks the form.
--   * service_fd_hubspot_claim / _finish   claim due rows (with backoff) and record the outcome. HubSpot-owned sales fields (lifecycle stage,
--                                      lead status, owner) are stored back in fd_contacts.hubspot_sales and are never written by us.
--
-- DESIGN DECISIONS.
--   * ONE CONTACT PER PERSON. Contacts are keyed on email first, then phone (spec). A form lead and a chat lead with the same email are the same
--     contact. In HubSpot the Edge Function SEARCHES by email (then phone) before it ever creates, stores the HubSpot id, and recovers from a
--     409 "already exists" by using the id HubSpot returns, so a second contact cannot be created by a retry or a race.
--   * WHAT WE WRITE vs WHAT HUBSPOT OWNS. We write identity and product facts (email, name, phone, our lifecycle stage). Sales fields belong to
--     the founder in HubSpot and are only read back. Supabase is the source of truth for product facts, HubSpot for sales fields.
--   * CONSENT IS EXPLICIT AND SPECIFIC. An enquiry whose person did not tick the box is still answered by a human (it is their message), but is
--     NOT sent to HubSpot and NOT enrolled in follow-up. The consent row records the exact wording hash and version.
--   * SUPPRESSION WINS. A contact who unsubscribed is never re-enrolled or re-synced because they submitted another form.
--   * The note sent to HubSpot carries the source, the consent wording version and time, and the visitor's own message, truncated. It never
--     carries anything the visitor did not write.
--   * The sync is OFF until an admin sets hubspot_enabled (config) AND the Edge Function has HUBSPOT_PRIVATE_APP_TOKEN. Rows wait meanwhile.

alter table public.fd_contacts
  add column if not exists crm_sync boolean not null default false,
  add column if not exists hubspot_synced_stage text,
  add column if not exists hubspot_synced_at timestamptz,
  add column if not exists hubspot_sales jsonb not null default '{}'::jsonb;

insert into public.fd_app_config (key, value, description) values
  ('hubspot_enabled', 'false'::jsonb, 'Master switch for pushing enquirers to HubSpot. Also needs HUBSPOT_PRIVATE_APP_TOKEN on the fd-hubspot-sync function. Rows wait while off.')
on conflict do nothing;

-- hubspot_enabled is a boolean like the other switches (the validator is M2's; extend it with the new key).
create or replace function private.fd_validate_config(p_key text, p_value jsonb) returns void language plpgsql immutable set search_path = '' as $$
declare v_num numeric;
begin
  if p_key in ('assistant_enabled', 'prelaunch_mode', 'followups_enabled', 'followups_dry_run', 'account_followup_basis_confirmed', 'hubspot_enabled') then
    if jsonb_typeof(p_value) <> 'boolean' then raise exception '% must be true or false', p_key; end if;
  elsif p_key in ('weekly_send_cap', 'stall_minutes', 'inactive_days', 'session_message_cap', 'transcript_retention_days') then
    if jsonb_typeof(p_value) <> 'number' then raise exception '% must be a whole number', p_key; end if;
    v_num := (p_value #>> '{}')::numeric;
    if v_num < 1 or v_num <> trunc(v_num) or v_num > 100000 then raise exception '% must be a whole number from 1 to 100000', p_key; end if;
  elsif p_key = 'daily_model_spend_cap_usd' then
    if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric <= 0 or (p_value #>> '{}')::numeric > 100000 then
      raise exception 'daily_model_spend_cap_usd must be a positive number'; end if;
  elsif p_key = 'launch_date' then
    if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'launch_date must be YYYY-MM-DD'; end if;
  elsif p_key = 'quiet_hours' then
    if jsonb_typeof(p_value) <> 'object' or coalesce(p_value ->> 'start', '') !~ '^([01]\d|2[0-3]):[0-5]\d$'
       or coalesce(p_value ->> 'end', '') !~ '^([01]\d|2[0-3]):[0-5]\d$' or coalesce(p_value ->> 'timezone', '') = '' then
      raise exception 'quiet_hours needs start and end as HH:MM and a timezone'; end if;
  elsif p_key in ('model_fast', 'model_strong', 'sender_name', 'reply_to') then
    if jsonb_typeof(p_value) <> 'string' or btrim(p_value #>> '{}') = '' then raise exception '% must be non-empty text', p_key; end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. The outbox
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.fd_hubspot_outbox (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.organisations (id) on delete restrict,
  contact_id      uuid not null references public.fd_contacts (id) on delete cascade,
  kind            text not null check (kind in ('contact_upsert', 'note')),
  dedupe_key      text not null check (char_length(dedupe_key) between 3 and 200),
  payload         jsonb not null default '{}'::jsonb,
  state           text not null default 'pending' check (state in ('pending', 'sending', 'sent', 'failed')),
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at      timestamptz,
  sent_at         timestamptz,
  error           text,
  created_at      timestamptz not null default now(),
  unique (contact_id, kind, dedupe_key)
);
-- At most one pending upsert per contact: a burst of changes becomes one write that reads the contact fresh.
create unique index fd_hubspot_outbox_one_pending_upsert on public.fd_hubspot_outbox (contact_id) where kind = 'contact_upsert' and state = 'pending';
create index fd_hubspot_outbox_due_idx on public.fd_hubspot_outbox (next_attempt_at) where state in ('pending', 'sending');

alter table public.fd_hubspot_outbox enable row level security;
create policy fd_hubspot_outbox_staff_select on public.fd_hubspot_outbox
  for select to authenticated using (private.is_admin() or (private.has_permission('leads.manage') and organisation_id = private.current_org_id()));
revoke all on public.fd_hubspot_outbox from anon;
revoke insert, update, delete, truncate on public.fd_hubspot_outbox from authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. Contacts keyed on email, then phone
-- ---------------------------------------------------------------------------------------------------------------------------------
create function private.fd_find_or_create_contact(p_email text, p_phone text, p_name text, p_source text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_org constant uuid := '00000000-0000-0000-0000-000000000001'; v_email text := nullif(lower(btrim(p_email)), ''); v_phone text := nullif(btrim(p_phone), '');
begin
  if v_email is not null then
    select id into v_id from public.fd_contacts where organisation_id = v_org and email = v_email;
    if v_id is null and v_phone is not null then
      -- Someone who enquired by phone alone and now gives an email is the same person: adopt the phone-only contact rather than make a second.
      select id into v_id from public.fd_contacts where organisation_id = v_org and phone = v_phone and email is null;
      if v_id is not null then
        update public.fd_contacts set email = v_email, name = coalesce(name, nullif(btrim(p_name), '')), updated_at = now() where id = v_id;
      end if;
    end if;
    if v_id is null then v_id := private.fd_ensure_contact(v_email, p_name, null, p_source); end if;
    if v_phone is not null then
      update public.fd_contacts set phone = v_phone, updated_at = now()
       where id = v_id and phone is null and not exists (select 1 from public.fd_contacts o where o.organisation_id = v_org and o.phone = v_phone);
    end if;
    return v_id;
  end if;
  select id into v_id from public.fd_contacts where organisation_id = v_org and phone = v_phone;
  if v_id is null then
    insert into public.fd_contacts (phone, name, source, lifecycle_stage) values (v_phone, nullif(btrim(p_name), ''), p_source, 'enquiry') returning id into v_id;
  else
    update public.fd_contacts set name = coalesce(name, nullif(btrim(p_name), '')), updated_at = now() where id = v_id;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. F4: capture a lead
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.service_fd_capture_lead(
  p_email text, p_phone text, p_name text, p_source text, p_message text, p_consent boolean, p_wording text, p_wording_version text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_contact uuid; v_email text := nullif(lower(btrim(p_email)), ''); v_phone text := nullif(btrim(p_phone), '');
  v_suppressed boolean; v_note text;
begin
  if p_source not in ('website_form', 'chat') then raise exception 'unknown source %', p_source; end if;
  -- No consent, no capture: nothing is stored in the front desk, nothing goes to the CRM, nothing is scheduled.
  if p_consent is not true then return jsonb_build_object('captured', false, 'reason', 'consent_required'); end if;
  if p_wording is null or btrim(p_wording) = '' or p_wording_version is null or btrim(p_wording_version) = '' then
    return jsonb_build_object('captured', false, 'reason', 'consent_wording_required');
  end if;
  if v_email is not null and not private.fd_email_ok(v_email) then v_email := null; end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then v_phone := null; end if;
  if v_email is null and v_phone is null then return jsonb_build_object('captured', false, 'reason', 'no_contact_details'); end if;

  v_contact := private.fd_find_or_create_contact(v_email, v_phone, p_name, p_source);
  select suppressed into v_suppressed from public.fd_contacts where id = v_contact;
  -- Suppression always wins: someone who unsubscribed is not re-enrolled or re-synced by submitting another form.
  if v_suppressed then return jsonb_build_object('captured', true, 'contact_id', v_contact, 'suppressed', true); end if;

  if v_email is not null then
    perform private.fd_record_consent(v_contact, 'email', 'service_followup', 'consent', p_wording_version, p_wording, p_source);
  end if;
  if p_source = 'chat' then
    perform private.fd_record_consent(v_contact, 'chat', 'chat_capture', 'consent', p_wording_version, p_wording, 'chat');
  end if;
  update public.fd_contacts set crm_sync = true, updated_at = now() where id = v_contact;

  -- CRM writes: one pending upsert (reads the contact fresh when delivered) and one note per distinct enquiry.
  insert into public.fd_hubspot_outbox (contact_id, kind, dedupe_key) values (v_contact, 'contact_upsert', 'capture:' || to_char(now(), 'YYYYMMDDHH24MISSUS'))
  on conflict do nothing;
  v_note := 'Enquiry via ' || case p_source when 'chat' then 'website chat' else 'website form' end
            || E'\nConsent given: ' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC, wording version ' || p_wording_version
            || coalesce(E'\n\nTheir message: ' || left(nullif(btrim(p_message), ''), 1000), '');
  insert into public.fd_hubspot_outbox (contact_id, kind, dedupe_key, payload)
  values (v_contact, 'note', 'note:' || md5(p_source || coalesce(p_message, '') || to_char(now(), 'YYYYMMDDHH24')), jsonb_build_object('body', v_note))
  on conflict do nothing;

  -- The post-enquiry follow-up, once per contact (it needs an email address and the live consent recorded above).
  if v_email is not null then
    perform private.fd_enrol(v_contact, 'post_enquiry', now(), 'enquiry:' || v_contact);
  end if;
  perform private.fd_audit('capture_lead', 'fd_contacts', v_contact::text, jsonb_build_object('source', p_source, 'wording_version', p_wording_version), 'system');
  return jsonb_build_object('captured', true, 'contact_id', v_contact, 'suppressed', false);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. F5: claim and finish CRM writes
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.service_fd_hubspot_claim(p_limit integer default 20)
returns table (outbox_id uuid, kind text, contact_id uuid, email text, phone text, name text, lifecycle_stage text, source text,
               hubspot_contact_id text, payload jsonb, attempts integer)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare r record;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then p_limit := 20; end if;
  if private.fd_cfg('hubspot_enabled') is distinct from 'true'::jsonb then return; end if;

  -- A contact synced earlier whose stage has moved on (they signed up, onboarded, paid) gets one fresh upsert so HubSpot's product facts stay true.
  insert into public.fd_hubspot_outbox (contact_id, kind, dedupe_key)
  select c.id, 'contact_upsert', 'stage:' || c.lifecycle_stage || ':' || to_char(now(), 'YYYYMMDDHH24MISSUS')
    from public.fd_contacts c
   where c.crm_sync and not c.suppressed and c.hubspot_contact_id is not null and c.lifecycle_stage is distinct from c.hubspot_synced_stage
  on conflict do nothing;

  update public.fd_hubspot_outbox set state = 'failed', error = 'gave up after 6 attempts'
   where state = 'sending' and claimed_at < now() - interval '15 minutes' and attempts >= 6;

  for r in
    select o.id as oid, o.kind as k, o.contact_id as cid, o.payload as pl, o.attempts as tries,
           c.email as em, c.phone as ph, c.name as nm, c.lifecycle_stage as stage, c.source as src, c.hubspot_contact_id as hid, c.suppressed as supp
      from public.fd_hubspot_outbox o join public.fd_contacts c on c.id = o.contact_id
     where ((o.state = 'pending' and o.next_attempt_at <= now()) or (o.state = 'sending' and o.claimed_at < now() - interval '15 minutes' and o.attempts < 6))
     order by (o.kind = 'note'), o.created_at
     limit p_limit
       for update of o skip locked
  loop
    -- A contact who has since been suppressed is not pushed to the CRM.
    if r.supp then
      update public.fd_hubspot_outbox set state = 'failed', error = 'contact suppressed' where id = r.oid;
      continue;
    end if;
    update public.fd_hubspot_outbox set state = 'sending', attempts = attempts + 1, claimed_at = now() where id = r.oid;
    outbox_id := r.oid; kind := r.k; contact_id := r.cid; email := r.em; phone := r.ph; name := r.nm; lifecycle_stage := r.stage; source := r.src;
    hubspot_contact_id := r.hid; payload := r.pl; attempts := r.tries + 1;
    return next;
  end loop;
end $$;

create function public.service_fd_hubspot_finish(p_outbox uuid, p_ok boolean, p_hubspot_id text, p_stage text, p_sales jsonb, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_contact uuid; v_kind text; v_attempts int;
begin
  select contact_id, kind, attempts into v_contact, v_kind, v_attempts from public.fd_hubspot_outbox where id = p_outbox and state = 'sending';
  if not found then return; end if;
  if p_ok then
    update public.fd_hubspot_outbox set state = 'sent', sent_at = now(), error = null where id = p_outbox;
    if p_hubspot_id is not null then
      update public.fd_contacts
         set hubspot_contact_id = coalesce(p_hubspot_id, hubspot_contact_id), hubspot_synced_at = now(),
             hubspot_synced_stage = case when v_kind = 'contact_upsert' then coalesce(p_stage, hubspot_synced_stage) else hubspot_synced_stage end,
             hubspot_sales = case when p_sales is not null and jsonb_typeof(p_sales) = 'object' then p_sales else hubspot_sales end
       where id = v_contact;
    end if;
  else
    -- Backoff: 2, 8, 18, 32, 50 minutes; after 6 attempts it stays failed and shows in the console.
    update public.fd_hubspot_outbox
       set state = case when v_attempts >= 6 then 'failed' else 'pending' end,
           next_attempt_at = now() + make_interval(mins => 2 * v_attempts * v_attempts),
           error = left(coalesce(p_error, 'unknown'), 300)
     where id = p_outbox;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. Console overview, grants, schedule
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.fd_crm_overview() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.fd_require_staff();
  return jsonb_build_object(
    'hubspot_enabled', private.fd_cfg('hubspot_enabled'),
    'by_state', coalesce((select jsonb_object_agg(state, n) from (select state, count(*) n from public.fd_hubspot_outbox group by state) q), '{}'::jsonb),
    'synced_contacts', (select count(*) from public.fd_contacts where hubspot_contact_id is not null),
    'sync_contacts', (select count(*) from public.fd_contacts where crm_sync),
    'last_error', (select error from public.fd_hubspot_outbox where state in ('pending', 'failed') and error is not null order by created_at desc limit 1));
end $$;

revoke all on function private.fd_find_or_create_contact(text, text, text, text) from public, anon, authenticated;
revoke all on function public.service_fd_capture_lead(text, text, text, text, text, boolean, text, text) from public, anon, authenticated;
revoke all on function public.service_fd_hubspot_claim(integer) from public, anon, authenticated;
revoke all on function public.service_fd_hubspot_finish(uuid, boolean, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.service_fd_capture_lead(text, text, text, text, text, boolean, text, text) to service_role;
grant execute on function public.service_fd_hubspot_claim(integer) to service_role;
grant execute on function public.service_fd_hubspot_finish(uuid, boolean, text, text, jsonb, text) to service_role;
revoke all on function public.fd_crm_overview() from public, anon;
grant execute on function public.fd_crm_overview() to authenticated;

-- Every 5 minutes, only when there is something due and the shared secret exists (the same fd_followup_secret as the follow-up dispatcher).
select cron.schedule(
  'fd-hubspot-sync',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/fd-hubspot-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_publishable_key'),
      'x-fd-followup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fd_followup_secret'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 55000
  ) as request_id
  where private.fd_cfg('hubspot_enabled') = 'true'::jsonb
    and exists (select 1 from vault.decrypted_secrets where name = 'fd_followup_secret')
    and (exists (select 1 from public.fd_hubspot_outbox where state in ('pending', 'sending') and next_attempt_at <= now())
         or exists (select 1 from public.fd_contacts where crm_sync and not suppressed and hubspot_contact_id is not null and lifecycle_stage is distinct from hubspot_synced_stage));
  $$
);

do $$
declare f text;
begin
  foreach f in array array['public.service_fd_capture_lead(text, text, text, text, text, boolean, text, text)', 'public.service_fd_hubspot_claim(integer)',
                           'public.service_fd_hubspot_finish(uuid, boolean, text, text, jsonb, text)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'fd M3: % is callable by a non service role', f; end if;
  end loop;
  if has_table_privilege('anon', 'public.fd_hubspot_outbox', 'SELECT') then raise exception 'fd M3: anon can read the outbox'; end if;
  if (select value from public.fd_app_config where key = 'hubspot_enabled') <> 'false'::jsonb then raise exception 'fd M3: the CRM sync must ship off'; end if;
  if not exists (select 1 from cron.job where jobname = 'fd-hubspot-sync') then raise exception 'fd M3: the sync schedule was not created'; end if;
end $$;
