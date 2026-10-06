-- S19: red event paging and escalation (spec 7.9, safety cases 8 and 9).
--
-- Invariants touched: INV-05 (a red event never waits for a clinician to pull work: it pages on-call at once and
-- escalates if nobody acknowledges), INV-07 (every notification here is neutral: no condition, reading, name or result),
-- INV-10 and INV-12 (an open page ties the paged clinician to that patient, and only while it is open), INV-13 (is_test),
-- INV-16 (each page records the paging_config version it used). D-12 and OQ-113: push, in-console alarm and email only,
-- no SMS paging.
--
-- What this adds:
--   * paging_config (versioned, mirrored as paging.rules in packages/shared/src/proposed-config; a test keeps the two
--     identical, and keeps escalation_minutes equal to the existing paging.escalation_minutes entry). PROPOSED, CMO owner.
--   * pages: a root page per red triage event (to the rota's primary on call), a backup child at the first escalation
--     time, an escalation child (clinical lead and ops) at the second, or straight to level 2 when the rota gives nobody
--     to page (safety case 9). Direct writes refused; the only writers are the functions below.
--   * public.create_red_page(triage_event) (service role): never for a shadow event (OQ-88), idempotent per event.
--   * private.sweep_pages() (cron, every minute): the escalation timers, each page in its own subtransaction, idempotent
--     through bookkeeping columns, an incident for anything that fails. Also closes pages after the access window.
--   * acknowledge_page / close_page / my_active_pages / paging_overview.
--   * private.clinician_has_patient_access() gains one clause: an open page sent to or acknowledged by me (INV-12).
--   * a subscriber on triage.graded (handler paging.create_from_triage).
--
-- Counts before this migration (live): pages and paging_config do not exist; clinician_alerts and escalations (the older
-- alert ladder for vitals and results) are untouched.

-- ---------------------------------------------------------------------------
-- 1. Config (PROPOSED values, CMO owner)
-- ---------------------------------------------------------------------------
create table public.paging_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index paging_config_one_active on public.paging_config (is_active) where is_active;

-- A bad edit (one time, a string, zero) would make the comparisons null and the ladder silently stop escalating, so the
-- shape is checked by the database itself.
create function private.paging_rules_valid(r jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
begin
  -- a missing key makes a comparison null; a CHECK treats null as passing, so the whole answer is coalesced to false
  return coalesce(jsonb_typeof(r -> 'escalation_minutes') = 'array'
     and jsonb_array_length(r -> 'escalation_minutes') = 2
     and (r -> 'escalation_minutes' ->> 0) ~ '^[0-9]+$' and (r -> 'escalation_minutes' ->> 1) ~ '^[0-9]+$'
     and (r -> 'escalation_minutes' ->> 0)::integer > 0
     and (r -> 'escalation_minutes' ->> 0)::integer < (r -> 'escalation_minutes' ->> 1)::integer
     and (r ->> 'lead_repeat_minutes') ~ '^[0-9]+$' and (r ->> 'lead_repeat_minutes')::integer > 0
     and (r ->> 'lead_repeat_max') ~ '^[0-9]+$' and (r ->> 'lead_repeat_max')::integer > 0
     and (r ->> 'unclosed_alert_minutes') ~ '^[0-9]+$' and (r ->> 'unclosed_alert_minutes')::integer > 0
     and (r ->> 'page_access_hours') ~ '^[0-9]+$' and (r ->> 'page_access_hours')::integer > 0, false);
exception when others then
  return false;
end;
$$;
revoke all on function private.paging_rules_valid(jsonb) from public, anon, authenticated;
alter table public.paging_config add constraint paging_config_rules_valid check (private.paging_rules_valid(rules));

-- paging-rules-begin
insert into public.paging_config (version, is_active, effective_from, rules) values (1, true, '2026-10-06', $json$
{
  "escalation_minutes": [5, 10],
  "lead_repeat_minutes": 5,
  "lead_repeat_max": 12,
  "unclosed_alert_minutes": 60,
  "page_access_hours": 24
}
$json$::jsonb);
-- paging-rules-end

alter table public.paging_config enable row level security;
create policy paging_config_read on public.paging_config for select to authenticated using (true);
revoke all on public.paging_config from anon;
revoke insert, update, delete, truncate, references, trigger on public.paging_config from authenticated;
grant select on public.paging_config to authenticated;

create function private.paging_rule(p_key text) returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules -> p_key from public.paging_config where is_active order by version desc limit 1 $$;
revoke all on function private.paging_rule(text) from public, anon, authenticated;

create function private.paging_config_version() returns integer
language sql stable security definer set search_path = ''
as $$ select version from public.paging_config where is_active order by version desc limit 1 $$;
revoke all on function private.paging_config_version() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. pages
-- ---------------------------------------------------------------------------
create type public.page_role as enum ('primary', 'backup', 'escalation');

create table public.pages (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  triage_event_id    uuid not null references public.triage_events (id) on delete restrict,
  -- the root page of an event has no parent; a backup or escalation row points at its root
  parent_page_id     uuid references public.pages (id) on delete cascade,
  role               public.page_role not null,
  -- null only for an escalation row: those alerts go to the clinical lead and ops, not to one person
  to_clinician_id    uuid references public.profiles (id) on delete restrict,
  escalation_level   smallint not null check (escalation_level between 0 and 2),
  sent_at            timestamptz not null default now(),
  acknowledged_at    timestamptz,
  acknowledged_by    uuid references public.profiles (id) on delete set null,
  closed_at          timestamptz,
  close_note         text,
  -- timer bookkeeping on the root page: each step happens once
  backup_paged_at    timestamptz,
  lead_alerted_at    timestamptz,
  last_lead_alert_at timestamptz,
  lead_repeat_count  integer not null default 0,
  action_alerted_at  timestamptz,
  no_cover           boolean not null default false,
  config_version     integer not null,
  is_test            boolean not null default false,
  created_at         timestamptz not null default now(),
  check (role = 'escalation' or to_clinician_id is not null),
  check ((acknowledged_at is null) = (acknowledged_by is null))
);
create unique index pages_one_root_per_event on public.pages (triage_event_id) where parent_page_id is null;
create unique index pages_one_child_per_role on public.pages (parent_page_id, role) where parent_page_id is not null;
create index pages_open_idx on public.pages (to_clinician_id) where closed_at is null;
create index pages_open_roots_idx on public.pages (sent_at) where parent_page_id is null and closed_at is null;
create index pages_ack_idx on public.pages (acknowledged_by) where closed_at is null and acknowledged_by is not null;
create index pages_patient_open_idx on public.pages (patient_id) where closed_at is null;
create index pages_sweep_idx on public.pages (sent_at) where parent_page_id is null and role = 'primary' and acknowledged_at is null and closed_at is null;

create function private.guard_paging_write() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(current_setting('tarragon.paging_write', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'pages is written only by the paging functions' using errcode = '42501';
end;
$$;
revoke all on function private.guard_paging_write() from public, anon, authenticated;
create trigger pages_guard before insert or update or delete on public.pages
  for each row execute function private.guard_paging_write();

alter table public.pages enable row level security;
-- A clinician reads the pages sent to them or that they acknowledged; the clinical lead and admin read all. Never the patient.
create policy pages_read on public.pages for select to authenticated
  using (to_clinician_id = (select auth.uid()) or acknowledged_by = (select auth.uid()) or private.can_credential_review());
revoke all on public.pages from anon;
revoke insert, update, delete, truncate, references, trigger on public.pages from authenticated;
grant select on public.pages to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Events (ids only, INV-07)
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('page.sent', 'A red event page was sent to the clinician on call', 'S19', true),
  ('page.acknowledged', 'A red event page was acknowledged', 'S19', false),
  ('page.escalated', 'A red event page was not acknowledged in time, or had nobody to page', 'S19', true);
insert into public.event_type_versions (event_type, version, required_keys) values
  ('page.sent', 1, array['page_id', 'role']),
  ('page.acknowledged', 1, array['page_id']),
  ('page.escalated', 1, array['page_id', 'level']);

-- ---------------------------------------------------------------------------
-- 4. Helpers
-- ---------------------------------------------------------------------------
-- Push, in-app and email together, critical priority (never held back by quiet hours), neutral wording (the template).
-- Email goes with the push, not after it fails: a push needs data and a live app, and a page must not depend on either.
create function private.page_notify(p_recipient uuid, p_org uuid, p_template text, p_page uuid, p_channels text[] default array['push', 'in_app', 'email']) returns void
language plpgsql security definer set search_path = ''
as $$
declare c text;
begin
  foreach c in array p_channels loop
    insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
    values (p_recipient, p_org, c::public.notification_channel, p_template, jsonb_build_object('page_id', p_page), 'pending', 'non_clinical', 'critical', 'pages', p_page);
  end loop;
end;
$$;
revoke all on function private.page_notify(uuid, uuid, text, uuid, text[]) from public, anon, authenticated;

-- The clinical lead (chief medical officer) and ops (admin) of the organisation, matched on the test flag.
create function private.page_notify_leadership(p_org uuid, p_page uuid, p_test boolean, p_template text default 'on_call_escalation', p_channels text[] default array['push', 'in_app', 'email']) returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; n integer := 0;
begin
  for r in
    select p.id from public.profiles p where p.organisation_id = p_org and p.is_active and p.role = 'admin' and p.is_test = p_test
    union
    select cs.profile_id from public.clinical_staff cs join public.profiles p on p.id = cs.profile_id
     where cs.organisation_id = p_org and cs.profile_id is not null and cs.active and cs.status = 'active'
       and cs.doctor_tier = 'chief_medical_officer' and p.is_test = p_test
  loop
    perform private.page_notify(r.id, p_org, p_template, p_page, p_channels);
    n := n + 1;
  end loop;
  if n = 0 then
    -- nobody to tell is itself an emergency, not a quiet success
    perform private.page_incident(p_org, 'page_no_leadership', 'A red event alert had nobody to go to',
      'A red event needed the clinical lead and ops alerted but no active chief medical officer or admin account matched. Add or activate one.');
  end if;
  return n;
end;
$$;
revoke all on function private.page_notify_leadership(uuid, uuid, boolean, text, text[]) from public, anon, authenticated;

-- The rota row covering now (test and real rotas never mix).
create function private.on_call_now(p_org uuid, p_test boolean) returns table (rota_id uuid, primary_id uuid, backup_id uuid)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.primary_clinician_id, r.backup_clinician_id from public.on_call_rota r
   where r.organisation_id = p_org and r.is_test = p_test and r.cancelled_at is null and r.starts_at <= now() and r.ends_at > now() limit 1;
$$;
revoke all on function private.on_call_now(uuid, boolean) from public, anon, authenticated;

-- Who receives the first page: the rota's primary if eligible, else its backup if eligible, else nobody (no cover).
create function private.page_recipient(p_org uuid, p_test boolean) returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare r record;
begin
  select * into r from private.on_call_now(p_org, p_test);
  if not found then return null; end if;
  if private.clinician_is_eligible(r.primary_id) then return r.primary_id; end if;
  if r.backup_id is not null and private.clinician_is_eligible(r.backup_id) then return r.backup_id; end if;
  return null;
end;
$$;
revoke all on function private.page_recipient(uuid, boolean) from public, anon, authenticated;

-- One open incident per reference; refreshed, never duplicated, never silent.
create function private.page_incident(p_org uuid, p_ref text, p_title text, p_summary text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.ops_incidents where external_reference = p_ref and status not in ('resolved', 'closed')) then
    update public.ops_incidents set summary = p_summary where external_reference = p_ref and status not in ('resolved', 'closed');
  else
    insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values (p_org, 'clinical', 'sev1', p_title, p_summary, p_ref, now(), now());
  end if;
end;
$$;
revoke all on function private.page_incident(uuid, text, text, text) from public, anon, authenticated;

-- The class 1 task that makes sure someone with the on-call competency can pick the case up. A failure is audited and
-- raises an incident, and never undoes the page.
create function private.page_task(p_page public.pages, p_rule_set integer) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform private.create_clinical_task(p_page.patient_id, 'red_event_unacknowledged', null, 'page:' || p_page.id, p_page.triage_event_id, p_rule_set, null);
exception when others then
  insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
    values (p_page.organisation_id, 'page_task.error', 'page', p_page.id, jsonb_build_object('error', sqlerrm));
  perform private.page_incident(p_page.organisation_id, 'page_task_failed', 'A red event task could not be created',
    'The class 1 task for an unacknowledged red event page could not be created; see audit_log action page_task.error. The page and the alerts were still sent.');
end;
$$;
revoke all on function private.page_task(public.pages, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Sending the first page (service role, from the triage.graded subscriber)
-- ---------------------------------------------------------------------------
create function public.create_red_page(p_triage_event uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  te public.triage_events%rowtype;
  v_root uuid;
  v_to uuid;
  v_page public.pages%rowtype;
begin
  select * into te from public.triage_events where id = p_triage_event;
  if not found then raise exception 'unknown triage event' using errcode = '22023'; end if;
  -- two layers with the handler: a shadow grade (rule set nobody approved, OQ-88) and anything that is not a red grade
  -- carrying the page action never pages
  if te.shadow or te.grade <> 'red' or not (te.actions @> '[{"kind":"page_on_call"}]'::jsonb) then return null; end if;
  perform pg_advisory_xact_lock(hashtext('page:' || p_triage_event));
  select id into v_root from public.pages where triage_event_id = p_triage_event and parent_page_id is null;
  if found then return v_root; end if;

  v_to := private.page_recipient(te.organisation_id, te.is_test);
  perform set_config('tarragon.paging_write', 'on', true);
  insert into public.pages (organisation_id, patient_id, triage_event_id, role, to_clinician_id, escalation_level, no_cover, lead_alerted_at, config_version, is_test)
  values (te.organisation_id, te.patient_id, te.id, case when v_to is null then 'escalation' else 'primary' end::public.page_role, v_to,
          case when v_to is null then 2 else 0 end, v_to is null, case when v_to is null then now() end, private.paging_config_version(), te.is_test)
  returning * into v_page;
  perform set_config('tarragon.paging_write', 'off', true);

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (te.organisation_id, null, 'page.sent', 'page', v_page.id, jsonb_build_object('role', v_page.role, 'level', v_page.escalation_level, 'no_cover', v_page.no_cover));
  perform private.emit_domain_event('page.sent', te.organisation_id, jsonb_build_object('page_id', v_page.id, 'role', v_page.role),
    'page.sent:' || v_page.id, te.patient_id, 'page', v_page.id, 'urgent');

  if v_to is not null then
    perform private.page_notify(v_to, te.organisation_id, 'on_call_page', v_page.id);
  else
    -- safety case 9: nobody on the rota to page. No timer to wait for: level 2 straight away, a task so any on-call
    -- clinician can take it, and an incident.
    perform private.page_notify_leadership(te.organisation_id, v_page.id, te.is_test);
    perform private.page_task(v_page, te.rule_set_version);
    perform private.page_incident(te.organisation_id, 'page_no_cover:' || v_page.id, 'Red event with nobody on call',
      'A red event arrived while no eligible clinician was on the rota. The clinical lead and ops were alerted and a priority task is open.');
    perform private.emit_domain_event('page.escalated', te.organisation_id, jsonb_build_object('page_id', v_page.id, 'level', 2, 'reason', 'no_cover'),
      'page.escalated:' || v_page.id || ':2', te.patient_id, 'page', v_page.id, 'urgent');
  end if;
  return v_page.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The escalation timers
-- ---------------------------------------------------------------------------
create function private.sweep_pages() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r public.pages%rowtype;
  oc record;
  v_m1 integer := (private.paging_rule('escalation_minutes') ->> 0)::integer;
  v_m2 integer := (private.paging_rule('escalation_minutes') ->> 1)::integer;
  v_backup uuid;
  v_no_backup boolean;
  v_child uuid;
  v_backups integer := 0;
  v_leads integer := 0;
  v_repeats integer := 0;
  v_unclosed integer := 0;
  v_rep_max integer := (private.paging_rule('lead_repeat_max') #>> '{}')::integer;
  v_errors integer := 0;
  v_closed integer;
  v_rule_set integer;
begin
  for r in
    select * from public.pages
     where parent_page_id is null and role = 'primary' and acknowledged_at is null and closed_at is null
       and (backup_paged_at is null or lead_alerted_at is null)
     order by sent_at for update skip locked
  loop
    begin
      v_no_backup := false;
      select rule_set_version into v_rule_set from public.triage_events where id = r.triage_event_id;

      -- first escalation time: page the backup and make sure a task exists
      if r.backup_paged_at is null and now() >= r.sent_at + make_interval(mins => v_m1) then
        select * into oc from private.on_call_now(r.organisation_id, r.is_test);
        v_backup := null;
        if found then
          -- the first eligible person on the rota who is not the one already paged
          if oc.primary_id is distinct from r.to_clinician_id and private.clinician_is_eligible(oc.primary_id) then v_backup := oc.primary_id;
          elsif oc.backup_id is not null and oc.backup_id is distinct from r.to_clinician_id and private.clinician_is_eligible(oc.backup_id) then v_backup := oc.backup_id;
          end if;
        end if;
        perform set_config('tarragon.paging_write', 'on', true);
        update public.pages set backup_paged_at = now() where id = r.id;
        if v_backup is not null then
          insert into public.pages (organisation_id, patient_id, triage_event_id, parent_page_id, role, to_clinician_id, escalation_level, config_version, is_test)
          values (r.organisation_id, r.patient_id, r.triage_event_id, r.id, 'backup', v_backup, 1, r.config_version, r.is_test)
          returning id into v_child;
        else
          v_no_backup := true;
        end if;
        perform set_config('tarragon.paging_write', 'off', true);
        if v_backup is not null then
          perform private.page_notify(v_backup, r.organisation_id, 'on_call_page', v_child);
          perform private.emit_domain_event('page.escalated', r.organisation_id, jsonb_build_object('page_id', v_child, 'level', 1, 'reason', 'unacknowledged'),
            'page.escalated:' || v_child || ':1', r.patient_id, 'page', v_child, 'urgent');
        end if;
        perform private.page_task(r, v_rule_set);
        v_backups := v_backups + 1;
      end if;

      -- second escalation time (or at once when there was nobody else to page): the clinical lead and ops
      if r.lead_alerted_at is null and (v_no_backup or now() >= r.sent_at + make_interval(mins => v_m2)) then
        perform set_config('tarragon.paging_write', 'on', true);
        insert into public.pages (organisation_id, patient_id, triage_event_id, parent_page_id, role, escalation_level, config_version, is_test)
        values (r.organisation_id, r.patient_id, r.triage_event_id, r.id, 'escalation', 2, r.config_version, r.is_test)
        returning id into v_child;
        update public.pages set lead_alerted_at = now() where id = r.id;
        perform set_config('tarragon.paging_write', 'off', true);
        perform private.page_notify_leadership(r.organisation_id, v_child, r.is_test);
        perform private.page_incident(r.organisation_id, 'page_unanswered:' || r.id, 'A red event page was not acknowledged',
          'A red event page has not been acknowledged by the clinicians on call. The clinical lead and ops were alerted.');
        perform private.emit_domain_event('page.escalated', r.organisation_id,
          jsonb_build_object('page_id', v_child, 'level', 2, 'reason', case when v_no_backup then 'no_backup' else 'unacknowledged' end),
          'page.escalated:' || v_child || ':2', r.patient_id, 'page', v_child, 'urgent');
        v_leads := v_leads + 1;
      end if;
    exception when others then
      -- a failed step must never stop the other pages or pass unnoticed
      v_errors := v_errors + 1;
      perform set_config('tarragon.paging_write', 'off', true);
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (r.organisation_id, 'page_sweep.error', 'page', r.id, jsonb_build_object('error', sqlerrm));
      perform private.page_incident(r.organisation_id, 'page_sweep_failed', 'Red event escalation failed for a page',
        'The escalation timer failed for at least one red event page; see audit_log action page_sweep.error. A page may not have been escalated.');
    end;
  end loop;

  -- a level 2 alert is repeated until someone acknowledges: one push to a sleeping lead is not an escalation. Repeats are push and
  -- in-app only (email goes once, with the first alert, so a lead's inbox is not flooded), and they stop at lead_repeat_max with a
  -- sev1 incident, because an unbounded loop only trains a person to ignore it (published tools cap repeats too).
  for r in
    select * from public.pages
     where parent_page_id is null and acknowledged_at is null and closed_at is null and lead_alerted_at is not null
       and lead_repeat_count < v_rep_max
       and coalesce(last_lead_alert_at, lead_alerted_at) <= now() - make_interval(mins => (private.paging_rule('lead_repeat_minutes') #>> '{}')::integer)
     order by sent_at for update skip locked
  loop
    begin
      select coalesce((select c.id from public.pages c where c.parent_page_id = r.id and c.role = 'escalation'), r.id) into v_child;
      perform private.page_notify_leadership(r.organisation_id, v_child, r.is_test, 'on_call_escalation', array['push', 'in_app']);
      perform set_config('tarragon.paging_write', 'on', true);
      update public.pages set last_lead_alert_at = now(), lead_repeat_count = lead_repeat_count + 1 where id = r.id;
      perform set_config('tarragon.paging_write', 'off', true);
      if r.lead_repeat_count + 1 >= v_rep_max then
        perform private.page_incident(r.organisation_id, 'page_unanswered_exhausted:' || r.id, 'A red event page is still unanswered after every alert',
          'The clinical lead and ops were alerted repeatedly and nobody acknowledged a red event page. Alerts have stopped repeating: act on this directly.');
      end if;
      v_repeats := v_repeats + 1;
    exception when others then
      v_errors := v_errors + 1;
      perform set_config('tarragon.paging_write', 'off', true);
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (r.organisation_id, 'page_sweep.error', 'page', r.id, jsonb_build_object('error', sqlerrm, 'step', 'repeat'));
      perform private.page_incident(r.organisation_id, 'page_sweep_failed', 'Red event escalation failed for a page',
        'The escalation timer failed for at least one red event page; see audit_log action page_sweep.error. A page may not have been escalated.');
    end;
  end loop;

  -- acknowledged is not handled: a page acknowledged but still not closed after unclosed_alert_minutes tells the clinical lead and
  -- ops once, so "acknowledged and then nothing happened" is caught (Opsgenie offers re-notify after acknowledge for the same reason)
  for r in
    select * from public.pages
     where parent_page_id is null and acknowledged_at is not null and closed_at is null and action_alerted_at is null
       and acknowledged_at <= now() - make_interval(mins => (private.paging_rule('unclosed_alert_minutes') #>> '{}')::integer)
     order by sent_at for update skip locked
  loop
    begin
      perform private.page_notify_leadership(r.organisation_id, r.id, r.is_test, 'on_call_unfinished', array['push', 'in_app']);
      perform set_config('tarragon.paging_write', 'on', true);
      update public.pages set action_alerted_at = now() where id = r.id;
      perform set_config('tarragon.paging_write', 'off', true);
      v_unclosed := v_unclosed + 1;
    exception when others then
      v_errors := v_errors + 1;
      perform set_config('tarragon.paging_write', 'off', true);
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (r.organisation_id, 'page_sweep.error', 'page', r.id, jsonb_build_object('error', sqlerrm, 'step', 'unclosed'));
      perform private.page_incident(r.organisation_id, 'page_sweep_failed', 'Red event escalation failed for a page',
        'The escalation timer failed for at least one red event page; see audit_log action page_sweep.error. A page may not have been escalated.');
    end;
  end loop;

  -- an ACKNOWLEDGED page ties a clinician to the chart; it does not stay open for ever. An unacknowledged page is never closed
  -- here: it keeps ringing and keeps being re-alerted, because quietly closing it would hide a red event nobody has seen.
  perform set_config('tarragon.paging_write', 'on', true);
  update public.pages set closed_at = now(), close_note = coalesce(close_note, 'closed automatically after the access window')
   where closed_at is null and sent_at < now() - make_interval(hours => (private.paging_rule('page_access_hours') #>> '{}')::integer)
     and exists (select 1 from public.pages root where root.id = coalesce(pages.parent_page_id, pages.id) and root.acknowledged_at is not null);
  get diagnostics v_closed = row_count;
  perform set_config('tarragon.paging_write', 'off', true);
  return jsonb_build_object('backups', v_backups, 'leads', v_leads, 'repeats', v_repeats, 'unclosed', v_unclosed, 'errors', v_errors, 'closed', v_closed);
end;
$$;
revoke all on function private.sweep_pages() from public, anon, authenticated;

-- every 15 seconds (pg_cron 1.6 supports it, process-events already does): a minute of lag on a 5 minute ladder is 20 percent late
select cron.schedule('sweep-pages', '15 seconds', $$ select private.sweep_pages(); $$);

-- Once a clinician has acknowledged, the unacknowledged-page task is stale: cancel it unless somebody already claimed it
-- (then they are working it and it must not be pulled from under them). A failure is audited and never undoes the acknowledgement.
create function private.page_task_settle(p_root public.pages) returns void
language plpgsql security definer set search_path = ''
as $$
declare t record;
begin
  for t in select id from public.clinical_tasks where dedup_key = 'page:' || p_root.id and state in ('created', 'offered_to_lead', 'open', 'escalated') loop
    perform private.apply_task_transition(t.id, 'cancelled', 'lead', null, 'the red event page was acknowledged by a clinician');
  end loop;
exception when others then
  insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
    values (p_root.organisation_id, 'page_task_settle.error', 'page', p_root.id, jsonb_build_object('error', sqlerrm));
end;
$$;
revoke all on function private.page_task_settle(public.pages) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Acknowledge, close, read
-- ---------------------------------------------------------------------------
-- Only a clinician a page of this event was sent to, or the chief medical officer. Ops are told but cannot silence it.
create function public.acknowledge_page(p_page uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  pg public.pages%rowtype;
  root public.pages%rowtype;
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into pg from public.pages where id = p_page;
  if not found then raise exception 'unknown page' using errcode = '22023'; end if;
  select * into root from public.pages where id = coalesce(pg.parent_page_id, pg.id) for update;
  if not (exists (select 1 from public.pages x where coalesce(x.parent_page_id, x.id) = root.id and x.to_clinician_id = v_uid) or private.credential_is_cmo()) then
    raise exception 'only the clinicians paged, or the chief medical officer, can acknowledge a page' using errcode = '42501';
  end if;
  if root.acknowledged_at is not null then return; end if;
  if root.closed_at is not null then raise exception 'this page is already closed' using errcode = '22023'; end if;
  perform set_config('tarragon.paging_write', 'on', true);
  update public.pages set acknowledged_at = now(), acknowledged_by = v_uid where coalesce(parent_page_id, id) = root.id and acknowledged_at is null;
  perform set_config('tarragon.paging_write', 'off', true);
  perform private.page_task_settle(root);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (root.organisation_id, v_uid, 'page.acknowledged', 'page', root.id, jsonb_build_object('seconds_after_sent', extract(epoch from now() - root.sent_at)::integer));
  perform private.emit_domain_event('page.acknowledged', root.organisation_id, jsonb_build_object('page_id', root.id),
    'page.acknowledged:' || root.id, root.patient_id, 'page', root.id);
end;
$$;

-- Closing says it is handled and why; it ends the chart access the open page gave.
create function public.close_page(p_page uuid, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  pg public.pages%rowtype;
  root public.pages%rowtype;
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'closing a page needs a written note of at least 10 characters' using errcode = '22023'; end if;
  select * into pg from public.pages where id = p_page;
  if not found then raise exception 'unknown page' using errcode = '22023'; end if;
  select * into root from public.pages where id = coalesce(pg.parent_page_id, pg.id) for update;
  if root.acknowledged_at is null then raise exception 'acknowledge the page before closing it' using errcode = '22023'; end if;
  if root.acknowledged_by is distinct from v_uid and not private.credential_is_cmo() then
    raise exception 'only the clinician who acknowledged the page, or the chief medical officer, can close it' using errcode = '42501';
  end if;
  if root.closed_at is not null then return; end if;
  perform set_config('tarragon.paging_write', 'on', true);
  update public.pages set closed_at = now(), close_note = btrim(p_note) where coalesce(parent_page_id, id) = root.id and closed_at is null;
  perform set_config('tarragon.paging_write', 'off', true);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (root.organisation_id, v_uid, 'page.closed', 'page', root.id, jsonb_build_object('note', btrim(p_note)));
end;
$$;

-- The caller's open pages. The patient reference is returned only to the clinician who acknowledged the event: being paged
-- gives no chart access (INV-12), so it gives no patient reference either.
create function public.my_active_pages() returns table (
  page_id uuid, root_id uuid, role public.page_role, escalation_level smallint, sent_at timestamptz,
  acknowledged_at timestamptz, patient_id uuid, seconds_waiting integer)
language sql stable security definer set search_path = ''
as $$
  select pg.id, root.id, pg.role, pg.escalation_level, pg.sent_at, root.acknowledged_at,
         case when root.acknowledged_by = (select auth.uid()) then pg.patient_id end,
         extract(epoch from now() - root.sent_at)::integer
    from public.pages pg join public.pages root on root.id = coalesce(pg.parent_page_id, pg.id)
   where pg.closed_at is null
     and (pg.to_clinician_id = (select auth.uid())
          or root.acknowledged_by = (select auth.uid())
          or (pg.role = 'escalation' and private.credential_is_cmo()
              and pg.organisation_id = (select organisation_id from public.clinical_staff where profile_id = (select auth.uid()))))
   order by root.sent_at, pg.escalation_level;
$$;

-- For the clinical lead and ops: every page of the last 7 days with where its timer stands. No patient reference.
create function public.paging_overview() returns table (
  root_id uuid, sent_at timestamptz, no_cover boolean, max_level smallint, acknowledged_at timestamptz, acknowledged_by_name text,
  closed_at timestamptz, backup_paged_at timestamptz, lead_alerted_at timestamptz, seconds_waiting integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.can_credential_review() then raise exception 'not authorised' using errcode = '42501'; end if;
  return query
  select r.id, r.sent_at, r.no_cover, (select max(c.escalation_level) from public.pages c where coalesce(c.parent_page_id, c.id) = r.id), r.acknowledged_at,
         (select full_name from public.clinical_staff where profile_id = r.acknowledged_by), r.closed_at, r.backup_paged_at, r.lead_alerted_at,
         extract(epoch from coalesce(r.acknowledged_at, now()) - r.sent_at)::integer
    from public.pages r
   where r.parent_page_id is null and r.sent_at > now() - interval '7 days'
     and r.organisation_id = coalesce((select organisation_id from public.profiles where id = (select auth.uid())), r.organisation_id)
   order by r.sent_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. INV-12: an open page ties the paged clinician to that patient (and nothing else widens)
-- ---------------------------------------------------------------------------
create or replace function private.clinician_has_patient_access(p_patient uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and p_patient is not null
    and private.is_org_staff((select pr.organisation_id from public.profiles pr where pr.id = p_patient))
    and (
      -- today's care-team assignment (clinician, clinical director, care coordinator)
      exists (
        select 1 from public.care_team_assignment cta
         where cta.patient_id = p_patient
           and (select auth.uid()) in (cta.clinician_id, cta.clinical_director_id, cta.care_coordinator_id)
      )
      -- an open escalation routed to me
      or exists (
        select 1 from public.escalations e
         where e.patient_id = p_patient
           and e.assigned_doctor_id = (select auth.uid())
           and e.status in ('open', 'under_review')
      )
      -- an unresolved alert I am responsible for (or the backup)
      or exists (
        select 1 from public.clinician_alerts a
          join public.clinical_staff cs on cs.id in (a.responsible_clinician_id, a.backup_clinician_id)
         where a.patient_id = p_patient
           and cs.profile_id = (select auth.uid())
           and a.status in ('open', 'acknowledged', 'snoozed')
      )
      -- a consultation in progress, or an upcoming one that has not ended (a stale booked row never ties a clinician)
      or exists (
        select 1 from public.appointments ap
         where ap.patient_id = p_patient
           and ap.clinician_id = (select auth.uid())
           and (
                ap.status = 'in_progress'
             or (ap.status in ('scheduled', 'booked', 'confirmed', 'checked_in') and ap.ends_at >= now())
           )
      )
      -- a video consultation I started or am due to host that has not ended
      or exists (
        select 1 from public.video_consultations vc
         where vc.patient_id = p_patient
           and vc.initiated_by = (select auth.uid())
           and vc.status in ('scheduled', 'started')
           and vc.ended_at is null
      )
      -- an active clinical task pushed to me, claimed by me, or offered to me as the named clinician (S16, INV-12)
      or exists (
        select 1 from public.clinical_tasks ct
         where ct.patient_id = p_patient
           and (
                (ct.state = 'offered_to_lead' and (select auth.uid()) in (ct.pushed_to, ct.lead_clinician_id))
             or (ct.state in ('claimed', 'escalated') and ct.claimed_by = (select auth.uid()))
           )
      )
      -- an open red event page I have ACKNOWLEDGED (S19, INV-12): being paged is not enough, taking responsibility is; closed
      -- pages and pages past the access window do not count
      or exists (
        select 1 from public.pages pg
         where pg.patient_id = p_patient and pg.closed_at is null
           and pg.acknowledged_by = (select auth.uid())
      )
      -- an open specialist referral assigned to me
      or exists (
        select 1 from public.specialist_referrals sr
          join public.clinical_staff cs on cs.id = sr.assigned_specialist_id
         where sr.patient_id = p_patient
           and cs.profile_id = (select auth.uid())
           and sr.status not in ('closed', 'declined', 'completed', 'draft')
      )
    );
$$;

-- ---------------------------------------------------------------------------
-- 9. Subscriber and privileges
-- ---------------------------------------------------------------------------
insert into public.event_subscribers (subscriber_key, event_type, handler_key, note)
values ('paging.on_red', 'triage.graded', 'paging.create_from_triage', 'S19: a red, approved (non-shadow) triage grade pages the clinician on call');

do $$
declare f text;
begin
  foreach f in array array['public.create_red_page(uuid)', 'public.acknowledge_page(uuid)', 'public.close_page(uuid, text)', 'public.my_active_pages()', 'public.paging_overview()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  grant execute on function public.acknowledge_page(uuid) to authenticated;
  grant execute on function public.close_page(uuid, text) to authenticated;
  grant execute on function public.my_active_pages() to authenticated;
  grant execute on function public.paging_overview() to authenticated;
  grant execute on function public.create_red_page(uuid) to service_role;
end $$;
revoke all on function private.clinician_has_patient_access(uuid) from public, anon;
grant execute on function private.clinician_has_patient_access(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name in ('pages', 'paging_config') and grantee in ('anon', 'PUBLIC')) then
    raise exception 'S19: anon or PUBLIC has table privileges';
  end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name in ('pages', 'paging_config') and grantee = 'authenticated' and privilege_type <> 'SELECT') then
    raise exception 'S19: authenticated has a write privilege on a paging table';
  end if;
  if has_function_privilege('anon', 'public.acknowledge_page(uuid)', 'EXECUTE') or has_function_privilege('anon', 'public.create_red_page(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.create_red_page(uuid)', 'EXECUTE') then
    raise exception 'S19: a paging function is callable by the wrong role';
  end if;
  if (select count(*) from public.paging_config where is_active) <> 1 then raise exception 'S19: paging_config needs exactly one active version'; end if;
end $$;
