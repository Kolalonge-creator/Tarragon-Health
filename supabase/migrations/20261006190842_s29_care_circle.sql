-- S29: Care Circle (spec 4.7, 8.6, safety case 21): invites, summary-level permissions, supporter view, neutral red alerts,
-- pay for a loved one.
--
-- Invariants touched: INV-07 (the red alert and every notice here is neutral: no condition, reading, name or result),
-- INV-08 (no SMS: the invite link is shared by the patient from their own phone), INV-09 (every payment is one order for one
-- item, nothing is stored), INV-10 (every supporter read is written to care_access_events), INV-13 (is_test), INV-15 (kobo,
-- unchanged), INV-16 (config is versioned).
--
-- Why a NEW table and not profile_access (the reconciliation first said "live wins"): a live scan of the policies found that
-- several read paths admit ANY profile_access grantee with no permission test at all (profiles_select, booking_requests_select,
-- vaccination_adverse_events_select, vaccination_card_extractions_select, vaccination_records and schedules updates). A Care
-- Circle member written into profile_access would have inherited every one of them, which is exactly what safety case 21 forbids.
-- care_circle_members is read by no existing policy, so a member opens nothing; the supporter reads through one function that
-- checks one permission per block. Live counts before this migration: profile_access 0 rows, care_access_requests 0 rows.
--
-- What this adds:
--   * care_circle_config (versioned, PROPOSED, mirrored as care_circle.rules in packages/shared/src/proposed-config).
--   * care_circle_invites (hash of the token and of the contact only) and care_circle_members.
--   * create / preview / accept / cancel invite, update / revoke member, my_care_circle, my_supported_people,
--     circle_supporter_view, circle_open_alerts, circle_view_log.
--   * pages_notify_circle: a trigger that sends the neutral red alert to members who hold red_alerts.
--   * create_order learns beneficiaries: a member holding pay_for_care may pay for the patient (S25 refused every beneficiary).
--   * a notice to the patient when someone pays for their care.

-- ---------------------------------------------------------------------------
-- 0. The care access log's surface vocabulary gains 'care_circle'
-- ---------------------------------------------------------------------------
-- log_care_access swallows its own errors (a warning, by design, so the log never blocks care), which means an unknown scope
-- would drop every circle audit line silently. Found by the proof, not by a user. Same pattern as 20260829223600.
alter table public.care_access_events drop constraint care_access_events_scope_known;
alter table public.care_access_events add constraint care_access_events_scope_known check (
  scope is null or scope = any (array[
    'care_receipt', 'health_summary', 'care_status', 'billing', 'refill_request', 'booking', 'messaging',
    'data_shared_lab', 'data_shared_hmo', 'data_shared_ai_vendor', 'data_shared_pharmacy', 'data_export_dsar',
    'care_circle'
  ])
);

-- ---------------------------------------------------------------------------
-- 1. Config (PROPOSED values, Founder owner)
-- ---------------------------------------------------------------------------
create table public.care_circle_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index care_circle_config_one_active on public.care_circle_config (is_active) where is_active;

