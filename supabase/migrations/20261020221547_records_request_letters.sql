-- Records request letters (docs/design/RRL.md; spec 2.3 and 2.11): a patient-owned tool to ask a hospital for a copy of the person's own records,
-- print the letter, hand it over, and track whether the records came back.
--
-- No hospital integration exists, so the realistic way to fill a Passport is for the person to ask their facility. This migration adds only the
-- tracking: two tables, five patient functions, three bus events and a go-live guard that starts OFF. Nothing here sends anything to anyone: the person
-- prints, hands over or sends the letter themselves. No notification row is created (nothing may depend on a send); "overdue" is derived from the
-- row and shown in the app.
--
-- Additive only. LIVE COUNTS BEFORE: neither table exists. The migration touches no existing table, function, policy or enum, so it cannot change
-- behaviour for anyone who does not use it.
--
--   1. Bus events (ids only): records_request.created / .sent / .received.
--   2. records_requests: one row per request (own rows only; no client write grant; every write goes through a function below).
--   3. records_request_events: append-only history of each request (created, sent, received, withdrawn, note changed).
--   4. Patient functions: create_records_request, mark_records_request_sent, mark_records_request_received, withdraw_records_request,
--      set_records_request_note, my_records_requests.
--   5. Go-live guard records_request_letters, OFF. Creating a request and marking one sent refuse while it is off (a test patient may exercise it);
--      reading your own requests, marking one received and withdrawing one never refuse, so nobody's data is trapped.
--   6. Registered in the S39d data registry and the under-18 dependant policy (the standing proofs fail otherwise).

-- ---------------------------------------------------------------------------
-- 1. Bus events
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('records_request.created',  'A person prepared a letter asking a facility for their records', 'RRL', false),
  ('records_request.sent',     'A person said they handed the records request letter over',      'RRL', false),
  ('records_request.received', 'A person said the records they asked for have arrived',          'RRL', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys) values
  ('records_request.created', 1, array['request_id']),
  ('records_request.sent', 1, array['request_id']),
  ('records_request.received', 1, array['request_id'])
on conflict (event_type, version) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The requests
-- ---------------------------------------------------------------------------
create table public.records_requests (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  facility_name    text not null check (char_length(btrim(facility_name)) between 2 and 160),
  facility_contact text check (facility_contact is null or char_length(facility_contact) <= 200),
  scope_codes      text[] not null,
  state            text not null default 'prepared' check (state in ('prepared', 'sent', 'received', 'withdrawn')),
  -- the letter wording version the person printed (a key in versioned config, never the wording itself)
  letter_version   text not null check (letter_version ~ '^records_request\.letter@[0-9]+$'),
  requested_at     timestamptz,   -- when the person said they handed it over
  due_at           timestamptz,   -- requested_at + the configured placeholder period: a reminder date, not a legal deadline
  received_at      timestamptz,
  note             text check (note is null or char_length(note) <= 500),
  is_test          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (scope_codes <@ array['discharge_summary', 'lab_results', 'imaging_report', 'whole_record']::text[]
         and cardinality(scope_codes) between 1 and 4),
  check ((state = 'prepared') = (requested_at is null and due_at is null)
         or state in ('received', 'withdrawn')),
  check ((state = 'received') = (received_at is not null)),
  check (due_at is null or requested_at is null or due_at > requested_at)
);
create index records_requests_patient_idx on public.records_requests (patient_id, created_at desc);

create trigger records_requests_set_updated_at
  before update on public.records_requests
  for each row execute function private.set_updated_at();

alter table public.records_requests enable row level security;
create policy records_requests_select_own on public.records_requests
  for select to authenticated using (patient_id = (select auth.uid()));
revoke all on public.records_requests from anon, authenticated;
grant select on public.records_requests to authenticated;
comment on table public.records_requests is
  'A person''s own request to a facility for a copy of their records. Written only by the patient functions. Nothing is sent by the platform.';

