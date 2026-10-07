-- S78a: direct paging watchdog, page.unacknowledged event, re-page of an acknowledged-but-unclosed page, paging counts.
-- (spec 23.15, 23.21, INV-05; CMO decision S-8: keep 5 and 10 minutes, no SMS (D-12), add a direct watchdog, acknowledge stops
-- escalation, an acknowledged-but-unresolved page pages again, count every page and override.)
--
-- Why. Today a red page is created only by the outbox subscriber paging.on_red, handled in process-events. If process-events is down,
-- a red triage event is graded and never paged: INV-05 depends on one edge function being alive. This adds a second, independent path
-- inside the database itself.
--
-- What this adds (all additive; nothing in S19 is redefined except the config validity check, extended to accept optional keys):
--   * private.sweep_unpaged_red_events() on pg_cron every 15 seconds (as sweep-pages is): finds non-shadow, non-test red triage events
--     older than a grace period that have no root page, and creates the page by calling the SAME function the subscriber calls,
--     public.create_red_page (idempotent, advisory-locked, unique index per event), so the escalation logic is not forked. It audits
--     page.watchdog_created and opens one sev1 ops incident saying the outbox path stalled.
--   * paging_config version 2 (PROPOSED, INACTIVE, unsigned): adds watchdog_grace_seconds (60), watchdog_lookback_minutes (360) and
--     repage_after_ack_minutes (null = disabled). Version 1 stays the active row and has none of these keys, so until the CMO signs and
--     activates a new version: grace falls back to a hard default of 60 seconds, lookback to 360 minutes, and the re-page stays OFF.
--   * private.sweep_page_followups() every 15 seconds: (a) emits the spec-named page.unacknowledged event once per root page the first
--     time it escalates for lack of acknowledgement (S19 emits page.escalated; that is kept, this is alongside), (b) when
--     repage_after_ack_minutes is set, an acknowledged page still not closed after that interval pages the acknowledging clinician and the
--     backup once more (pages.repaged_at is the once-only bookkeeping).
--   * public.paging_counts(p_days): pages, escalations, overrides (an acknowledgement by someone the page was not sent to, i.e. the CMO),
--     re-pages and watchdog pages for CMO and admin. New function, because changing paging_overview()'s return shape would break its caller.
--
-- Counts before this migration: no data change. The only column added is pages.repaged_at (null for every existing row).
-- SMS is not touched (D-12): the re-page uses the same push, in-app and email channels and template as any page.