create function private.care_circle_rules_valid(r jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare k text;
begin
  -- every key must be a positive whole number; a missing or odd one would make a comparison null and quietly lift a limit
  foreach k in array array['invite_ttl_hours', 'default_grant_days', 'max_invites_per_day', 'max_members', 'max_attempts', 'view_weeks',
                           'alert_visible_hours', 'expiry_notice_days', 'gift_decide_days'] loop
    if (r ->> k) is null or (r ->> k) !~ '^[0-9]{1,5}$' or (r ->> k)::integer < 1 then return false; end if;
  end loop;
  return (r ->> 'default_grant_days')::integer <= 1095 and (r ->> 'invite_ttl_hours')::integer <= 720;
exception when others then
  return false;
end;
$$;
revoke all on function private.care_circle_rules_valid(jsonb) from public, anon, authenticated;
alter table public.care_circle_config add constraint care_circle_config_rules_valid check (private.care_circle_rules_valid(rules));

-- care-circle-rules-begin
insert into public.care_circle_config (version, is_active, effective_from, rules) values (1, true, '2026-10-06', $json$
{
  "invite_ttl_hours": 72,
  "default_grant_days": 365,
  "max_invites_per_day": 5,
  "max_members": 8,
  "max_attempts": 5,
  "view_weeks": 8,
  "alert_visible_hours": 3,
  "expiry_notice_days": 7,
  "gift_decide_days": 30
}
$json$::jsonb);
-- care-circle-rules-end

alter table public.care_circle_config enable row level security;
create policy care_circle_config_read on public.care_circle_config for select to authenticated using (true);
revoke all on public.care_circle_config from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.care_circle_config from authenticated;
grant select on public.care_circle_config to authenticated;

create function private.circle_rules() returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules from public.care_circle_config where is_active $$;
revoke all on function private.circle_rules() from public, anon, authenticated;

-- 17.5: the concierge coordinator is configured and dormant until staffing allows. Nothing is built behind it.
insert into public.platform_modules (key, label, description)
values ('care_circle_concierge', 'Care Circle concierge coordinator',
        'A coordinator service for supporters who fund a parent''s care (spec 17.5). Dormant until staffing allows; no code runs behind it yet.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
create function private.circle_permissions_valid(p text[]) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(cardinality(p) between 1 and 5
         and p <@ array['adherence_summary', 'weekly_bp_trend', 'appointments', 'red_alerts', 'pay_for_care']::text[]
         and cardinality(p) = (select count(distinct x) from unnest(p) x), false)
$$;
revoke all on function private.circle_permissions_valid(text[]) from public, anon, authenticated;

create table public.care_circle_invites (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  invitee_kind    text not null check (invitee_kind in ('phone', 'email')),
  invitee_hash    text not null check (invitee_hash ~ '^[0-9a-f]{64}$'),
  invitee_hint    text not null check (char_length(invitee_hint) <= 40),
  relationship    text not null check (char_length(btrim(relationship)) between 1 and 40),
  permissions     text[] not null check (private.circle_permissions_valid(permissions)),
  grant_days      integer not null check (grant_days between 1 and 1095),
  token_hash      text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  state           text not null default 'pending' check (state in ('pending', 'accepted', 'cancelled', 'expired')),
  expires_at      timestamptz not null,
  attempts        integer not null default 0 check (attempts >= 0),
  accepted_by     uuid references public.profiles (id) on delete set null,
  accepted_at     timestamptz,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  check (state <> 'accepted' or (accepted_by is not null and accepted_at is not null))
);
create index care_circle_invites_patient_idx on public.care_circle_invites (patient_id, state);
create index care_circle_invites_hash_idx on public.care_circle_invites (invitee_hash) where state = 'pending';

create table public.care_circle_members (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  supporter_id    uuid not null references public.profiles (id) on delete cascade,
  relationship    text not null check (char_length(btrim(relationship)) between 1 and 40),
  permissions     text[] not null check (private.circle_permissions_valid(permissions)),
  state           text not null default 'active' check (state in ('active', 'revoked', 'expired')),
  expires_at      timestamptz not null,
  invite_id       uuid references public.care_circle_invites (id) on delete set null,
  revoked_at      timestamptz,
  revoked_by      uuid references public.profiles (id) on delete set null,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint care_circle_no_self check (patient_id <> supporter_id),
  check (state <> 'revoked' or revoked_at is not null)
);
create unique index care_circle_one_active_member on public.care_circle_members (patient_id, supporter_id) where state = 'active';
create index care_circle_members_supporter_idx on public.care_circle_members (supporter_id) where state = 'active';
create trigger care_circle_members_set_updated_at before update on public.care_circle_members
  for each row execute function private.set_updated_at();

-- RLS: a patient reads their own circle, a supporter reads the rows that name them. Nobody writes directly. The invite table
-- never exposes a hash column: select is granted per column.
alter table public.care_circle_invites enable row level security;
alter table public.care_circle_members enable row level security;
revoke all on public.care_circle_invites from public, anon, authenticated;
revoke all on public.care_circle_members from public, anon, authenticated;
grant select (id, organisation_id, patient_id, invitee_kind, invitee_hint, relationship, permissions, grant_days, state, expires_at,
              accepted_at, created_at)
  on public.care_circle_invites to authenticated;
grant select on public.care_circle_members to authenticated;
create policy care_circle_invites_own on public.care_circle_invites for select to authenticated
  using (patient_id = (select auth.uid()));
create policy care_circle_members_own on public.care_circle_members for select to authenticated
  using (patient_id = (select auth.uid()) or supporter_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------
-- A phone number as +E164 (a Nigerian 0 number becomes +234), an email lower-cased. Null when it is neither.
create function private.circle_normalise_contact(p_kind text, p_contact text) returns text
language plpgsql immutable set search_path = ''
as $$
declare v text;
begin
  if p_contact is null then return null; end if;
  if p_kind = 'email' then
    v := lower(btrim(p_contact));
    return case when v ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and char_length(v) <= 254 then v end;
  elsif p_kind = 'phone' then
    v := regexp_replace(p_contact, '[\s\-\(\)\.]', '', 'g');
    if v ~ '^00' then v := '+' || substr(v, 3); end if;
    if v ~ '^0[0-9]{10}$' then v := '+234' || substr(v, 2); end if;
    if v ~ '^234[0-9]{10}$' then v := '+' || v; end if;
    return case when v ~ '^\+[1-9][0-9]{7,14}$' then v end;
  end if;
  return null;
end;
$$;
revoke all on function private.circle_normalise_contact(text, text) from public, anon, authenticated;

-- A random token needs no secret: it has 256 bits of entropy, so a plain SHA-256 of it cannot be reversed.
create function private.circle_hash(p_value text) returns text
language sql immutable set search_path = ''
as $$ select encode(extensions.digest(p_value, 'sha256'), 'hex') $$;
revoke all on function private.circle_hash(text) from public, anon, authenticated;

-- A phone number or an email has little entropy (about 10^10 Nigerian mobiles), so a plain hash is reversible by anyone who can
-- read the table. The contact is therefore hashed with HMAC-SHA256 under a secret kept in Supabase Vault (encrypted with a key
-- held outside the database, so a dump of the tables alone cannot reverse it). The secret is created here, random per
-- environment, if it does not exist yet; nothing in app code ever reads it. (OQ-196, founder decision 2026-10-06.)
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'care_circle_contact_pepper') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'care_circle_contact_pepper',
                                'HMAC key for Care Circle invitee contact hashes (S29). Rotating it makes every pending invite unusable.');
  end if;
end $$;

create function private.circle_contact_hash(p_value text) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare k text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'care_circle_contact_pepper';
  -- fail closed: without the secret there is no safe way to hash a contact, so no invite is made or matched
  if k is null or k = '' then raise exception 'circle_not_configured' using errcode = 'P0001'; end if;
  return encode(extensions.hmac(p_value, k, 'sha256'), 'hex');
end;
$$;
revoke all on function private.circle_contact_hash(text) from public, anon, authenticated;

-- "+234•••••1234": enough for the patient to recognise who they invited, never the number.
create function private.circle_hint(p_kind text, p_norm text) returns text
language sql immutable set search_path = ''
as $$
  select case when p_kind = 'phone' then left(p_norm, 4) || repeat('•', greatest(char_length(p_norm) - 8, 1)) || right(p_norm, 4)
              else left(split_part(p_norm, '@', 1), 1) || '•••@' || split_part(p_norm, '@', 2) end
$$;
revoke all on function private.circle_hint(text, text) from public, anon, authenticated;

-- Does the signed-in account own the contact the invite was made for? Only a VERIFIED email or phone counts.
create function private.circle_caller_owns_contact(p_kind text, p_hash text) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare u record; n text;
begin
  select email, email_confirmed_at, phone, phone_confirmed_at into u from auth.users where id = (select auth.uid());
  if not found then return false; end if;
  if p_kind = 'email' then
    if u.email is null or u.email_confirmed_at is null then return false; end if;
    n := private.circle_normalise_contact('email', u.email);
  else
    if u.phone is null or u.phone_confirmed_at is null then return false; end if;
    n := private.circle_normalise_contact('phone', case when left(u.phone, 1) = '+' then u.phone else '+' || u.phone end);
  end if;
  return n is not null and private.circle_contact_hash(n) = p_hash;
end;
$$;
revoke all on function private.circle_caller_owns_contact(text, text) from public, anon, authenticated;

-- The one gate every supporter read, alert and purchase goes through. Expiry is checked here, so an expired member is a
-- revoked member everywhere without waiting for the cron to mark the row.
create function private.circle_member_for(p_patient uuid, p_permission text default null) returns public.care_circle_members
language sql stable security definer set search_path = ''
as $$
  select m.* from public.care_circle_members m
    join public.profiles s on s.id = m.supporter_id and s.is_active
   where m.patient_id = p_patient and m.supporter_id = (select auth.uid())
     and m.state = 'active' and m.expires_at > now()
     and (p_permission is null or p_permission = any (m.permissions))
   limit 1
$$;
revoke all on function private.circle_member_for(uuid, text) from public, anon, authenticated;

create function private.circle_notify(p_recipient uuid, p_org uuid, p_template text, p_source_table text, p_source uuid,
                                      p_channels text[], p_priority text, p_test boolean) returns void
language plpgsql security definer set search_path = ''
as $$
declare c text;
begin
  foreach c in array p_channels loop
    if not exists (select 1 from public.notifications n where n.recipient_id = p_recipient and n.template = p_template
                      and n.channel = c::public.notification_channel and n.source_table = p_source_table and n.source_id = p_source) then
      insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
      values (p_recipient, p_org, c::public.notification_channel, p_template, '{}'::jsonb, 'pending', 'non_clinical', p_priority::public.notification_priority, p_source_table, p_source);
    end if;
  end loop;
end;
$$;
revoke all on function private.circle_notify(uuid, uuid, text, text, uuid, text[], text, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Invites
-- ---------------------------------------------------------------------------
-- The patient makes an invite. The token is returned once and never stored: only its SHA-256 is. The link is shared by the
-- patient from their own phone (INV-08: the platform sends no SMS and WhatsApp is gone).
create function public.create_care_circle_invite(p_kind text, p_contact text, p_relationship text, p_permissions text[], p_grant_days integer default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  pr public.profiles%rowtype;
  cfg jsonb := private.circle_rules();
  v_norm text;
  v_hash text;
  v_token text;
  v_days integer;
  v_expires timestamptz;
  v_id uuid;
begin
  if v_uid is null then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  select * into pr from public.profiles where id = v_uid and role = 'patient' and is_active
     and receives_care and not coalesce(is_dependent_account, false);
  if not found then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  if p_kind not in ('phone', 'email') then raise exception 'invite_contact_invalid' using errcode = '22023'; end if;
  v_norm := private.circle_normalise_contact(p_kind, p_contact);
  if v_norm is null then raise exception 'invite_contact_invalid' using errcode = '22023'; end if;
  if not private.circle_permissions_valid(p_permissions) then raise exception 'invite_permissions_invalid' using errcode = '22023'; end if;
  if p_relationship is null or char_length(btrim(p_relationship)) not between 1 and 40 then raise exception 'invite_relationship_invalid' using errcode = '22023'; end if;
  v_days := coalesce(p_grant_days, (cfg ->> 'default_grant_days')::integer);
  if v_days < 1 or v_days > 1095 then raise exception 'invite_days_invalid' using errcode = '22023'; end if;
  v_hash := private.circle_contact_hash(v_norm);

  -- an invite to yourself is never meaningful
  if private.circle_caller_owns_contact(p_kind, v_hash) then raise exception 'invite_self' using errcode = 'P0001'; end if;

  -- per patient, counting cancelled and expired ones, so cancelling does not free a slot
  if (select count(*) from public.care_circle_invites where patient_id = v_uid and created_at > now() - interval '24 hours')
       >= (cfg ->> 'max_invites_per_day')::integer then
    raise exception 'invite_rate_limited' using errcode = 'P0001';
  end if;
  if (select count(*) from public.care_circle_members where patient_id = v_uid and state = 'active' and expires_at > now())
     + (select count(*) from public.care_circle_invites where patient_id = v_uid and state = 'pending' and expires_at > now() and invitee_hash <> v_hash)
       >= (cfg ->> 'max_members')::integer
     -- re-sending to someone already waiting replaces their invite, so it never adds a place
     and not exists (select 1 from public.care_circle_invites where patient_id = v_uid and state = 'pending' and expires_at > now() and invitee_hash = v_hash) then
    raise exception 'circle_full' using errcode = 'P0001';
  end if;

  -- a new link for the same person replaces the old one
  update public.care_circle_invites set state = 'cancelled'
   where patient_id = v_uid and invitee_hash = v_hash and state = 'pending';

  v_token := replace(replace(encode(extensions.gen_random_bytes(32), 'base64'), '+', '-'), '/', '_');
  v_token := replace(v_token, '=', '');
  v_expires := now() + make_interval(hours => (cfg ->> 'invite_ttl_hours')::integer);

  insert into public.care_circle_invites (organisation_id, patient_id, invitee_kind, invitee_hash, invitee_hint, relationship, permissions,
                                          grant_days, token_hash, expires_at, is_test)
  values (pr.organisation_id, v_uid, p_kind, v_hash, private.circle_hint(p_kind, v_norm), btrim(p_relationship), p_permissions,
          v_days, private.circle_hash(v_token), v_expires, coalesce(pr.is_test, false))
  returning id into v_id;

  return jsonb_build_object('invite_id', v_id, 'token', v_token, 'expires_at', v_expires, 'grant_days', v_days);
end $$;

-- Looks up a pending invite for the signed-in account. Every failure (no such token, used, expired, wrong account, too many
-- wrong tries, the patient themselves) returns the same {ok: false}, so a stranger learns nothing about who has an invite. A wrong
-- account counts an attempt; that is why a failure RETURNS and never raises (a raise would roll the count back).
create function private.circle_invite_for_caller(p_token text, p_count_attempt boolean) returns public.care_circle_invites
language plpgsql security definer set search_path = ''
as $$
declare
  i public.care_circle_invites%rowtype;
  v_uid uuid := (select auth.uid());
  cfg jsonb := private.circle_rules();
  me public.profiles%rowtype;
begin
  if v_uid is null or p_token is null or char_length(p_token) not between 20 and 128 then return null; end if;
  select * into i from public.care_circle_invites where token_hash = private.circle_hash(p_token) for update;
  if not found or i.state <> 'pending' or i.expires_at <= now() or i.attempts >= (cfg ->> 'max_attempts')::integer then return null; end if;
  select * into me from public.profiles where id = v_uid and role = 'patient' and is_active and organisation_id = i.organisation_id;
  if not found or v_uid = i.patient_id or me.is_test is distinct from i.is_test then return null; end if;
  if not private.circle_caller_owns_contact(i.invitee_kind, i.invitee_hash) then
    if p_count_attempt then update public.care_circle_invites set attempts = attempts + 1 where id = i.id; end if;
    return null;
  end if;
  return i;
end $$;
revoke all on function private.circle_invite_for_caller(text, boolean) from public, anon, authenticated;

create function public.preview_care_circle_invite(p_token text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare i public.care_circle_invites%rowtype; v_name text;
begin
  i := private.circle_invite_for_caller(p_token, true);
  if i.id is null then return jsonb_build_object('ok', false); end if;
  select split_part(btrim(full_name), ' ', 1) into v_name from public.profiles where id = i.patient_id;
  return jsonb_build_object('ok', true, 'inviter_first_name', coalesce(nullif(v_name, ''), 'Someone'), 'relationship', i.relationship,
                            'permissions', to_jsonb(i.permissions), 'grant_days', i.grant_days, 'expires_at', i.expires_at);
end $$;

create function public.accept_care_circle_invite(p_token text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  i public.care_circle_invites%rowtype;
  v_uid uuid := (select auth.uid());
  cfg jsonb := private.circle_rules();
  m public.care_circle_members%rowtype;
  v_until timestamptz;
begin
  i := private.circle_invite_for_caller(p_token, true);
  if i.id is null then return jsonb_build_object('ok', false); end if;
  -- the cap limits NEW members; someone already in the circle may take a changed invite even when it is full
  if not exists (select 1 from public.care_circle_members where patient_id = i.patient_id and supporter_id = v_uid and state = 'active')
     and (select count(*) from public.care_circle_members where patient_id = i.patient_id and state = 'active' and expires_at > now())
       >= (cfg ->> 'max_members')::integer then
    return jsonb_build_object('ok', false);
  end if;
  v_until := now() + make_interval(days => i.grant_days);

  -- one atomic statement: someone already in the circle is updated, never doubled, and two invites accepted at once cannot collide
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at, invite_id, is_test)
  values (i.organisation_id, i.patient_id, v_uid, i.relationship, i.permissions, v_until, i.id, i.is_test)
  on conflict (patient_id, supporter_id) where state = 'active'
  do update set relationship = excluded.relationship, permissions = excluded.permissions, expires_at = excluded.expires_at, invite_id = excluded.invite_id
  returning * into m;

  update public.care_circle_invites set state = 'accepted', accepted_by = v_uid, accepted_at = now() where id = i.id;
  perform private.log_care_access(i.patient_id, 'granted', 'care_circle', jsonb_build_object('permissions', to_jsonb(i.permissions)), v_uid);
  perform private.circle_notify(i.patient_id, i.organisation_id, 'circle_joined', 'care_circle_members', m.id, array['in_app'], 'routine', i.is_test);
  return jsonb_build_object('ok', true, 'patient_id', i.patient_id, 'member_id', m.id);
end $$;

create function public.cancel_care_circle_invite(p_invite uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  update public.care_circle_invites set state = 'cancelled'
   where id = p_invite and patient_id = (select auth.uid()) and state = 'pending';
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Members: change, revoke, lists
-- ---------------------------------------------------------------------------
create function public.update_care_circle_member(p_member uuid, p_permissions text[], p_expires_at timestamptz default null) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); m public.care_circle_members%rowtype;
begin
  if not private.circle_permissions_valid(p_permissions) then raise exception 'invite_permissions_invalid' using errcode = '22023'; end if;
  if p_expires_at is not null and (p_expires_at <= now() or p_expires_at > now() + interval '1095 days') then
    raise exception 'invite_days_invalid' using errcode = '22023';
  end if;
  update public.care_circle_members
     set permissions = p_permissions, expires_at = coalesce(p_expires_at, expires_at)
   where id = p_member and patient_id = v_uid and state = 'active' and expires_at > now()
   returning * into m;
  if m.id is null then return false; end if;
  perform private.log_care_access(m.patient_id, 'permission_changed', 'care_circle', jsonb_build_object('permissions', to_jsonb(p_permissions), 'by_patient', true), m.supporter_id);
  return true;
end $$;

-- The patient removes a member, or the member leaves. Takes effect on the next call from the supporter: every gate reads state.
create function public.revoke_care_circle_member(p_member uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); m public.care_circle_members%rowtype;
begin
  update public.care_circle_members set state = 'revoked', revoked_at = now(), revoked_by = v_uid
   where id = p_member and state = 'active' and (patient_id = v_uid or supporter_id = v_uid)
   returning * into m;
  if m.id is null then return false; end if;
  perform private.log_care_access(m.patient_id, 'revoked', 'care_circle', jsonb_build_object('by_patient', v_uid = m.patient_id), m.supporter_id);
  -- Only the patient is told, and only when a supporter LEAVES. A supporter the patient removes is told nothing: a "you were removed"
  -- message can cause conflict or coercion at home (research S29), and their next look simply says the page is not available.
  if v_uid = m.supporter_id then
    perform private.circle_notify(m.patient_id, m.organisation_id, 'circle_left', 'care_circle_members', m.id, array['in_app'], 'routine', m.is_test);
  end if;
  return true;
end $$;

create function public.my_care_circle() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_build_object('member_id', m.id, 'name', coalesce(nullif(btrim(s.full_name), ''), 'A supporter'),
                'relationship', m.relationship, 'permissions', to_jsonb(m.permissions), 'expires_at', m.expires_at, 'since', m.created_at)
                order by m.created_at)
              from public.care_circle_members m join public.profiles s on s.id = m.supporter_id
             where m.patient_id = (select auth.uid()) and m.state = 'active' and m.expires_at > now()), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(jsonb_build_object('invite_id', i.id, 'hint', i.invitee_hint, 'kind', i.invitee_kind,
                'relationship', i.relationship, 'permissions', to_jsonb(i.permissions), 'expires_at', i.expires_at) order by i.created_at)
              from public.care_circle_invites i
             where i.patient_id = (select auth.uid()) and i.state = 'pending' and i.expires_at > now()), '[]'::jsonb))
