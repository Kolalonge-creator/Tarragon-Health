-- S20 v2 speak-up (plan Stage 4, defect Q2, CMO decision 7 recorded 2026-10-07). Preserves every v1 guarantee: operations and admin
-- accounts cannot read a concern, its messages or its identity; no domain event, audit_log row or export names a concern.
--
--   * Named backup readers can no longer be admin accounts. Enforced in the add-reader RPC, by a trigger on the readers table and
--     by a trigger on profiles (a later role change to admin deactivates that person's reader row), and again in every reader check
--     (defence in depth: even a stray active row of an admin reads nothing).
--   * A reader can be an EXTERNAL independent person: safety_concern_readers.kind = 'independent' (any non-admin login, no clinician
--     record needed). A concern raised by the chief medical officer, or marked "about the clinical lead", is routed 'independent_only':
--     only independent readers can read it, never the lead.
--   * Optional anonymous intake: no raiser id is stored; a one-time follow-up code (kept only as a hash) is the way back.
--   * The raiser sees the status; detriment check-ins at 30 and 90 days (config in quality_config v2, inert until it is signed) go to
--     the raiser in-app and by email with neutral wording; a "problem" answer opens a retaliation review.
--   * An aggregate-only board report (counts by state and age, never text).
--
-- Replay note: public.raise_safety_concern(text, text, text, text, uuid) and public.add_safety_concern_backup_reader(uuid, text) are
-- DROPPED and recreated with defaulted trailing parameters (no second overload, so bare-literal calls stay unambiguous). The old
-- private.concern_reader(timestamptz, uuid) is dropped after every caller moved to private.concern_visible (otherwise a stale
-- permissive helper would remain). Counts before this migration: reader rows are checked below (admin readers are deactivated).

-- ---------------------------------------------------------------------------
-- 1. Readers
-- ---------------------------------------------------------------------------
alter table public.safety_concern_readers
  add column kind text not null default 'clinician' check (kind in ('clinician', 'independent'));

-- Who can be a reader: an ordinary login (a clinician, or an outside person with a patient-type account) and, for a clinician reader, one who is
-- still working. Any operations-type role (admin, finance, analyst, pharmacist, lab and payer roles ...) is not allowed: an allow-list, not "not admin".
create function private.reader_row_ok(p_profile uuid, p_kind text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = p_profile and p.is_active and p.role in ('clinician', 'patient'))
     and (p_kind = 'independent' or exists (select 1 from public.clinical_staff cs where cs.profile_id = p_profile and cs.active and cs.status = 'active'));
$$;
revoke all on function private.reader_row_ok(uuid, text) from public, anon, authenticated;

-- any existing reader who fails the rule is switched off here (an admin account, or a clinician who is no longer working)
update public.safety_concern_readers r set active = false where r.active and not private.reader_row_ok(r.profile_id, r.kind);

create function private.guard_concern_reader() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.active and not exists (select 1 from public.profiles p where p.id = new.profile_id and p.role in ('clinician', 'patient')) then
    raise exception 'only an ordinary clinician or outside-person account can be a safety concern reader' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_concern_reader() from public, anon, authenticated;
create trigger safety_concern_readers_no_admin before insert or update of active, profile_id on public.safety_concern_readers
  for each row execute function private.guard_concern_reader();

create function private.profile_role_reader_sync() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.safety_concern_readers set active = false where profile_id = new.id and active;
  return null;
end;
$$;
revoke all on function private.profile_role_reader_sync() from public, anon, authenticated;
create trigger profiles_role_admin_drops_reader after update of role on public.profiles
  for each row when (new.role not in ('clinician', 'patient') and old.role is distinct from new.role)
  execute function private.profile_role_reader_sync();

-- a reader check that also refuses an admin account (belt and braces) and an inactive login
create or replace function private.backup_reader(p_org uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.safety_concern_readers r join public.profiles p on p.id = r.profile_id
                  where r.profile_id = (select auth.uid()) and r.active and r.organisation_id = p_org and private.reader_row_ok(r.profile_id, r.kind));
$$;

create function private.independent_reader(p_org uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.safety_concern_readers r join public.profiles p on p.id = r.profile_id
                  where r.profile_id = (select auth.uid()) and r.active and r.kind = 'independent' and r.organisation_id = p_org and private.reader_row_ok(r.profile_id, r.kind));
$$;
revoke all on function private.independent_reader(uuid) from public, anon;
grant execute on function private.independent_reader(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Concerns: routing, anonymity, check-ins
-- ---------------------------------------------------------------------------
alter table public.safety_concerns
  add column independent_reminded_at timestamptz,
  add column routing              text not null default 'standard' check (routing in ('standard', 'independent_only')),
  add column anonymous            boolean not null default false,
  add column follow_up_code_hash  text;
alter table public.safety_concerns alter column raised_by drop not null;
alter table public.safety_concerns
  add constraint safety_concerns_anonymous_shape check (anonymous = (raised_by is null)),
  add constraint safety_concerns_anonymous_has_code check (not anonymous or follow_up_code_hash is not null);
create unique index safety_concerns_follow_up_code_idx on public.safety_concerns (follow_up_code_hash) where follow_up_code_hash is not null;

-- concerns the chief medical officer raised before this migration move to the independent route
update public.safety_concerns c set routing = 'independent_only'
 where exists (select 1 from public.clinical_staff cs where cs.profile_id = c.raised_by and cs.doctor_tier = 'chief_medical_officer');

alter table public.retaliation_reviews add column routing text not null default 'standard' check (routing in ('standard', 'independent_only'));

create table public.safety_concern_checkins (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  concern_id      uuid not null references public.safety_concerns (id) on delete cascade,
  window_days     integer not null check (window_days > 0),
  sent_at         timestamptz not null default now(),
  answered_at     timestamptz,
  answer          text check (answer in ('fine', 'problem')),
  note            text check (note is null or char_length(note) <= 2000),
  is_test         boolean not null default false,
  unique (concern_id, window_days),
  check ((answer is null) = (answered_at is null))
);

create function private.concern_visible(p_routing text, p_escalated timestamptz, p_org uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case when p_routing = 'independent_only' then private.independent_reader(p_org)
              else private.cmo_of(p_org) or (p_escalated is not null and private.backup_reader(p_org)) end;
$$;
revoke all on function private.concern_visible(text, timestamptz, uuid) from public, anon;
grant execute on function private.concern_visible(text, timestamptz, uuid) to authenticated;

create function private.retaliation_visible(p_routing text, p_org uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select case when p_routing = 'independent_only' then private.independent_reader(p_org) else private.cmo_of(p_org) or private.backup_reader(p_org) end; $$;
revoke all on function private.retaliation_visible(text, uuid) from public, anon;
grant execute on function private.retaliation_visible(text, uuid) to authenticated;

drop policy safety_concerns_select on public.safety_concerns;
drop policy safety_concern_messages_select on public.safety_concern_messages;
drop policy retaliation_reviews_select on public.retaliation_reviews;
drop policy safety_concern_readers_select on public.safety_concern_readers;
create policy safety_concerns_select on public.safety_concerns for select to authenticated
  using (raised_by = (select auth.uid()) or private.concern_visible(routing, escalated_at, organisation_id));
create policy safety_concern_messages_select on public.safety_concern_messages for select to authenticated
  using (exists (select 1 from public.safety_concerns c where c.id = concern_id
                   and ((c.raised_by = (select auth.uid()) and kind in ('response', 'note', 'acknowledged', 'closed')) or private.concern_visible(c.routing, c.escalated_at, c.organisation_id))));
create policy retaliation_reviews_select on public.retaliation_reviews for select to authenticated using (private.retaliation_visible(routing, organisation_id));
create policy safety_concern_readers_select on public.safety_concern_readers for select to authenticated
  using (private.cmo_of(organisation_id) or profile_id = (select auth.uid()));

alter table public.safety_concern_checkins enable row level security;
create policy safety_concern_checkins_select on public.safety_concern_checkins for select to authenticated
  using (exists (select 1 from public.safety_concerns c where c.id = concern_id
                   and (c.raised_by = (select auth.uid()) or private.concern_visible(c.routing, c.escalated_at, c.organisation_id))));
revoke all on public.safety_concern_checkins from public, anon, authenticated;
grant select on public.safety_concern_checkins to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Notifying (neutral text only, INV-07)
-- ---------------------------------------------------------------------------
create function private.notify_independent_readers(p_org uuid, p_is_test boolean, p_subject text, p_message text, p_payload jsonb default '{}'::jsonb) returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; n integer := 0;
begin
  for r in select rd.profile_id from public.safety_concern_readers rd join public.profiles p on p.id = rd.profile_id
            where rd.active and rd.kind = 'independent' and rd.organisation_id = p_org and rd.is_test = p_is_test and private.reader_row_ok(rd.profile_id, rd.kind) loop
    perform private.credential_notify(r.profile_id, p_org, p_subject, p_message, coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('audience', 'concern_reader'), true);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function private.notify_independent_readers(uuid, boolean, text, text, jsonb) from public, anon, authenticated;

-- every reader (clinician or independent) that is not an admin account
create or replace function private.notify_backup_readers(p_org uuid, p_is_test boolean, p_subject text, p_message text, p_payload jsonb default '{}'::jsonb) returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; n integer := 0;
begin
  for r in select rd.profile_id from public.safety_concern_readers rd join public.profiles p on p.id = rd.profile_id
            where rd.active and rd.organisation_id = p_org and rd.is_test = p_is_test and private.reader_row_ok(rd.profile_id, rd.kind) loop
    perform private.credential_notify(r.profile_id, p_org, p_subject, p_message, coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('audience', 'concern_reader'), true);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Raising a concern
-- ---------------------------------------------------------------------------
drop function if exists public.raise_safety_concern(text, text, text, text, uuid);

create function public.raise_safety_concern(p_category text, p_severity text, p_description text, p_screen text default null, p_task uuid default null, p_about_lead boolean default false)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.uid_or_deny(); s public.clinical_staff%rowtype; c jsonb := private.quality_setting('speak_up'); v_id uuid;
  v_ack interval; v_by_cmo boolean; v_route text;
begin
  select * into s from public.clinical_staff where profile_id = v_uid;
  if not found then raise exception 'only clinicians can raise a safety concern here' using errcode = '42501'; end if;
  if p_severity in ('low', 'medium')
     and (select count(*) from public.safety_concerns where raised_by = v_uid and created_at > now() - interval '24 hours') >= (c ->> 'max_per_day')::integer then
    raise exception 'you have raised many concerns today; please speak to the clinical lead directly, or mark it high or immediate if it cannot wait' using errcode = '54000';
  end if;
  if p_task is not null and not exists (select 1 from public.task_claims tc where tc.task_id = p_task and tc.clinician_id = v_uid) then
    raise exception 'that task is not one you worked on' using errcode = '22023';
  end if;
  v_ack := make_interval(hours => case when p_severity = 'immediate' then (c ->> 'immediate_acknowledge_hours')::integer else (c ->> 'acknowledge_hours')::integer end);
  v_by_cmo := s.doctor_tier = 'chief_medical_officer';
  -- decision 7: a concern raised by the clinical lead, or about the clinical lead, is read only by an independent reader, never by the lead
  v_route := case when v_by_cmo or coalesce(p_about_lead, false) then 'independent_only' else 'standard' end;
  insert into public.safety_concerns (organisation_id, raised_by, category, severity, description, screen, task_id, acknowledge_due_at, respond_due_at, escalated_at, routing, is_test)
  values (s.organisation_id, v_uid, p_category, p_severity, p_description, left(p_screen, 100), p_task, now() + v_ack,
          now() + make_interval(days => (c ->> 'respond_days')::integer), case when v_route = 'independent_only' then now() end, v_route, s.is_test)
  returning id into v_id;
  insert into public.safety_concern_messages (concern_id, author_id, kind, body) values (v_id, v_uid, 'raised', null);
  if v_route = 'independent_only' and not exists (select 1 from public.safety_concern_readers rd where rd.active and rd.kind = 'independent' and rd.organisation_id = s.organisation_id and private.reader_row_ok(rd.profile_id, rd.kind))
     and not exists (select 1 from public.ops_incidents where external_reference = 'clinical_safety_overdue' and status not in ('resolved', 'closed')) then
    insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values (s.organisation_id, 'clinical', 'sev2', 'A clinical safety item is overdue',
            'An item held by the clinical lead area has no reader who may open it. Details are not available to operations.', 'clinical_safety_overdue', now(), now());
  end if;
  if v_route = 'independent_only' then
    perform private.notify_independent_readers(s.organisation_id, s.is_test, 'A new item needs your attention', 'A new item needs your attention in the clinical lead area.',
      jsonb_build_object('i18n_key', 'quality.concern_new'));
  else
    perform private.notify_clinical_leads(s.organisation_id, s.is_test, 'A new item needs your attention', 'A new item needs your attention in the clinical lead area.',
      jsonb_build_object('i18n_key', 'quality.concern_new'), v_uid, true);
  end if;
  return v_id;
end;
$$;

-- Anonymous intake. The caller must be a clinician (so a stranger cannot flood the route) but the row stores no id: only the
-- organisation and a hash of a one-time follow-up code, returned once. Limits: the request itself passes through the platform's
-- infrastructure logs, which this function cannot hide (docs/design/S16-S20-quality-v2.md).
create function public.raise_anonymous_safety_concern(p_category text, p_severity text, p_description text, p_about_lead boolean default false) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.uid_or_deny(); s public.clinical_staff%rowtype; c jsonb := private.quality_setting('speak_up'); v_id uuid; v_code text; v_ack interval; v_route text;
begin
  select * into s from public.clinical_staff where profile_id = v_uid;
  if not found then raise exception 'only clinicians can raise a safety concern here' using errcode = '42501'; end if;
  if p_severity in ('low', 'medium')
     and (select count(*) from public.safety_concerns where anonymous and organisation_id = s.organisation_id and created_at > now() - interval '24 hours')
         >= coalesce((c ->> 'anonymous_max_per_day_per_org')::integer, (c ->> 'max_per_day')::integer) then
    raise exception 'many anonymous concerns have been raised today; please speak to the clinical lead directly, or mark it high or immediate if it cannot wait' using errcode = '54000';
  end if;
  v_ack := make_interval(hours => case when p_severity = 'immediate' then (c ->> 'immediate_acknowledge_hours')::integer else (c ->> 'acknowledge_hours')::integer end);
  v_route := case when s.doctor_tier = 'chief_medical_officer' or coalesce(p_about_lead, false) then 'independent_only' else 'standard' end;
  v_code := upper(encode(extensions.gen_random_bytes(8), 'hex'));
  insert into public.safety_concerns (organisation_id, raised_by, category, severity, description, acknowledge_due_at, respond_due_at, escalated_at, routing, anonymous, follow_up_code_hash, is_test)
  values (s.organisation_id, null, p_category, p_severity, p_description, now() + v_ack, now() + make_interval(days => (c ->> 'respond_days')::integer),
          case when v_route = 'independent_only' then now() end, v_route, true, encode(extensions.digest(v_code, 'sha256'), 'hex'), s.is_test)
  returning id into v_id;
  insert into public.safety_concern_messages (concern_id, author_id, kind, body) values (v_id, null, 'raised', null);
  if v_route = 'independent_only' and not exists (select 1 from public.safety_concern_readers rd where rd.active and rd.kind = 'independent' and rd.organisation_id = s.organisation_id and private.reader_row_ok(rd.profile_id, rd.kind))
     and not exists (select 1 from public.ops_incidents where external_reference = 'clinical_safety_overdue' and status not in ('resolved', 'closed')) then
    insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values (s.organisation_id, 'clinical', 'sev2', 'A clinical safety item is overdue',
            'An item held by the clinical lead area has no reader who may open it. Details are not available to operations.', 'clinical_safety_overdue', now(), now());
  end if;
  if v_route = 'independent_only' then
    perform private.notify_independent_readers(s.organisation_id, s.is_test, 'A new item needs your attention', 'A new item needs your attention in the clinical lead area.',
      jsonb_build_object('i18n_key', 'quality.concern_new'));
  else
    perform private.notify_clinical_leads(s.organisation_id, s.is_test, 'A new item needs your attention', 'A new item needs your attention in the clinical lead area.',
      jsonb_build_object('i18n_key', 'quality.concern_new'), null, true);
  end if;
  return substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4) || '-' || substr(v_code, 13, 4);
end;
$$;

create function private.concern_by_code(p_code text) returns public.safety_concerns
language plpgsql security definer set search_path = ''
as $$
declare c public.safety_concerns%rowtype; v_clean text := upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g'));
begin
  perform private.uid_or_deny();
  select * into c from public.safety_concerns where anonymous and follow_up_code_hash = encode(extensions.digest(v_clean, 'sha256'), 'hex');
  if not found then raise exception 'that code was not found' using errcode = 'P0002'; end if;
  return c;
end;
$$;
revoke all on function private.concern_by_code(text) from public, anon, authenticated;

create function public.anonymous_concern_status(p_code text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare c public.safety_concerns%rowtype;
begin
  c := private.concern_by_code(p_code);
  return jsonb_build_object('state', c.state, 'created_at', c.created_at, 'acknowledge_due_at', c.acknowledge_due_at, 'respond_due_at', c.respond_due_at,
    'acknowledged_at', c.acknowledged_at, 'responded_at', c.responded_at, 'closed_at', c.closed_at,
    'messages', coalesce((select jsonb_agg(jsonb_build_object('kind', m.kind, 'body', m.body, 'mine', m.author_id is null and m.kind in ('raised', 'note'), 'created_at', m.created_at) order by m.created_at)
                            from public.safety_concern_messages m where m.concern_id = c.id and m.kind in ('response', 'note', 'acknowledged', 'closed')), '[]'::jsonb),
    'checkins', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'window_days', k.window_days, 'sent_at', k.sent_at, 'answered_at', k.answered_at) order by k.window_days)
                            from public.safety_concern_checkins k where k.concern_id = c.id), '[]'::jsonb));
