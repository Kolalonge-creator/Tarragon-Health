-- ===========================================================================
-- Proof: ops_rota_gap_alert_dedup (fix: rota_gap_12h re-raised on every evaluation).
--   A. A fixture organisation with an active test clinician and no rota gets exactly ONE row from the check, with the stable key
--      '<org_id>:rota_gap' (no timestamp) and an aggregated detail.
--   B. Two forced evaluations (include test data, force) leave exactly ONE open alert and ONE incident for the fixture org (all inside this rolled-back
--      transaction, so no notification row survives to be sent to anyone).
--   C. The migration's clean-up statements resolve old-style duplicate alerts and incidents without sending a notification.
--   D. SABOTAGE: the old timestamped definition is reinstalled in a sub-block; the key assertion must fail there.
-- ===========================================================================
begin;

do $do$
declare
  v_org uuid; v_key text; v_rows integer; v_alerts integer; v_inc integer; v_notif_before integer; v_notif_after integer;
  v_old_alert uuid; v_old_inc uuid; v_caught boolean := false;
begin
  insert into public.organisations (name, type) values ('Rota Gap Dedup Test Org', 'direct_consumer') returning id into v_org;
  insert into public.clinical_staff (organisation_id, full_name, active, status, license_verified_at, is_test, doctor_tier)
    values (v_org, 'Rota Gap Test Clinician', true, 'active', now(), true, 'senior_medical_officer');

  -- A. one row, stable key
  select count(*) into v_rows from private.ops_check_rota_gap_12h('{"hours": 12}'::jsonb, true) c where c.dedup_key like v_org::text || '%';
  if v_rows <> 1 then raise exception 'A: expected exactly one check row for the fixture org, got %', v_rows; end if;
  select c.dedup_key into v_key from private.ops_check_rota_gap_12h('{"hours": 12}'::jsonb, true) c where c.dedup_key like v_org::text || '%';
  if v_key <> v_org::text || ':rota_gap' then raise exception 'A: key is not stable: %', v_key; end if;
  if not exists (select 1 from private.ops_check_rota_gap_12h('{"hours": 12}'::jsonb, true) c
                  where c.dedup_key = v_key and (c.detail ->> 'gap_count')::integer >= 1 and (c.detail ->> 'hours')::numeric > 0) then
    raise exception 'A: detail not aggregated';
  end if;
  -- without test clinicians counted the fixture org is not eligible
  if exists (select 1 from private.ops_check_rota_gap_12h('{"hours": 12}'::jsonb, false) c where c.dedup_key like v_org::text || '%') then
    raise exception 'A: eligibility filter lost';
  end if;

  -- B. two evaluations, one alert, one incident
  perform private.ops_evaluate_alerts(true, true);
  perform private.ops_evaluate_alerts(true, true);
  select count(*) into v_alerts from public.ops_alerts where rule_code = 'rota_gap_12h' and state = 'open' and dedup_key = v_key;
  select count(*) into v_inc from public.ops_incidents where external_reference = 'ops_alert:rota_gap_12h:' || v_key and status not in ('resolved', 'closed');
  if v_alerts <> 1 then raise exception 'B: expected 1 open alert, got %', v_alerts; end if;
  if v_inc <> 1 then raise exception 'B: expected 1 incident, got %', v_inc; end if;

  -- C. clean-up statements (same as the migration) on seeded old-style duplicates
  insert into public.ops_alerts (rule_code, dedup_key, severity, detail, is_test)
    values ('rota_gap_12h', v_org::text || ':202001010000', 'sev1', '{}', true) returning id into v_old_alert;
  insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values (null, 'technical', 'sev1', 'Nobody is on call for part of the next 12 hours', 'old', 'ops_alert:rota_gap_12h:' || v_org::text || ':202001010000', now(), now())
    returning id into v_old_inc;
  select count(*) into v_notif_before from public.notifications;
  update public.ops_alerts set state = 'resolved', resolved_at = now() where rule_code = 'rota_gap_12h' and state = 'open';
  update public.ops_incidents
     set status = 'resolved', resolved_at = now(), acknowledged_at = coalesce(acknowledged_at, now()), mitigated_at = coalesce(mitigated_at, now()), root_cause = 'Alert de-duplication key moved on every evaluation (fixed by this migration)',
         corrective_action = 'x', preventive_action = 'y'
   where title = 'Nobody is on call for part of the next 12 hours' and external_reference like 'ops_alert:rota_gap_12h:%' and status not in ('resolved', 'closed');
  select count(*) into v_notif_after from public.notifications;
  if v_notif_after <> v_notif_before then raise exception 'C: clean-up sent notifications'; end if;
  if not exists (select 1 from public.ops_alerts where id = v_old_alert and state = 'resolved') then raise exception 'C: old alert not resolved'; end if;
  if not exists (select 1 from public.ops_incidents where id = v_old_inc and status = 'resolved' and acknowledged_at is not null and mitigated_at is not null and resolved_at is not null) then raise exception 'C: old incident not resolved with all timestamps'; end if;
  -- other titles untouched
  insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values (null, 'technical', 'sev2', 'Some other incident', 'x', 'ops_alert:other:1', now(), now());
  if not exists (select 1 from public.ops_incidents where title = 'Some other incident' and status = 'open') then raise exception 'C: other title touched'; end if;

  -- D. SABOTAGE: reinstall the old (timestamped) key; the key assertion must fail
  begin
    execute $f$create or replace function private.ops_check_rota_gap_12h(p jsonb, p_test boolean) returns table (dedup_key text, detail jsonb)
      language sql stable security definer set search_path = '' as $b$
      select o.id::text || ':' || to_char(g.gap_start at time zone 'utc', 'YYYYMMDDHH24MI'), jsonb_build_object('gap_start', g.gap_start)
        from public.organisations o cross join lateral private.rota_gaps(o.id, now(), now() + interval '12 hours') g
       where exists (select 1 from public.clinical_staff cs where cs.organisation_id = o.id and cs.active and cs.status = 'active' and (p_test or not cs.is_test))
    $b$$f$;
    select c.dedup_key into v_key from private.ops_check_rota_gap_12h('{"hours": 12}'::jsonb, true) c where c.dedup_key like v_org::text || '%' limit 1;
    if v_key = v_org::text || ':rota_gap' then raise exception 'D: sabotage did not change the key'; end if;
    raise exception 'SABOTAGE_FLIPPED';
  exception when others then
    if sqlerrm <> 'SABOTAGE_FLIPPED' then raise; end if;
    v_caught := true;
  end;
  if not v_caught then raise exception 'D: sabotage not detected'; end if;
  -- the sub-block rolled back: the fixed function is back
  select c.dedup_key into v_key from private.ops_check_rota_gap_12h('{"hours": 12}'::jsonb, true) c where c.dedup_key like v_org::text || '%';
  if v_key <> v_org::text || ':rota_gap' then raise exception 'D: fixed definition not restored'; end if;

  raise notice 'ops_rota_gap_alert_dedup: all assertions passed';
end $do$;

rollback;
