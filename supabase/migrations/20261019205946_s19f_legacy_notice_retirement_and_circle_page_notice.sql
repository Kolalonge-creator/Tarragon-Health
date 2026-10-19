-- S19f: (1) a SAFE, CONFIRMED way to retire the legacy "notify every clinician" broadcast for blood pressure and glucose, and
--       (2) the Care Circle notice for a unified red-event page. Everything ships OFF: the config below is born inactive and unsigned.
--
-- Design: docs/design/S19f-legacy-notice-retirement-and-circle-notice.md (continues docs/design/S16-S20-unified-red-paging.md sections C and D, rows 2 and 6).
-- CMO test pack: docs/plans/S19f-legacy-notice-retirement-test-pack.md.
--
-- Why a CONFIRMATION path and not a plain switch. Blood pressure already gets two things for one red event: the legacy broadcast (a synchronous
-- trigger, private.handle_bp_reading_red_flag, pathway bp_vitals_red_flag) and the triage-engine page (asynchronous: process-events grades the
-- reading, record_triage_result makes the page). A glucose emergency (glucose_red_flag, raised by raise_glucose_backstop_emergency) will do the same
-- once glucose_care_triage is signed. The page does not exist yet when the trigger runs, so the trigger cannot simply "skip if paged". Instead,
-- when the CMO has signed a version that retires a pathway's broadcast:
--   * the trigger HOLDS the broadcast (a row in legacy_notice_holds) instead of sending it, but only when a page is really expected:
--     the pathway's rule set is approved, the event bus has a fresh heartbeat, the rota names a primary, that primary can be told (push or a
--     verified email) and the patient may be paged (not Free). If any of that is not true the broadcast fires at once, exactly as today.
--   * a sweep (every 15 seconds from sweep_pages, and again from the per-minute health job, so one dead driver cannot strand a held notice)
--     looks for the page of THAT event (the triage event of the same reading, or the open page family it merged into). Page found, no cover
--     absent, primary reachable (or the page already acknowledged): the broadcast is SUPPRESSED for good. No page by hold_seconds, or a page with
--     no cover, or a primary nobody can reach: the broadcast is RELEASED, byte for byte the notification the trigger would have sent.
--   * switching the config off, or a newer version that no longer holds that pathway, releases every held notice that has no confirmed page at once.
--   * an overdue held notice (more than 120 seconds past its deadline) opens an ops incident from the independent health job: never silent.
-- With suppress_legacy_* = 0 (the PARALLEL-RUN version) nothing is held or changed: both fire exactly as today and the measurement table records,
-- for every event, whether and when its page arrived, so the CMO sees how often the page would have been enough before turning anything off.
--
-- Emergency events (bp_reading, glucose_red_flag in emergency_events) keep their broadcast unless the SEPARATE key suppress_legacy_emergency_notice
-- is also 1. Amber levels, Free patients, every other source and the abnormal screening pipeline (Category 2 to 1) are not touched.
--
-- CARE CIRCLE. A unified page (S19d) deliberately did not tell the Care Circle. Found while reading the S29 code for this change: it still
-- SHOWED them. circle_open_alerts() and circle_ack_alert() read public.pages directly, so with unified paging on, a supporter's "open requests"
-- list would have listed a unified page the notifier had skipped. This migration puts both behind ONE predicate, private.page_circle_may_know(page):
--   * a page that is not a unified page (blood pressure engine page, a backup or escalation child): true, byte-identical behaviour to today;
--   * a unified page: only when the signed config says circle_notice_unified_page = 1, AND the event is not reproductive (the origin of the page is
--     noted by the two callers, because the page is made inside the BEFORE INSERT trigger of a row that cannot be read yet): a symptom-origin event
--     (red-flag symptom, symptom log, symptom triage, danger-symptom checklist) is withheld for a patient with a pregnancy or reproductive-health
--     footprint or for a reproductive symptom type (testicular pain or lump); vitals-origin events (oxygen, pulse, temperature) carry no such content.
--   Any error answers false. The notice stays the neutral, content-free circle_check_in (INV-07). It needs the member's red_alerts permission, an
--   active unexpired membership, no patient pause, and is_test parity: all the existing S29 rules, reused, not copied. A Free patient never has a
--   unified page, so never has a circle notice from one. Care Circle is a separate consent model from the clinical access categories by S29 design
--   (a circle member is deliberately NOT a profile_access grantee); reproductive_health data is never read or sent here, only the existence of a page.
--
-- PATCHED IN PLACE, never rewritten: handle_bp_reading_red_flag, handle_emergency_event, handle_symptom_red_flag, unified_red_page_covers,
-- notify_circle_red_alert, circle_open_alerts, circle_ack_alert, sweep_pages, sweep_paging_health. Each patch needs its anchor exactly once in the CURRENT definition (so a drifted live copy
-- fails loudly instead of being silently overwritten) and is skipped when already applied.

-- ---------------------------------------------------------------------------
-- 1. Versioned config (PROPOSED, owner CMO). Born inactive and unsigned: no active signed row means everything below reads OFF.
-- ---------------------------------------------------------------------------
create table public.legacy_notice_retirement_config (
  id               uuid primary key default gen_random_uuid(),
  version          integer not null unique,
  is_active        boolean not null default false,
  effective_from   date not null,
  rules            jsonb not null,
  approved_at      timestamptz,
  approved_by      uuid references public.profiles (id) on delete set null,
  test_pack_confirmed_at timestamptz,
  switched_off_at  timestamptz,
  switched_off_by  uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint legacy_notice_retirement_config_live_needs_signature check (not is_active or approved_at is not null)
);
create unique index legacy_notice_retirement_config_one_active on public.legacy_notice_retirement_config (is_active) where is_active;