$$;

create function public.my_supported_people() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('patient_id', m.patient_id, 'member_id', m.id,
              'name', coalesce(nullif(btrim(p.full_name), ''), 'Someone'), 'relationship', m.relationship,
              'permissions', to_jsonb(m.permissions), 'expires_at', m.expires_at) order by p.full_name), '[]'::jsonb)
    from public.care_circle_members m join public.profiles p on p.id = m.patient_id and p.is_active
   where m.supporter_id = (select auth.uid()) and m.state = 'active' and m.expires_at > now()
$$;

-- Who looked, and when: the patient's own view of their circle's activity (one line per supporter per hour, by log_care_access).
create function public.circle_view_log(p_limit integer default 30) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('viewer', coalesce(nullif(btrim(s.full_name), ''), 'A supporter'), 'at', e.occurred_at) order by e.occurred_at desc), '[]'::jsonb)
    from (select * from public.care_access_events
           where patient_id = (select auth.uid()) and kind = 'record_viewed' and scope = 'care_circle'
           order by occurred_at desc limit least(greatest(p_limit, 1), 100)) e
    join public.profiles s on s.id = e.actor_profile_id
$$;

-- ---------------------------------------------------------------------------
-- 6. The supporter view: one block per permission, nothing else
-- ---------------------------------------------------------------------------
create function public.circle_supporter_view(p_patient uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  m public.care_circle_members%rowtype;
  v_weeks integer := (private.circle_rules() ->> 'view_weeks')::integer;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  out jsonb;
  v_taken integer; v_due integer;
  v_bp jsonb; v_dir text; v_a numeric; v_b numeric;
  v_next timestamptz; v_missed integer;
  v_name text;
begin
  m := private.circle_member_for(p_patient);
  if m.id is null then raise exception 'circle_not_found' using errcode = 'P0002'; end if;
  select coalesce(nullif(btrim(full_name), ''), 'Someone') into v_name from public.profiles where id = p_patient;
  out := jsonb_build_object('patient_id', p_patient, 'name', v_name, 'relationship', m.relationship,
                            'permissions', to_jsonb(m.permissions), 'shared_until', m.expires_at);

  if 'adherence_summary' = any (m.permissions) then
    select count(*) filter (where status in ('taken', 'delayed')), count(*) filter (where status in ('taken', 'delayed', 'missed', 'skipped'))
      into v_taken, v_due
      from public.medication_logs
     where patient_id = p_patient and scheduled_for_date between v_today - 6 and v_today;
    out := out || jsonb_build_object('adherence', jsonb_build_object('days', 7, 'taken', v_taken, 'due', v_due,
              'percent', case when v_due > 0 then round(100.0 * v_taken / v_due)::integer end));
  end if;

  if 'weekly_bp_trend' = any (m.permissions) then
    -- weekly averages only: no single reading, no time of day, no symptom, no note
    select coalesce(jsonb_agg(jsonb_build_object('week_start', w.wk, 'systolic', w.sys, 'diastolic', w.dia, 'readings', w.n) order by w.wk), '[]'::jsonb)
      into v_bp
      from (select (date_trunc('week', taken_at at time zone 'Africa/Lagos'))::date wk, round(avg(systolic))::integer sys,
                   round(avg(diastolic))::integer dia, count(*)::integer n
              from public.vitals_readings
             where patient_id = p_patient and vital_type = 'blood_pressure' and systolic is not null and diastolic is not null
               and coalesce(validation_status::text, '') <> 'rejected'
               and taken_at >= (v_today - (v_weeks * 7))::timestamp at time zone 'Africa/Lagos'
             group by 1) w;
    -- direction: the latest week against the one before it, only when both exist
    select (v_bp -> -1 ->> 'systolic')::numeric, (v_bp -> -2 ->> 'systolic')::numeric into v_a, v_b;
    v_dir := case when jsonb_array_length(v_bp) < 2 then null
                  when v_a - v_b >= 5 then 'higher' when v_a - v_b <= -5 then 'lower' else 'steady' end;
    out := out || jsonb_build_object('bp_trend', jsonb_build_object('weeks', v_bp, 'direction', v_dir));
  end if;

  if 'appointments' = any (m.permissions) then
    select min(scheduled_for) filter (where status in ('scheduled', 'booked', 'confirmed') and scheduled_for > now()),
           count(*) filter (where status = 'no_show' and scheduled_for > now() - interval '30 days')
      into v_next, v_missed
      from public.appointments where patient_id = p_patient;
    out := out || jsonb_build_object('appointments', jsonb_build_object('next_at', v_next, 'missed_30d', v_missed));
  end if;

  if 'pay_for_care' = any (m.permissions) then
    out := out || jsonb_build_object('can_pay', true);
  end if;

  perform private.log_care_access(p_patient, 'record_viewed', 'care_circle', jsonb_build_object('blocks', to_jsonb(m.permissions)), m.supporter_id);
  return out;
end $$;

-- What a supporter holding red_alerts sees when the alert arrives: a name and a request to call. No grade, no reading, no cause.
create function public.circle_open_alerts() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('patient_id', m.patient_id, 'name', coalesce(nullif(btrim(p.full_name), ''), 'Someone'),
              'since', pg.sent_at) order by pg.sent_at desc), '[]'::jsonb)
    from public.care_circle_members m
    join public.profiles p on p.id = m.patient_id
    join public.pages pg on pg.patient_id = m.patient_id and pg.parent_page_id is null and pg.closed_at is null
                        and pg.sent_at > now() - make_interval(hours => (private.circle_rules() ->> 'alert_visible_hours')::integer)
   where m.supporter_id = (select auth.uid()) and m.state = 'active' and m.expires_at > now() and 'red_alerts' = any (m.permissions)