-- ---------------------------------------------------------------------------
-- 3. Append-only history
-- ---------------------------------------------------------------------------
create table public.records_request_events (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  request_id       uuid not null references public.records_requests (id) on delete cascade,
  event            text not null check (event in ('created', 'sent', 'received', 'withdrawn', 'note_changed')),
  detail           jsonb not null default '{}'::jsonb,
  is_test          boolean not null default false,
  created_at       timestamptz not null default now()
);
create index records_request_events_request_idx on public.records_request_events (request_id, created_at);

create trigger records_request_events_append_only
  before update or delete on public.records_request_events
  for each row execute function private.reject_mutation();

alter table public.records_request_events enable row level security;
create policy records_request_events_select_own on public.records_request_events
  for select to authenticated using (patient_id = (select auth.uid()));
revoke all on public.records_request_events from anon, authenticated;
grant select on public.records_request_events to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Patient functions
-- ---------------------------------------------------------------------------
create or replace function private.records_request_actor() returns table (uid uuid, org uuid, test boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  return query select p.id, p.organisation_id, p.is_test from public.profiles p where p.id = v_uid and p.role = 'patient' and p.organisation_id is not null;
  if not found then raise exception 'this action is for patients' using errcode = '42501'; end if;
end;
$$;
revoke all on function private.records_request_actor() from public, anon, authenticated;

create or replace function public.create_records_request(
  p_facility text, p_contact text, p_scope text[], p_letter_version text, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  a record;
  v_id uuid;
  v_facility text := btrim(p_facility);
  v_scope text[];
begin
  select * into a from private.records_request_actor();
  if not private.go_live_open_patient('records_request_letters', a.uid) then
    raise exception 'records request letters are not open yet' using errcode = '55000';
  end if;
  if v_facility is null or char_length(v_facility) < 2 or char_length(v_facility) > 160 then raise exception 'a facility name is required' using errcode = '22023'; end if;
  if p_contact is not null and char_length(p_contact) > 200 then raise exception 'the facility contact is too long' using errcode = '22023'; end if;
  if p_note is not null and char_length(p_note) > 500 then raise exception 'the note is too long' using errcode = '22023'; end if;
  select array_agg(distinct s order by s) into v_scope from unnest(coalesce(p_scope, array[]::text[])) s;
  if v_scope is null or not (v_scope <@ array['discharge_summary', 'lab_results', 'imaging_report', 'whole_record']::text[]) then
    raise exception 'choose what you want from the list' using errcode = '22023';
  end if;
  if p_letter_version is null or p_letter_version !~ '^records_request\.letter@[0-9]+$' then raise exception 'unknown letter version' using errcode = '22023'; end if;

  insert into public.records_requests (organisation_id, patient_id, facility_name, facility_contact, scope_codes, letter_version, note, is_test)
  values (a.org, a.uid, v_facility, nullif(btrim(p_contact), ''), v_scope, p_letter_version, nullif(btrim(p_note), ''), coalesce(a.test, false))
  returning id into v_id;
  insert into public.records_request_events (organisation_id, patient_id, request_id, event, detail, is_test)
  values (a.org, a.uid, v_id, 'created', jsonb_build_object('letter_version', p_letter_version), coalesce(a.test, false));
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  values (a.org, a.uid, 'records_request.created', 'records_request', v_id, jsonb_build_object('scope_codes', v_scope), a.uid);
  perform private.emit_domain_event('records_request.created', a.org, jsonb_build_object('request_id', v_id),
    'records_request.created:' || v_id::text, a.uid, 'records_request', v_id);
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.mark_records_request_sent(p_id uuid, p_response_days integer) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  a record;
  r public.records_requests%rowtype;
begin
  select * into a from private.records_request_actor();
  if not private.go_live_open_patient('records_request_letters', a.uid) then
    raise exception 'records request letters are not open yet' using errcode = '55000';
  end if;
  if p_response_days is null or p_response_days < 1 or p_response_days > 180 then raise exception 'the reply period must be between 1 and 180 days' using errcode = '22023'; end if;
  update public.records_requests
     set state = 'sent', requested_at = now(), due_at = now() + make_interval(days => p_response_days)
   where id = p_id and patient_id = a.uid and state = 'prepared'
   returning * into r;
  if not found then raise exception 'that request is not waiting to be handed over' using errcode = 'P0002'; end if;
  insert into public.records_request_events (organisation_id, patient_id, request_id, event, detail, is_test)
  values (a.org, a.uid, r.id, 'sent', jsonb_build_object('response_days', p_response_days), r.is_test);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  values (a.org, a.uid, 'records_request.sent', 'records_request', r.id, jsonb_build_object('response_days', p_response_days), a.uid);
  perform private.emit_domain_event('records_request.sent', a.org, jsonb_build_object('request_id', r.id),
    'records_request.sent:' || r.id::text, a.uid, 'records_request', r.id);
  return jsonb_build_object('id', r.id, 'due_at', r.due_at);
end;
$$;

create or replace function public.mark_records_request_received(p_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  a record;
  r public.records_requests%rowtype;
begin
  select * into a from private.records_request_actor();
  update public.records_requests set state = 'received', received_at = now()
   where id = p_id and patient_id = a.uid and state in ('prepared', 'sent')
   returning * into r;
  if not found then raise exception 'that request cannot be marked received' using errcode = 'P0002'; end if;
  insert into public.records_request_events (organisation_id, patient_id, request_id, event, is_test) values (a.org, a.uid, r.id, 'received', r.is_test);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  values (a.org, a.uid, 'records_request.received', 'records_request', r.id, '{}'::jsonb, a.uid);
  perform private.emit_domain_event('records_request.received', a.org, jsonb_build_object('request_id', r.id),
    'records_request.received:' || r.id::text, a.uid, 'records_request', r.id);
  return jsonb_build_object('id', r.id);
end;
$$;

create or replace function public.withdraw_records_request(p_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  a record;
  r public.records_requests%rowtype;
begin
  select * into a from private.records_request_actor();
  update public.records_requests set state = 'withdrawn'
   where id = p_id and patient_id = a.uid and state in ('prepared', 'sent')
   returning * into r;
  if not found then raise exception 'that request cannot be withdrawn' using errcode = 'P0002'; end if;
  insert into public.records_request_events (organisation_id, patient_id, request_id, event, is_test) values (a.org, a.uid, r.id, 'withdrawn', r.is_test);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  values (a.org, a.uid, 'records_request.withdrawn', 'records_request', r.id, '{}'::jsonb, a.uid);
  return jsonb_build_object('id', r.id);
end;
$$;

create or replace function public.set_records_request_note(p_id uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  a record;
  r public.records_requests%rowtype;
begin
  select * into a from private.records_request_actor();
  if p_note is not null and char_length(p_note) > 500 then raise exception 'the note is too long' using errcode = '22023'; end if;
  update public.records_requests set note = nullif(btrim(p_note), '')
   where id = p_id and patient_id = a.uid
   returning * into r;
  if not found then raise exception 'request not found' using errcode = 'P0002'; end if;
  -- the history records that the note changed, not its text (the note is the person's own words and lives on the row)
  insert into public.records_request_events (organisation_id, patient_id, request_id, event, detail, is_test)
  values (a.org, a.uid, r.id, 'note_changed', jsonb_build_object('length', coalesce(char_length(r.note), 0)), r.is_test);
  return jsonb_build_object('id', r.id);
end;
$$;

create or replace function public.my_records_requests()
returns table (
  id uuid, facility_name text, facility_contact text, scope_codes text[], state text, letter_version text,
  requested_at timestamptz, due_at timestamptz, received_at timestamptz, note text, created_at timestamptz, is_overdue boolean
)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.facility_name, r.facility_contact, r.scope_codes, r.state, r.letter_version, r.requested_at, r.due_at, r.received_at, r.note, r.created_at,
         (r.state = 'sent' and r.due_at is not null and r.due_at < now()) as is_overdue
    from public.records_requests r
   where r.patient_id = (select auth.uid())
   order by r.created_at desc
$$;

revoke all on function public.create_records_request(text, text, text[], text, text) from public, anon;
revoke all on function public.mark_records_request_sent(uuid, integer) from public, anon;
revoke all on function public.mark_records_request_received(uuid) from public, anon;
revoke all on function public.withdraw_records_request(uuid) from public, anon;
revoke all on function public.set_records_request_note(uuid, text) from public, anon;
revoke all on function public.my_records_requests() from public, anon;
grant execute on function public.create_records_request(text, text, text[], text, text) to authenticated;
grant execute on function public.mark_records_request_sent(uuid, integer) to authenticated;
grant execute on function public.mark_records_request_received(uuid) to authenticated;
grant execute on function public.withdraw_records_request(uuid) to authenticated;
grant execute on function public.set_records_request_note(uuid, text) to authenticated;
grant execute on function public.my_records_requests() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Go-live guard (OFF)
-- ---------------------------------------------------------------------------
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in)
select 'records_request_letters', 'Records request letters', 'Preparing and tracking a letter that asks a facility for the person''s own records',
       'Counsel has reviewed and signed the letter wording and the reply period; the founder confirms', 'admin',
       array['create_records_request', 'mark_records_request_sent', 'the letter and tracker screens'],
       'Reading your own requests, marking one received and withdrawing one are never blocked. Switching it on needs its conditions added to private.go_live_conditions first; until then it reports "no defined condition" and cannot be switched on.'
where not exists (select 1 from public.go_live_guards where key = 'records_request_letters');

-- ---------------------------------------------------------------------------
-- 6. Registries the standing proofs check
-- ---------------------------------------------------------------------------
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
select t.table_name, 'patient_id', private.retention_class_for(t.table_name),
       case when private.retention_class_for(t.table_name) = 'operational' then 'delete' else 'review' end,
       private.retention_class_for(t.table_name) <> 'audit',
       'Records request letters 2026-10-20: PROPOSED classification, to be confirmed by the CMO and DPO.'
  from unnest(array['records_requests', 'records_request_events']) as t(table_name)
on conflict (table_name) do nothing;

select private.guard_minor_dependant_table('records_requests', 'patient_id');
select private.guard_minor_dependant_table('records_request_events', 'patient_id');

-- ---------------------------------------------------------------------------
-- Self-checks
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
  t text;
begin
  foreach t in array array['records_requests', 'records_request_events'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = t and c.relrowsecurity) then
      raise exception 'records request self-check: % has no row level security', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'SELECT') or has_table_privilege('authenticated', 'public.' || t, 'INSERT')
       or has_table_privilege('authenticated', 'public.' || t, 'UPDATE') or has_table_privilege('authenticated', 'public.' || t, 'DELETE') then
      raise exception 'records request self-check: % allows a client to read as anon or write directly', t;
    end if;
    if not has_table_privilege('authenticated', 'public.' || t, 'SELECT') then
      raise exception 'records request self-check: authenticated cannot read %', t;
    end if;
    if not exists (select 1 from public.data_registry where table_name = t) then raise exception 'records request self-check: % is not in the data registry', t; end if;
    if not exists (select 1 from public.minor_dependant_table_policy where table_name = t) then raise exception 'records request self-check: % has no dependant policy', t; end if;
  end loop;
  foreach f in array array[
    'public.create_records_request(text, text, text[], text, text)', 'public.mark_records_request_sent(uuid, integer)',
    'public.mark_records_request_received(uuid)', 'public.withdraw_records_request(uuid)',
    'public.set_records_request_note(uuid, text)', 'public.my_records_requests()'] loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'records request self-check: anon can execute %', f; end if;
    if not has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'records request self-check: authenticated cannot execute %', f; end if;
  end loop;
  if has_function_privilege('anon', 'private.records_request_actor()', 'EXECUTE') or has_function_privilege('authenticated', 'private.records_request_actor()', 'EXECUTE') then
    raise exception 'records request self-check: the actor helper is callable by a client';
  end if;
  if not exists (select 1 from public.go_live_guards where key = 'records_request_letters') then raise exception 'records request self-check: the guard is missing'; end if;
  if exists (select 1 from public.go_live_guards where key = 'records_request_letters' and is_on) then raise exception 'records request self-check: the guard must start off'; end if;
  if (select count(*) from public.event_types where event_type in ('records_request.created', 'records_request.sent', 'records_request.received')) <> 3 then
    raise exception 'records request self-check: an event type is missing';
  end if;
end $$;
