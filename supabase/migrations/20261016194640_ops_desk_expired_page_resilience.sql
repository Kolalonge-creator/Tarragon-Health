-- Ops-desk resilience for an expired red page (CMO decision S16-S20-10, OQ-441).
--
-- When a red event page runs through every alert and nobody acknowledges it, the in-console alarm and the sev1 incident
-- "Phone the on-call clinician now" (page_expired:<id>, S19c) are the last line. Decision 10 says a NAMED ops person then phones
-- the on-call clinician and the chief medical officer. This migration gives that person a place in the data:
--
--   1. A roster: named primary and deputy ops contacts per organisation (profile ids), hours in Africa/Lagos, an active flag.
--      The phone number is NEVER stored here: it is read from the person's own profile and counts only when the sign-in
--      system has confirmed it (auth.users.phone_confirmed_at) and it matches the profile. A contact cannot be made active
--      without a confirmed real number, a window of hours and an administrator account (the same idea as
--      lab_providers_active_needs_real_contacts: no placeholder is ever live).
--   2. Assignment: a trigger on ops_incidents. When page_expired:* or page_nobody_reachable:* opens, the primary who is on duty
--      is assigned (owner_id set, an on_call_ops_desk notice by push, in-app and email, NEVER sms or voice: INV-08, D-12, the
--      human makes the call). If the primary has not acknowledged after deputy_after_seconds the deputy is assigned. If nobody is
--      on duty, a sev1 "no named ops person" incident is opened. A once-a-minute sweep also raises a sev1 when a real rota exists
--      and no ops contact is on duty for the current hour.
--   3. ops_desk_call_log: append-only. Who phoned whom, when, and the outcome. No patient identifiers (the call sheet shows
--      clinicians only; page text stays neutral, INV-07).
--   4. ops_desk_checklist_*: backup power, a second internet link, tested contact numbers and deputy cover, each an attestation
--      by a named person with a date and an evidence note. The system never fabricates that power or a link exists. Gating
--      is OFF: ops_desk_config v1 has checklist_gates_readiness = 0; v2 (inactive, unsigned) turns it on and then the
--      on_call_cover_ok go-live guard cannot be switched on until the checklist is in place.
--
-- Nothing here signs, activates or names a person. No contact, no attestation and no phone number is seeded.
-- Functions replaced from their live definitions: none (every function here is new; the only existing objects touched are
-- a new trigger on ops_incidents and a new trigger on go_live_guards). Rows affected on apply: 0.

-- ---------------------------------------------------------------------------
-- 1. Config (CMO owned, versioned, v1 gates nothing)
-- ---------------------------------------------------------------------------
create table public.ops_desk_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  approved_at    timestamptz,
  approved_by    uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now()
);
create unique index ops_desk_config_one_active on public.ops_desk_config (is_active) where is_active;
create index ops_desk_config_approved_by_idx on public.ops_desk_config (approved_by) where approved_by is not null;