end;
$$;

create function public.add_to_anonymous_concern(p_code text, p_body text) returns void
language plpgsql security definer set search_path = ''
as $$
declare c public.safety_concerns%rowtype;
begin
  c := private.concern_by_code(p_code);
  if c.state = 'closed' then raise exception 'this concern is closed; raise a new one' using errcode = '23514'; end if;
  if char_length(btrim(coalesce(p_body, ''))) < 5 then raise exception 'write at least a few words' using errcode = '22023'; end if;
  insert into public.safety_concern_messages (concern_id, author_id, kind, body) values (c.id, null, 'note', btrim(p_body));
  if c.routing = 'independent_only' then
    perform private.notify_independent_readers(c.organisation_id, c.is_test, 'A new item needs your attention', 'A new item needs your attention in the clinical lead area.', jsonb_build_object('i18n_key', 'quality.concern_new'));
  else
    perform private.notify_clinical_leads(c.organisation_id, c.is_test, 'A new item needs your attention', 'A new item needs your attention in the clinical lead area.', jsonb_build_object('i18n_key', 'quality.concern_new'), null, false);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Reading and acting (readers only)
-- ---------------------------------------------------------------------------
create or replace function public.my_safety_concerns() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := private.uid_or_deny();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'category', c.category, 'severity', c.severity, 'description', c.description, 'state', c.state,
      'created_at', c.created_at, 'acknowledge_due_at', c.acknowledge_due_at, 'respond_due_at', c.respond_due_at, 'acknowledged_at', c.acknowledged_at,
      'responded_at', c.responded_at, 'closed_at', c.closed_at,
      'messages', coalesce((select jsonb_agg(jsonb_build_object('kind', m.kind, 'body', m.body, 'mine', m.author_id = v_uid, 'created_at', m.created_at) order by m.created_at)
                              from public.safety_concern_messages m where m.concern_id = c.id and m.kind in ('response', 'note', 'acknowledged', 'closed')), '[]'::jsonb),
      'checkins', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'window_days', k.window_days, 'sent_at', k.sent_at, 'answered_at', k.answered_at) order by k.window_days)
                              from public.safety_concern_checkins k where k.concern_id = c.id), '[]'::jsonb))
      order by c.created_at desc) from public.safety_concerns c where c.raised_by = v_uid), '[]'::jsonb);
