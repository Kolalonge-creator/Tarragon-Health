-- S19c: red-event pager delivery hardening (S16-S20 review plan, Stage 1; CMO decisions 9, 10, 11 parts 1 and 2, 15).
--
-- Defects closed here: P1 (page email never delivers: the sender change ships with this migration, see the edge function),
-- P2 (a page now nudges the sender at once; the first bus hop of a blood pressure reading is urgent), P3 (the older critical
-- alert engine can no longer climb a page to SMS or re-notify after an acknowledgement; a trigger makes SMS and voice
-- impossible for page notifications), P4 and P7 (no page, acknowledgement or chart access for a conflicted clinician or the
-- patient themself; no acknowledgement or chart access for a clinician who is no longer eligible), P6 (repeat red events for one
-- patient merge into one UNACKNOWLEDGED page family; an acknowledged family is never joined, so a new event rings again), P8 (a reconciler creates any missing page within 60 seconds), P9 (on-call needs a working push subscription,
-- a verified email and a test page acknowledged in the last N days, not only the self-attested checklist).
-- Also: delivered acknowledgement per channel with an early advance of the ladder, a terminal 'expired' state with its own
-- alarm, heartbeats for the paging engine and for on-call devices, and an incident when the engine is stale or nobody
-- reachable is on the rota.
--
-- Invariants kept: INV-05 (a red event never waits: the ladder only ever gets faster, 5 and 10 minute timers unchanged),
-- INV-06 (nothing here turns a page off), INV-07 (every notice is the fixed neutral template), INV-12 (chart access still only
-- after acknowledgement of an open page, and now never for a conflicted clinician), INV-13 (is_test everywhere).
-- Values are PROPOSED (CMO) and live in paging_delivery_config, mirrored in packages/shared proposed-config as
-- paging.delivery_rules. Live counts before this change: no real (non-test) page has ever been sent in production.

-- ---------------------------------------------------------------------------
-- 1. Config (PROPOSED values, CMO owner)
-- ---------------------------------------------------------------------------
create table public.paging_delivery_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index paging_delivery_config_one_active on public.paging_delivery_config (is_active) where is_active;