$$;

-- ---------------------------------------------------------------------------
-- 7. Neutral red alert (INV-07): a root page tells the members who hold red_alerts, nothing else
-- ---------------------------------------------------------------------------
create function private.notify_circle_red_alert() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  if new.parent_page_id is not null then return new; end if;
  begin
    for r in
      select m.supporter_id from public.care_circle_members m join public.profiles s on s.id = m.supporter_id and s.is_active
       where m.patient_id = new.patient_id and m.state = 'active' and m.expires_at > now() and 'red_alerts' = any (m.permissions)
         and s.is_test = new.is_test
    loop
      -- each family member in their own sub-block: one bad recipient must not take everyone else's alert down with it
      begin
        perform private.circle_notify(r.supporter_id, new.organisation_id, 'circle_check_in', 'pages', new.id, array['in_app', 'push'], 'critical', new.is_test);
      exception when others then
        begin
          perform private.page_incident(new.organisation_id, 'circle_alert_failed:' || new.id || ':' || r.supporter_id, 'A Care Circle alert could not be sent',
            'The red event page ' || new.id || ' was created, but telling one member of the patient''s Care Circle failed: ' || sqlerrm);
        exception when others then
          raise warning 'circle alert and its incident both failed for page %: %', new.id, sqlerrm;
        end;
      end;
    end loop;
  exception when others then
    -- never let a family notice stop the page, and never fail quietly either
    begin
      perform private.page_incident(new.organisation_id, 'circle_alert_failed:' || new.id, 'A Care Circle alert could not be sent',
        'The red event page ' || new.id || ' was created, but telling the patient''s Care Circle failed: ' || sqlerrm);
    exception when others then
      raise warning 'circle alert and its incident both failed for page %: %', new.id, sqlerrm;
    end;
  end;
  return new;