end;
$$;

-- an independent reader is not a clinician, so the test flag falls back to the profile's own
create or replace function private.caller_is_test() returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select is_test from public.profiles where id = (select auth.uid())), false); $$;
revoke all on function private.caller_is_test() from public, anon;
grant execute on function private.caller_is_test() to authenticated;

create or replace function public.safety_concern_inbox(p_state text default null) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.uid_or_deny();
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'raised_by', c.raised_by, 'raised_by_name', cs.full_name, 'anonymous', c.anonymous, 'routing', c.routing,
      'category', c.category, 'severity', c.severity,
      'description', c.description, 'screen', c.screen, 'task_id', c.task_id, 'state', c.state, 'created_at', c.created_at,
      'acknowledge_due_at', c.acknowledge_due_at, 'respond_due_at', c.respond_due_at, 'overdue', c.state = 'new' and c.acknowledge_due_at < now(),
      'escalated_at', c.escalated_at, 'incident_id', c.incident_id,
      'messages', coalesce((select jsonb_agg(jsonb_build_object('kind', m.kind, 'body', m.body, 'author_id', m.author_id, 'created_at', m.created_at) order by m.created_at)
                              from public.safety_concern_messages m where m.concern_id = c.id), '[]'::jsonb))
      order by (c.state = 'new') desc, c.acknowledge_due_at)
    from public.safety_concerns c left join public.clinical_staff cs on cs.profile_id = c.raised_by
   where private.concern_visible(c.routing, c.escalated_at, c.organisation_id) and c.is_test = private.caller_is_test()
     and (p_state is null or c.state = p_state)), '[]'::jsonb);