create function private.paging_delivery_rules_valid(r jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare k text;
begin
  foreach k in array array['delivered_ack_seconds', 'reconcile_after_seconds', 'reconcile_lookback_hours', 'merge_window_minutes',
                           'engine_heartbeat_stale_seconds', 'device_seen_stale_minutes', 'readiness_test_page_days',
                           'test_page_min_interval_seconds', 'page_notification_stuck_seconds', 'first_hop_safe_systolic_min', 'first_hop_safe_systolic_max',
                           'first_hop_safe_diastolic_min', 'first_hop_safe_diastolic_max'] loop
    if not coalesce((r ->> k) ~ '^[0-9]+$' and (r ->> k)::integer > 0, false) then return false; end if;
  end loop;
  -- 1 = the objective on-call readiness checks are required to be put on the rota, 0 = only the self-attested checklist
  return coalesce((r ->> 'objective_readiness_required') in ('0', '1'), false);
exception when others then
  return false;
end;
$$;
revoke all on function private.paging_delivery_rules_valid(jsonb) from public, anon, authenticated;
alter table public.paging_delivery_config add constraint paging_delivery_config_rules_valid check (private.paging_delivery_rules_valid(rules));

-- paging-delivery-rules-begin
insert into public.paging_delivery_config (version, is_active, effective_from, rules) values (1, true, '2026-10-14', $json$
{
  "delivered_ack_seconds": 90,
  "reconcile_after_seconds": 60,
  "reconcile_lookback_hours": 24,
  "merge_window_minutes": 30,
  "engine_heartbeat_stale_seconds": 120,
  "device_seen_stale_minutes": 10,
  "readiness_test_page_days": 7,
  "test_page_min_interval_seconds": 120,
  "page_notification_stuck_seconds": 120,
  "first_hop_safe_systolic_min": 100,
  "first_hop_safe_systolic_max": 139,
  "first_hop_safe_diastolic_min": 60,
  "first_hop_safe_diastolic_max": 89,
  "objective_readiness_required": 1
}
$json$::jsonb);
-- paging-delivery-rules-end

alter table public.paging_delivery_config enable row level security;
create policy paging_delivery_config_read on public.paging_delivery_config for select to authenticated using (true);
revoke all on public.paging_delivery_config from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.paging_delivery_config from authenticated;
grant select on public.paging_delivery_config to authenticated;

create function private.paging_delivery_rule(p_key text) returns integer
language sql stable security definer set search_path = ''
as $$ select (rules ->> p_key)::integer from public.paging_delivery_config where is_active order by version desc limit 1 $$;
revoke all on function private.paging_delivery_rule(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. New columns and tables
-- ---------------------------------------------------------------------------
alter table public.pages
  add column delivered_at    timestamptz,
  add column expired_at      timestamptz,
  add column merged_count    integer not null default 0,
  add column last_merged_at  timestamptz;

-- A repeat red event for a patient who already has an open page family is recorded here instead of making a new root.
create table public.page_merged_events (
  triage_event_id uuid primary key references public.triage_events (id) on delete cascade,
  page_id         uuid not null references public.pages (id) on delete cascade,
  merged_at       timestamptz not null default now()
);
create index page_merged_events_page_idx on public.page_merged_events (page_id);
alter table public.page_merged_events enable row level security;
create policy page_merged_events_read on public.page_merged_events for select to authenticated
  using (private.can_credential_review() and exists (select 1 from public.pages pg where pg.id = page_merged_events.page_id and pg.organisation_id = (select pr.organisation_id from public.profiles pr where pr.id = (select auth.uid()))));
revoke all on public.page_merged_events from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.page_merged_events from authenticated;
grant select on public.page_merged_events to authenticated;

-- A test page: sent to a clinician to prove their phone and email really work (readiness) or as an unannounced drill.
create table public.page_tests (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  clinician_id     uuid not null references public.profiles (id) on delete cascade,
  requested_by     uuid references public.profiles (id) on delete set null,
  kind             text not null default 'readiness' check (kind in ('readiness', 'drill')),
  sent_at          timestamptz not null default now(),
  delivered_at     timestamptz,
  acknowledged_at  timestamptz,
  is_test          boolean not null default false
);
create index page_tests_clinician_idx on public.page_tests (clinician_id, sent_at desc);
create index page_tests_requested_by_idx on public.page_tests (requested_by) where requested_by is not null;
create index page_tests_org_idx on public.page_tests (organisation_id);
alter table public.page_tests enable row level security;
create policy page_tests_read on public.page_tests for select to authenticated
  using (clinician_id = (select auth.uid()) or (private.can_credential_review() and organisation_id = (select pr.organisation_id from public.profiles pr where pr.id = (select auth.uid()))));
revoke all on public.page_tests from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.page_tests from authenticated;
grant select on public.page_tests to authenticated;

-- The app recorded that a page (or test page) was actually shown, per channel. This is the "delivered" receipt that FCM and
-- Web Push do not give: it comes from the device or console itself.
create table public.page_delivered_acks (
  id           uuid primary key default gen_random_uuid(),
  page_id      uuid references public.pages (id) on delete cascade,
  test_id      uuid references public.page_tests (id) on delete cascade,
  clinician_id uuid not null references public.profiles (id) on delete cascade,
  channel      text not null check (channel in ('push', 'in_app', 'alarm')),
  device_id    text,
  acked_at     timestamptz not null default now(),
  check ((page_id is null) <> (test_id is null))
);
create unique index page_delivered_acks_page_uq on public.page_delivered_acks (page_id, clinician_id, channel) where page_id is not null;
create unique index page_delivered_acks_test_uq on public.page_delivered_acks (test_id, clinician_id, channel) where test_id is not null;
create index page_delivered_acks_clinician_idx on public.page_delivered_acks (clinician_id);
alter table public.page_delivered_acks enable row level security;
create policy page_delivered_acks_read on public.page_delivered_acks for select to authenticated
  using (clinician_id = (select auth.uid())
         or (private.can_credential_review() and exists (select 1 from public.profiles c where c.id = page_delivered_acks.clinician_id and c.organisation_id = (select pr.organisation_id from public.profiles pr where pr.id = (select auth.uid())))));
revoke all on public.page_delivered_acks from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.page_delivered_acks from authenticated;
grant select on public.page_delivered_acks to authenticated;

-- Heartbeats of the paging engine, and last-seen of each on-call device.
create table public.paging_heartbeats (
  component    text primary key check (component in ('sweep_pages', 'process_events', 'reconciler')),
  last_seen_at timestamptz not null default now(),
  detail       jsonb not null default '{}'::jsonb
);
alter table public.paging_heartbeats enable row level security;
create policy paging_heartbeats_read on public.paging_heartbeats for select to authenticated using (private.can_credential_review());
revoke all on public.paging_heartbeats from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.paging_heartbeats from authenticated;
grant select on public.paging_heartbeats to authenticated;

create table public.on_call_device_seen (
  clinician_id      uuid not null references public.profiles (id) on delete cascade,
  device_id         text not null check (char_length(device_id) between 8 and 80),
  kind              text not null check (kind in ('web', 'ios', 'android')),
  last_seen_at      timestamptz not null default now(),
  last_delivered_at timestamptz,
  primary key (clinician_id, device_id)
);
alter table public.on_call_device_seen enable row level security;
create policy on_call_device_seen_read on public.on_call_device_seen for select to authenticated
  using (clinician_id = (select auth.uid())
         or (private.can_credential_review() and exists (select 1 from public.profiles c where c.id = on_call_device_seen.clinician_id and c.organisation_id = (select pr.organisation_id from public.profiles pr where pr.id = (select auth.uid())))));
revoke all on public.on_call_device_seen from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.on_call_device_seen from authenticated;
grant select on public.on_call_device_seen to authenticated;

-- Only the functions below write these tables (same switch as pages).
create trigger page_merged_events_guard before insert or update on public.page_merged_events for each row execute function private.guard_paging_write();
create trigger page_tests_guard before insert or update on public.page_tests for each row execute function private.guard_paging_write();
create trigger page_delivered_acks_guard before insert or update on public.page_delivered_acks for each row execute function private.guard_paging_write();
create trigger paging_heartbeats_guard before insert or update on public.paging_heartbeats for each row execute function private.guard_paging_write();
create trigger on_call_device_seen_guard before insert or update on public.on_call_device_seen for each row execute function private.guard_paging_write();

-- A recent-first read of triage events with a red grade: the reconciler's only scan.
create index triage_events_red_recent_idx on public.triage_events (created_at) where grade = 'red' and not shadow;

insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('page.expired', 'A red event page ran out of ladder with nobody acknowledging it', 'S19', true);
insert into public.event_type_versions (event_type, version, required_keys) values ('page.expired', 1, array['page_id']);

-- ---------------------------------------------------------------------------
-- 3. P3: no SMS, no voice, no legacy ladder for page notifications
-- ---------------------------------------------------------------------------
-- The only way to hand a page to a person is push, in-app and email (D-12, decision 10). A trigger makes the other channels
-- impossible rather than relying on every future producer remembering.
create function private.no_sms_for_pages() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.source_table in ('pages', 'page_tests') and new.channel::text in ('sms', 'voice') then
    raise exception 'page notifications never use sms or voice' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.no_sms_for_pages() from public, anon, authenticated;
create trigger notifications_no_sms_for_pages before insert on public.notifications
  for each row execute function private.no_sms_for_pages();

-- The older critical alert engine hops an unopened critical notification push, email, sms and re-notifies after an
-- acknowledgement. Pages have their own ladder, so its rows are not eligible for the legacy one.
-- The engine is PATCHED, not replaced: this reads whatever definition is current (the live one carries changes that are in no
-- migration file yet: a patient ladder, test_alert and red_alert_watch exclusions) and adds exactly one clause after the
-- existing "its own admin alarm" exclusion, so a later or concurrent change to the engine is never overwritten. If the anchor is
-- not found the migration stops rather than guess.
do $patch$
declare
  v_def text := pg_get_functiondef('private.escalate_unconfirmed_critical_notifications()'::regprocedure);
  v_new text;
  v_anchor constant text := 'and n.template is distinct from ''critical_notification_escalation_exhausted''';
begin
  if v_def like '%''page_tests''%' then return; end if;   -- already patched
  if position(v_anchor in v_def) = 0 then
    raise exception 'S19c: the legacy critical alert engine no longer has the expected exclusion line; patch it by hand';
  end if;
  v_new := replace(v_def, v_anchor, v_anchor || E'\n      -- S19c (P3): a page has its own closed-loop ladder with no SMS rung; the legacy engine must never touch it\n      and coalesce(n.source_table, '''') not in (''pages'', ''page_tests'')');
  execute v_new;
end
$patch$;

-- ---------------------------------------------------------------------------
-- 4. P2: the page rows go out at once
-- ---------------------------------------------------------------------------
-- Best effort, like enqueue_critical_notification: pg_net sends after commit, and the 5 minute sender cron stays the backstop.
create function private.nudge_send_pending() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/send-pending-notifications',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_publishable_key'),
      'Content-Type', 'application/json'),
    timeout_milliseconds := 8000);
exception when others then
  null;
end;
$$;
revoke all on function private.nudge_send_pending() from public, anon, authenticated;

-- One row per channel, critical priority, and then the nudge. page_notify keeps its S19 arguments; p_nudge is new.
drop function private.page_notify(uuid, uuid, text, uuid, text[]);
create function private.page_notify_ref(p_recipient uuid, p_org uuid, p_template text, p_ref uuid, p_source_table text,
                                        p_channels text[] default array['push', 'in_app', 'email'], p_nudge boolean default true) returns void
language plpgsql security definer set search_path = ''
as $$
declare c text;
begin
  foreach c in array p_channels loop
    insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
    values (p_recipient, p_org, c::public.notification_channel, p_template, jsonb_build_object('page_id', p_ref), 'pending', 'non_clinical', 'critical', p_source_table, p_ref);
  end loop;
  if p_nudge then perform private.nudge_send_pending(); end if;
end;
$$;
revoke all on function private.page_notify_ref(uuid, uuid, text, uuid, text, text[], boolean) from public, anon, authenticated;

create function private.page_notify(p_recipient uuid, p_org uuid, p_template text, p_page uuid, p_channels text[] default array['push', 'in_app', 'email'], p_nudge boolean default true) returns void
language sql security definer set search_path = ''
as $$ select private.page_notify_ref(p_recipient, p_org, p_template, p_page, 'pages', p_channels, p_nudge) $$;
revoke all on function private.page_notify(uuid, uuid, text, uuid, text[], boolean) from public, anon, authenticated;

create or replace function private.page_notify_leadership(p_org uuid, p_page uuid, p_test boolean, p_template text default 'on_call_escalation', p_channels text[] default array['push', 'in_app', 'email']) returns integer
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
    perform private.page_notify(r.id, p_org, p_template, p_page, p_channels, false);
    n := n + 1;
  end loop;
  if n = 0 then
    perform private.page_incident(p_org, 'page_no_leadership', 'A red event alert had nobody to go to',
      'A red event needed the clinical lead and ops alerted but no active chief medical officer or admin account matched. Add or activate one.');
  else
    perform private.nudge_send_pending();
  end if;
  return n;
end;
$$;

-- First hop: a blood pressure reading OUTSIDE the safe band in paging_delivery_config can be red, so its event is urgent and
-- nudges process-events at once. A reading inside the band, a missing or unreadable band, and every recovery re-emit stay on the
-- 15 second cron, so a bulk upload or a backlog cannot flood the edge function ahead of a real red event. The grade, not this
-- priority, decides what happens: nothing is ever skipped. A red-flag symptom regrade is always urgent (below). The recheck
-- timeout and missing-event re-emit in private.sweep_triage_rechecks stay normal priority and are NOT touched here. The bodies are
-- the live definitions (the symptom function reads private.vitals_readings_current, S05b) plus the priority.
create or replace function private.emit_bp_observation_recorded()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_inside boolean; v_symptom boolean;
begin
  if new.vital_type::text = 'blood_pressure' and new.systolic is not null and new.diastolic is not null then
    begin
      -- null (a missing band) is not inside: fail towards urgent
      -- a red-flag symptom logged in the last 10 minutes can make an in-band reading red (the symptom regrade only fires when the
      -- symptom arrives AFTER the reading), so that reading is urgent too
      v_symptom := exists (select 1 from public.symptoms sy where sy.patient_id = new.patient_id and sy.created_at > now() - interval '10 minutes'
                             and sy.symptom_type::text in ('severe_headache', 'chest_pain', 'breathlessness', 'weakness_or_numbness',
                                                           'difficulty_speaking', 'back_pain', 'confusion', 'visual_disturbance'));
      v_inside := not v_symptom and coalesce(new.systolic between private.paging_delivery_rule('first_hop_safe_systolic_min') and private.paging_delivery_rule('first_hop_safe_systolic_max')
                      and new.diastolic between private.paging_delivery_rule('first_hop_safe_diastolic_min') and private.paging_delivery_rule('first_hop_safe_diastolic_max'), false);
      perform private.emit_domain_event(
        'observation.recorded', new.organisation_id,
        jsonb_build_object('observation_id', new.id),
        'bp:' || new.id::text,
        new.patient_id, 'observation', new.id, case when v_inside then 'normal' else 'urgent' end);
    exception when others then
      raise warning 'S12: could not emit observation.recorded for %: %', new.id, sqlerrm;
    end;
  end if;
  return null;
end $$;

create or replace function private.emit_symptom_regrade()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_obs public.vitals_readings%rowtype;
begin
  if new.symptom_type::text not in ('severe_headache', 'chest_pain', 'breathlessness', 'weakness_or_numbness',
       'difficulty_speaking', 'back_pain', 'confusion', 'visual_disturbance') then
    return null;
  end if;
  begin
    select * into v_obs from private.vitals_readings_current v
    where v.patient_id = new.patient_id and v.vital_type::text = 'blood_pressure' and v.systolic is not null
      and v.created_at <= new.created_at and v.created_at >= new.created_at - interval '10 minutes'
    order by v.created_at desc, v.taken_at desc limit 1;
    if found then
      perform private.emit_domain_event(
        'observation.recorded', v_obs.organisation_id,
        jsonb_build_object('observation_id', v_obs.id, 'symptom_id', new.id),
        'bp:' || v_obs.id::text || ':sym:' || new.id::text,
        v_obs.patient_id, 'observation', v_obs.id, 'urgent');
    end if;
  exception when others then
    raise warning 'S12: could not emit a symptom regrade for %: %', new.id, sqlerrm;
  end;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 5. P4: who can be paged (never a conflicted clinician or the patient); P6: merge repeat red events
-- ---------------------------------------------------------------------------
drop function private.page_recipient(uuid, boolean);
create function private.page_recipient(p_org uuid, p_test boolean, p_patient uuid default null) returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare r record;
begin
  select * into r from private.on_call_now(p_org, p_test);
  if not found then return null; end if;
  if private.clinician_is_eligible(r.primary_id)
     and r.primary_id is distinct from p_patient and not coalesce(private.has_conflict(r.primary_id, p_patient), false) then return r.primary_id; end if;
  if r.backup_id is not null and private.clinician_is_eligible(r.backup_id)
     and r.backup_id is distinct from p_patient and not coalesce(private.has_conflict(r.backup_id, p_patient), false) then return r.backup_id; end if;
  return null;
end;
$$;
revoke all on function private.page_recipient(uuid, boolean, uuid) from public, anon, authenticated;

create or replace function public.create_red_page(p_triage_event uuid)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  te public.triage_events%rowtype;
  v_root uuid;
  v_to uuid;
  v_page public.pages%rowtype;
  v_family public.pages%rowtype;
begin
  select * into te from public.triage_events where id = p_triage_event;
  if not found then raise exception 'unknown triage event' using errcode = '22023'; end if;
  -- two layers with the handler: a shadow grade (rule set nobody approved, OQ-88) and anything that is not a red grade
  -- carrying the page action never pages
  if te.shadow or te.grade <> 'red' or not (te.actions @> '[{"kind":"page_on_call"}]'::jsonb) then return null; end if;
  perform pg_advisory_xact_lock(hashtext('page:' || p_triage_event));
  select id into v_root from public.pages where triage_event_id = p_triage_event and parent_page_id is null;
  if found then return v_root; end if;
  select page_id into v_root from public.page_merged_events where triage_event_id = p_triage_event;
  if found then return v_root; end if;

  -- Two-tier (CMO 2026-10-08): a Free patient's red event pages nobody. They get the guidance record instead.
  if not private.patient_may_page_doctor(te.patient_id) then
    perform private.record_free_red_event(te.id);
    return null;
  end if;

  -- P6: one open UNACKNOWLEDGED page family per patient. A repeat red event inside the window joins it (that family is already
  -- ringing and escalating, so a second ring adds nothing). An acknowledged, expired or closed family is never joined: someone who
  -- has stepped away after acknowledging must not be the only thing standing between a new red event and a page (INV-05).
  perform pg_advisory_xact_lock(hashtext('pagefam:' || te.patient_id));
  select * into v_family from public.pages
   where patient_id = te.patient_id and is_test = te.is_test and parent_page_id is null and closed_at is null and expired_at is null
     and acknowledged_at is null and sent_at > now() - make_interval(mins => private.paging_delivery_rule('merge_window_minutes'))
   order by sent_at desc limit 1;
  if found then
    perform set_config('tarragon.paging_write', 'on', true);
    insert into public.page_merged_events (triage_event_id, page_id) values (te.id, v_family.id);
    update public.pages set merged_count = merged_count + 1, last_merged_at = now() where id = v_family.id;
    perform set_config('tarragon.paging_write', 'off', true);
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
      values (te.organisation_id, null, 'page.merged', 'page', v_family.id, jsonb_build_object('triage_event_id', te.id));
    return v_family.id;
  end if;

  v_to := private.page_recipient(te.organisation_id, te.is_test, te.patient_id);
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
revoke all on function public.create_red_page(uuid) from public, anon, authenticated;
grant execute on function public.create_red_page(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. P7: acknowledging needs a clinician who is still allowed to, and who is not the patient or conflicted
-- ---------------------------------------------------------------------------
create or replace function public.acknowledge_page(p_page uuid) returns void
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
  -- S19c (P7, P4): paged earlier is not enough. Suspended, licence or indemnity lapsed, the patient themself, or a declared
  -- conflict all refuse, and the ladder carries on to the next person.
  if not private.clinician_is_eligible(v_uid) then
    raise exception 'your clinician access is paused, so you cannot acknowledge this page' using errcode = '42501';
  end if;
  if v_uid = root.patient_id or private.has_conflict(v_uid, root.patient_id) then
    raise exception 'you cannot take this case' using errcode = '42501';
  end if;
  if root.acknowledged_at is not null then return; end if;
  if root.closed_at is not null then raise exception 'this page is already closed' using errcode = '22023'; end if;
  perform set_config('tarragon.paging_write', 'on', true);
  update public.pages set acknowledged_at = now(), acknowledged_by = v_uid, delivered_at = coalesce(delivered_at, now())
   where coalesce(parent_page_id, id) = root.id and acknowledged_at is null;
  perform set_config('tarragon.paging_write', 'off', true);
  perform private.page_task_settle(root);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (root.organisation_id, v_uid, 'page.acknowledged', 'page', root.id, jsonb_build_object('seconds_after_sent', extract(epoch from now() - root.sent_at)::integer));
  perform private.emit_domain_event('page.acknowledged', root.organisation_id, jsonb_build_object('page_id', root.id),
    'page.acknowledged:' || root.id, root.patient_id, 'page', root.id);
end;
$$;
revoke all on function public.acknowledge_page(uuid) from public, anon;
grant execute on function public.acknowledge_page(uuid) to authenticated;

-- INV-12: the acknowledged-page clause now never grants a conflicted clinician (or the patient) the chart. Everything else is
-- unchanged from the live definition (20261006183117_s21g...).
create or replace function private.clinician_has_patient_access(p_patient uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
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
      -- S21 (OQ-159, INV-12): a consultation I finished with this patient, until a signed note exists for it, for at most the policy cap
      or exists (
        select 1 from public.encounters en
         where en.patient_id = p_patient
           and en.clinician_id = (select auth.uid())
           and en.status = 'completed'
           and en.ended_at >= now() - make_interval(hours => coalesce((private.consult_policy() ->> 'chartAccessAfterFinishMaxHours')::integer, 0))
           -- an encounter with no link to a note (neither a video consultation nor an async consult) gets no access here: nothing could end it
           and (en.video_consultation_id is not null or en.async_consult_id is not null)
           and not exists (
                 select 1 from public.clinical_encounter_notes n
                  where n.patient_id = en.patient_id
                    and n.status = 'finalized'
                    and ((n.video_consultation_id is not null and n.video_consultation_id = en.video_consultation_id)
                      or (n.async_consult_id is not null and n.async_consult_id = en.async_consult_id))
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
      -- pages and pages past the access window do not count. S19c (P4, P7): never for a conflicted clinician, never for the patient, and not for a
      -- clinician who is no longer eligible (suspended, licence or indemnity lapsed) even if they acknowledged earlier.
      or (
        exists (
          select 1 from public.pages pg
           where pg.patient_id = p_patient and pg.closed_at is null
             and pg.acknowledged_by = (select auth.uid())
        )
        and (select auth.uid()) <> p_patient
        and not private.has_conflict((select auth.uid()), p_patient)
        and private.clinician_is_eligible((select auth.uid()))
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
$function$;
revoke all on function private.clinician_has_patient_access(uuid) from public, anon;
grant execute on function private.clinician_has_patient_access(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Delivered acknowledgement (decision 9) and heartbeats
-- ---------------------------------------------------------------------------
create function private.paging_heartbeat(p_component text, p_detail jsonb default '{}'::jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform set_config('tarragon.paging_write', 'on', true);
  insert into public.paging_heartbeats (component, last_seen_at, detail) values (p_component, now(), coalesce(p_detail, '{}'::jsonb))
  on conflict (component) do update set last_seen_at = now(), detail = excluded.detail;
  perform set_config('tarragon.paging_write', 'off', true);
end;
$$;
revoke all on function private.paging_heartbeat(text, jsonb) from public, anon, authenticated;

-- The edge function process-events records its own heartbeat after each pass (service role only).
create function public.record_engine_heartbeat(p_component text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_component not in ('process_events') then raise exception 'unknown component' using errcode = '22023'; end if;
  perform private.paging_heartbeat(p_component);
end;
$$;
revoke all on function public.record_engine_heartbeat(text) from public, anon, authenticated;
grant execute on function public.record_engine_heartbeat(text) to service_role;

-- Internal: remember a device and the moment it last showed a page.
create function private.touch_on_call_device(p_clinician uuid, p_device text, p_kind text, p_delivered boolean) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_device is null or char_length(p_device) not between 8 and 80 then return; end if;
  perform set_config('tarragon.paging_write', 'on', true);
  insert into public.on_call_device_seen (clinician_id, device_id, kind, last_seen_at, last_delivered_at)
  values (p_clinician, p_device, coalesce(p_kind, 'web'), now(), case when p_delivered then now() end)
  on conflict (clinician_id, device_id) do update
    set last_seen_at = now(), last_delivered_at = case when p_delivered then now() else public.on_call_device_seen.last_delivered_at end
    where public.on_call_device_seen.last_seen_at < now() - interval '20 seconds' or p_delivered;
  perform set_config('tarragon.paging_write', 'off', true);
end;
$$;
revoke all on function private.touch_on_call_device(uuid, text, text, boolean) from public, anon, authenticated;

-- A device or console says it is alive (the on-call alarm calls this about once a minute while the console is open).
create function public.paging_device_ping(p_device text, p_kind text default 'web') returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_kind not in ('web', 'ios', 'android') then raise exception 'unknown device kind' using errcode = '22023'; end if;
  if not exists (select 1 from public.clinical_staff where profile_id = (select auth.uid()) and active and status = 'active') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  perform private.touch_on_call_device((select auth.uid()), p_device, p_kind, false);
end;
$$;
revoke all on function public.paging_device_ping(text, text) from public, anon;
grant execute on function public.paging_device_ping(text, text) to authenticated;

-- The app shows a page: record it. p_ref is a page id or a test page id and only the clinician it was sent to can record it.
-- Idempotent per page, clinician and channel. Returns whether this was the first receipt.
create function private.record_page_delivered_internal(p_clinician uuid, p_ref uuid, p_channel text, p_device text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_first boolean := false; v_n integer;
begin
  if p_channel not in ('push', 'in_app', 'alarm') then raise exception 'unknown channel' using errcode = '22023'; end if;
  perform set_config('tarragon.paging_write', 'on', true);
  if exists (select 1 from public.pages where id = p_ref and to_clinician_id = p_clinician) then
    insert into public.page_delivered_acks (page_id, clinician_id, channel, device_id) values (p_ref, p_clinician, p_channel, p_device)
      on conflict (page_id, clinician_id, channel) where page_id is not null do nothing;
    get diagnostics v_n = row_count; v_first := v_n > 0;
    update public.pages set delivered_at = now() where id = p_ref and delivered_at is null;
  elsif exists (select 1 from public.page_tests where id = p_ref and clinician_id = p_clinician) then
    insert into public.page_delivered_acks (test_id, clinician_id, channel, device_id) values (p_ref, p_clinician, p_channel, p_device)
      on conflict (test_id, clinician_id, channel) where test_id is not null do nothing;
    get diagnostics v_n = row_count; v_first := v_n > 0;
    update public.page_tests set delivered_at = now() where id = p_ref and delivered_at is null;
  else
    perform set_config('tarragon.paging_write', 'off', true);
    raise exception 'unknown page' using errcode = '42501';
  end if;
  perform set_config('tarragon.paging_write', 'off', true);
  perform private.touch_on_call_device(p_clinician, p_device, 'web', true);
  return v_first;
end;
$$;
revoke all on function private.record_page_delivered_internal(uuid, uuid, text, text) from public, anon, authenticated;

create function public.record_page_delivered(p_ref uuid, p_channel text, p_device text default null) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'not authorised' using errcode = '42501'; end if;
  return private.record_page_delivered_internal((select auth.uid()), p_ref, p_channel, p_device);
end;
$$;
revoke all on function public.record_page_delivered(uuid, text, text) from public, anon;
grant execute on function public.record_page_delivered(uuid, text, text) to authenticated;

-- The service worker only knows the notification id it was pushed: it records the receipt through this.
create function public.record_notification_displayed(p_notification uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare n public.notifications%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into n from public.notifications where id = p_notification and recipient_id = (select auth.uid());
  if not found or n.source_table not in ('pages', 'page_tests') or n.source_id is null then return false; end if;
  -- only a page or test page sent TO this clinician is a receipt target (an update or a lead alert is not): anything else is false
  if not (exists (select 1 from public.pages pg where pg.id = n.source_id and pg.to_clinician_id = (select auth.uid()))
          or exists (select 1 from public.page_tests t where t.id = n.source_id and t.clinician_id = (select auth.uid()))) then
    return false;
  end if;
  return private.record_page_delivered_internal((select auth.uid()), n.source_id, 'push', null);
end;
$$;
revoke all on function public.record_notification_displayed(uuid) from public, anon;
grant execute on function public.record_notification_displayed(uuid) to authenticated;

-- Has this clinician ever shown a page on a device or console of theirs recently? The early advance only counts a missing
-- receipt against someone who can report one; a clinician whose route cannot report (for example an app that does not send
-- receipts yet) falls back to the 5 and 10 minute timers, never to a faster escalation caused by silence of the reporting route.
create function private.clinician_reports_delivery(p_profile uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.page_delivered_acks a
                  where a.clinician_id = p_profile
                    and a.acked_at > now() - make_interval(days => private.paging_delivery_rule('readiness_test_page_days')))
$$;
revoke all on function private.clinician_reports_delivery(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. The reconciler (P8) and the health sweep
-- ---------------------------------------------------------------------------
create function private.reconcile_red_pages() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  te record;
  v_n integer := 0;
  v_page uuid;
begin
  for te in
    select t.id, t.organisation_id, t.patient_id, t.created_at
      from public.triage_events t
     where t.grade = 'red' and not t.shadow and t.patient_id is not null
       and t.created_at > now() - make_interval(hours => private.paging_delivery_rule('reconcile_lookback_hours'))
       and t.created_at <= now() - make_interval(secs => private.paging_delivery_rule('reconcile_after_seconds'))
       and t.actions @> '[{"kind":"page_on_call"}]'::jsonb
       and not exists (select 1 from public.pages p where p.triage_event_id = t.id and p.parent_page_id is null)
       and not exists (select 1 from public.page_merged_events m where m.triage_event_id = t.id)
       and not exists (select 1 from public.free_red_events f where f.triage_event_id = t.id)
     order by t.created_at
  loop
    begin
      -- create_red_page decides: a Member is paged; a Free patient gets the guidance record instead (and the event then leaves this
      -- list because free_red_events now holds it), so a bus outage cannot leave a Free patient with no guidance either
      v_page := public.create_red_page(te.id);
      if v_page is not null then
        v_n := v_n + 1;
        insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
          values (te.organisation_id, null, 'page.reconciled', 'page', v_page,
                  jsonb_build_object('triage_event_id', te.id, 'seconds_late', extract(epoch from now() - te.created_at)::integer));
        perform private.page_incident(te.organisation_id, 'page_reconciled', 'A red event page had to be recovered',
          'A red triage event had no page after the grace period and the reconciler created it. The event bus (process-events) may be down or failing: check the process-events heartbeat and the dead letter.');
      end if;
    exception when others then
      if not exists (select 1 from public.audit_log a where a.action = 'page_reconcile.error' and a.entity_id = te.id and a.created_at > now() - interval '1 hour') then
        insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
          values (te.organisation_id, 'page_reconcile.error', 'triage_event', te.id, jsonb_build_object('error', sqlerrm));
      end if;
      perform private.page_incident(te.organisation_id, 'page_reconcile_failed', 'A red event could not be paged by the reconciler',
        'A red triage event has no page and the reconciler could not create one; see audit_log action page_reconcile.error. Page the on-call clinician by phone now.');
    end;
  end loop;
  perform private.paging_heartbeat('reconciler', jsonb_build_object('created', v_n));
  return v_n;
end;
$$;
revoke all on function private.reconcile_red_pages() from public, anon, authenticated;

-- Reachable = eligible and able to be told: a working push subscription and a verified email.
create function private.clinician_reachable(p_profile uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.clinician_is_eligible(p_profile)
     and exists (select 1 from public.push_subscriptions s where s.profile_id = p_profile and s.disabled_at is null)
     and exists (select 1 from auth.users u where u.id = p_profile and u.email is not null and u.email_confirmed_at is not null)
$$;
revoke all on function private.clinician_reachable(uuid) from public, anon, authenticated;

-- Every minute (pg_cron, outside the 15 second sweeps): engine heartbeats, nobody reachable on the rota, and the reconciler as an
-- independent backstop if sweep_pages itself is failing. Opens one incident per reference; never silent.
create function private.sweep_paging_health() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_stale integer := private.paging_delivery_rule('engine_heartbeat_stale_seconds');
  v_n integer := 0;
  h record;
  o record;
  v_primary uuid;
  v_backup uuid;
  v_ok boolean;
  v_stuck bigint;
  v_old bigint;
  v_org_for_incident uuid := null;   -- an engine fault is platform wide (ops_incidents: null organisation)
begin
  begin
    perform private.reconcile_red_pages();
  exception when others then
    insert into public.audit_log (action, entity_type, event) values ('page_reconcile.error', 'paging', jsonb_build_object('error', sqlerrm, 'via', 'health'));
  end;

  for h in select component, last_seen_at from public.paging_heartbeats where component in ('sweep_pages', 'process_events') loop
    if h.last_seen_at < now() - make_interval(secs => v_stale) then
      perform private.page_incident(v_org_for_incident, 'paging_engine_stale:' || h.component, 'The paging engine is not running: ' || h.component,
        'The ' || h.component || ' heartbeat is older than ' || v_stale || ' seconds. Red event pages may not be created or escalated on time. Check the scheduled job and the edge function now, and phone the on-call clinician for any open case.');
      v_n := v_n + 1;
    end if;
  end loop;
  -- a component that never reported at all is also stale, but only once the other has (otherwise a fresh install would alarm)
  if exists (select 1 from public.paging_heartbeats where component = 'sweep_pages')
     and not exists (select 1 from public.paging_heartbeats where component = 'process_events') then
    perform private.page_incident(v_org_for_incident, 'paging_engine_stale:process_events', 'The paging engine is not running: process_events',
      'process-events has never recorded a heartbeat although the paging sweep is running. Check that the edge function is deployed and PROCESS_EVENTS_SECRET is set.');
    v_n := v_n + 1;
  end if;

  -- the nudge that sends a page is best effort (pg_net) and the 5 minute sender cron is its backstop: a page notification still pending
  -- after page_notification_stuck_seconds means the sender is down or failing, which no engine heartbeat shows
  select count(*) into v_stuck from public.notifications n
   where n.source_table in ('pages', 'page_tests') and n.status = 'pending' and n.channel::text in ('push', 'email')
     and n.created_at < now() - make_interval(secs => private.paging_delivery_rule('page_notification_stuck_seconds'))
     and n.created_at > now() - interval '1 day';
  if v_stuck > 0 then
    perform private.page_incident(v_org_for_incident, 'page_notifications_stuck', 'Page notifications are not being sent',
      v_stuck || ' page notification(s) have been waiting to send for longer than ' || private.paging_delivery_rule('page_notification_stuck_seconds') ||
      ' seconds. The notification sender (send-pending-notifications) may be down, mis-deployed or missing its secrets. Phone any on-call clinician with an open case now.');
    v_n := v_n + 1;
  end if;
  -- red events too old for the reconciler's look-back that still have no page, merge record or Free record: never dropped silently
  select count(*) into v_old from public.triage_events t
   where t.grade = 'red' and not t.shadow and t.patient_id is not null
     and t.created_at < now() - make_interval(hours => private.paging_delivery_rule('reconcile_lookback_hours'))
     and t.created_at > now() - interval '7 days'
     and t.actions @> '[{"kind":"page_on_call"}]'::jsonb
     and not exists (select 1 from public.pages p where p.triage_event_id = t.id and p.parent_page_id is null)
     and not exists (select 1 from public.page_merged_events m where m.triage_event_id = t.id)
     and not exists (select 1 from public.free_red_events f where f.triage_event_id = t.id);
  if v_old > 0 then
    perform private.page_incident(v_org_for_incident, 'page_unreconciled_old', 'Red events from days ago have no page',
      v_old || ' red triage event(s) older than the reconciler''s look-back have no page. Review them now: they were never paged.');
    v_n := v_n + 1;
  end if;

  -- an organisation that runs a real rota and has nobody reachable on it right now
  for o in
    select distinct r.organisation_id from public.on_call_rota r where r.is_test = false and r.cancelled_at is null
  loop
    v_primary := null; v_backup := null;
    select primary_id, backup_id into v_primary, v_backup from private.on_call_now(o.organisation_id, false);
    v_ok := coalesce(private.clinician_reachable(v_primary), false) or coalesce(private.clinician_reachable(v_backup), false);
    if not v_ok then
      perform private.page_incident(o.organisation_id, 'page_nobody_reachable:' || o.organisation_id, 'Nobody reachable is on call',
        'Nobody on the on-call rota right now is eligible with a working push subscription and a verified email, or no shift covers this hour. A red event would have nobody to page: fix the rota or the clinician''s phone setup now.');
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.sweep_paging_health() from public, anon, authenticated;
select cron.schedule('paging-health', '* * * * *', $$ select private.sweep_paging_health(); $$);

-- ---------------------------------------------------------------------------
-- 9. The escalation timers, now with the early advance, conflict exclusion, merge-safe bookkeeping and the expired state
-- ---------------------------------------------------------------------------
create or replace function private.sweep_pages() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r public.pages%rowtype;
  oc record;
  v_m1 integer := (private.paging_rule('escalation_minutes') ->> 0)::integer;
  v_m2 integer := (private.paging_rule('escalation_minutes') ->> 1)::integer;
  v_dack integer := private.paging_delivery_rule('delivered_ack_seconds');
  v_backup uuid;
  v_no_backup boolean;
  v_child uuid;
  v_backup_row public.pages%rowtype;
  v_early_backup boolean;
  v_early_lead boolean;
  v_backups integer := 0;
  v_leads integer := 0;
  v_repeats integer := 0;
  v_unclosed integer := 0;
  v_expired integer := 0;
  v_rep_max integer := (private.paging_rule('lead_repeat_max') #>> '{}')::integer;
  v_errors integer := 0;
  v_closed integer;
  v_rule_set integer;
begin
  perform private.paging_heartbeat('sweep_pages');
  -- the reconciler runs from here every pass and also from the independent per-minute health job
  begin
    perform private.reconcile_red_pages();
  exception when others then
    v_errors := v_errors + 1;
    insert into public.audit_log (action, entity_type, event) values ('page_reconcile.error', 'paging', jsonb_build_object('error', sqlerrm, 'via', 'sweep'));
  end;

  for r in
    select * from public.pages
     where parent_page_id is null and role = 'primary' and acknowledged_at is null and closed_at is null
       and (backup_paged_at is null or lead_alerted_at is null)
     order by sent_at for update skip locked
  loop
    begin
      v_no_backup := false;
      select rule_set_version into v_rule_set from public.triage_events where id = r.triage_event_id;

      -- first escalation time, or early when the page was never shown on the paged clinician's device or console in time
      -- (decision 9: delivered receipt; the 5 minute timer stays for a page that was shown but not acknowledged)
      v_early_backup := r.backup_paged_at is null and r.delivered_at is null and now() >= r.sent_at + make_interval(secs => v_dack)
                        and private.clinician_reports_delivery(r.to_clinician_id);
      if r.backup_paged_at is null and (now() >= r.sent_at + make_interval(mins => v_m1) or v_early_backup) then
        select * into oc from private.on_call_now(r.organisation_id, r.is_test);
        v_backup := null;
        if found then
          -- the first eligible person on the rota who is not the one already paged, not the patient and not conflicted
          if oc.primary_id is distinct from r.to_clinician_id and private.clinician_is_eligible(oc.primary_id)
             and oc.primary_id is distinct from r.patient_id and not private.has_conflict(oc.primary_id, r.patient_id) then v_backup := oc.primary_id;
          elsif oc.backup_id is not null and oc.backup_id is distinct from r.to_clinician_id and private.clinician_is_eligible(oc.backup_id)
             and oc.backup_id is distinct from r.patient_id and not private.has_conflict(oc.backup_id, r.patient_id) then v_backup := oc.backup_id;
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
          perform private.emit_domain_event('page.escalated', r.organisation_id,
            jsonb_build_object('page_id', v_child, 'level', 1, 'reason', case when v_early_backup then 'not_delivered' else 'unacknowledged' end),
            'page.escalated:' || v_child || ':1', r.patient_id, 'page', v_child, 'urgent');
        end if;
        perform private.page_task(r, v_rule_set);
        v_backups := v_backups + 1;
        select * into r from public.pages where id = r.id;
      end if;

      -- second escalation time (or at once when there was nobody else to page): the clinical lead and ops. Early when the backup
      -- page was never shown either.
      v_early_lead := false;
      if r.lead_alerted_at is null and r.backup_paged_at is not null then
        select * into v_backup_row from public.pages where parent_page_id = r.id and role = 'backup';
        if found and v_backup_row.delivered_at is null and now() >= v_backup_row.sent_at + make_interval(secs => v_dack)
           and private.clinician_reports_delivery(v_backup_row.to_clinician_id) then v_early_lead := true; end if;
      end if;
      if r.lead_alerted_at is null and (v_no_backup or now() >= r.sent_at + make_interval(mins => v_m2) or v_early_lead) then
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
          jsonb_build_object('page_id', v_child, 'level', 2, 'reason', case when v_no_backup then 'no_backup' when v_early_lead then 'not_delivered' else 'unacknowledged' end),
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

  -- a level 2 alert is repeated until someone acknowledges. Repeats are push and in-app only. When the last repeat has gone out and
  -- nobody has acknowledged, the page is EXPIRED: a terminal state with its own alarm to the clinical lead and ops and an ops task to
  -- phone the on-call clinician. It is not closed: a late acknowledgement is still better than none and is accepted.
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
        perform private.expire_page(r.id);
        v_expired := v_expired + 1;
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

  -- an ACKNOWLEDGED page ties a clinician to the chart; it does not stay open for ever. An unacknowledged page is never closed here.
  perform set_config('tarragon.paging_write', 'on', true);
  update public.pages set closed_at = now(), close_note = coalesce(close_note, 'closed automatically after the access window')
   where closed_at is null and sent_at < now() - make_interval(hours => (private.paging_rule('page_access_hours') #>> '{}')::integer)
     and exists (select 1 from public.pages root where root.id = coalesce(pages.parent_page_id, pages.id) and root.acknowledged_at is not null);
  get diagnostics v_closed = row_count;
  perform set_config('tarragon.paging_write', 'off', true);
  return jsonb_build_object('backups', v_backups, 'leads', v_leads, 'repeats', v_repeats, 'unclosed', v_unclosed, 'expired', v_expired, 'errors', v_errors, 'closed', v_closed);
end;
$$;
revoke all on function private.sweep_pages() from public, anon, authenticated;

-- The terminal "expired" state: the whole ladder ran out unacknowledged.
create function private.expire_page(p_root uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare r public.pages%rowtype; v_child uuid;
begin
  select * into r from public.pages where id = p_root and parent_page_id is null for update;
  if not found or r.expired_at is not null or r.acknowledged_at is not null then return; end if;
  perform set_config('tarragon.paging_write', 'on', true);
  update public.pages set expired_at = now() where id = r.id;
  perform set_config('tarragon.paging_write', 'off', true);
  select coalesce((select c.id from public.pages c where c.parent_page_id = r.id and c.role = 'escalation'), r.id) into v_child;
  -- a distinct alarm (its own template) to the clinical lead and ops, push, in-app and email
  perform private.page_notify_leadership(r.organisation_id, v_child, r.is_test, 'on_call_expired');
  -- the ops task: a named person phones the on-call clinician and the clinical lead. No automated SMS ever.
  perform private.page_incident(r.organisation_id, 'page_expired:' || r.id, 'Phone the on-call clinician now: a red event page expired',
    'A red event page ran through every alert and nobody acknowledged it. Phone the on-call clinician and the chief medical officer now, and record who you reached. Open the On call page to see the case reference.');
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (r.organisation_id, null, 'page.expired', 'page', r.id, jsonb_build_object('lead_repeat_count', r.lead_repeat_count));
  perform private.emit_domain_event('page.expired', r.organisation_id, jsonb_build_object('page_id', r.id),
    'page.expired:' || r.id, r.patient_id, 'page', r.id, 'urgent');
end;
$$;
revoke all on function private.expire_page(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. Reading the state: my_active_pages and paging_overview gain delivered/expired; paging_health for reviewers
-- ---------------------------------------------------------------------------
drop function public.my_active_pages();
create function public.my_active_pages() returns table (
  page_id uuid, root_id uuid, role public.page_role, escalation_level smallint, sent_at timestamptz,
  acknowledged_at timestamptz, patient_id uuid, seconds_waiting integer, delivered_at timestamptz, expired_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select pg.id, root.id, pg.role, pg.escalation_level, pg.sent_at, root.acknowledged_at,
         case when root.acknowledged_by = (select auth.uid()) then pg.patient_id end,
         extract(epoch from now() - root.sent_at)::integer, pg.delivered_at, root.expired_at
    from public.pages pg join public.pages root on root.id = coalesce(pg.parent_page_id, pg.id)
   where pg.closed_at is null
     and (pg.to_clinician_id = (select auth.uid())
          or root.acknowledged_by = (select auth.uid())
          or (pg.role = 'escalation' and private.credential_is_cmo()
              and pg.organisation_id = (select organisation_id from public.clinical_staff where profile_id = (select auth.uid()))))
   order by root.sent_at, pg.escalation_level;
$$;
revoke all on function public.my_active_pages() from public, anon;
grant execute on function public.my_active_pages() to authenticated;

drop function public.paging_overview();
create function public.paging_overview() returns table (
  root_id uuid, sent_at timestamptz, no_cover boolean, max_level smallint, acknowledged_at timestamptz, acknowledged_by_name text,
  closed_at timestamptz, backup_paged_at timestamptz, lead_alerted_at timestamptz, seconds_waiting integer, expired_at timestamptz,
  delivered_at timestamptz, merged_count integer)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.can_credential_review() then raise exception 'not authorised' using errcode = '42501'; end if;
  return query
  select r.id, r.sent_at, r.no_cover, (select max(c.escalation_level) from public.pages c where coalesce(c.parent_page_id, c.id) = r.id), r.acknowledged_at,
         (select full_name from public.clinical_staff where profile_id = r.acknowledged_by), r.closed_at, r.backup_paged_at, r.lead_alerted_at,
         extract(epoch from coalesce(r.acknowledged_at, now()) - r.sent_at)::integer, r.expired_at, r.delivered_at, r.merged_count
    from public.pages r
   where r.parent_page_id is null and r.sent_at > now() - interval '7 days'
     and r.organisation_id = coalesce((select organisation_id from public.profiles where id = (select auth.uid())), r.organisation_id)
   order by r.sent_at desc;
end;
$$;
revoke all on function public.paging_overview() from public, anon;
grant execute on function public.paging_overview() to authenticated;

-- Reviewers: how the engine and the on-call devices look right now. No patient reference.
create function public.paging_health() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_org uuid;
  v_stale integer := private.paging_delivery_rule('engine_heartbeat_stale_seconds');
  v_dev integer := private.paging_delivery_rule('device_seen_stale_minutes');
  v_rota_id uuid;
  v_primary uuid;
  v_backup uuid;
begin
  if not private.can_credential_review() then raise exception 'not authorised' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = (select auth.uid());
  -- the caller's own world: a test account sees the test rota, a real account the real one (test and real rotas never mix)
  select rota_id, primary_id, backup_id into v_rota_id, v_primary, v_backup
    from private.on_call_now(v_org, coalesce((select pr.is_test from public.profiles pr where pr.id = (select auth.uid())), false));
  return jsonb_build_object(
    'engine', coalesce((select jsonb_agg(jsonb_build_object('component', h.component, 'last_seen_at', h.last_seen_at,
        'age_seconds', extract(epoch from now() - h.last_seen_at)::integer, 'stale', h.last_seen_at < now() - make_interval(secs => v_stale)) order by h.component)
        from public.paging_heartbeats h), '[]'::jsonb),
    'rota_covered', v_rota_id is not null,
    'on_call', coalesce((select jsonb_agg(jsonb_build_object('clinician_id', x.pid, 'name', cs.full_name, 'role', x.role_name,
        'reachable', private.clinician_reachable(x.pid),
        'devices', coalesce((select jsonb_agg(jsonb_build_object('kind', d.kind, 'last_seen_at', d.last_seen_at, 'last_delivered_at', d.last_delivered_at,
            'silent', d.last_seen_at < now() - make_interval(mins => v_dev)) order by d.last_seen_at desc)
            from public.on_call_device_seen d where d.clinician_id = x.pid), '[]'::jsonb)))
        from (select v_primary as pid, 'primary' as role_name union all select v_backup, 'backup') x
        left join public.clinical_staff cs on cs.profile_id = x.pid where x.pid is not null), '[]'::jsonb),
    'open_unacknowledged', (select count(*) from public.pages p where p.parent_page_id is null and p.acknowledged_at is null and p.closed_at is null and p.organisation_id = v_org),
    'expired_open', (select count(*) from public.pages p where p.parent_page_id is null and p.expired_at is not null and p.acknowledged_at is null and p.closed_at is null and p.organisation_id = v_org));
end;
$$;
revoke all on function public.paging_health() from public, anon;
grant execute on function public.paging_health() to authenticated;

-- ---------------------------------------------------------------------------
-- 11. P9: objective readiness and the test page
-- ---------------------------------------------------------------------------
-- What is still missing before this clinician can be put on call, beyond the self-attested checklist.
create function private.on_call_objective_gaps(p_profile uuid) returns text[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_remove(array[
    case when not exists (select 1 from public.push_subscriptions s where s.profile_id = p_profile and s.disabled_at is null) then 'push_subscription' end,
    case when not exists (select 1 from auth.users u where u.id = p_profile and u.email is not null and u.email_confirmed_at is not null) then 'verified_email' end,
    case when not exists (select 1 from public.page_tests t where t.clinician_id = p_profile and t.acknowledged_at is not null
                            and t.acknowledged_at > now() - make_interval(days => private.paging_delivery_rule('readiness_test_page_days'))) then 'test_page' end
  ], null), '{}'::text[])
$$;
revoke all on function private.on_call_objective_gaps(uuid) from public, anon, authenticated;

create or replace function private.rota_validate_clinician(p_profile uuid, p_org uuid, p_start timestamptz, p_end timestamptz)
returns void language plpgsql stable security definer set search_path = ''
as $$
declare cs public.clinical_staff%rowtype; v_gaps text[];
begin
  select * into cs from public.clinical_staff where profile_id = p_profile and organisation_id = p_org;
  if not found then raise exception 'unknown clinician for this organisation' using errcode = '22023'; end if;
  if not private.has_competency(p_profile, 'on_call') then raise exception '% does not have the on-call competency', cs.full_name using errcode = '22023'; end if;
  if not private.on_call_ready(p_profile) then raise exception '% has not confirmed the on-call phone checklist', cs.full_name using errcode = '22023'; end if;
  if private.paging_delivery_rule('objective_readiness_required') = 1 then
    v_gaps := private.on_call_objective_gaps(p_profile);
    if array_length(v_gaps, 1) > 0 then
      raise exception '% is not ready for on call: missing %', cs.full_name, array_to_string(v_gaps, ', ') using errcode = '22023';
    end if;
  end if;
  if not private.clinician_eligible_through(p_profile, greatest(p_start, now()), p_end) then
    raise exception '% is not eligible for the whole shift (licence, indemnity or status)', cs.full_name using errcode = '22023';
  end if;
  if private.clinician_on_leave_during(p_profile, p_start, p_end) then raise exception '% is on leave for part of this shift', cs.full_name using errcode = '22023'; end if;
  if cs.employment_type = 'contracted' and not exists (select 1 from public.availability_blocks b
        where b.clinician_id = p_profile and b.state = 'confirmed' and b.kind = 'on_call' and b.starts_at <= p_start and b.ends_at >= p_end) then
    raise exception '% has no confirmed on-call hours covering this shift', cs.full_name using errcode = '22023';
  end if;
end;
$$;
revoke all on function private.rota_validate_clinician(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- Sends a test page to one clinician: to themself, or (reviewers) to another clinician. A readiness test or an unannounced drill.
create function public.send_test_page(p_clinician uuid default null, p_kind text default 'readiness') returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_target uuid := coalesce(p_clinician, (select auth.uid()));
  cs public.clinical_staff%rowtype;
  v_id uuid;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_kind not in ('readiness', 'drill') then raise exception 'unknown kind' using errcode = '22023'; end if;
  if v_target <> v_uid and not private.can_credential_review() then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_kind = 'drill' and not private.can_credential_review() then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into cs from public.clinical_staff where profile_id = v_target and active and status = 'active';
  if not found then raise exception 'not a working clinician' using errcode = '42501'; end if;
  if cs.organisation_id is distinct from (select pr.organisation_id from public.profiles pr where pr.id = v_uid) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if exists (select 1 from public.page_tests t where t.clinician_id = v_target and t.sent_at > now() - make_interval(secs => private.paging_delivery_rule('test_page_min_interval_seconds'))) then
    raise exception 'a test page was sent a moment ago: wait a little before sending another' using errcode = '22023';
  end if;
  perform set_config('tarragon.paging_write', 'on', true);
  insert into public.page_tests (organisation_id, clinician_id, requested_by, kind, is_test)
    values (cs.organisation_id, v_target, v_uid, p_kind, coalesce((select pr.is_test from public.profiles pr where pr.id = v_target), false))
    returning id into v_id;
  perform set_config('tarragon.paging_write', 'off', true);
  perform private.page_notify_ref(v_target, cs.organisation_id, 'on_call_test_page', v_id, 'page_tests');
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (cs.organisation_id, v_uid, 'page_test.sent', 'page_test', v_id, jsonb_build_object('kind', p_kind, 'clinician_id', v_target));
  return v_id;
end;
$$;
revoke all on function public.send_test_page(uuid, text) from public, anon;
grant execute on function public.send_test_page(uuid, text) to authenticated;

create function public.acknowledge_test_page(p_test uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare t public.page_tests%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into t from public.page_tests where id = p_test for update;
  if not found or t.clinician_id <> (select auth.uid()) then raise exception 'unknown test page' using errcode = '42501'; end if;
  if t.acknowledged_at is not null then return; end if;
  -- the point of a test page is to prove the route works: it must have been shown by a push on a device first. Acknowledging a
  -- page nobody saw would only prove a click.
  if not exists (select 1 from public.page_delivered_acks a where a.test_id = t.id and a.clinician_id = t.clinician_id and a.channel = 'push') then
    raise exception 'the test page has not arrived as a notification on your phone or browser yet: wait for it, then acknowledge' using errcode = '22023';
  end if;
  perform set_config('tarragon.paging_write', 'on', true);
  update public.page_tests set acknowledged_at = now(), delivered_at = coalesce(delivered_at, now()) where id = t.id;
  perform set_config('tarragon.paging_write', 'off', true);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (t.organisation_id, (select auth.uid()), 'page_test.acknowledged', 'page_test', t.id,
            jsonb_build_object('seconds_after_sent', extract(epoch from now() - t.sent_at)::integer, 'kind', t.kind));
end;
$$;
revoke all on function public.acknowledge_test_page(uuid) from public, anon;
grant execute on function public.acknowledge_test_page(uuid) to authenticated;

-- The caller's own recent test pages and what is still missing.
create or replace function public.my_on_call_readiness() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'version', private.readiness_version(),
    'items', to_jsonb(private.readiness_items()),
    'confirmed_at', (select r.confirmed_at from public.on_call_readiness r where r.clinician_id = (select auth.uid()) and r.checklist_version = private.readiness_version()),
    'on_call_clinician', private.has_competency((select auth.uid()), 'on_call'),
    'gaps', to_jsonb(private.on_call_objective_gaps((select auth.uid()))),
    'objective_required', private.paging_delivery_rule('objective_readiness_required') = 1,
    'test_page_days', private.paging_delivery_rule('readiness_test_page_days'),
    'last_test_page_acknowledged_at', (select max(t.acknowledged_at) from public.page_tests t where t.clinician_id = (select auth.uid())),
    'pending_test_page_id', (select t.id from public.page_tests t where t.clinician_id = (select auth.uid()) and t.acknowledged_at is null
                              and t.sent_at > now() - interval '1 hour' order by t.sent_at desc limit 1))
$$;

create or replace function public.on_call_readiness_overview() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid;
begin
  if not private.can_credential_review() then raise exception 'not authorised' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = (select auth.uid());
  return coalesce((
    select jsonb_agg(jsonb_build_object('clinician_id', cs.profile_id, 'name', cs.full_name, 'ready', r.clinician_id is not null, 'confirmed_at', r.confirmed_at,
                                        'gaps', to_jsonb(private.on_call_objective_gaps(cs.profile_id))) order by (r.clinician_id is not null), cs.full_name)
    from public.clinical_staff cs
    left join public.on_call_readiness r on r.clinician_id = cs.profile_id and r.checklist_version = private.readiness_version()
    where cs.organisation_id = v_org and cs.active and cs.status = 'active' and cs.profile_id is not null and private.has_competency(cs.profile_id, 'on_call')), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Self-check
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['public.record_engine_heartbeat(text)', 'public.paging_device_ping(text,text)', 'public.record_page_delivered(uuid,text,text)',
      'public.record_notification_displayed(uuid)', 'public.paging_health()', 'public.send_test_page(uuid,text)', 'public.acknowledge_test_page(uuid)',
      'public.acknowledge_page(uuid)', 'public.my_active_pages()', 'public.paging_overview()'] loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'S19c: anon can execute %', f; end if;
  end loop;
  if has_function_privilege('authenticated', 'public.record_engine_heartbeat(text)', 'EXECUTE') or has_function_privilege('authenticated', 'public.create_red_page(uuid)', 'EXECUTE') then
    raise exception 'S19c: a service-only function is callable by authenticated';
  end if;
  foreach f in array array['private.reconcile_red_pages()', 'private.sweep_paging_health()', 'private.expire_page(uuid)', 'private.nudge_send_pending()',
      'private.page_notify_ref(uuid,uuid,text,uuid,text,text[],boolean)', 'private.page_recipient(uuid,boolean,uuid)', 'private.clinician_reachable(uuid)',
      'private.on_call_objective_gaps(uuid)', 'private.record_page_delivered_internal(uuid,uuid,text,text)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'S19c: % is executable by anon or authenticated', f; end if;
  end loop;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public'
              and table_name in ('page_tests', 'page_delivered_acks', 'paging_heartbeats', 'on_call_device_seen', 'page_merged_events', 'paging_delivery_config')
              and grantee in ('anon', 'PUBLIC')) then
    raise exception 'S19c: anon or PUBLIC has table privileges';
  end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public'
              and table_name in ('page_tests', 'page_delivered_acks', 'paging_heartbeats', 'on_call_device_seen', 'page_merged_events', 'paging_delivery_config')
              and grantee = 'authenticated' and privilege_type <> 'SELECT') then
    raise exception 'S19c: authenticated has a write privilege on a paging table';
  end if;
  if (select count(*) from public.paging_delivery_config where is_active) <> 1 then raise exception 'S19c: exactly one active paging_delivery_config row expected'; end if;
  if pg_get_functiondef('private.escalate_unconfirmed_critical_notifications()'::regprocedure) not ilike '%not in (''pages'', ''page_tests'')%' then
    raise exception 'S19c: the legacy engine does not exclude page notifications';
  end if;
  if not exists (select 1 from cron.job where jobname = 'paging-health') then raise exception 'S19c: paging-health is not scheduled'; end if;
end $$;