create function private.ops_desk_rules_valid(r jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare k text;
begin
  foreach k in array array['deputy_after_seconds', 'checklist_max_age_days', 'call_note_max_chars'] loop
    if not coalesce((r ->> k) ~ '^[0-9]+$' and (r ->> k)::integer > 0, false) then return false; end if;
  end loop;
  foreach k in array array['uncovered_roster_alarm', 'checklist_gates_readiness'] loop
    if not coalesce((r ->> k) in ('0', '1'), false) then return false; end if;
  end loop;
  return (r ->> 'deputy_after_seconds')::integer between 60 and 3600 and (r ->> 'call_note_max_chars')::integer <= 2000;
exception when others then
  return false;
end;
$$;
revoke all on function private.ops_desk_rules_valid(jsonb) from public, anon, authenticated;
alter table public.ops_desk_config add constraint ops_desk_config_rules_valid check (private.ops_desk_rules_valid(rules));

-- ops-desk-rules-begin
-- PROPOSED (owner CMO). checklist_gates_readiness = 0: the checklist is recorded and shown, and gates nothing.
insert into public.ops_desk_config (version, is_active, effective_from, rules) values (1, true, '2026-10-16', $json$
{
  "deputy_after_seconds": 300,
  "uncovered_roster_alarm": 1,
  "checklist_gates_readiness": 0,
  "checklist_max_age_days": 90,
  "call_note_max_chars": 500
}
$json$::jsonb);
-- ops-desk-rules-end

-- ops-desk-rules-v2-begin
-- Inactive and unsigned. Same rules with the checklist gate ON. The CMO signs it in the sign-off hub.
insert into public.ops_desk_config (version, is_active, effective_from, rules) values (2, false, '2026-10-16', $json$
{
  "deputy_after_seconds": 300,
  "uncovered_roster_alarm": 1,
  "checklist_gates_readiness": 1,
  "checklist_max_age_days": 90,
  "call_note_max_chars": 500
}
$json$::jsonb);
-- ops-desk-rules-v2-end

alter table public.ops_desk_config enable row level security;
create policy ops_desk_config_read on public.ops_desk_config for select to authenticated using (true);
revoke all on public.ops_desk_config from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.ops_desk_config from authenticated;
grant select on public.ops_desk_config to authenticated;

create function private.ops_desk_config_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_active or old.approved_at is not null then
      raise exception 'ops_desk_config version % is active or signed and cannot be deleted; draft a new version', old.version using errcode = '23514';
    end if;
    return old;
  end if;
  if (new.version is distinct from old.version or new.rules is distinct from old.rules or new.effective_from is distinct from old.effective_from)
     and (old.is_active or old.approved_at is not null) then
    raise exception 'ops_desk_config version % is active or signed and cannot be edited; draft a new version', old.version using errcode = '23514';
  end if;
  if old.approved_at is not null and (new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by) then
    raise exception 'a signed ops_desk_config keeps its signature' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.ops_desk_config_guard() from public, anon, authenticated;
create trigger ops_desk_config_guard before update or delete on public.ops_desk_config
  for each row execute function private.ops_desk_config_guard();
create trigger refuse_superseded_activation before update of is_active on public.ops_desk_config
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();

create function private.ops_desk_rule(p_key text) returns integer
language sql stable security definer set search_path = ''
as $$ select (rules ->> p_key)::integer from public.ops_desk_config where is_active order by version desc limit 1 $$;
revoke all on function private.ops_desk_rule(text) from public, anon, authenticated;

-- The CMO's own act, from the sign-off hub. Nothing else calls it.
create function public.sign_ops_desk_config(p_version integer) returns void
language plpgsql security definer set search_path = ''
as $$
declare c public.ops_desk_config%rowtype;
begin
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can sign the ops desk configuration' using errcode = '42501'; end if;
  select * into c from public.ops_desk_config where version = p_version for update;
  if not found then raise exception 'no such ops desk configuration version' using errcode = 'P0002'; end if;
  if c.approved_at is not null then raise exception 'that version is already signed' using errcode = '23514'; end if;
  update public.ops_desk_config set is_active = false where is_active and version <> p_version;
  update public.ops_desk_config set approved_at = now(), approved_by = (select auth.uid()), is_active = true where version = p_version;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values ((select organisation_id from public.profiles where id = (select auth.uid())), (select auth.uid()), 'ops_desk_config.signed', 'ops_desk_config', c.id,
            jsonb_build_object('version', p_version));
end;
$$;
revoke all on function public.sign_ops_desk_config(integer) from public, anon, authenticated;
grant execute on function public.sign_ops_desk_config(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Phone helpers: a number counts only when it is the person's own, confirmed by sign-in, and not a placeholder
-- ---------------------------------------------------------------------------
create function private.phone_looks_placeholder(p text) returns boolean
language sql immutable set search_path = ''
as $$
  select p is null
      or p !~ '^\+[1-9][0-9]{7,14}$'
      or p ~ '(\d)\1{5,}'
      or p like '%1234567%' or p like '%7654321%' or p like '%0123456%'
$$;
revoke all on function private.phone_looks_placeholder(text) from public, anon, authenticated;

create function private.verified_profile_phone(p_profile uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select pr.phone
    from public.profiles pr
    join auth.users u on u.id = pr.id
   where pr.id = p_profile
     and not private.phone_looks_placeholder(pr.phone)
     and u.phone_confirmed_at is not null
     and regexp_replace(coalesce(u.phone, ''), '\D', '', 'g') = regexp_replace(pr.phone, '\D', '', 'g')
$$;
revoke all on function private.verified_profile_phone(uuid) from public, anon, authenticated;

create function private.mask_phone(p text) returns text
language sql immutable set search_path = ''
as $$ select case when p is null then null else left(p, 4) || repeat('*', greatest(length(p) - 7, 2)) || right(p, 3) end $$;
revoke all on function private.mask_phone(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The roster
-- ---------------------------------------------------------------------------
create table public.ops_desk_contacts (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  profile_id      uuid not null unique references public.profiles (id) on delete restrict,
  role            text not null check (role in ('primary', 'deputy')),
  is_active       boolean not null default false,
  activated_by    uuid references public.profiles (id) on delete restrict,
  activated_at    timestamptz,
  activation_note text,
  is_test         boolean not null default false,
  created_by      uuid references public.profiles (id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint ops_desk_contacts_active_attributed check (not is_active or (activated_by is not null and activated_at is not null))
);
create index ops_desk_contacts_org_idx on public.ops_desk_contacts (organisation_id, is_active);
create index ops_desk_contacts_activated_by_idx on public.ops_desk_contacts (activated_by) where activated_by is not null;
create index ops_desk_contacts_created_by_idx on public.ops_desk_contacts (created_by) where created_by is not null;

create table public.ops_desk_contact_windows (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  contact_id      uuid not null references public.ops_desk_contacts (id) on delete cascade,
  day_of_week     smallint not null check (day_of_week between 1 and 7),   -- ISO: 1 Monday .. 7 Sunday, in Africa/Lagos
  start_time      time not null,
  end_time        time not null,
  created_at      timestamptz not null default now(),
  constraint ops_desk_windows_ordered check (end_time > start_time),
  unique (contact_id, day_of_week, start_time)
);
create index ops_desk_windows_contact_idx on public.ops_desk_contact_windows (contact_id);
create index ops_desk_windows_org_idx on public.ops_desk_contact_windows (organisation_id);

-- No placeholder is ever live. Checked every time a row is written, so a later edit cannot slip past.
create function private.ops_desk_contact_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare pr public.profiles%rowtype;
begin
  select * into pr from public.profiles where id = new.profile_id;
  if not found then raise exception 'unknown profile' using errcode = '23503'; end if;
  if tg_op = 'INSERT' and pr.organisation_id is distinct from new.organisation_id then
    raise exception 'an ops desk contact must belong to the same organisation' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and pr.role <> 'admin' then
    raise exception 'an ops desk contact must be an administrator account (the desk works from the admin console)' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and new.is_active then
    raise exception 'a new ops desk contact starts inactive; activate it after the phone and hours are checked' using errcode = '23514';
  end if;
  -- the checks below apply only to a row that is (becoming) active, so a contact whose account was later demoted or moved can always be made inactive
  if new.is_active then
    if pr.role <> 'admin' then
      raise exception 'an ops desk contact must be an administrator account (the desk works from the admin console)' using errcode = '23514';
    end if;
    if not pr.is_active then raise exception 'that account is deactivated' using errcode = '23514'; end if;
    if private.verified_profile_phone(new.profile_id) is null then
      raise exception 'an ops desk contact needs a real phone number that the person has confirmed on their own account' using errcode = '23514';
    end if;
    if not exists (select 1 from public.ops_desk_contact_windows w where w.contact_id = new.id) then
      raise exception 'an ops desk contact needs at least one window of hours' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'INSERT' then new.is_test := pr.is_test; end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.ops_desk_contact_guard() from public, anon, authenticated;
create trigger ops_desk_contacts_guard before insert or update on public.ops_desk_contacts
  for each row execute function private.ops_desk_contact_guard();

-- ---------------------------------------------------------------------------
-- 4. Assignments, the call log (append only), the checklist
-- ---------------------------------------------------------------------------
create table public.ops_desk_assignments (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  incident_id     uuid not null references public.ops_incidents (id) on delete cascade,
  contact_id      uuid not null references public.ops_desk_contacts (id) on delete restrict,
  profile_id      uuid not null references public.profiles (id) on delete restrict,
  role            text not null check (role in ('primary', 'deputy')),
  reason          text not null check (reason in ('first_choice', 'primary_not_on_duty', 'primary_unacknowledged')),
  assigned_at     timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.profiles (id) on delete restrict,
  escalated_at    timestamptz,
  is_test         boolean not null default false,
  unique (incident_id, contact_id)
);
create index ops_desk_assignments_incident_idx on public.ops_desk_assignments (incident_id);
create index ops_desk_assignments_org_idx on public.ops_desk_assignments (organisation_id, assigned_at desc);
create index ops_desk_assignments_profile_idx on public.ops_desk_assignments (profile_id);
create index ops_desk_assignments_contact_idx on public.ops_desk_assignments (contact_id);
create index ops_desk_assignments_ack_by_idx on public.ops_desk_assignments (acknowledged_by) where acknowledged_by is not null;
create index ops_desk_assignments_open_idx on public.ops_desk_assignments (assigned_at) where acknowledged_at is null and escalated_at is null;

create table public.ops_desk_call_log (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  incident_id        uuid not null references public.ops_incidents (id) on delete restrict,
  called_by          uuid not null references public.profiles (id) on delete restrict,
  callee_kind        text not null check (callee_kind in ('on_call_primary', 'on_call_backup', 'chief_medical_officer', 'other')),
  callee_profile_id  uuid not null references public.profiles (id) on delete restrict,
  callee_phone_masked text,
  outcome            text not null check (outcome in ('answered_acknowledged', 'answered_will_acknowledge', 'no_answer', 'busy_or_off', 'wrong_or_no_number', 'voicemail_left')),
  note               text,
  called_at          timestamptz not null default now(),
  is_test            boolean not null default false
);
create index ops_desk_call_log_incident_idx on public.ops_desk_call_log (incident_id, called_at);
create index ops_desk_call_log_org_idx on public.ops_desk_call_log (organisation_id, called_at desc);
create index ops_desk_call_log_called_by_idx on public.ops_desk_call_log (called_by);
create index ops_desk_call_log_callee_idx on public.ops_desk_call_log (callee_profile_id);

create function private.ops_desk_append_only() returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception '% is append only: add a new row instead of changing or removing one', tg_table_name using errcode = '23514';
end;
$$;
revoke all on function private.ops_desk_append_only() from public, anon, authenticated;
create trigger ops_desk_call_log_append_only before update or delete on public.ops_desk_call_log
  for each row execute function private.ops_desk_append_only();
create trigger ops_desk_call_log_no_truncate before truncate on public.ops_desk_call_log
  for each statement execute function private.ops_desk_append_only();

create table public.ops_desk_checklist_items (
  item_key   text primary key check (item_key ~ '^[a-z][a-z0-9_]*$'),
  title      text not null,
  detail     text not null,
  sort_order integer not null
);
insert into public.ops_desk_checklist_items (item_key, title, detail, sort_order) values
  ('backup_power', 'Backup power', 'An inverter or UPS, and charged power banks, that keep the laptop, router and desk phone running for the minimum time in docs/runbooks/ops-desk-resilience.md.', 1),
  ('second_internet_link', 'Second internet link', 'A second connection on a different network from the first, tested by loading the console on it.', 2),
  ('tested_contact_numbers', 'Tested contact numbers', 'Each person on the call sheet (on-call clinicians, the chief medical officer and the deputy) was phoned on the number on file and answered.', 3),
  ('deputy_cover', 'Deputy cover', 'A named deputy can take the phone calls when the primary cannot, for the hours the primary is not working.', 4);

create table public.ops_desk_checklist_attestations (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  item_key        text not null references public.ops_desk_checklist_items (item_key) on delete restrict,
  state           text not null check (state in ('in_place', 'not_in_place')),
  attested_by     uuid not null references public.profiles (id) on delete restrict,
  attested_at     timestamptz not null default now(),
  evidence_note   text not null check (char_length(btrim(evidence_note)) >= 20),
  is_test         boolean not null default false
);
create index ops_desk_attestations_org_idx on public.ops_desk_checklist_attestations (organisation_id, item_key, attested_at desc);
create index ops_desk_attestations_by_idx on public.ops_desk_checklist_attestations (attested_by);
create trigger ops_desk_attestations_append_only before update or delete on public.ops_desk_checklist_attestations
  for each row execute function private.ops_desk_append_only();
create trigger ops_desk_attestations_no_truncate before truncate on public.ops_desk_checklist_attestations
  for each statement execute function private.ops_desk_append_only();

-- Who may read: an administrator or the chief medical officer of the same organisation. Nobody writes directly.
create function private.ops_desk_viewer(p_org uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.is_active and pr.organisation_id = p_org)
     and (private.is_admin() or private.credential_is_cmo())
$$;
revoke all on function private.ops_desk_viewer(uuid) from public, anon, authenticated;
-- the read policies call it as the signed-in user, so it needs execute (it reveals only whether the caller is an administrator or the CMO of that organisation)
grant execute on function private.ops_desk_viewer(uuid) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['ops_desk_contacts', 'ops_desk_contact_windows', 'ops_desk_assignments', 'ops_desk_call_log', 'ops_desk_checklist_attestations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.ops_desk_viewer(organisation_id))', t || '_read', t);
    execute format('revoke all on public.%I from public, anon', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
  alter table public.ops_desk_checklist_items enable row level security;
  create policy ops_desk_checklist_items_read on public.ops_desk_checklist_items for select to authenticated using (true);
  revoke all on public.ops_desk_checklist_items from public, anon;
  revoke insert, update, delete, truncate, references, trigger on public.ops_desk_checklist_items from authenticated;
  grant select on public.ops_desk_checklist_items to authenticated;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Who is on duty, and the assignment
-- ---------------------------------------------------------------------------
create function private.ops_desk_contact_usable(p_contact uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.ops_desk_contacts c
      join public.profiles pr on pr.id = c.profile_id and pr.is_active and pr.role = 'admin'
     where c.id = p_contact and c.is_active
       and private.verified_profile_phone(c.profile_id) is not null
       and exists (select 1 from public.ops_desk_contact_windows w where w.contact_id = c.id))
$$;
revoke all on function private.ops_desk_contact_usable(uuid) from public, anon, authenticated;

create function private.ops_desk_on_duty(p_org uuid, p_test boolean, p_at timestamptz default now())
returns table (contact_id uuid, profile_id uuid, role text)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.profile_id, c.role
    from public.ops_desk_contacts c
    join public.profiles pr on pr.id = c.profile_id and pr.is_active and pr.role = 'admin'
   where c.organisation_id = p_org and c.is_test = p_test and c.is_active
     and private.verified_profile_phone(c.profile_id) is not null
     and exists (
       select 1 from public.ops_desk_contact_windows w
        where w.contact_id = c.id
          and w.day_of_week = extract(isodow from p_at at time zone 'Africa/Lagos')::integer
          and (p_at at time zone 'Africa/Lagos')::time >= w.start_time
          and (p_at at time zone 'Africa/Lagos')::time < w.end_time)
$$;
revoke all on function private.ops_desk_on_duty(uuid, boolean, timestamptz) from public, anon, authenticated;

-- The page an incident is about (its notices point at it); the incident itself when there is no page (a standing "nobody reachable" condition).
create function private.ops_desk_ref(p_incident uuid) returns uuid
language sql stable security definer set search_path = ''
as $$
  select case when i.external_reference ~ '^page_expired:[0-9a-f-]{36}$' then substring(i.external_reference from 14)::uuid else i.id end
    from public.ops_incidents i where i.id = p_incident
$$;
revoke all on function private.ops_desk_ref(uuid) from public, anon, authenticated;

-- A notice about an incident rather than a page. Routine priority and its own source table, so neither the page monitors nor the legacy
-- critical-notification ladder (which has an sms rung) ever look at it; sms and voice are refused by the trigger below. A failure to send is
-- watched by sweep_ops_desk (ops_desk_notifications_failed).
create function private.ops_desk_notify_incident(p_recipient uuid, p_org uuid, p_template text, p_incident uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare c text;
begin
  foreach c in array array['push', 'in_app', 'email'] loop
    insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
    values (p_recipient, p_org, c::public.notification_channel, p_template, jsonb_build_object('incident_id', p_incident), 'pending', 'non_clinical', 'routine', 'ops_incidents', p_incident);
  end loop;
  perform private.nudge_send_pending();
end;
$$;
revoke all on function private.ops_desk_notify_incident(uuid, uuid, text, uuid) from public, anon, authenticated;

-- No ops desk notice is ever an sms or a voice call, whatever table it points at (the human makes the call).
create function private.ops_desk_no_sms() returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'ops desk notices are never sent by sms or voice' using errcode = '23514';
end;
$$;
revoke all on function private.ops_desk_no_sms() from public, anon, authenticated;
create trigger notifications_ops_desk_no_sms before insert on public.notifications
  for each row when (new.template like 'on\_call\_ops\_desk%' and new.channel::text in ('sms', 'voice'))
  execute function private.ops_desk_no_sms();

-- p_mode 'first': the primary on duty, else the deputy on duty. 'deputy': a deputy on duty other than p_exclude.
create function private.ops_desk_assign(p_incident uuid, p_mode text default 'first', p_exclude uuid default null) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  i public.ops_incidents%rowtype;
  v_page uuid;
  v_test boolean := false;
  v_ref uuid;
  c record;
  v_reason text;
  v_asg uuid;
begin
  select * into i from public.ops_incidents where id = p_incident;
  if not found or i.organisation_id is null then return null; end if;
  if i.external_reference ~ '^page_expired:[0-9a-f-]{36}$' then
    v_page := substring(i.external_reference from 14)::uuid;
    select p.is_test into v_test from public.pages p where p.id = v_page;
  end if;
  v_test := coalesce(v_test, false);
  v_ref := coalesce(v_page, i.id);

  if p_mode = 'first' then
    select * into c from private.ops_desk_on_duty(i.organisation_id, v_test) d where d.role = 'primary' and d.profile_id is distinct from p_exclude order by d.contact_id limit 1;
    v_reason := 'first_choice';
    if not found then
      select * into c from private.ops_desk_on_duty(i.organisation_id, v_test) d where d.role = 'deputy' and d.profile_id is distinct from p_exclude order by d.contact_id limit 1;
      v_reason := 'primary_not_on_duty';
    end if;
  else
    select * into c from private.ops_desk_on_duty(i.organisation_id, v_test) d where d.role = 'deputy' and d.profile_id is distinct from p_exclude order by d.contact_id limit 1;
    v_reason := 'primary_unacknowledged';
  end if;

  if c.contact_id is null and p_mode <> 'first' then return null; end if;
  if c.contact_id is null then
    -- a drill (test page) is never a real emergency: no sev1 and no notice, only the audit row
    if v_test then
      insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
        values (i.organisation_id, null, 'ops_desk.uncovered_test', 'ops_incident', i.id, jsonb_build_object('mode', p_mode));
      return null;
    end if;
    -- nobody named is on duty: say so loudly, and tell the clinical lead and administrators. The expired-page notice has already gone to them.
    perform private.page_incident(i.organisation_id, 'ops_desk_uncovered:' || i.id, 'No named ops person for this hour: phone the on-call clinician now',
      'A red event page needs a phone call and no ops contact is on duty for this hour (or none is named). Phone the on-call clinician and the chief medical officer yourself and record the calls on the Ops desk page. Name and activate ops contacts so this does not happen again.');
    -- a standing "nobody reachable" condition already sits in the incident queue; only an expired page needs the extra notice
    if v_page is not null then
      perform private.page_notify_leadership(i.organisation_id, v_ref, v_test, 'on_call_ops_desk_uncovered');
    end if;
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
      values (i.organisation_id, null, 'ops_desk.uncovered', 'ops_incident', i.id, jsonb_build_object('mode', p_mode));
    return null;
  end if;

  insert into public.ops_desk_assignments (organisation_id, incident_id, contact_id, profile_id, role, reason, is_test)
  values (i.organisation_id, i.id, c.contact_id, c.profile_id, c.role, v_reason, v_test)
  on conflict (incident_id, contact_id) do nothing
  returning id into v_asg;
  if v_asg is null then return null; end if;
  update public.ops_incidents set owner_id = c.profile_id where id = i.id;
  if v_page is not null then
    perform private.page_notify_ref(c.profile_id, i.organisation_id, 'on_call_ops_desk', v_page, 'pages', array['push', 'in_app', 'email'], true);
  else
    -- a standing "nobody reachable" condition has no page: the notice points at the incident it is about, not at a page that does not exist
    perform private.ops_desk_notify_incident(c.profile_id, i.organisation_id, 'on_call_ops_desk_roster', i.id);
  end if;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (i.organisation_id, null, 'ops_desk.assigned', 'ops_incident', i.id, jsonb_build_object('assigned_to', c.profile_id, 'role', c.role, 'reason', v_reason));
  return v_asg;
end;
$$;
revoke all on function private.ops_desk_assign(uuid, text, uuid) from public, anon, authenticated;

-- A failure here must never stop the incident from being created: it is audited and raises its own incident.
create function private.ops_incident_assign_ops_desk() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  begin
    perform private.ops_desk_assign(new.id, 'first', null);
  exception when others then
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (new.organisation_id, 'ops_desk.assign_error', 'ops_incident', new.id, jsonb_build_object('error', sqlerrm));
    begin
      perform private.page_incident(new.organisation_id, 'ops_desk_assign_failed:' || new.id, 'The ops desk could not be assigned to a page incident',
        'Assigning the named ops person failed (see audit_log ops_desk.assign_error). Phone the on-call clinician and the chief medical officer now.');
    exception when others then
      -- the fallback incident failed too: say so in the audit trail and the database log, never silently
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (new.organisation_id, 'ops_desk.assign_fallback_error', 'ops_incident', new.id, jsonb_build_object('error', sqlerrm));
      raise warning 'ops desk: assigning % failed and so did the fallback incident: %', new.id, sqlerrm;
    end;
  end;
  return null;
end;
$$;
revoke all on function private.ops_incident_assign_ops_desk() from public, anon, authenticated;
create trigger ops_incidents_assign_ops_desk after insert on public.ops_incidents
  for each row when (new.external_reference like 'page\_expired:%' or new.external_reference like 'page\_nobody\_reachable:%')
  execute function private.ops_incident_assign_ops_desk();

-- ---------------------------------------------------------------------------
-- 6. The sweep: deputy after the configured time, a closing alarm, and the uncovered-roster sev1
-- ---------------------------------------------------------------------------
create function private.sweep_ops_desk() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  a record; o record;
  v_after integer := coalesce(private.ops_desk_rule('deputy_after_seconds'), 300);
  v_deputies integer := 0; v_final integer := 0; v_uncovered integer := 0; v_errors integer := 0;
  v_got uuid;
begin
  for a in
    select asg.id, asg.incident_id, asg.profile_id, asg.role, asg.organisation_id, asg.is_test
      from public.ops_desk_assignments asg
      join public.ops_incidents i on i.id = asg.incident_id
     where asg.acknowledged_at is null and asg.escalated_at is null
       and asg.assigned_at <= now() - make_interval(secs => v_after)
       and i.status not in ('resolved', 'closed') and i.acknowledged_at is null
       -- the page was acknowledged by a clinician after all: the phone call is no longer needed
       and not exists (select 1 from public.pages pg where i.external_reference = 'page_expired:' || pg.id and pg.acknowledged_at is not null)
     order by asg.assigned_at for update of asg skip locked
  loop
    begin
      update public.ops_desk_assignments set escalated_at = now() where id = a.id;
      if a.role = 'primary' then
        v_got := private.ops_desk_assign(a.incident_id, 'deputy', a.profile_id);
        if not exists (select 1 from public.ops_desk_assignments d where d.incident_id = a.incident_id and d.role = 'deputy') and not a.is_test then
          perform private.page_incident(a.organisation_id, 'ops_desk_no_deputy:' || a.incident_id, 'The ops desk primary has not answered and no deputy is on duty',
            'The named ops primary has not acknowledged a page incident and no deputy is on duty. Phone the on-call clinician and the chief medical officer yourself and record the calls.');
        end if;
        v_deputies := v_deputies + 1;
      else
        if not a.is_test then
          perform private.page_incident(a.organisation_id, 'ops_desk_unacknowledged:' || a.incident_id, 'Nobody at the ops desk has acknowledged a page incident',
            'The named ops deputy has not acknowledged a page incident. Phone the on-call clinician and the chief medical officer yourself and record the calls on the Ops desk page.');
          if private.ops_desk_ref(a.incident_id) <> a.incident_id then
            perform private.page_notify_leadership(a.organisation_id, private.ops_desk_ref(a.incident_id), a.is_test, 'on_call_ops_desk_uncovered');
          end if;
        end if;
        v_final := v_final + 1;
      end if;
    exception when others then
      v_errors := v_errors + 1;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (a.organisation_id, 'ops_desk.sweep_error', 'ops_incident', a.incident_id, jsonb_build_object('error', sqlerrm));
      begin
        perform private.page_incident(a.organisation_id, 'ops_desk_sweep_failed', 'The ops desk escalation failed',
          'Moving a page incident to the ops deputy failed (see audit_log ops_desk.sweep_error). Phone the on-call clinician and the chief medical officer now.');
      exception when others then
        insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
          values (a.organisation_id, 'ops_desk.sweep_fallback_error', 'ops_incident', a.incident_id, jsonb_build_object('error', sqlerrm));
        raise warning 'ops desk sweep: % failed and so did the fallback incident: %', a.incident_id, sqlerrm;
      end;
    end;
  end loop;

  -- a notice that failed to send: the page monitors do not see these (they point at an incident, not a page)
  if exists (select 1 from public.notifications n where n.source_table = 'ops_incidents' and n.template like 'on\_call\_ops\_desk%' and n.status = 'failed' and n.created_at > now() - interval '1 hour') then
    perform private.page_incident(null, 'ops_desk_notifications_failed', 'Ops desk notices are failing to send',
      'A notice to an ops contact failed in the last hour (see notifications.last_error). Check who is affected and phone them.');
  end if;

  if coalesce(private.ops_desk_rule('uncovered_roster_alarm'), 0) = 1 then
    for o in select distinct r.organisation_id from public.on_call_rota r where r.is_test = false and r.cancelled_at is null and r.starts_at <= now() and r.ends_at > now() loop
      begin
        if exists (select 1 from private.ops_desk_on_duty(o.organisation_id, false)) then
          -- cover is back: the alarm closes itself (a person can still reopen the question in the incident)
          -- the register's own path: moving the status fires its stamp trigger (resolved_at, mitigated_at, acknowledged_at) and its timeline trigger
          update public.ops_incidents set status = 'resolved', root_cause = coalesce(root_cause, 'An ops desk contact is on duty again (closed automatically).')
           where external_reference = 'ops_desk_uncovered_roster:' || o.organisation_id and status not in ('resolved', 'closed');
        else
          perform private.page_incident(o.organisation_id, 'ops_desk_uncovered_roster:' || o.organisation_id, 'Nobody is named at the ops desk for this hour',
            'A real on-call rota is running and no ops desk contact is on duty right now. If a red event page expires, no named person will be told to phone the on-call clinician. Name, verify and activate ops contacts on the Ops desk page.');
          v_uncovered := v_uncovered + 1;
        end if;
      exception when others then
        v_errors := v_errors + 1;
        insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
          values (o.organisation_id, 'ops_desk.sweep_error', 'organisation', o.organisation_id, jsonb_build_object('error', sqlerrm, 'step', 'roster'));
      end;
    end loop;
  end if;
  return jsonb_build_object('deputies', v_deputies, 'final', v_final, 'uncovered', v_uncovered, 'errors', v_errors);
end;
$$;
revoke all on function private.sweep_ops_desk() from public, anon, authenticated;
select cron.schedule('ops-desk-sweep', '* * * * *', $$ select private.sweep_ops_desk(); $$);

-- ---------------------------------------------------------------------------
-- 7. Maintaining the roster (administrators)
-- ---------------------------------------------------------------------------
create function private.ops_desk_admin() returns table (id uuid, organisation_id uuid, is_test boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.uid_or_deny();
  if not private.is_admin() then raise exception 'only an administrator can do this' using errcode = '42501'; end if;
  return query select pr.id, pr.organisation_id, coalesce(pr.is_test, false) from public.profiles pr where pr.id = (select auth.uid());
end;
$$;
revoke all on function private.ops_desk_admin() from public, anon, authenticated;

create function public.ops_desk_save_contact(p_profile uuid, p_role text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare c record; v_id uuid;
begin
  select * into c from private.ops_desk_admin();
  if p_role not in ('primary', 'deputy') then raise exception 'the role is primary or deputy' using errcode = '22023'; end if;
  if not exists (select 1 from public.profiles pr where pr.id = p_profile and pr.organisation_id = c.organisation_id) then
    raise exception 'that person is not in your organisation' using errcode = '22023';
  end if;
  select ct.id into v_id from public.ops_desk_contacts ct where ct.profile_id = p_profile and ct.organisation_id = c.organisation_id;
  if v_id is not null then
    if exists (select 1 from public.ops_desk_contacts ct where ct.id = v_id and ct.is_active) then
      raise exception 'that person is already an active contact; make them not active first if you want to change their role' using errcode = '22023';
    end if;
    update public.ops_desk_contacts set role = p_role where id = v_id;
  else
    insert into public.ops_desk_contacts (organisation_id, profile_id, role, created_by)
    values (c.organisation_id, p_profile, p_role, c.id)
    returning id into v_id;
  end if;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (c.organisation_id, c.id, 'ops_desk.contact_saved', 'ops_desk_contact', v_id, jsonb_build_object('role', p_role, 'profile_id', p_profile));
  return v_id;
end;
$$;
revoke all on function public.ops_desk_save_contact(uuid, text) from public, anon;
grant execute on function public.ops_desk_save_contact(uuid, text) to authenticated;

-- p_windows: [{"day": 1, "start": "08:00", "end": "18:00"}, ...] in Africa/Lagos (ISO day, 1 Monday to 7 Sunday). Replaces the set.
create function public.ops_desk_set_windows(p_contact uuid, p_windows jsonb) returns integer
language plpgsql security definer set search_path = ''
as $$
declare c record; ct public.ops_desk_contacts%rowtype; w jsonb; n integer := 0;
begin
  select * into c from private.ops_desk_admin();
  select * into ct from public.ops_desk_contacts where id = p_contact and organisation_id = c.organisation_id for update;
  if not found then raise exception 'unknown contact' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_windows) <> 'array' then raise exception 'windows must be a list' using errcode = '22023'; end if;
  if ct.is_active and jsonb_array_length(p_windows) = 0 then
    raise exception 'an active contact needs at least one window; deactivate the contact first' using errcode = '22023';
  end if;
  -- every window: an ISO day, a start HH:MM (00:00 to 23:59), an end HH:MM or exactly 24:00 (midnight), the end after the start.
  -- A night shift is two windows (22:00 to 24:00 on one day, 00:00 to 06:00 on the next), so there is never a one-minute gap at midnight.
  for w in select * from jsonb_array_elements(p_windows) loop
    if (w ->> 'day') !~ '^[1-7]$' or coalesce(w ->> 'start', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(w ->> 'end', '') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$' or (w ->> 'end')::time <= (w ->> 'start')::time then
      raise exception 'each window needs a day (1 to 7), a start time (00:00 to 23:59) and an end time after it (up to 24:00 for midnight)' using errcode = '22023';
    end if;
  end loop;
  delete from public.ops_desk_contact_windows where contact_id = p_contact;
  for w in select * from jsonb_array_elements(p_windows) loop
    insert into public.ops_desk_contact_windows (organisation_id, contact_id, day_of_week, start_time, end_time)
    values (c.organisation_id, p_contact, (w ->> 'day')::smallint, (w ->> 'start')::time, (w ->> 'end')::time)
    on conflict (contact_id, day_of_week, start_time) do nothing;
    n := n + 1;
  end loop;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (c.organisation_id, c.id, 'ops_desk.windows_set', 'ops_desk_contact', p_contact, jsonb_build_object('windows', n));
  return n;
exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format or check_violation or not_null_violation or numeric_value_out_of_range then
  raise exception 'each window needs a day (1 to 7), a start and an end time (HH:MM) with the end after the start' using errcode = '22023';
end;
$$;
revoke all on function public.ops_desk_set_windows(uuid, jsonb) from public, anon;
grant execute on function public.ops_desk_set_windows(uuid, jsonb) to authenticated;

create function public.ops_desk_set_contact_active(p_contact uuid, p_active boolean, p_note text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare c record; ct public.ops_desk_contacts%rowtype;
begin
  select * into c from private.ops_desk_admin();
  select * into ct from public.ops_desk_contacts where id = p_contact and organisation_id = c.organisation_id for update;
  if not found then raise exception 'unknown contact' using errcode = 'P0002'; end if;
  if p_active and char_length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'say in a few words how the phone number and hours were checked' using errcode = '22023';
  end if;
  update public.ops_desk_contacts
     set is_active = p_active,
         activated_by = case when p_active then c.id end,
         activated_at = case when p_active then now() end,
         activation_note = case when p_active then btrim(p_note) end
   where id = p_contact;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (c.organisation_id, c.id, case when p_active then 'ops_desk.contact_activated' else 'ops_desk.contact_deactivated' end, 'ops_desk_contact', p_contact,
            jsonb_build_object('profile_id', ct.profile_id));
end;
$$;
revoke all on function public.ops_desk_set_contact_active(uuid, boolean, text) from public, anon;
grant execute on function public.ops_desk_set_contact_active(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Working a page incident: acknowledge, the call sheet, the call log
-- ---------------------------------------------------------------------------
create function public.ops_desk_acknowledge(p_incident uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.uid_or_deny(); i public.ops_incidents%rowtype; n integer;
begin
  select * into i from public.ops_incidents where id = p_incident;
  if not found then raise exception 'unknown incident' using errcode = 'P0002'; end if;
  update public.ops_desk_assignments set acknowledged_at = now(), acknowledged_by = v_uid
   where incident_id = p_incident and profile_id = v_uid and acknowledged_at is null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'this incident is not assigned to you, or you already acknowledged it' using errcode = '42501'; end if;
  -- the register's own acknowledgement is stamped too (moving it to investigating), which is what stops a further escalation to the deputy
  update public.ops_incidents set owner_id = v_uid, status = case when status = 'open' then 'investigating'::public.ops_incident_status else status end where id = p_incident;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (i.organisation_id, v_uid, 'ops_desk.acknowledged', 'ops_incident', p_incident, '{}'::jsonb);
end;
$$;
revoke all on function public.ops_desk_acknowledge(uuid) from public, anon;
grant execute on function public.ops_desk_acknowledge(uuid) to authenticated;

-- The people to phone. Clinicians only: no patient, no case detail (INV-07). A person with no confirmed number shows no number.
-- The people the call sheet lists for an incident (kind and profile). One definition, used by the sheet and by the call log.
create function private.ops_desk_sheet_people(p_incident uuid) returns table (kind text, pid uuid)
language plpgsql stable security definer set search_path = ''
as $$
declare i public.ops_incidents%rowtype; v_root public.pages%rowtype; v_test boolean := false;
begin
  select * into i from public.ops_incidents where id = p_incident;
  if not found then return; end if;
  if i.external_reference ~ '^page_expired:[0-9a-f-]{36}$' then
    select * into v_root from public.pages where id = substring(i.external_reference from 14)::uuid;
    v_test := coalesce(v_root.is_test, false);
  end if;
  return query
    select 'on_call_primary'::text, coalesce(v_root.to_clinician_id, (select d.primary_id from private.on_call_now(i.organisation_id, v_test) d))
    union all
    select 'on_call_backup'::text, coalesce((select pg.to_clinician_id from public.pages pg where pg.parent_page_id = v_root.id and pg.role = 'backup' limit 1),
                                            (select d.backup_id from private.on_call_now(i.organisation_id, v_test) d))
    union all
    select 'chief_medical_officer'::text, cs.profile_id from public.clinical_staff cs join public.profiles pr on pr.id = cs.profile_id
     where cs.organisation_id = i.organisation_id and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer' and pr.is_test = v_test;
end;
$$;
revoke all on function private.ops_desk_sheet_people(uuid) from public, anon, authenticated;

create function public.ops_desk_call_sheet(p_incident uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  c record; i public.ops_incidents%rowtype; v_page uuid; v_root public.pages%rowtype; v_test boolean := false;
  v_rows jsonb := '[]'::jsonb; r record;
begin
  perform private.uid_or_deny();
  if not (private.is_admin() or private.credential_is_cmo()) then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into c from private.cap_caller();
  select * into i from public.ops_incidents where id = p_incident and organisation_id = c.organisation_id;
  if not found or i.external_reference !~ '^page_(expired|nobody_reachable):' then raise exception 'unknown page incident' using errcode = 'P0002'; end if;
  if i.external_reference ~ '^page_expired:[0-9a-f-]{36}$' then
    v_page := substring(i.external_reference from 14)::uuid;
    select * into v_root from public.pages where id = v_page;
    v_test := coalesce(v_root.is_test, false);
  end if;
  for r in
    select p.kind, p.pid, coalesce(pr.full_name, 'Unnamed') as full_name, private.verified_profile_phone(p.pid) as phone
      from private.ops_desk_sheet_people(p_incident) p join public.profiles pr on pr.id = p.pid where p.pid is not null
  loop
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('kind', r.kind, 'profile_id', r.pid, 'name', r.full_name,
      'phone', r.phone, 'phone_status', case when r.phone is null then 'no_confirmed_number' else 'confirmed' end));
  end loop;
  return jsonb_build_object('incident_id', i.id, 'reference', i.reference, 'opened_at', i.detected_at, 'page_acknowledged', coalesce(v_root.acknowledged_at is not null, false), 'people', v_rows);
end;
$$;
revoke all on function public.ops_desk_call_sheet(uuid) from public, anon;
grant execute on function public.ops_desk_call_sheet(uuid) to authenticated;

create function public.log_ops_desk_call(p_incident uuid, p_callee_kind text, p_callee_profile uuid, p_outcome text, p_note text default null) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  c record; i public.ops_incidents%rowtype; v_max integer := coalesce(private.ops_desk_rule('call_note_max_chars'), 500); v_id uuid; callee public.profiles%rowtype;
begin
  perform private.uid_or_deny();
  if not (private.is_admin() or private.credential_is_cmo()) then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into c from private.cap_caller();
  select * into i from public.ops_incidents where id = p_incident and organisation_id = c.organisation_id;
  if not found or i.external_reference !~ '^page_(expired|nobody_reachable):' then raise exception 'unknown page incident' using errcode = 'P0002'; end if;
  select * into callee from public.profiles where id = p_callee_profile and organisation_id = c.organisation_id and is_active and role in ('clinician', 'admin');
  if not found then raise exception 'that person is not active staff in your organisation' using errcode = '22023'; end if;
  if p_callee_kind = 'other' then
    -- someone who is not on the call sheet (for example from the paper list) needs a written reason
    if char_length(btrim(coalesce(p_note, ''))) < 10 then
      raise exception 'say in a few words why you phoned someone who is not on the call sheet' using errcode = '22023';
    end if;
  elsif not exists (select 1 from private.ops_desk_sheet_people(p_incident) s where s.kind = p_callee_kind and s.pid = p_callee_profile) then
    raise exception 'that person is not on the call sheet for this incident as the %; choose someone listed, or use "someone else" with a note', replace(p_callee_kind, '_', ' ') using errcode = '22023';
  end if;
  if char_length(coalesce(p_note, '')) > v_max then raise exception 'keep the note to % characters, with no patient names or numbers', v_max using errcode = '22023'; end if;
  insert into public.ops_desk_call_log (organisation_id, incident_id, called_by, callee_kind, callee_profile_id, callee_phone_masked, outcome, note, is_test)
  values (c.organisation_id, p_incident, c.id, p_callee_kind, p_callee_profile, private.mask_phone(private.verified_profile_phone(p_callee_profile)), p_outcome, nullif(btrim(p_note), ''), c.is_test)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.log_ops_desk_call(uuid, text, uuid, text, text) from public, anon;
grant execute on function public.log_ops_desk_call(uuid, text, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. The checklist: a named person attests; the system never invents one
-- ---------------------------------------------------------------------------
create function public.attest_ops_desk_item(p_item text, p_state text, p_evidence text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare c record; v_id uuid;
begin
  perform private.uid_or_deny();
  if not (private.is_admin() or private.credential_is_cmo()) then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into c from private.cap_caller();
  if not exists (select 1 from public.ops_desk_checklist_items where item_key = p_item) then raise exception 'unknown checklist item' using errcode = 'P0002'; end if;
  if p_state not in ('in_place', 'not_in_place') then raise exception 'the state is in_place or not_in_place' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_evidence, ''))) < 20 then
    raise exception 'write at least 20 characters saying what you saw or tested (what, where, when)' using errcode = '22023';
  end if;
  insert into public.ops_desk_checklist_attestations (organisation_id, item_key, state, attested_by, evidence_note, is_test)
  values (c.organisation_id, p_item, p_state, c.id, btrim(p_evidence), c.is_test) returning id into v_id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (c.organisation_id, c.id, 'ops_desk.attested', 'ops_desk_checklist_attestation', v_id, jsonb_build_object('item', p_item, 'state', p_state));
  return v_id;
end;
$$;
revoke all on function public.attest_ops_desk_item(text, text, text) from public, anon;
grant execute on function public.attest_ops_desk_item(text, text, text) to authenticated;

-- One organisation is "ready" when each item's newest attestation says in_place and is not older than the configured age, and a primary
-- and a deputy are active with a confirmed number.
create function private.ops_desk_org_ready(p_org uuid, p_test boolean default false) returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (
           select 1 from public.ops_desk_checklist_items it
            where not exists (
              select 1 from (select a.state, a.attested_at from public.ops_desk_checklist_attestations a
                              where a.organisation_id = p_org and a.item_key = it.item_key and a.is_test = p_test
                              order by a.attested_at desc limit 1) l
               where l.state = 'in_place' and l.attested_at > now() - make_interval(days => coalesce(private.ops_desk_rule('checklist_max_age_days'), 90))))
     and exists (select 1 from public.ops_desk_contacts c where c.organisation_id = p_org and c.is_test = p_test and c.role = 'primary' and private.ops_desk_contact_usable(c.id))
     and exists (select 1 from public.ops_desk_contacts c where c.organisation_id = p_org and c.is_test = p_test and c.role = 'deputy' and private.ops_desk_contact_usable(c.id))
$$;
revoke all on function private.ops_desk_org_ready(uuid, boolean) from public, anon, authenticated;

-- Gating, OFF by default: only when the CMO's signed config says checklist_gates_readiness = 1 is the on-call cover guard refused.
create function private.ops_desk_gate_on_call_cover_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare o record;
begin
  if coalesce(private.ops_desk_rule('checklist_gates_readiness'), 0) <> 1 then return new; end if;
  for o in select distinct r.organisation_id from public.on_call_rota r where r.is_test = false and r.cancelled_at is null and r.ends_at > now() loop
    if not private.ops_desk_org_ready(o.organisation_id) then
      raise exception 'the ops desk is not ready: the resilience checklist needs a fresh attestation for every item and a primary and a deputy must be active (Ops desk page)' using errcode = '23514';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.ops_desk_gate_on_call_cover_guard() from public, anon, authenticated;
create trigger ops_desk_checklist_gate before update of is_on on public.go_live_guards
  for each row when (new.key = 'on_call_cover_ok' and new.is_on and not old.is_on)
  execute function private.ops_desk_gate_on_call_cover_guard();

-- ---------------------------------------------------------------------------
-- 10. Reading it: roster, overview (also the CMO summary and the readiness line), call history
-- ---------------------------------------------------------------------------
create function public.ops_desk_roster() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare c record;
begin
  perform private.uid_or_deny();
  if not (private.is_admin() or private.credential_is_cmo()) then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into c from private.cap_caller();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'contact_id', ct.id, 'profile_id', ct.profile_id, 'name', coalesce(pr.full_name, 'Unnamed'), 'role', ct.role, 'is_active', ct.is_active,
      'phone', private.verified_profile_phone(ct.profile_id),
      'phone_status', case when private.verified_profile_phone(ct.profile_id) is not null then 'confirmed'
                           when pr.phone is null then 'no_number' else 'not_confirmed' end,
      'on_duty_now', exists (select 1 from private.ops_desk_on_duty(c.organisation_id, ct.is_test) d where d.contact_id = ct.id),
      'activated_by_name', (select coalesce(ap.full_name, 'Unnamed') from public.profiles ap where ap.id = ct.activated_by), 'activated_at', ct.activated_at,
      'windows', coalesce((select jsonb_agg(jsonb_build_object('day', w.day_of_week, 'start', left(w.start_time::text, 5), 'end', left(w.end_time::text, 5)) order by w.day_of_week, w.start_time)
                             from public.ops_desk_contact_windows w where w.contact_id = ct.id), '[]'::jsonb)
    ) order by ct.role, pr.full_name)
      from public.ops_desk_contacts ct join public.profiles pr on pr.id = ct.profile_id
     where ct.organisation_id = c.organisation_id), '[]'::jsonb);
end;
$$;
revoke all on function public.ops_desk_roster() from public, anon;
grant execute on function public.ops_desk_roster() to authenticated;

create function public.ops_desk_overview(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  c record; v_days integer := least(greatest(coalesce(p_days, 30), 1), 366);
  v_age integer := coalesce(private.ops_desk_rule('checklist_max_age_days'), 90);
  v_items jsonb; v_gap integer; v_since timestamptz;
begin
  perform private.uid_or_deny();
  if not (private.is_admin() or private.credential_is_cmo()) then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into c from private.cap_caller();
  v_since := now() - make_interval(days => v_days);
  select coalesce(jsonb_agg(jsonb_build_object(
      'item_key', it.item_key, 'title', it.title, 'detail', it.detail,
      'state', coalesce(l.state, 'not_attested'), 'attested_at', l.attested_at, 'attested_by_name', coalesce(l.name, 'Unnamed'), 'evidence_note', l.evidence_note,
      'stale', l.attested_at is not null and l.attested_at <= now() - make_interval(days => v_age)) order by it.sort_order), '[]'::jsonb)
    into v_items
    from public.ops_desk_checklist_items it
    left join lateral (select a.state, a.attested_at, a.evidence_note, pr.full_name as name
                         from public.ops_desk_checklist_attestations a join public.profiles pr on pr.id = a.attested_by
                        where a.organisation_id = c.organisation_id and a.item_key = it.item_key and a.is_test = c.is_test
                        order by a.attested_at desc limit 1) l on true;
  -- hours in the next 7 days (Lagos) with nobody on duty
  select count(*) into v_gap from generate_series(date_trunc('hour', now()), date_trunc('hour', now()) + interval '167 hours', interval '1 hour') h
   where not exists (select 1 from private.ops_desk_on_duty(c.organisation_id, c.is_test, h));
  return jsonb_build_object(
    'config_version', (select version from public.ops_desk_config where is_active),
    'checklist_gates_readiness', coalesce(private.ops_desk_rule('checklist_gates_readiness'), 0) = 1,
    'ready', private.ops_desk_org_ready(c.organisation_id, c.is_test),
    'checklist', v_items,
    'active_primary', (select count(*) from public.ops_desk_contacts x where x.organisation_id = c.organisation_id and x.role = 'primary' and x.is_test = c.is_test and private.ops_desk_contact_usable(x.id)),
    'active_deputy', (select count(*) from public.ops_desk_contacts x where x.organisation_id = c.organisation_id and x.role = 'deputy' and x.is_test = c.is_test and private.ops_desk_contact_usable(x.id)),
    'on_duty_now', (select count(*) from private.ops_desk_on_duty(c.organisation_id, c.is_test)),
    'uncovered_hours_next_7_days', v_gap,
    'window_days', v_days,
    'assignments', (select count(*) from public.ops_desk_assignments a where a.organisation_id = c.organisation_id and a.is_test = c.is_test and a.assigned_at >= v_since),
    'acknowledged', (select count(*) from public.ops_desk_assignments a where a.organisation_id = c.organisation_id and a.is_test = c.is_test and a.assigned_at >= v_since and a.acknowledged_at is not null),
    'moved_to_deputy', (select count(*) from public.ops_desk_assignments a where a.organisation_id = c.organisation_id and a.is_test = c.is_test and a.assigned_at >= v_since and a.reason = 'primary_unacknowledged'),
    'median_seconds_to_acknowledge', (select (percentile_cont(0.5) within group (order by extract(epoch from a.acknowledged_at - a.assigned_at)))::integer
                                        from public.ops_desk_assignments a where a.organisation_id = c.organisation_id and a.is_test = c.is_test and a.assigned_at >= v_since and a.acknowledged_at is not null),
    'calls_logged', (select count(*) from public.ops_desk_call_log l where l.organisation_id = c.organisation_id and l.is_test = c.is_test and l.called_at >= v_since),
    'calls_answered', (select count(*) from public.ops_desk_call_log l where l.organisation_id = c.organisation_id and l.is_test = c.is_test and l.called_at >= v_since and l.outcome in ('answered_acknowledged', 'answered_will_acknowledge')),
    'open_uncovered_incidents', (select count(*) from public.ops_incidents i where i.organisation_id = c.organisation_id and i.status not in ('resolved', 'closed')
                                    and (i.external_reference like 'ops\_desk\_uncovered%' or i.external_reference like 'ops\_desk\_no\_deputy%' or i.external_reference like 'ops\_desk\_unacknowledged%'))
  );
end;
$$;
revoke all on function public.ops_desk_overview(integer) from public, anon;
grant execute on function public.ops_desk_overview(integer) to authenticated;

create function public.ops_desk_calls(p_incident uuid default null, p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare c record;
begin
  perform private.uid_or_deny();
  if not (private.is_admin() or private.credential_is_cmo()) then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into c from private.cap_caller();
  return coalesce((
    select jsonb_agg(x order by x ->> 'called_at' desc) from (
      select jsonb_build_object('id', l.id, 'incident_id', l.incident_id, 'incident_reference', i.reference, 'called_at', l.called_at,
               'called_by_name', coalesce(cb.full_name, 'Unnamed'), 'callee_kind', l.callee_kind, 'callee_name', coalesce(ce.full_name, 'Unnamed'), 'callee_phone_masked', l.callee_phone_masked,
               'outcome', l.outcome, 'note', l.note) as x
        from public.ops_desk_call_log l
        join public.ops_incidents i on i.id = l.incident_id
        join public.profiles cb on cb.id = l.called_by
        join public.profiles ce on ce.id = l.callee_profile_id
       where l.organisation_id = c.organisation_id and l.is_test = c.is_test and (p_incident is null or l.incident_id = p_incident)
       order by l.called_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) q), '[]'::jsonb);
end;
$$;
revoke all on function public.ops_desk_calls(uuid, integer) from public, anon;
grant execute on function public.ops_desk_calls(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Self-check
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  if (select (rules ->> 'checklist_gates_readiness') from public.ops_desk_config where is_active) <> '0' then raise exception 'ops desk: the gate must ship off'; end if;
  if exists (select 1 from public.ops_desk_config where version = 2 and (is_active or approved_at is not null)) then raise exception 'ops desk: v2 must be inactive and unsigned'; end if;
  if exists (select 1 from public.ops_desk_contacts) or exists (select 1 from public.ops_desk_checklist_attestations) then raise exception 'ops desk: nothing may be seeded'; end if;
  foreach f in array array['public.ops_desk_save_contact(uuid,text)', 'public.ops_desk_set_windows(uuid,jsonb)', 'public.ops_desk_set_contact_active(uuid,boolean,text)',
      'public.ops_desk_acknowledge(uuid)', 'public.ops_desk_call_sheet(uuid)', 'public.log_ops_desk_call(uuid,text,uuid,text,text)', 'public.attest_ops_desk_item(text,text,text)',
      'public.ops_desk_roster()', 'public.ops_desk_overview(integer)', 'public.ops_desk_calls(uuid,integer)', 'public.sign_ops_desk_config(integer)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') or not has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'ops desk: wrong execute grants on %', f; end if;
  end loop;
  foreach f in array array['private.ops_desk_assign(uuid,text,uuid)', 'private.sweep_ops_desk()', 'private.ops_desk_on_duty(uuid,boolean,timestamptz)', 'private.verified_profile_phone(uuid)',
      'private.ops_desk_org_ready(uuid,boolean)', 'private.ops_desk_rule(text)', 'private.ops_desk_contact_usable(uuid)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'ops desk: % must not be callable', f; end if;
  end loop;
  foreach f in array array['ops_desk_contacts', 'ops_desk_contact_windows', 'ops_desk_assignments', 'ops_desk_call_log', 'ops_desk_checklist_attestations', 'ops_desk_config'] loop
    if has_table_privilege('anon', 'public.' || f, 'SELECT') or has_table_privilege('authenticated', 'public.' || f, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || f, 'UPDATE') or has_table_privilege('authenticated', 'public.' || f, 'DELETE') then
      raise exception 'ops desk: wrong table grants on %', f;
    end if;
  end loop;
end $$;