end;
$$;

create or replace function private.concern_for_action(p_concern uuid) returns public.safety_concerns
language plpgsql security definer set search_path = ''
as $$
declare c public.safety_concerns%rowtype;
begin
  perform private.uid_or_deny();
  select * into c from public.safety_concerns where id = p_concern for update;
  if not found or not private.concern_visible(c.routing, c.escalated_at, c.organisation_id) then raise exception 'concern not found' using errcode = 'P0002'; end if;
  return c;
end;
$$;

create or replace function public.acknowledge_safety_concern(p_concern uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); c public.safety_concerns%rowtype;
begin
  c := private.concern_for_action(p_concern);
  if c.state <> 'new' then return; end if;
  update public.safety_concerns set state = 'acknowledged', acknowledged_at = now(), acknowledged_by = v_uid where id = c.id;
  insert into public.safety_concern_messages (concern_id, author_id, kind, body) values (c.id, v_uid, 'acknowledged', 'Your concern was received and is being looked at.');
  if c.raised_by is not null then
    perform private.credential_notify(c.raised_by, c.organisation_id, 'Your concern was received', 'Your concern was received. You can follow it under Raise a safety concern.',
      jsonb_build_object('i18n_key', 'quality.concern_ack'), false);
  end if;
end;
$$;

create or replace function public.respond_to_safety_concern(p_concern uuid, p_body text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); c public.safety_concerns%rowtype;
begin
  c := private.concern_for_action(p_concern);
  if c.state = 'closed' then raise exception 'this concern is closed' using errcode = '23514'; end if;
  if char_length(btrim(coalesce(p_body, ''))) < 20 then raise exception 'write a response of at least 20 characters' using errcode = '22023'; end if;
  update public.safety_concerns set state = 'responded', responded_at = coalesce(responded_at, now()),
         acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by = coalesce(acknowledged_by, v_uid) where id = c.id;
  insert into public.safety_concern_messages (concern_id, author_id, kind, body) values (c.id, v_uid, 'response', btrim(p_body));
  if c.raised_by is not null then
    perform private.credential_notify(c.raised_by, c.organisation_id, 'You have a reply', 'You have a reply to your concern. Open it under Raise a safety concern.',
      jsonb_build_object('i18n_key', 'quality.concern_reply'), false);
  end if;