end $$;
revoke all on function private.notify_circle_red_alert() from public, anon, authenticated;
create trigger pages_notify_circle after insert on public.pages
  for each row execute function private.notify_circle_red_alert();

-- ---------------------------------------------------------------------------
-- 8. Pay for a loved one
-- ---------------------------------------------------------------------------
create function private.circle_can_pay_for(p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select (private.circle_member_for(p_patient, 'pay_for_care')).id is not null $$;
revoke all on function private.circle_can_pay_for(uuid) from public, anon, authenticated;

-- S25's create_order, with one change: a beneficiary other than the buyer is allowed when the buyer holds an unexpired
-- pay_for_care membership of that patient's circle. Membership and lead capacity are checked on the BENEFICIARY. Paying opens no
-- record access (nothing here touches care_circle_members), and the money is one order for one item (INV-09).
create or replace function public.create_order(p_code text, p_client_key uuid default null, p_beneficiary uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ben uuid;
  pr public.profiles%rowtype;
  bp public.profiles%rowtype;
  it public.catalog_items%rowtype;
  px public.prices%rowtype;
  o public.orders%rowtype;
begin
  if v_uid is null then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  select * into pr from public.profiles where id = v_uid and role = 'patient' and is_active;
  if not found then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  v_ben := coalesce(p_beneficiary, v_uid);
  -- a supporter-only account has no care here, so there is nothing for it to buy for itself (it may still pay for a loved one)
  if v_ben = v_uid and not pr.receives_care then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  if v_ben <> v_uid then
    select * into bp from public.profiles where id = v_ben and role = 'patient' and is_active;
    if not found or bp.organisation_id is distinct from pr.organisation_id or bp.is_test is distinct from pr.is_test
       or not private.circle_can_pay_for(v_ben) then
      raise exception 'order_beneficiary_not_allowed' using errcode = '42501';
    end if;
  end if;

  -- a retry of the same tap returns the first order
  if p_client_key is not null then
    select * into o from public.orders where buyer_profile_id = v_uid and client_key = p_client_key;
    if found then
      return jsonb_build_object('order_id', o.id, 'reference', o.paystack_reference, 'amount_kobo', o.amount_kobo, 'state', o.state, 'checkout_url', o.checkout_url, 'replay', true);
    end if;
  end if;

  if not coalesce((select is_enabled from public.platform_modules where key = 'v5_checkout'), false) then
    raise exception 'checkout_not_open' using errcode = 'P0001';
  end if;
  select * into it from public.catalog_items where organisation_id = pr.organisation_id and code = p_code;
  if not found or not it.active then raise exception 'item_not_available' using errcode = 'P0001'; end if;
  px := private.current_price(it.id);
  if px.id is null then raise exception 'item_not_available' using errcode = 'P0001'; end if;

  if it.kind = 'membership' and exists (
       select 1 from public.patient_memberships m where m.patient_id = v_ben and m.state = 'active' and (m.ends_at is null or m.ends_at > now())) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;
  if it.grants_lead and not exists (select 1 from private.lead_candidates(v_ben, '{}', true)) then
    raise exception 'no_capacity' using errcode = 'P0001';
  end if;
  if (select count(*) from public.orders where buyer_profile_id = v_uid and state = 'created' and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'too_many_open_orders' using errcode = 'P0001';
  end if;

  insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, components,
                             paystack_reference, client_key, is_test)
  values (pr.organisation_id, v_uid, v_ben, it.id, px.id, px.amount_kobo, px.components,
          'tho_' || replace(gen_random_uuid()::text, '-', ''), p_client_key, coalesce(pr.is_test, false))
  on conflict (buyer_profile_id, client_key) where client_key is not null do nothing
  returning * into o;
  if o.id is null then
    -- a second tap of the same key raced the first: return the first order
    select * into o from public.orders where buyer_profile_id = v_uid and client_key = p_client_key;
    return jsonb_build_object('order_id', o.id, 'reference', o.paystack_reference, 'amount_kobo', o.amount_kobo, 'state', o.state, 'checkout_url', o.checkout_url, 'replay', true);
  end if;
  return jsonb_build_object('order_id', o.id, 'reference', o.paystack_reference, 'amount_kobo', o.amount_kobo, 'state', o.state, 'checkout_url', null, 'replay', false);
end $$;

-- The patient is told, in plain words with no item, price or payer, when someone else's payment lands. Once per order.
create function private.notify_paid_for_you() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.state = 'paid' and old.state is distinct from 'paid' and new.buyer_profile_id <> new.beneficiary_patient_id then
    perform private.circle_notify(new.beneficiary_patient_id, new.organisation_id, 'circle_paid_for_you', 'orders', new.id, array['in_app'], 'routine', new.is_test);
  end if;
  return new;
end $$;
revoke all on function private.notify_paid_for_you() from public, anon, authenticated;
create trigger orders_notify_paid_for_you after update of state on public.orders
  for each row execute function private.notify_paid_for_you();

-- ---------------------------------------------------------------------------
-- 9. Expiry sweep (hourly): the gates already ignore an expired row, this makes the record say so
-- ---------------------------------------------------------------------------
create function private.expire_care_circle() returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; n integer := 0;
begin
  update public.care_circle_invites set state = 'expired' where state = 'pending' and expires_at <= now();
  -- a member whose access ends soon: tell the PATIENT once (the supporter is told nothing), so a safety alert does not stop in silence
  for r in select m.id, m.patient_id, m.organisation_id, m.is_test from public.care_circle_members m
            where m.state = 'active' and m.expires_at > now()
              and m.expires_at <= now() + make_interval(days => (private.circle_rules() ->> 'expiry_notice_days')::integer) loop
    perform private.circle_notify(r.patient_id, r.organisation_id, 'circle_expiring', 'care_circle_members', r.id, array['in_app'], 'routine', r.is_test);
  end loop;
  for r in update public.care_circle_members set state = 'expired' where state = 'active' and expires_at <= now()
           returning patient_id, supporter_id loop
    perform private.log_care_access(r.patient_id, 'expired', 'care_circle', '{}'::jsonb, r.supporter_id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.expire_care_circle() from public, anon, authenticated;
select cron.schedule('care-circle-expiry', '17 * * * *', $$ select private.expire_care_circle(); $$);

-- ---------------------------------------------------------------------------
-- 10. Grants (anon has execute through PUBLIC, so it is revoked from public, then checked below)
-- ---------------------------------------------------------------------------
revoke all on function public.create_care_circle_invite(text, text, text, text[], integer) from public, anon;
revoke all on function public.preview_care_circle_invite(text) from public, anon;
revoke all on function public.accept_care_circle_invite(text) from public, anon;
revoke all on function public.cancel_care_circle_invite(uuid) from public, anon;
revoke all on function public.update_care_circle_member(uuid, text[], timestamptz) from public, anon;
revoke all on function public.revoke_care_circle_member(uuid) from public, anon;
revoke all on function public.my_care_circle() from public, anon;
revoke all on function public.my_supported_people() from public, anon;
revoke all on function public.circle_view_log(integer) from public, anon;
revoke all on function public.circle_supporter_view(uuid) from public, anon;
revoke all on function public.circle_open_alerts() from public, anon;
revoke all on function public.create_order(text, uuid, uuid) from public, anon;
grant execute on function public.create_care_circle_invite(text, text, text, text[], integer) to authenticated;
grant execute on function public.preview_care_circle_invite(text) to authenticated;
grant execute on function public.accept_care_circle_invite(text) to authenticated;
grant execute on function public.cancel_care_circle_invite(uuid) to authenticated;
grant execute on function public.update_care_circle_member(uuid, text[], timestamptz) to authenticated;
grant execute on function public.revoke_care_circle_member(uuid) to authenticated;
grant execute on function public.my_care_circle() to authenticated;
grant execute on function public.my_supported_people() to authenticated;
grant execute on function public.circle_view_log(integer) to authenticated;
grant execute on function public.circle_supporter_view(uuid) to authenticated;
grant execute on function public.circle_open_alerts() to authenticated;
grant execute on function public.create_order(text, uuid, uuid) to authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.create_care_circle_invite(text, text, text, text[], integer)', 'public.preview_care_circle_invite(text)',
    'public.accept_care_circle_invite(text)', 'public.cancel_care_circle_invite(uuid)',
    'public.update_care_circle_member(uuid, text[], timestamptz)', 'public.revoke_care_circle_member(uuid)',
    'public.my_care_circle()', 'public.my_supported_people()', 'public.circle_view_log(integer)',
    'public.circle_supporter_view(uuid)', 'public.circle_open_alerts()', 'public.create_order(text, uuid, uuid)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon can execute %', f; end if;
    if not has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'authenticated cannot execute %', f; end if;
  end loop;
  if has_table_privilege('anon', 'public.care_circle_members', 'SELECT') or has_table_privilege('anon', 'public.care_circle_invites', 'SELECT') then
    raise exception 'anon can read the circle tables';
  end if;
  if has_column_privilege('authenticated', 'public.care_circle_invites', 'token_hash', 'SELECT')
     or has_column_privilege('authenticated', 'public.care_circle_invites', 'invitee_hash', 'SELECT') then
    raise exception 'a hash column is readable';
  end if;
end $$;