-- ---------------------------------------------------------------------------
-- 1. Config validity accepts the optional keys (still rejects a bad one); version 2 PROPOSED and inactive
-- ---------------------------------------------------------------------------
create or replace function private.paging_rules_valid(r jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
begin
  return coalesce(jsonb_typeof(r -> 'escalation_minutes') = 'array'
     and jsonb_array_length(r -> 'escalation_minutes') = 2
     and (r -> 'escalation_minutes' ->> 0) ~ '^[0-9]+$' and (r -> 'escalation_minutes' ->> 1) ~ '^[0-9]+$'
     and (r -> 'escalation_minutes' ->> 0)::integer > 0
     and (r -> 'escalation_minutes' ->> 0)::integer < (r -> 'escalation_minutes' ->> 1)::integer
     and (r ->> 'lead_repeat_minutes') ~ '^[0-9]+$' and (r ->> 'lead_repeat_minutes')::integer > 0
     and (r ->> 'lead_repeat_max') ~ '^[0-9]+$' and (r ->> 'lead_repeat_max')::integer > 0
     and (r ->> 'unclosed_alert_minutes') ~ '^[0-9]+$' and (r ->> 'unclosed_alert_minutes')::integer > 0
     and (r ->> 'page_access_hours') ~ '^[0-9]+$' and (r ->> 'page_access_hours')::integer > 0
     -- optional (S78a): absent or json null means "use the default" / "disabled"; present means a positive whole number
     and (coalesce(r ->> 'watchdog_grace_seconds', '1') ~ '^[0-9]+$' and coalesce(r ->> 'watchdog_grace_seconds', '1')::integer > 0)
     and (coalesce(r ->> 'watchdog_lookback_minutes', '1') ~ '^[0-9]+$' and coalesce(r ->> 'watchdog_lookback_minutes', '1')::integer > 0)
     and (coalesce(r ->> 'repage_after_ack_minutes', '1') ~ '^[0-9]+$' and coalesce(r ->> 'repage_after_ack_minutes', '1')::integer > 0), false);
exception when others then
  return false;
end;
$$;
revoke all on function private.paging_rules_valid(jsonb) from public, anon, authenticated;

-- paging-rules-v2-begin
insert into public.paging_config (version, is_active, effective_from, rules) values (2, false, '2026-10-07', $json$
{
  "escalation_minutes": [5, 10],
  "lead_repeat_minutes": 5,
  "lead_repeat_max": 12,
  "unclosed_alert_minutes": 60,
  "page_access_hours": 24,
  "watchdog_grace_seconds": 60,
  "watchdog_lookback_minutes": 360,
  "repage_after_ack_minutes": null
}
$json$::jsonb);
-- paging-rules-v2-end

-- once-only bookkeeping for the re-page (written only behind the paging write flag, like every other column of pages)
alter table public.pages add column repaged_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. The direct watchdog (INV-05)
-- ---------------------------------------------------------------------------
create function private.sweep_unpaged_red_events() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_grace integer := coalesce((private.paging_rule('watchdog_grace_seconds') #>> '{}')::integer, 60);
  v_look integer := coalesce((private.paging_rule('watchdog_lookback_minutes') #>> '{}')::integer, 360);
  v_page uuid;
  v_created integer := 0;
  v_errors integer := 0;
begin
  for r in
    select te.id, te.organisation_id
      from public.triage_events te
     where te.grade = 'red' and not te.shadow and not te.is_test
       and te.patient_id is not null
       and te.actions @> '[{"kind":"page_on_call"}]'::jsonb
       and te.created_at <= now() - make_interval(secs => v_grace)
       and te.created_at > now() - make_interval(mins => v_look)
       and not exists (select 1 from public.pages p where p.triage_event_id = te.id and p.parent_page_id is null)
     order by te.created_at
     limit 50
  loop
    begin
      -- the very function the outbox subscriber calls: idempotent, advisory-locked, unique per event
      v_page := public.create_red_page(r.id);
      if v_page is not null then
        v_created := v_created + 1;
        insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
          values (r.organisation_id, 'page.watchdog_created', 'page', v_page, jsonb_build_object('triage_event_id', r.id, 'grace_seconds', v_grace));
        perform private.page_incident(r.organisation_id, 'page_outbox_stalled', 'Red event paging path stalled',
          'A red event had no page after the grace period, so the database watchdog created it. The event processor (process-events) may be down or behind. Check it now.');
      end if;
    exception
      when unique_violation then null;   -- the subscriber created the page between the check and the insert: nothing to do
      when others then
        v_errors := v_errors + 1;
        perform set_config('tarragon.paging_write', 'off', true);
        insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
          values (r.organisation_id, 'page_watchdog.error', 'triage_event', r.id, jsonb_build_object('error', sqlerrm));
        perform private.page_incident(r.organisation_id, 'page_watchdog_failed', 'Red event watchdog failed',
          'The watchdog could not create a page for a red event; see audit_log action page_watchdog.error. A red event may be unpaged.');
    end;
  end loop;
  return jsonb_build_object('created', v_created, 'errors', v_errors);
end;
$$;
revoke all on function private.sweep_unpaged_red_events() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. page.unacknowledged and the re-page
-- ---------------------------------------------------------------------------
create function private.sweep_page_followups() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r public.pages%rowtype;
  oc record;
  v_repage integer := (private.paging_rule('repage_after_ack_minutes') #>> '{}')::integer;
  v_emitted integer := 0;
  v_repaged integer := 0;
  v_errors integer := 0;
  v_own uuid;
  v_backup uuid;
  v_backup_page uuid;
begin
  -- (a) the first time a root page escalated for lack of acknowledgement (the backup step): the spec-named event, once per root
  for r in
    select * from public.pages p
     where p.parent_page_id is null and p.backup_paged_at is not null and not p.no_cover
       and p.sent_at > now() - interval '48 hours'
       and not exists (select 1 from public.domain_events e where e.event_type = 'page.unacknowledged' and e.idempotency_key = 'page.unacknowledged:' || p.id)
     order by p.sent_at limit 100
  loop
    begin
      perform private.emit_domain_event('page.unacknowledged', r.organisation_id,
        jsonb_build_object('page_id', r.id, 'level', 1, 'reason', 'unacknowledged'),
        'page.unacknowledged:' || r.id, r.patient_id, 'page', r.id, 'urgent', null, null, r.backup_paged_at);
      v_emitted := v_emitted + 1;
    exception when others then
      v_errors := v_errors + 1;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
        values (r.organisation_id, 'page_followup.error', 'page', r.id, jsonb_build_object('error', sqlerrm, 'step', 'event'));
    end;
  end loop;

  -- (b) acknowledged but not closed after the configured interval: page the acknowledging clinician and the backup once more.
  -- Disabled (null) until a signed paging_config version sets repage_after_ack_minutes.
  if v_repage is not null then
    for r in
      select * from public.pages p
       where p.parent_page_id is null and p.acknowledged_at is not null and p.closed_at is null and p.repaged_at is null
         and p.acknowledged_at <= now() - make_interval(mins => v_repage)
       order by p.sent_at for update skip locked
    loop
      begin
        -- the acknowledging clinician's own page row of this family (so the link opens their page), else the root
        select coalesce((select c.id from public.pages c where coalesce(c.parent_page_id, c.id) = r.id and c.to_clinician_id = r.acknowledged_by limit 1), r.id) into v_own;
        perform private.page_notify(r.acknowledged_by, r.organisation_id, 'on_call_page', v_own);

        -- the backup: the backup page of this family if there is one, else the rota's other eligible person
        v_backup := null; v_backup_page := null;
        select c.to_clinician_id, c.id into v_backup, v_backup_page from public.pages c where c.parent_page_id = r.id and c.role = 'backup';
        if v_backup is null then
          select * into oc from private.on_call_now(r.organisation_id, r.is_test);
          if found then
            if oc.primary_id is distinct from r.acknowledged_by and private.clinician_is_eligible(oc.primary_id) then v_backup := oc.primary_id;
            elsif oc.backup_id is not null and oc.backup_id is distinct from r.acknowledged_by and private.clinician_is_eligible(oc.backup_id) then v_backup := oc.backup_id;
            end if;
          end if;
          v_backup_page := r.id;
        end if;
        if v_backup is not null and v_backup is distinct from r.acknowledged_by then
          perform private.page_notify(v_backup, r.organisation_id, 'on_call_page', v_backup_page);
        end if;

        perform set_config('tarragon.paging_write', 'on', true);
        update public.pages set repaged_at = now() where id = r.id;
        perform set_config('tarragon.paging_write', 'off', true);
        insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
          values (r.organisation_id, null, 'page.repaged', 'page', r.id, jsonb_build_object('after_minutes', v_repage, 'backup_paged', v_backup is not null));
        v_repaged := v_repaged + 1;
      exception when others then
        v_errors := v_errors + 1;
        perform set_config('tarragon.paging_write', 'off', true);
        insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
          values (r.organisation_id, 'page_followup.error', 'page', r.id, jsonb_build_object('error', sqlerrm, 'step', 'repage'));
        perform private.page_incident(r.organisation_id, 'page_followup_failed', 'A page follow-up failed',
          'The re-page of an acknowledged but unclosed page failed; see audit_log action page_followup.error.');
      end;
    end loop;
  end if;
  return jsonb_build_object('emitted', v_emitted, 'repaged', v_repaged, 'errors', v_errors);
end;
$$;
revoke all on function private.sweep_page_followups() from public, anon, authenticated;

select cron.schedule('sweep-unpaged-red-events', '15 seconds', $$ select private.sweep_unpaged_red_events(); $$);
select cron.schedule('sweep-page-followups', '15 seconds', $$ select private.sweep_page_followups(); $$);

-- ---------------------------------------------------------------------------
-- 4. Counts for the clinical lead and ops. No patient reference, no clinician name.
-- ---------------------------------------------------------------------------
create function public.paging_counts(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_org uuid := private.caller_org();
  v_since timestamptz;
begin
  if (select auth.uid()) is null or v_org is null or not private.can_credential_review() then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_days is null or p_days < 1 or p_days > 366 then raise exception 'bad arguments' using errcode = '22023'; end if;
  v_since := now() - make_interval(days => p_days);
  return jsonb_build_object(
    'days', p_days,
    'pages', (select count(*) from public.pages r where r.organisation_id = v_org and not r.is_test and r.parent_page_id is null and r.sent_at > v_since),
    'acknowledged', (select count(*) from public.pages r where r.organisation_id = v_org and not r.is_test and r.parent_page_id is null and r.sent_at > v_since and r.acknowledged_at is not null),
    'escalated_to_backup', (select count(*) from public.pages r where r.organisation_id = v_org and not r.is_test and r.parent_page_id is null and r.sent_at > v_since and r.backup_paged_at is not null),
    'escalated_to_lead', (select count(*) from public.pages r where r.organisation_id = v_org and not r.is_test and r.parent_page_id is null and r.sent_at > v_since and r.lead_alerted_at is not null),
    'no_cover', (select count(*) from public.pages r where r.organisation_id = v_org and not r.is_test and r.parent_page_id is null and r.sent_at > v_since and r.no_cover),
    -- an override: the page was acknowledged by someone none of its rows was sent to (the chief medical officer stepping in)
    'overrides', (select count(*) from public.pages r where r.organisation_id = v_org and not r.is_test and r.parent_page_id is null and r.sent_at > v_since and r.acknowledged_by is not null
                    and not exists (select 1 from public.pages c where coalesce(c.parent_page_id, c.id) = r.id and c.to_clinician_id = r.acknowledged_by)),
    'repaged', (select count(*) from public.pages r where r.organisation_id = v_org and not r.is_test and r.parent_page_id is null and r.sent_at > v_since and r.repaged_at is not null),
    'created_by_watchdog', (select count(*) from public.audit_log a join public.pages r on r.id = a.entity_id
                             where a.action = 'page.watchdog_created' and r.organisation_id = v_org and not r.is_test and r.sent_at > v_since));
end;
$$;
revoke all on function public.paging_counts(integer) from public, anon, authenticated;
grant execute on function public.paging_counts(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if (select count(*) from public.paging_config where is_active) <> 1 or (select version from public.paging_config where is_active) <> 1 then
    raise exception 'S78a: paging_config version 1 must stay the only active version (version 2 is PROPOSED and unsigned)';
  end if;
  if private.paging_rule('repage_after_ack_minutes') is not null then raise exception 'S78a: the re-page must be disabled on the active config'; end if;
  if not exists (select 1 from cron.job where jobname = 'sweep-unpaged-red-events') or not exists (select 1 from cron.job where jobname = 'sweep-page-followups') then
    raise exception 'S78a: the sweeps are not scheduled';
  end if;
  if has_function_privilege('anon', 'public.paging_counts(integer)', 'EXECUTE') or has_function_privilege('anon', 'private.sweep_unpaged_red_events()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.sweep_unpaged_red_events()', 'EXECUTE') then
    raise exception 'S78a: a paging function is callable by the wrong role';
  end if;
  if exists (select 1 from public.paging_config where version = 2 and not private.paging_rules_valid(rules)) then raise exception 'S78a: version 2 fails its own check'; end if;
end $$;