end;
$$;

create or replace function public.close_safety_concern(p_concern uuid, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); c public.safety_concerns%rowtype;
begin
  c := private.concern_for_action(p_concern);
  if c.state = 'closed' then return; end if;
  if c.responded_at is null then raise exception 'respond to the person who raised it before closing' using errcode = '23514'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 20 then raise exception 'say what was done, in at least 20 characters' using errcode = '22023'; end if;
  update public.safety_concerns set state = 'closed', closed_at = now(), closed_by = v_uid, close_note = btrim(p_note) where id = c.id;
  insert into public.safety_concern_messages (concern_id, author_id, kind, body) values (c.id, v_uid, 'closed', btrim(p_note));
  if c.raised_by is not null then
    perform private.credential_notify(c.raised_by, c.organisation_id, 'Your concern was closed', 'Your concern was closed. You can read the outcome under Raise a safety concern.',
      jsonb_build_object('i18n_key', 'quality.concern_closed'), false);
  end if;
end;
$$;

create or replace function public.add_to_safety_concern(p_concern uuid, p_body text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.uid_or_deny(); c public.safety_concerns%rowtype;
begin
  select * into c from public.safety_concerns where id = p_concern and raised_by = v_uid;
  if not found then raise exception 'concern not found' using errcode = 'P0002'; end if;
  if c.state = 'closed' then raise exception 'this concern is closed; raise a new one' using errcode = '23514'; end if;
  if char_length(btrim(coalesce(p_body, ''))) < 5 then raise exception 'write at least a few words' using errcode = '22023'; end if;
  insert into public.safety_concern_messages (concern_id, author_id, kind, body) values (c.id, v_uid, 'note', btrim(p_body));
  if c.routing = 'independent_only' then
    perform private.notify_independent_readers(c.organisation_id, c.is_test, 'A new item needs your attention', 'A new item needs your attention in the clinical lead area.', jsonb_build_object('i18n_key', 'quality.concern_new'));
  else
    perform private.notify_clinical_leads(c.organisation_id, c.is_test, 'A new item needs your attention', 'A new item needs your attention in the clinical lead area.',
      jsonb_build_object('i18n_key', 'quality.concern_new'), v_uid, false);
  end if;
end;
$$;

-- named readers: never an admin account; an independent reader can be anyone who is not an admin and not the clinical lead
drop function if exists public.add_safety_concern_backup_reader(uuid, text);
create function public.add_safety_concern_backup_reader(p_profile uuid, p_note text default null, p_kind text default 'clinician') returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.uid_or_deny(); v_org uuid; v_test boolean; v_role public.user_role;
begin
  if not private.credential_is_cmo() then raise exception 'only the clinical lead can name a backup reader' using errcode = '42501'; end if;
  if p_kind not in ('clinician', 'independent') then raise exception 'unknown reader kind' using errcode = '22023'; end if;
  select p.organisation_id, p.is_test, p.role into v_org, v_test, v_role from public.profiles p
   where p.id = p_profile and p.is_active and p.organisation_id = private.caller_org();
  if v_org is null or (v_role not in ('clinician', 'patient') and p_kind = 'clinician') then raise exception 'that person was not found' using errcode = 'P0002'; end if;
  if v_role = 'admin' then raise exception 'an admin account cannot be a safety concern reader' using errcode = '23514'; end if;
  if v_role not in ('clinician', 'patient') then raise exception 'only an ordinary clinician or outside-person account can be a safety concern reader' using errcode = '23514'; end if;
  if p_kind = 'clinician' and (v_role <> 'clinician' or not exists (select 1 from public.clinical_staff cs where cs.profile_id = p_profile and cs.active and cs.status = 'active')) then
    raise exception 'that person was not found' using errcode = 'P0002';
  end if;
  if p_profile = v_uid or exists (select 1 from public.clinical_staff cs where cs.profile_id = p_profile and cs.doctor_tier = 'chief_medical_officer' and cs.active) then
    raise exception 'the clinical lead cannot name themselves or another lead as a reader' using errcode = '23514';
  end if;
  -- turning the last independent reader into a clinician reader would orphan the concerns only they may read
  if p_kind = 'clinician' and exists (select 1 from public.safety_concern_readers x where x.profile_id = p_profile and x.kind = 'independent' and x.active)
     and not exists (select 1 from public.safety_concern_readers o where o.kind = 'independent' and o.active and o.organisation_id = v_org and o.profile_id <> p_profile)
     and exists (select 1 from public.safety_concerns c where c.organisation_id = v_org and c.routing = 'independent_only' and c.state <> 'closed') then
    raise exception 'an open concern needs this independent reader; name another independent reader first' using errcode = '23514';
  end if;
  insert into public.safety_concern_readers (organisation_id, profile_id, note, added_by, is_test, kind) values (v_org, p_profile, p_note, v_uid, v_test, p_kind)
  on conflict (profile_id) do update set active = true, note = excluded.note, kind = excluded.kind;
end;
$$;

create or replace function public.remove_safety_concern_backup_reader(p_profile uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.safety_concern_readers%rowtype;
begin
  perform private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the clinical lead can remove a backup reader' using errcode = '42501'; end if;
  select * into r from public.safety_concern_readers where profile_id = p_profile and organisation_id = private.caller_org() and active;
  if not found then return; end if;
  -- the lead cannot switch off the only independent reader while a concern that only that reader may read is still open
  if r.kind = 'independent'
     and not exists (select 1 from public.safety_concern_readers o where o.kind = 'independent' and o.active and o.organisation_id = r.organisation_id and o.profile_id <> r.profile_id)
     and exists (select 1 from public.safety_concerns c where c.organisation_id = r.organisation_id and c.routing = 'independent_only' and c.state <> 'closed') then
    raise exception 'an open concern needs this independent reader; name another independent reader first' using errcode = '23514';
  end if;
  update public.safety_concern_readers set active = false where id = r.id;
end;
$$;

-- what a signed-in person is, as far as the speak-up route goes (drives which screen they see)
create function public.my_reader_status() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := private.uid_or_deny();
begin
  return jsonb_build_object(
    'is_reader', exists (select 1 from public.safety_concern_readers r join public.profiles p on p.id = r.profile_id where r.profile_id = v_uid and r.active and private.reader_row_ok(r.profile_id, r.kind)),
    'is_independent', exists (select 1 from public.safety_concern_readers r join public.profiles p on p.id = r.profile_id where r.profile_id = v_uid and r.active and r.kind = 'independent' and private.reader_row_ok(r.profile_id, r.kind)));
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Retaliation reviews follow the concern's route
-- ---------------------------------------------------------------------------
create or replace function private.note_adverse_action(p_profile uuid, p_kind text, p_ref text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid; v_test boolean; v_months integer := (private.quality_setting('speak_up') ->> 'retaliation_review_months')::integer; v_ins integer; v_route text;
begin
  select organisation_id, is_test into v_org, v_test from public.clinical_staff where profile_id = p_profile;
  if v_org is null or not exists (select 1 from public.safety_concerns where raised_by = p_profile and created_at > now() - make_interval(months => v_months)) then return; end if;
  -- someone who spoke up about the lead is protected from the lead: the review goes to the independent reader
  v_route := case when exists (select 1 from public.safety_concerns where raised_by = p_profile and routing = 'independent_only' and created_at > now() - make_interval(months => v_months))
                  then 'independent_only' else 'standard' end;
  insert into public.retaliation_reviews (organisation_id, clinician_id, trigger_kind, trigger_ref, routing, is_test) values (v_org, p_profile, p_kind, p_ref, v_route, v_test)
  on conflict (clinician_id, trigger_kind, trigger_ref) do nothing;
  get diagnostics v_ins = row_count;
  if v_ins > 0 then
    if v_route = 'independent_only' then
      perform private.notify_independent_readers(v_org, v_test, 'A new item needs your attention', 'A new item needs your attention in the clinical lead area.', jsonb_build_object('i18n_key', 'quality.concern_new'));
    else
      perform private.notify_clinical_leads(v_org, v_test, 'A new item needs your attention', 'A new item needs your attention in the clinical lead area.',
        jsonb_build_object('i18n_key', 'quality.concern_new'), p_profile, false);
      perform private.notify_backup_readers(v_org, v_test, 'A new item needs your attention', 'A new item needs your attention in the clinical lead area.', jsonb_build_object('i18n_key', 'quality.concern_new'));
    end if;
  end if;
end;
$$;

create or replace function public.retaliation_review_queue() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.uid_or_deny();
  if not (private.credential_is_cmo() or private.backup_reader(private.caller_org())) then raise exception 'not available' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'clinician_id', r.clinician_id, 'clinician_name', cs.full_name, 'trigger_kind', r.trigger_kind,
      'state', r.state, 'outcome', r.outcome, 'created_at', r.created_at, 'routing', r.routing) order by (r.state = 'open') desc, r.created_at desc)
    from public.retaliation_reviews r join public.clinical_staff cs on cs.profile_id = r.clinician_id
   where r.organisation_id = private.caller_org() and private.retaliation_visible(r.routing, r.organisation_id) and r.is_test = private.caller_is_test()), '[]'::jsonb);