create function private.legacy_notice_rules_valid(r jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare k text;
begin
  foreach k in array array['observe', 'suppress_legacy_bp_notice', 'suppress_legacy_glucose_notice', 'suppress_legacy_emergency_notice', 'circle_notice_unified_page'] loop
    if not coalesce((r ->> k) in ('0', '1'), false) then return false; end if;
  end loop;
  -- how long a held notice waits for its page before it is released: 15 seconds to 5 minutes, a whole number
  if (r ->> 'hold_seconds') is null or (r ->> 'hold_seconds') !~ '^[0-9]{2,3}$'
     or (r ->> 'hold_seconds')::integer < 15 or (r ->> 'hold_seconds')::integer > 300 then return false; end if;
  return true;
exception when others then
  return false;
end;
$$;
revoke all on function private.legacy_notice_rules_valid(jsonb) from public, anon, authenticated;
alter table public.legacy_notice_retirement_config add constraint legacy_notice_retirement_config_rules_valid check (private.legacy_notice_rules_valid(rules));

create function private.legacy_notice_config_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'legacy_notice_retirement_config rows are never deleted' using errcode = '55000'; end if;
  if tg_op = 'UPDATE' and (new.version is distinct from old.version or new.rules is distinct from old.rules or new.effective_from is distinct from old.effective_from) then
    raise exception 'the rules of a legacy notice retirement version never change: add a new version' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function private.legacy_notice_config_guard() from public, anon, authenticated;
create trigger legacy_notice_config_guard before update or delete on public.legacy_notice_retirement_config
  for each row execute function private.legacy_notice_config_guard();

-- legacy-notice-retirement-rules-begin
-- Four versions, all INACTIVE and UNSIGNED. A different setting is a new version; the CMO picks one on the sign-off hub after the test pack.
--   1  PARALLEL RUN: observe only. Both notifications fire as today; the measurement table records when each page arrived.
--   2  Retire the RED-LEVEL broadcast for blood pressure and glucose (confirmed by a reachable page). Emergency events keep their broadcast.
--   3  As 2, and also retire the EMERGENCY broadcast (separate key), once delivery is proven.
--   4  Care Circle is told about a unified red-event page (neutral notice, existing consent rules). Nothing retired.
insert into public.legacy_notice_retirement_config (version, is_active, effective_from, rules) values
(1, false, '2026-10-16', $json$
{"observe": 1, "suppress_legacy_bp_notice": 0, "suppress_legacy_glucose_notice": 0, "suppress_legacy_emergency_notice": 0, "circle_notice_unified_page": 0, "hold_seconds": 60}
$json$::jsonb),
(2, false, '2026-10-16', $json$
{"observe": 1, "suppress_legacy_bp_notice": 1, "suppress_legacy_glucose_notice": 1, "suppress_legacy_emergency_notice": 0, "circle_notice_unified_page": 0, "hold_seconds": 60}
$json$::jsonb),
(3, false, '2026-10-16', $json$
{"observe": 1, "suppress_legacy_bp_notice": 1, "suppress_legacy_glucose_notice": 1, "suppress_legacy_emergency_notice": 1, "circle_notice_unified_page": 0, "hold_seconds": 60}
$json$::jsonb),
(4, false, '2026-10-16', $json$
{"observe": 1, "suppress_legacy_bp_notice": 0, "suppress_legacy_glucose_notice": 0, "suppress_legacy_emergency_notice": 0, "circle_notice_unified_page": 1, "hold_seconds": 60}
$json$::jsonb);
-- legacy-notice-retirement-rules-end

alter table public.legacy_notice_retirement_config enable row level security;
create policy legacy_notice_retirement_config_read on public.legacy_notice_retirement_config for select to authenticated
  using (private.credential_is_cmo() or private.is_admin());
revoke all on public.legacy_notice_retirement_config from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.legacy_notice_retirement_config from authenticated;
grant select on public.legacy_notice_retirement_config to authenticated;

-- Fail-safe reads: a missing row, an unsigned row, a malformed value or any error means OFF (null), never ON.
create function private.legacy_retire_rule(p_key text) returns integer
language plpgsql stable security definer set search_path = ''
as $$
begin
  return (select (rules ->> p_key)::integer from public.legacy_notice_retirement_config
           where is_active and approved_at is not null order by version desc limit 1);
exception when others then
  return null;
end;
$$;
revoke all on function private.legacy_retire_rule(text) from public, anon, authenticated;

-- 'off' (byte-identical to today), 'observe' (both fire, measured) or 'hold' (broadcast held until its page is confirmed).
-- bp_red and the two emergency kinds are the only kinds; an emergency kind needs the pathway key AND the separate emergency key.
create function private.legacy_notice_mode(p_kind text) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare v_sup integer; v_em integer;
begin
  if p_kind not in ('bp_red', 'bp_emergency', 'glucose_emergency') then return 'off'; end if;
  v_sup := private.legacy_retire_rule(case when p_kind like 'bp\_%' then 'suppress_legacy_bp_notice' else 'suppress_legacy_glucose_notice' end);
  v_em := case when p_kind like '%\_emergency' then private.legacy_retire_rule('suppress_legacy_emergency_notice') else 1 end;
  if coalesce(v_sup, 0) = 1 and coalesce(v_em, 0) = 1 then return 'hold'; end if;
  if coalesce(private.legacy_retire_rule('observe'), 0) = 1 then return 'observe'; end if;
  return 'off';
exception when others then
  return 'off';
end;
$$;
revoke all on function private.legacy_notice_mode(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The measurement and hold table
-- ---------------------------------------------------------------------------
create table public.legacy_notice_holds (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid references public.profiles (id) on delete cascade,
  kind             text not null check (kind in ('bp_red', 'bp_emergency', 'glucose_emergency')),
  -- observed: parallel run, the broadcast fired at once and this row only measures. held: waiting for the page. suppressed: the page was confirmed and the
  -- broadcast was never sent. released: no confirmed page, the broadcast was sent late. fired: a pre-check said no page was expected, the broadcast was sent at once.
  status           text not null check (status in ('observed', 'held', 'suppressed', 'released', 'fired')),
  reading_id       uuid,
  rule_set_code    text not null,
  source_table     text not null,
  source_id        uuid,
  template         text not null,
  pathway          text not null,
  alert_level      text not null,
  -- non-identifying template inputs only (a label such as 'blood pressure'); the patient's name is looked up at release, never stored here
  payload_extra    jsonb not null default '{}'::jsonb,
  config_version   integer,
  is_test          boolean not null default false,
  created_at       timestamptz not null default now(),
  deadline_at      timestamptz,
  decided_at       timestamptz,
  fired_at         timestamptz,
  reason           text,
  page_id          uuid references public.pages (id) on delete set null,
  page_at          timestamptz,
  -- page_at minus created_at: negative or zero means the page existed before the event (a family already ringing)
  page_lag_seconds integer,
  primary_reachable boolean,
  measured_at      timestamptz
);
create index legacy_notice_holds_held_idx on public.legacy_notice_holds (created_at) where status = 'held';
create index legacy_notice_holds_unmeasured_idx on public.legacy_notice_holds (created_at) where status = 'observed' and measured_at is null;
create index legacy_notice_holds_created_idx on public.legacy_notice_holds (created_at desc);
alter table public.legacy_notice_holds enable row level security;
create policy legacy_notice_holds_read on public.legacy_notice_holds for select to authenticated
  using (private.credential_is_cmo() or private.is_admin());
revoke all on public.legacy_notice_holds from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.legacy_notice_holds from authenticated;
grant select on public.legacy_notice_holds to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Reachability, finding the page of one event, and the hook the legacy handlers call
-- ---------------------------------------------------------------------------
-- A clinician who is eligible and has a way to be told: a working push subscription OR a verified email.
create function private.legacy_primary_reachable(p_profile uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_profile is not null and coalesce(private.clinician_is_eligible(p_profile), false)
     and (exists (select 1 from public.push_subscriptions s where s.profile_id = p_profile and s.disabled_at is null)
          or exists (select 1 from auth.users u where u.id = p_profile and u.email is not null and u.email_confirmed_at is not null))
$$;
revoke all on function private.legacy_primary_reachable(uuid) from public, anon, authenticated;

-- The page of THIS event: the red, non-shadow triage event of the same reading and pathway, and its root page (or the open family it merged into).
create function private.legacy_hold_page(p_hold uuid, out o_page uuid, out o_page_at timestamptz, out o_to uuid, out o_no_cover boolean, out o_ack boolean)
returns record
language plpgsql stable security definer set search_path = ''
as $$
declare h public.legacy_notice_holds%rowtype; v_te uuid; v_root public.pages%rowtype;
begin
  select * into h from public.legacy_notice_holds where id = p_hold;
  if not found or h.reading_id is null or h.patient_id is null then return; end if;
  select te.id into v_te from public.triage_events te
   where te.patient_id = h.patient_id and te.trigger_type = 'observation' and te.trigger_id = h.reading_id
     and te.rule_set_code = h.rule_set_code and te.grade = 'red' and not te.shadow and te.is_test = h.is_test
   order by te.created_at limit 1;
  if v_te is null then return; end if;
  select * into v_root from public.pages where triage_event_id = v_te and parent_page_id is null;
  if not found then
    select pg.* into v_root from public.pages pg join public.page_merged_events m on m.page_id = pg.id where m.triage_event_id = v_te;
    if not found then return; end if;
  end if;
  o_page := v_root.id; o_page_at := v_root.sent_at; o_to := v_root.to_clinician_id; o_no_cover := v_root.no_cover; o_ack := v_root.acknowledged_at is not null;
end;
$$;
revoke all on function private.legacy_hold_page(uuid) from public, anon, authenticated;

-- Called by the legacy handlers INSTEAD of sending. Returns true ONLY when the broadcast has been taken over (held, or already covered) and the
-- handler must not send it now. Any problem returns false: the handler sends, exactly as it always did.
create function private.legacy_notice_deferred(
  p_kind text, p_org uuid, p_patient uuid, p_reading uuid, p_source_table text, p_source uuid,
  p_template text, p_pathway text, p_alert_level text, p_extra jsonb
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_mode text; v_test boolean; v_code text; v_why text; v_to uuid; v_fam public.pages%rowtype; v_hold integer; v_ver integer;
begin
  v_mode := private.legacy_notice_mode(p_kind);
  if v_mode = 'off' or p_patient is null then return false; end if;
  begin
    select coalesce(is_test, false) into v_test from public.profiles where id = p_patient;
    v_test := coalesce(v_test, false);
    v_code := case when p_kind like 'bp\_%' then 'bp_care_triage' else 'glucose_care_triage' end;
    select version into v_ver from public.legacy_notice_retirement_config where is_active and approved_at is not null order by version desc limit 1;

    if v_mode = 'observe' then
      insert into public.legacy_notice_holds (organisation_id, patient_id, kind, status, reading_id, rule_set_code, source_table, source_id, template, pathway, alert_level,
          payload_extra, config_version, is_test, decided_at, fired_at, reason)
      values (p_org, p_patient, p_kind, 'observed', p_reading, v_code, p_source_table, p_source, p_template, p_pathway, p_alert_level,
          coalesce(p_extra, '{}'::jsonb), v_ver, v_test, now(), now(), 'parallel_run');
      return false;
    end if;

    -- HOLD mode: first make sure a page is actually expected. Anything else fires at once, as today.
    if not coalesce(private.patient_may_page_doctor(p_patient), false) then v_why := 'free_patient';
    -- an event with no reading cannot be matched to a page, so there is nothing to wait for
    elsif p_reading is null then v_why := 'no_reading_id';
    elsif not exists (select 1 from public.triage_rule_sets rs where rs.code = v_code and rs.status = 'approved') then v_why := 'rule_set_not_approved';
    elsif not exists (select 1 from public.paging_heartbeats b where b.component = 'process_events'
                       and b.last_seen_at > now() - make_interval(secs => private.paging_delivery_rule('engine_heartbeat_stale_seconds'))) then v_why := 'engine_stale';
    else
      v_to := private.page_recipient(p_org, v_test, p_patient);
      if v_to is null then v_why := 'no_cover';
      elsif not private.legacy_primary_reachable(v_to) then v_why := 'primary_unreachable';
      end if;
    end if;
    if v_why is not null then
      insert into public.legacy_notice_holds (organisation_id, patient_id, kind, status, reading_id, rule_set_code, source_table, source_id, template, pathway, alert_level,
          payload_extra, config_version, is_test, decided_at, fired_at, reason, primary_reachable)
      values (p_org, p_patient, p_kind, 'fired', p_reading, v_code, p_source_table, p_source, p_template, p_pathway, p_alert_level,
          coalesce(p_extra, '{}'::jsonb), v_ver, v_test, now(), now(), v_why, case when v_why = 'primary_unreachable' then false end);
      return false;
    end if;

    v_hold := coalesce(private.legacy_retire_rule('hold_seconds'), 60);
    -- A repeat inside an open, unacknowledged family that is already ringing a reachable primary: nothing to wait for.
    select * into v_fam from public.pages
     where patient_id = p_patient and is_test = v_test and parent_page_id is null and closed_at is null and expired_at is null
       and acknowledged_at is null and not no_cover
       and sent_at > now() - make_interval(mins => private.paging_delivery_rule('merge_window_minutes'))
     order by sent_at desc limit 1;
    if found and private.legacy_primary_reachable(v_fam.to_clinician_id) then
      insert into public.legacy_notice_holds (organisation_id, patient_id, kind, status, reading_id, rule_set_code, source_table, source_id, template, pathway, alert_level,
          payload_extra, config_version, is_test, decided_at, reason, page_id, page_at, page_lag_seconds, primary_reachable, measured_at)
      values (p_org, p_patient, p_kind, 'suppressed', p_reading, v_code, p_source_table, p_source, p_template, p_pathway, p_alert_level,
          coalesce(p_extra, '{}'::jsonb), v_ver, v_test, now(), 'family_already_paged', v_fam.id, v_fam.sent_at,
          (extract(epoch from v_fam.sent_at - now()))::integer, true, now());
      return true;
    end if;

    insert into public.legacy_notice_holds (organisation_id, patient_id, kind, status, reading_id, rule_set_code, source_table, source_id, template, pathway, alert_level,
        payload_extra, config_version, is_test, deadline_at)
    values (p_org, p_patient, p_kind, 'held', p_reading, v_code, p_source_table, p_source, p_template, p_pathway, p_alert_level,
        coalesce(p_extra, '{}'::jsonb), v_ver, v_test, now() + make_interval(secs => v_hold));
    return true;
  exception when others then
    -- The sub-block rolled back its own rows. The legacy broadcast runs. Not silent: an audit row and an ops incident.
    begin
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (p_org, 'legacy_notice.error', 'legacy_notice', p_source, jsonb_build_object('kind', p_kind, 'error', sqlerrm));
      perform private.page_incident(p_org, 'legacy_notice_hold_failed:' || p_kind, 'A clinician notice could not be held for confirmation',
        'The legacy clinician notice for a ' || p_kind || ' event could not be taken over by the confirmation path, so it was sent as before. See audit_log action legacy_notice.error.');
    exception when others then
      raise warning 'legacy notice error for % %: %', p_kind, p_source, sqlerrm;
    end;
    return false;
  end;
end;
$$;
revoke all on function private.legacy_notice_deferred(text, uuid, uuid, uuid, text, uuid, text, text, text, jsonb) from public, anon, authenticated;

-- The release: the SAME notification the handler would have sent, one per clinician profile of the organisation (computed now, not at hold time).
create function private.release_legacy_notice(p_hold uuid) returns integer
language plpgsql security definer set search_path = ''
as $$
declare h public.legacy_notice_holds%rowtype; r public.profiles%rowtype; v_n integer := 0; v_payload jsonb;
begin
  select * into h from public.legacy_notice_holds where id = p_hold;
  if not found then return 0; end if;
  v_payload := jsonb_build_object('patient_name', coalesce((select full_name from public.profiles where id = h.patient_id), 'A patient'))
               || case when h.kind = 'bp_red' then jsonb_build_object('vital_label', h.payload_extra ->> 'vital_label', 'level_label', h.payload_extra ->> 'level_label')
                       else jsonb_build_object('source_label', h.payload_extra ->> 'source_label') end;
  for r in select * from public.profiles where organisation_id = h.organisation_id and role = 'clinician' loop
    perform private.enqueue_critical_notification(h.organisation_id, r.id, h.template, v_payload, h.pathway, h.alert_level::public.alert_level, h.source_table, h.source_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.release_legacy_notice(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The sweep (decides every held notice; fills the parallel-run measurement)
-- ---------------------------------------------------------------------------
create function private.sweep_legacy_notice_holds(p_release_unconfirmed boolean default false) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  h public.legacy_notice_holds%rowtype; pg record; v_reach boolean; v_n integer := 0; v_reason text; v_lag integer;
begin
  for h in select * from public.legacy_notice_holds where status = 'held' order by created_at limit 200 for update skip locked loop
    begin
      select * into pg from private.legacy_hold_page(h.id);
      v_reach := pg.o_page is not null and not coalesce(pg.o_no_cover, true)
                 and (coalesce(pg.o_ack, false) or private.legacy_primary_reachable(pg.o_to));
      v_lag := case when pg.o_page_at is not null then extract(epoch from pg.o_page_at - h.created_at)::integer end;
      if v_reach then
        update public.legacy_notice_holds set status = 'suppressed', decided_at = now(), reason = 'page_confirmed', page_id = pg.o_page, page_at = pg.o_page_at,
               page_lag_seconds = v_lag, primary_reachable = true, measured_at = now() where id = h.id;
        insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
          values (h.organisation_id, null, 'legacy_notice.suppressed', 'legacy_notice', h.id, jsonb_build_object('kind', h.kind, 'page_id', pg.o_page, 'lag_seconds', v_lag));
        v_n := v_n + 1;
      -- a page exists but cannot be confirmed (no cover, or its primary cannot be reached): waiting would only delay the older notice, send it now
      elsif p_release_unconfirmed or pg.o_page is not null or h.deadline_at <= now() or private.legacy_notice_mode(h.kind) <> 'hold' then
        v_reason := case when p_release_unconfirmed or private.legacy_notice_mode(h.kind) <> 'hold' then 'switched_off'
                         when pg.o_page is null then 'no_page_in_time'
                         when coalesce(pg.o_no_cover, true) then 'page_no_cover'
                         else 'primary_unreachable' end;
        perform private.release_legacy_notice(h.id);
        update public.legacy_notice_holds set status = 'released', decided_at = now(), fired_at = now(), reason = v_reason, page_id = pg.o_page, page_at = pg.o_page_at,
               page_lag_seconds = v_lag, primary_reachable = case when pg.o_page is null then null else false end, measured_at = now() where id = h.id;
        insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
          values (h.organisation_id, null, 'legacy_notice.released', 'legacy_notice', h.id, jsonb_build_object('kind', h.kind, 'reason', v_reason));
        v_n := v_n + 1;
      end if;
    exception when others then
      -- The row stays held and is retried on the next pass; the health job opens an incident when it is overdue. Audited at most once an hour per row.
      if not exists (select 1 from public.audit_log a where a.action = 'legacy_notice.sweep_error' and a.entity_id = h.id and a.created_at > now() - interval '1 hour') then
        insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
          values (h.organisation_id, 'legacy_notice.sweep_error', 'legacy_notice', h.id, jsonb_build_object('error', sqlerrm));
      end if;
    end;
  end loop;

  -- Parallel run: fill in when (and whether) the page of each observed event arrived. Measurement only; nothing is sent or held.
  for h in select * from public.legacy_notice_holds where status = 'observed' and measured_at is null and created_at > now() - interval '2 days'
            order by created_at limit 200 for update skip locked loop
    begin
      select * into pg from private.legacy_hold_page(h.id);
      if pg.o_page is not null then
        update public.legacy_notice_holds set page_id = pg.o_page, page_at = pg.o_page_at, page_lag_seconds = extract(epoch from pg.o_page_at - h.created_at)::integer,
               primary_reachable = case when coalesce(pg.o_no_cover, true) then false else coalesce(coalesce(pg.o_ack, false) or private.legacy_primary_reachable(pg.o_to), false) end,
               measured_at = now() where id = h.id;
      elsif h.created_at < now() - interval '15 minutes' then
        update public.legacy_notice_holds set measured_at = now(), reason = 'no_page_seen' where id = h.id;
      end if;
    exception when others then
      null; -- measurement only; the row is tried again next pass
    end;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.sweep_legacy_notice_holds(boolean) from public, anon, authenticated;

-- The independent per-minute driver: the sweep again (so a failing sweep_pages cannot strand a held notice) and an incident for any overdue hold.
create function private.legacy_notice_health() returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_overdue bigint; v_n integer := 0;
begin
  begin
    v_n := private.sweep_legacy_notice_holds();
  exception when others then
    insert into public.audit_log (action, entity_type, event) values ('legacy_notice.sweep_error', 'legacy_notice', jsonb_build_object('error', sqlerrm, 'via', 'health'));
  end;
  select count(*) into v_overdue from public.legacy_notice_holds where status = 'held' and deadline_at < now() - interval '120 seconds';
  if v_overdue > 0 then
    perform private.page_incident(null, 'legacy_notice_hold_overdue', 'A held clinician notice is overdue',
      v_overdue || ' held red-event clinician notice(s) are more than 2 minutes past their deadline and have been neither confirmed nor released. Check the paging sweep. Switch the legacy notice retirement OFF at the sign-off hub (that releases them) and phone the on-call clinician for any open case.');
  end if;
  return v_n;
end;
$$;
revoke all on function private.legacy_notice_health() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The CMO's controls and the evidence panel
-- ---------------------------------------------------------------------------
create function public.sign_legacy_notice_retirement_config(p_version integer, p_test_pack_run boolean) returns void
language plpgsql security definer set search_path = ''
as $$
declare c public.legacy_notice_retirement_config%rowtype; v_uid uuid; v_retires boolean;
begin
  v_uid := private.uid_or_deny();
  if not private.credential_is_cmo() then raise exception 'only the chief medical officer can switch legacy notice retirement on' using errcode = '42501'; end if;
  if p_test_pack_run is not true then raise exception 'confirm that the staging test pack was run before switching this on' using errcode = '22023'; end if;
  select * into c from public.legacy_notice_retirement_config where version = p_version for update;
  if not found then raise exception 'no such legacy notice retirement version' using errcode = 'P0002'; end if;
  if c.is_active then raise exception 'that version is already on' using errcode = '23514'; end if;
  v_retires := (c.rules ->> 'suppress_legacy_bp_notice') = '1' or (c.rules ->> 'suppress_legacy_glucose_notice') = '1' or (c.rules ->> 'suppress_legacy_emergency_notice') = '1';
  -- Retiring a broadcast needs a parallel run first: an observe-only version (nothing retired) must have been switched on at some time.
  if v_retires and not exists (select 1 from public.legacy_notice_retirement_config o
                                where o.approved_at is not null and (o.rules ->> 'observe') = '1'
                                  and (o.rules ->> 'suppress_legacy_bp_notice') = '0' and (o.rules ->> 'suppress_legacy_glucose_notice') = '0'
                                  and (o.rules ->> 'suppress_legacy_emergency_notice') = '0') then
    raise exception 'run the parallel-run version (nothing retired) first, and look at the measurement, before retiring a broadcast' using errcode = '23514';
  end if;
  update public.legacy_notice_retirement_config set is_active = false where is_active and version <> p_version;
  update public.legacy_notice_retirement_config
     set approved_at = coalesce(approved_at, now()), approved_by = coalesce(approved_by, v_uid), test_pack_confirmed_at = now(),
         is_active = true, switched_off_at = null, switched_off_by = null
   where version = p_version;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (null, v_uid, 'legacy_notice_retirement.switched_on', 'legacy_notice_retirement_config', c.id, jsonb_build_object('version', p_version));
  -- A newer version may no longer hold a kind that an older one held: release those now, never leave them waiting on a rule that is gone.
  perform private.sweep_legacy_notice_holds();
end;
$$;
revoke all on function public.sign_legacy_notice_retirement_config(integer, boolean) from public, anon, authenticated;
grant execute on function public.sign_legacy_notice_retirement_config(integer, boolean) to authenticated;

create function public.switch_off_legacy_notice_retirement() returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid; v_n integer; v_released integer;
begin
  v_uid := private.uid_or_deny();
  if not (private.credential_is_cmo() or private.is_admin()) then raise exception 'only the chief medical officer or an admin can switch legacy notice retirement off' using errcode = '42501'; end if;
  update public.legacy_notice_retirement_config set is_active = false, switched_off_at = now(), switched_off_by = v_uid where is_active;
  get diagnostics v_n = row_count;
  -- Back to the old path at once: every held notice with no confirmed page is released now (a held notice must not wait on a switch that is off).
  v_released := private.sweep_legacy_notice_holds(true);
  if v_n > 0 then
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
      values (null, v_uid, 'legacy_notice_retirement.switched_off', 'legacy_notice_retirement_config', null, jsonb_build_object('rows', v_n, 'decided_held', v_released));
  end if;
  return v_n;
end;
$$;
revoke all on function public.switch_off_legacy_notice_retirement() from public, anon, authenticated;
grant execute on function public.switch_off_legacy_notice_retirement() to authenticated;

-- The evidence for the CMO: per pathway, how often the page was there and how fast. Real patients only unless asked.
create function public.legacy_notice_measurement(p_days integer default 14, p_include_test boolean default false) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_hold integer := coalesce((select (rules ->> 'hold_seconds')::integer from public.legacy_notice_retirement_config order by is_active desc, version desc limit 1), 60);
begin
  if not (private.credential_is_cmo() or private.is_admin()) then raise exception 'not authorised' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'kind', kind, 'events', n, 'observed', observed, 'held', held, 'suppressed', suppressed, 'released', released, 'fired', fired,
      'page_seen', page_seen, 'page_first', page_first, 'page_within_hold', within_hold, 'primary_not_reachable', not_reachable,
      'median_lag_seconds', median_lag, 'p95_lag_seconds', p95_lag) order by kind)
    from (
      select kind, count(*) as n,
             count(*) filter (where status = 'observed') as observed, count(*) filter (where status = 'held') as held,
             count(*) filter (where status = 'suppressed') as suppressed, count(*) filter (where status = 'released') as released,
             count(*) filter (where status = 'fired') as fired,
             count(*) filter (where page_id is not null) as page_seen,
             count(*) filter (where page_lag_seconds <= 0) as page_first,
             count(*) filter (where page_lag_seconds <= v_hold and primary_reachable) as within_hold,
             count(*) filter (where primary_reachable is false) as not_reachable,
             percentile_cont(0.5) within group (order by page_lag_seconds) as median_lag,
             percentile_cont(0.95) within group (order by page_lag_seconds) as p95_lag
        from public.legacy_notice_holds
       where created_at > now() - make_interval(days => greatest(1, least(coalesce(p_days, 14), 365))) and (p_include_test or not is_test)
       group by kind) x), '[]'::jsonb);
end;
$$;
revoke all on function public.legacy_notice_measurement(integer, boolean) from public, anon, authenticated;
grant execute on function public.legacy_notice_measurement(integer, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Care Circle: ONE predicate for "may the circle know about this page"
-- ---------------------------------------------------------------------------
-- The origin of a unified page. The page is made inside the BEFORE INSERT trigger of the symptom or the emergency event that caused it, when that
-- row cannot be read yet, so the caller notes what it is (keyed by the row's id, so a stale note from another event is never picked up) and the
-- unified page records it in its context as a short label: the emergency source ('spo2_red_flag') or 'symptom:' plus the symptom type.
create function private.note_page_origin(p_ref uuid, p_origin text) returns boolean
language plpgsql set search_path = ''
as $$
begin
  perform set_config('tarragon.page_origin', coalesce(p_ref::text, '') || '|' || coalesce(p_origin, ''), true);
  return true;
end;
$$;
revoke all on function private.note_page_origin(uuid, text) from public, anon, authenticated;

create function private.page_origin_for(p_ref uuid) returns text
language plpgsql stable set search_path = ''
as $$
declare v text := current_setting('tarragon.page_origin', true);
begin
  if v is null or p_ref is null or position(p_ref::text || '|' in v) <> 1 then return null; end if;
  return nullif(substr(v, length(p_ref::text) + 2), '');
end;
$$;
revoke all on function private.page_origin_for(uuid) from public, anon, authenticated;

create function private.page_circle_may_know(p_page uuid) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_patient uuid; v_code text; v_basis text; v_ctx jsonb; v_origin text; v_vitals boolean;
begin
  select pg.patient_id, t.rule_set_code, t.basis, t.context into v_patient, v_code, v_basis, v_ctx
    from public.pages pg left join public.triage_events t on t.id = pg.triage_event_id where pg.id = p_page;
  if not found then return false; end if;
  -- Not a unified page (the blood pressure engine page, a backup or escalation child): exactly the behaviour it always had.
  if v_code is distinct from 'unified_red_paging' then return true; end if;
  if coalesce(private.legacy_retire_rule('circle_notice_unified_page'), 0) <> 1 then return false; end if;
  v_origin := v_ctx ->> 'origin';
  -- Vitals-origin (oxygen, pulse, temperature, and their emergency events) carry no reproductive content. Everything else is treated as a
  -- symptom: an unknown origin is withheld, never guessed.
  v_vitals := v_basis in ('spo2_red', 'pulse_red', 'temperature_red')
              or (v_basis = 'emergency_event' and v_origin in ('spo2_red_flag', 'temperature_red_flag', 'pulse_red_flag'));
  if v_vitals then return true; end if;
  if not (v_basis = 'symptom_red_flag' or v_basis = 'emergency_event') or v_origin is null then return false; end if;
  if v_origin in ('symptom:testicular_pain', 'symptom:testicular_lump') then return false; end if;
  -- symptom-origin: withheld for any pregnancy or reproductive-health footprint (the existence of the page must not reveal it)
  if coalesce((select p.is_pregnant from public.profiles p where p.id = v_patient), false)
     or exists (select 1 from public.patient_pregnancy pp where pp.patient_id = v_patient and pp.is_pregnant)
     or exists (select 1 from public.reproductive_health_profiles rp where rp.patient_id = v_patient and rp.life_stage::text <> 'not_applicable') then
    return false;
  end if;
  return true;
exception when others then
  return false;
end;
$$;
revoke all on function private.page_circle_may_know(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Patch the live functions in place from their CURRENT definitions
-- ---------------------------------------------------------------------------
create function pg_temp.s19f_patch_once(p_fn regprocedure, p_from text, p_to text) returns void
language plpgsql as
$h$
declare v_def text; v_new text; v_count integer;
begin
  v_def := pg_get_functiondef(p_fn);
  if position(p_to in v_def) > 0 then return; end if;
  v_count := (length(v_def) - length(replace(v_def, p_from, ''))) / length(p_from);
  if v_count <> 1 then raise exception 'S19f: anchor for % found % times, expected 1: %', p_fn, v_count, p_from; end if;
  v_new := replace(v_def, p_from, p_to);
  if v_new = v_def then raise exception 'S19f: patch of % changed nothing', p_fn; end if;
  execute v_new;
end
$h$;

do $patch$
begin
  -- 7a. Blood pressure, RED level only (amber "review needed" keeps its notice). One CASE so nothing is evaluated unless an alert was created or
  --     raised on a paid plan: the hook has side effects, and AND/OR give no evaluation order in Postgres.
  perform pg_temp.s19f_patch_once('private.handle_bp_reading_red_flag()'::regprocedure, E'\n  if v_should_page then\n',
    E'\n  if (case when v_should_page then not (case when v_level = ''red'' then private.legacy_notice_deferred(''bp_red'', new.organisation_id, new.patient_id, new.id, ''clinician_alerts'', v_alert_id, '
    || E'''vitals_red_flag_clinician_alert'', ''bp_vitals_red_flag'', v_alert_lvl::text, jsonb_build_object(''vital_label'', ''blood pressure'', ''level_label'', v_level_label)) else false end) else false end) then\n');

  -- 7b. Emergency events from blood pressure and glucose only. Three edits next to the S19d ones: a flag, its assignment, and the loop condition.
  perform pg_temp.s19f_patch_once('private.handle_emergency_event()'::regprocedure, E'  v_unified_paged boolean := false;\n', E'  v_unified_paged boolean := false;\n  v_legacy_held boolean := false;\n');
  perform pg_temp.s19f_patch_once('private.handle_emergency_event()'::regprocedure,
    E'new.organisation_id, new.patient_id, ''emergency_events'', new.id) else false end;\n',
    E'new.organisation_id, new.patient_id, ''emergency_events'', new.id) else false end;\n'
    || E'      v_legacy_held := case when new.source::text in (''bp_reading'', ''glucose_red_flag'')\n'
    || E'        then private.legacy_notice_deferred(case when new.source::text = ''bp_reading'' then ''bp_emergency'' else ''glucose_emergency'' end, new.organisation_id, new.patient_id, new.vital_reading_id,\n'
    || E'          ''clinician_alerts'', v_alert_id, ''emergency_event_clinician_alert'', ''emergency_event'', ''emergency'', jsonb_build_object(''source_label'', new.source::text)) else false end;\n');
  perform pg_temp.s19f_patch_once('private.handle_emergency_event()'::regprocedure, E'\n          and not v_unified_paged\n      loop', E'\n          and not v_unified_paged\n          and not v_legacy_held\n      loop');

  -- 7c. Care Circle: the S19d "never for a unified page" line becomes the one shared predicate; the two readers of public.pages get it too.
  -- 7c0. The unified page records where it came from (see note_page_origin), set by the two callers just before they ask for the page.
  perform pg_temp.s19f_patch_once('private.unified_red_page_covers(text,uuid,uuid,text,uuid)'::regprocedure,
    'jsonb_build_object(''source'', p_source, ''ref_table'', p_ref_table, ''ref_id'', p_ref_id))',
    'jsonb_build_object(''source'', p_source, ''ref_table'', p_ref_table, ''ref_id'', p_ref_id, ''origin'', private.page_origin_for(p_ref_id)))');
  perform pg_temp.s19f_patch_once('private.handle_symptom_red_flag()'::regprocedure,
    'private.unified_red_page_covers(''symptom_red_flag'', new.organisation_id, new.patient_id, ''symptoms'', new.id)',
    '(case when private.note_page_origin(new.id, ''symptom:'' || new.symptom_type::text) then private.unified_red_page_covers(''symptom_red_flag'', new.organisation_id, new.patient_id, ''symptoms'', new.id) else false end)');
  perform pg_temp.s19f_patch_once('private.handle_emergency_event()'::regprocedure,
    'then private.unified_red_page_covers(''emergency_event'', new.organisation_id, new.patient_id, ''emergency_events'', new.id) else false end;',
    'then (case when private.note_page_origin(new.id, new.source::text) then private.unified_red_page_covers(''emergency_event'', new.organisation_id, new.patient_id, ''emergency_events'', new.id) else false end) else false end;');

  perform pg_temp.s19f_patch_once('private.notify_circle_red_alert()'::regprocedure,
    E'  if exists (select 1 from public.triage_events ut where ut.id = new.triage_event_id and ut.rule_set_code = ''unified_red_paging'') then return new; end if;\n',
    E'  if not private.page_circle_may_know(new.id) then return new; end if;\n');
  perform pg_temp.s19f_patch_once('public.circle_open_alerts()'::regprocedure, 'and private.circle_page_visible(m.patient_id, pg.sent_at)',
    'and private.circle_page_visible(m.patient_id, pg.sent_at) and private.page_circle_may_know(pg.id)');
  perform pg_temp.s19f_patch_once('public.circle_ack_alert(uuid)'::regprocedure, E'     and private.circle_page_visible(p_patient, pg.sent_at)\n',
    E'     and private.circle_page_visible(p_patient, pg.sent_at) and private.page_circle_may_know(pg.id)\n');

  -- 7d. The two drivers of the sweep: the 15 second paging sweep, and the independent per-minute health job.
  perform pg_temp.s19f_patch_once('private.sweep_pages()'::regprocedure, E'  perform private.paging_heartbeat(''sweep_pages'');\n',
    E'  perform private.paging_heartbeat(''sweep_pages'');\n  begin\n    perform private.sweep_legacy_notice_holds();\n  exception when others then\n'
    || E'    insert into public.audit_log (action, entity_type, event) values (''legacy_notice.sweep_error'', ''legacy_notice'', jsonb_build_object(''error'', sqlerrm, ''via'', ''sweep''));\n  end;\n');
  perform pg_temp.s19f_patch_once('private.sweep_paging_health()'::regprocedure,
    E'  for h in select component, last_seen_at from public.paging_heartbeats where component in (''sweep_pages'', ''process_events'') loop\n',
    E'  begin\n    perform private.legacy_notice_health();\n  exception when others then\n'
    || E'    insert into public.audit_log (action, entity_type, event) values (''legacy_notice.sweep_error'', ''legacy_notice'', jsonb_build_object(''error'', sqlerrm, ''via'', ''health_wrapper''));\n  end;\n\n'
    || E'  for h in select component, last_seen_at from public.paging_heartbeats where component in (''sweep_pages'', ''process_events'') loop\n');
end
$patch$;

-- ---------------------------------------------------------------------------
-- 8. Self-checks
-- ---------------------------------------------------------------------------
do $check$
begin
  if position('legacy_notice_deferred' in pg_get_functiondef('private.handle_bp_reading_red_flag()'::regprocedure)) = 0
     or position('legacy_notice_deferred' in pg_get_functiondef('private.handle_emergency_event()'::regprocedure)) = 0
     or position('v_legacy_held' in pg_get_functiondef('private.handle_emergency_event()'::regprocedure)) = 0
     or position('page_circle_may_know' in pg_get_functiondef('private.notify_circle_red_alert()'::regprocedure)) = 0
     or position('page_circle_may_know' in pg_get_functiondef('public.circle_open_alerts()'::regprocedure)) = 0
     or position('page_circle_may_know' in pg_get_functiondef('public.circle_ack_alert(uuid)'::regprocedure)) = 0
     or position('sweep_legacy_notice_holds' in pg_get_functiondef('private.sweep_pages()'::regprocedure)) = 0
     or position('legacy_notice_health' in pg_get_functiondef('private.sweep_paging_health()'::regprocedure)) = 0 then
    raise exception 'S19f: a function was not patched';
  end if;
  if exists (select 1 from public.legacy_notice_retirement_config where is_active or approved_at is not null) then raise exception 'S19f: the config must ship inactive and unsigned'; end if;
  if private.legacy_notice_mode('bp_red') <> 'off' or private.legacy_notice_mode('glucose_emergency') <> 'off' then raise exception 'S19f: the retirement must read OFF on arrival'; end if;
  if (select count(*) from public.legacy_notice_retirement_config) <> 4 then raise exception 'S19f: expected four seeded versions'; end if;
  if has_function_privilege('anon', 'private.legacy_notice_deferred(text,uuid,uuid,uuid,text,uuid,text,text,text,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.legacy_notice_deferred(text,uuid,uuid,uuid,text,uuid,text,text,text,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'private.sweep_legacy_notice_holds(boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.release_legacy_notice(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'private.page_circle_may_know(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.sign_legacy_notice_retirement_config(integer,boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.switch_off_legacy_notice_retirement()', 'EXECUTE')
     or has_function_privilege('anon', 'public.legacy_notice_measurement(integer,boolean)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.sign_legacy_notice_retirement_config(integer,boolean)', 'EXECUTE') then
    raise exception 'S19f: function grants are wrong';
  end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name in ('legacy_notice_retirement_config', 'legacy_notice_holds')
              and grantee in ('anon', 'PUBLIC', 'authenticated') and privilege_type <> 'SELECT') then
    raise exception 'S19f: table grants are wrong';
  end if;
end
$check$;