end;
$$;

create or replace function public.close_retaliation_review(p_review uuid, p_outcome text, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := private.uid_or_deny(); r public.retaliation_reviews%rowtype;
begin
  select * into r from public.retaliation_reviews where id = p_review for update;
  if not found or not private.retaliation_visible(r.routing, r.organisation_id) then raise exception 'not available' using errcode = '42501'; end if;
  if r.state <> 'open' then raise exception 'there is no open review with that id' using errcode = '23514'; end if;
  if r.clinician_id = v_uid then raise exception 'you cannot close a review about yourself' using errcode = '42501'; end if;
  if p_outcome not in ('no_link', 'link_found', 'needs_follow_up') then raise exception 'unknown outcome' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'add a note of at least 10 characters' using errcode = '22023'; end if;
  update public.retaliation_reviews set state = 'closed', outcome = p_outcome, note = btrim(p_note), closed_by = v_uid, closed_at = now() where id = r.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Detriment check-ins (decision 7): neutral wording, in-app and email, answered by the raiser
-- ---------------------------------------------------------------------------
create function public.answer_concern_checkin(p_checkin uuid, p_answer text, p_note text default null, p_code text default null) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.uid_or_deny(); k public.safety_concern_checkins%rowtype; c public.safety_concerns%rowtype; v_months integer;
begin
  if p_answer not in ('fine', 'problem') then raise exception 'answer fine or problem' using errcode = '22023'; end if;
  select * into k from public.safety_concern_checkins where id = p_checkin for update;
  if not found then raise exception 'check-in not found' using errcode = 'P0002'; end if;
  select * into c from public.safety_concerns where id = k.concern_id;
  if p_code is not null then
    if (private.concern_by_code(p_code)).id is distinct from c.id then raise exception 'check-in not found' using errcode = 'P0002'; end if;
  elsif c.raised_by is distinct from v_uid then
    raise exception 'check-in not found' using errcode = 'P0002';
  end if;
  if k.answered_at is not null then raise exception 'this check-in was already answered' using errcode = '23514'; end if;
  update public.safety_concern_checkins set answer = p_answer, answered_at = now(), note = left(nullif(btrim(coalesce(p_note, '')), ''), 2000) where id = k.id;
  if p_answer = 'problem' then
    insert into public.safety_concern_messages (concern_id, author_id, kind, body)
      values (c.id, c.raised_by, 'note', 'Check-in answer: a problem was reported. ' || coalesce(left(nullif(btrim(coalesce(p_note, '')), ''), 2000), ''));
    if c.raised_by is not null then
      insert into public.retaliation_reviews (organisation_id, clinician_id, trigger_kind, trigger_ref, routing, is_test)
      values (c.organisation_id, c.raised_by, 'raiser_reported', k.id::text, c.routing, c.is_test) on conflict (clinician_id, trigger_kind, trigger_ref) do nothing;
    end if;
    if c.routing = 'independent_only' then
      perform private.notify_independent_readers(c.organisation_id, c.is_test, 'A new item needs your attention', 'A new item needs your attention in the clinical lead area.', jsonb_build_object('i18n_key', 'quality.concern_new'));
    else
      perform private.notify_clinical_leads(c.organisation_id, c.is_test, 'A new item needs your attention', 'A new item needs your attention in the clinical lead area.', jsonb_build_object('i18n_key', 'quality.concern_new'), c.raised_by, false);
      perform private.notify_backup_readers(c.organisation_id, c.is_test, 'A new item needs your attention', 'A new item needs your attention in the clinical lead area.', jsonb_build_object('i18n_key', 'quality.concern_new'));
    end if;
  end if;
end;
$$;

-- Aggregate only: counts by state and age. No text, no category, no severity, no names, nothing that identifies a concern.
create function public.safety_concern_board_report() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid := private.caller_org(); v_all boolean;
begin
  perform private.uid_or_deny();
  if not (private.cmo_of(v_org) or private.backup_reader(v_org)) then raise exception 'not available' using errcode = '42501'; end if;
  -- concerns by or about the lead are counted only for an independent reader; for anyone else they are left out entirely
  v_all := private.independent_reader(v_org);
  return (select jsonb_build_object(
      'total', count(*),
      'by_state', jsonb_build_object('new', count(*) filter (where state = 'new'), 'acknowledged', count(*) filter (where state = 'acknowledged'),
                                     'responded', count(*) filter (where state = 'responded'), 'closed', count(*) filter (where state = 'closed')),
      'open_by_age_days', jsonb_build_object(
        'up_to_7', count(*) filter (where state <> 'closed' and now() - created_at <= interval '7 days'),
        'from_8_to_14', count(*) filter (where state <> 'closed' and now() - created_at > interval '7 days' and now() - created_at <= interval '14 days'),
        'from_15_to_30', count(*) filter (where state <> 'closed' and now() - created_at > interval '14 days' and now() - created_at <= interval '30 days'),
        'from_31_to_90', count(*) filter (where state <> 'closed' and now() - created_at > interval '30 days' and now() - created_at <= interval '90 days'),
        'over_90', count(*) filter (where state <> 'closed' and now() - created_at > interval '90 days')),
      'acknowledge_overdue', count(*) filter (where state = 'new' and acknowledge_due_at < now()),
      'response_overdue', count(*) filter (where state in ('new', 'acknowledged') and responded_at is null and respond_due_at < now()),
      'open_retaliation_reviews', (select count(*) from public.retaliation_reviews rr where rr.organisation_id = v_org and rr.state = 'open' and rr.is_test = private.caller_is_test() and (v_all or rr.routing = 'standard')))
    from public.safety_concerns where organisation_id = v_org and is_test = private.caller_is_test() and (v_all or routing = 'standard'));
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. The hourly sweep (restated; adds the independent route and the check-ins)
-- ---------------------------------------------------------------------------
create or replace function private.safety_concern_sweep() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r record; v_esc integer := 0; v_noreader integer := 0; v_late integer := 0; v_errors integer := 0; v_checkins integer := 0; v_days jsonb; v_d integer; v_id uuid;
begin
  -- 1. not acknowledged in time: also readable by the backup readers (standard route; an independent-only concern is already with its readers)
  for r in select * from public.safety_concerns where state = 'new' and escalated_at is null and routing = 'standard' and acknowledge_due_at < now() loop
    begin
      update public.safety_concerns set escalated_at = now() where id = r.id;
      insert into public.safety_concern_messages (concern_id, kind, body) values (r.id, 'escalated', 'Not acknowledged in time; the backup readers can now see it.');
      perform private.notify_backup_readers(r.organisation_id, r.is_test, 'An item needs your attention', 'An item is overdue in the clinical lead area.',
        jsonb_build_object('i18n_key', 'quality.concern_overdue'));
      v_esc := v_esc + 1;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'safety_concern_sweep: escalating % failed: %', r.id, sqlerrm;
    end;
  end loop;
  -- an overdue independent-only concern: remind its readers once more through the same neutral notice
  for r in select * from public.safety_concerns where state = 'new' and routing = 'independent_only' and acknowledge_due_at < now() and independent_reminded_at is null loop
    begin
      update public.safety_concerns set independent_reminded_at = now() where id = r.id;
      perform private.notify_independent_readers(r.organisation_id, r.is_test, 'An item needs your attention', 'An item is overdue in the clinical lead area.', jsonb_build_object('i18n_key', 'quality.concern_overdue'));
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'safety_concern_sweep: independent reminder for % failed: %', r.id, sqlerrm;
    end;
  end loop;
  -- 2. overdue and nobody can read it: a neutral incident makes the gap visible
  for r in select distinct organisation_id, is_test, routing from public.safety_concerns sc
            where state = 'new' and acknowledge_due_at < now()
              and not exists (select 1 from public.safety_concern_readers rd join public.profiles p on p.id = rd.profile_id
                               where rd.active and private.reader_row_ok(rd.profile_id, rd.kind) and rd.organisation_id = sc.organisation_id and rd.is_test = sc.is_test
                                 and (sc.routing = 'standard' or rd.kind = 'independent')) loop
    begin
      v_noreader := v_noreader + 1;
      if not exists (select 1 from public.ops_incidents where external_reference = 'clinical_safety_overdue' and status not in ('resolved', 'closed')) then
        insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
        values (r.organisation_id, 'clinical', 'sev2', 'A clinical safety item is overdue',
                'An item held by the clinical lead area was not acknowledged in time and no reader who may open it is named. Details are not available to operations.',
                'clinical_safety_overdue', now(), now());
      end if;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'safety_concern_sweep: overdue incident failed: %', sqlerrm;
    end;
  end loop;
  -- 3. no response in time: tell whoever can read it, once
  for r in select * from public.safety_concerns where state in ('new', 'acknowledged') and responded_at is null and respond_due_at < now() and respond_overdue_notified_at is null loop
    begin
      update public.safety_concerns set respond_overdue_notified_at = now() where id = r.id;
      if r.routing = 'independent_only' then
        perform private.notify_independent_readers(r.organisation_id, r.is_test, 'An item needs a response', 'An item is waiting for a response in the clinical lead area.', jsonb_build_object('i18n_key', 'quality.concern_needs_response'));
      else
        perform private.notify_clinical_leads(r.organisation_id, r.is_test, 'An item needs a response', 'An item is waiting for a response in the clinical lead area.',
          jsonb_build_object('i18n_key', 'quality.concern_needs_response'), r.raised_by, false);
        if r.escalated_at is not null then perform private.notify_backup_readers(r.organisation_id, r.is_test, 'An item needs a response', 'An item is waiting for a response in the clinical lead area.',
          jsonb_build_object('i18n_key', 'quality.concern_needs_response')); end if;
      end if;
      v_late := v_late + 1;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'safety_concern_sweep: response notice for % failed: %', r.id, sqlerrm;
    end;
  end loop;
  -- 4. detriment check-ins to the raiser at the configured days (inert until quality_config carries speak_up.checkin_days)
  v_days := private.quality_setting('speak_up') -> 'checkin_days';
  if v_days is not null and jsonb_typeof(v_days) = 'array' then
    for r in select c.id, c.organisation_id, c.raised_by, c.is_test, c.created_at, d.value::integer as window_days
               from public.safety_concerns c cross join lateral jsonb_array_elements_text(v_days) as d(value)
              where c.created_at + make_interval(days => d.value::integer) <= now()
                and not exists (select 1 from public.safety_concern_checkins k where k.concern_id = c.id and k.window_days = d.value::integer) loop
      begin
        v_id := null;
        insert into public.safety_concern_checkins (organisation_id, concern_id, window_days, is_test) values (r.organisation_id, r.id, r.window_days, r.is_test)
          on conflict (concern_id, window_days) do nothing returning id into v_id;
        if v_id is not null and r.raised_by is not null then
          perform private.credential_notify(r.raised_by, r.organisation_id, 'A quick check-in', 'This is a routine check-in. Open the app and tell us how things are going.',
            jsonb_build_object('i18n_key', 'quality.concern_checkin'), true);
          v_checkins := v_checkins + 1;
        elsif v_id is not null then
          v_checkins := v_checkins + 1;
        end if;
      exception when others then
        v_errors := v_errors + 1;
        raise warning 'safety_concern_sweep: check-in for % failed: %', r.id, sqlerrm;
      end;
    end loop;
  end if;
  if v_errors > 0 and not exists (select 1 from public.ops_incidents where external_reference = 'safety_sweep' and status not in ('resolved', 'closed')) then
    insert into public.ops_incidents (category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values ('technical', 'sev2', 'The clinical lead area sweep failed for some items',
            format('%s item(s) could not be processed by private.safety_concern_sweep(). Details are not available to operations.', v_errors), 'safety_sweep', now(), now());
  end if;
  return jsonb_build_object('escalated', v_esc, 'no_backup_reader', v_noreader, 'response_overdue', v_late, 'checkins_sent', v_checkins, 'errors', v_errors);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Retire the old reader check; grants
-- ---------------------------------------------------------------------------
drop function private.concern_reader(timestamptz, uuid);

revoke all on function
  public.raise_safety_concern(text, text, text, text, uuid, boolean), public.raise_anonymous_safety_concern(text, text, text, boolean), public.anonymous_concern_status(text),
  public.add_to_anonymous_concern(text, text), public.add_safety_concern_backup_reader(uuid, text, text), public.my_reader_status(),
  public.answer_concern_checkin(uuid, text, text, text), public.safety_concern_board_report()
  from public, anon, authenticated;
grant execute on function
  public.raise_safety_concern(text, text, text, text, uuid, boolean), public.raise_anonymous_safety_concern(text, text, text, boolean), public.anonymous_concern_status(text),
  public.add_to_anonymous_concern(text, text), public.add_safety_concern_backup_reader(uuid, text, text), public.my_reader_status(),
  public.answer_concern_checkin(uuid, text, text, text), public.safety_concern_board_report()
  to authenticated;
revoke all on function public.my_safety_concerns(), public.safety_concern_inbox(text), public.acknowledge_safety_concern(uuid), public.respond_to_safety_concern(uuid, text),
  public.close_safety_concern(uuid, text), public.add_to_safety_concern(uuid, text), public.remove_safety_concern_backup_reader(uuid),
  public.retaliation_review_queue(), public.close_retaliation_review(uuid, text, text) from public, anon, authenticated;
grant execute on function public.my_safety_concerns(), public.safety_concern_inbox(text), public.acknowledge_safety_concern(uuid), public.respond_to_safety_concern(uuid, text),
  public.close_safety_concern(uuid, text), public.add_to_safety_concern(uuid, text), public.remove_safety_concern_backup_reader(uuid),
  public.retaliation_review_queue(), public.close_retaliation_review(uuid, text, text) to authenticated;

do $$
begin
  if exists (select 1 from public.safety_concern_readers r join public.profiles p on p.id = r.profile_id where r.active and not private.reader_row_ok(r.profile_id, r.kind)) then
    raise exception 'S20 v2: a reader who may not read is still active';
  end if;
  if has_function_privilege('anon', 'public.raise_anonymous_safety_concern(text, text, text, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.anonymous_concern_status(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.safety_concern_board_report()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.concern_by_code(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.notify_independent_readers(uuid, boolean, text, text, jsonb)', 'EXECUTE')
     or has_table_privilege('anon', 'public.safety_concern_checkins', 'SELECT') or has_table_privilege('authenticated', 'public.safety_concern_checkins', 'INSERT') then
    raise exception 'S20 v2 speak-up grants are wrong';
  end if;
end $$;
