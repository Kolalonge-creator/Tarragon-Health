-- S85 proof: the D.7.2 event map against the REAL event bus tables (spec lines 2257-2304).
--
-- The static half lives in packages/shared/src/journeys/event-map.test.ts (it reads the migrations and
-- process-events/handlers.ts). This is the database half: it asks the migrated database what is actually seeded and
-- registered, and then emits one event of each type in a rolled-back transaction to see what the bus really does with it.
--
-- Proves, in one rolled-back transaction:
--   1. WIRED events (observation.recorded, triage.graded, order.paid): the type exists, exactly the expected active subscribers
--      are registered, and emitting the event creates exactly one delivery per subscriber (the downstream effect starts).
--   2. GAP events whose type exists but nothing listens (dose.recorded, dose.missed, encounter.completed, lab_result.received,
--      lab_result.released, silence.detected): the type exists, there is NO active subscriber, and an emitted event creates
--      NO delivery. This is the expected-gap registry, asserted against the database. The registry may only shrink: the day one
--      of these gets a subscriber this proof fails until the registry (event-map.ts and the lists below) is updated.
--   3. GAP events whose type does not exist yet (glucose_observation.recorded, symptom_check.completed, wearable.synced,
--      phq9.scored, pregnancy.recorded): emitting raises "unknown or inactive event type". The day a type is added this fails.
--   4. SABOTAGE: switch off the triage subscriber and the observation.recorded fan-out check must flip; add a subscriber to a gap
--      type and the gap check must flip. A proof that cannot fail is not a proof.
--
-- The two lines below are read by the Jest registry test so the TypeScript and SQL registries cannot drift apart.
-- REGISTRY-GAP-TYPES-NO-SUBSCRIBER: dose.recorded, dose.missed, encounter.completed, lab_result.received, lab_result.released, silence.detected, glucose_observation.recorded, symptom_check.completed, wearable.synced, phq9.scored, pregnancy.recorded
-- REGISTRY-GAP-TYPES-NO-TYPE: glucose_observation.recorded, symptom_check.completed, wearable.synced, phq9.scored, pregnancy.recorded
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;

create function pg_temp.mk_payload(p_type text) returns jsonb language sql as $f$
  select coalesce(jsonb_object_agg(k, 'x'), '{}'::jsonb)
    from public.event_type_versions v, unnest(v.required_keys) k
   where v.event_type = p_type and v.version = (select current_version from public.event_types where event_type = p_type)
$f$;

create function pg_temp.fan_out(p_org uuid, p_type text, p_key text) returns integer language plpgsql as $f$
declare v_id uuid; v_n integer;
begin
  v_id := private.emit_domain_event(p_type, p_org, pg_temp.mk_payload(p_type), p_key);
  select count(*) into v_n from public.domain_event_deliveries where event_id = v_id;
  return v_n;
end $f$;

create function pg_temp.subs_of(p_type text) returns text language sql as $f$
  select coalesce(string_agg(subscriber_key, ',' order by subscriber_key), '') from public.event_subscribers where event_type = p_type and is_active
$f$;

create function pg_temp.emit_error(p_org uuid, p_type text) returns text language plpgsql as $f$
begin
  perform private.emit_domain_event(p_type, p_org, '{}'::jsonb, 's85-gap-' || p_type);
  return 'emitted';
exception when others then return sqlstate;
end $f$;

do $$
declare
  v_org uuid;
  v_t text;
  v_n integer;
  v_nsub integer;
  v_wired text[][] := array[
    ['observation.recorded', 'triage.grade_observation'],
    ['triage.graded',        'paging.on_red,queue.create_from_triage'],
    ['order.paid',           'lead.on_order_paid']
  ];
  v_gap_with_type text[] := array['dose.recorded', 'dose.missed', 'encounter.completed', 'lab_result.received', 'lab_result.released', 'silence.detected'];
  v_gap_no_type text[] := array['glucose_observation.recorded', 'symptom_check.completed', 'wearable.synced', 'phq9.scored', 'pregnancy.recorded'];
  i integer;
begin
  insert into public.organisations (name, type) values ('S85 event map proof', 'clinic') returning id into v_org;

  -- 1. wired
  for i in 1 .. array_length(v_wired, 1) loop
    v_t := v_wired[i][1];
    insert into results values ('real', v_t || ': type exists and is active', 'true',
      (exists (select 1 from public.event_types where event_type = v_t and is_active))::text);
    insert into results values ('real', v_t || ': expected active subscribers', v_wired[i][2], pg_temp.subs_of(v_t));
    select count(*) into v_nsub from public.event_subscribers where event_type = v_t and is_active;
    insert into results values ('real', v_t || ': one delivery per subscriber on emit', v_nsub::text, pg_temp.fan_out(v_org, v_t, 's85-wired-' || v_t)::text);
    insert into results values ('real', v_t || ': the downstream effect has a delivery (not zero)', 'true', (v_nsub > 0)::text);
    insert into results values ('real', v_t || ': every subscriber names a handler key', 'true',
      (not exists (select 1 from public.event_subscribers where event_type = v_t and is_active and coalesce(handler_key, '') = ''))::text);
  end loop;

  -- 2. gaps with a type: nothing listens
  foreach v_t in array v_gap_with_type loop
    insert into results values ('real', 'GAP ' || v_t || ': type exists', 'true', (exists (select 1 from public.event_types where event_type = v_t and is_active))::text);
    insert into results values ('real', 'GAP ' || v_t || ': no active subscriber (registry says none)', '', pg_temp.subs_of(v_t));
    insert into results values ('real', 'GAP ' || v_t || ': an emitted event creates no delivery', '0', pg_temp.fan_out(v_org, v_t, 's85-gap-' || v_t)::text);
  end loop;

  -- 3. gaps with no type yet
  foreach v_t in array v_gap_no_type loop
    insert into results values ('real', 'GAP ' || v_t || ': type does not exist yet', 'false', (exists (select 1 from public.event_types where event_type = v_t))::text);
    insert into results values ('real', 'GAP ' || v_t || ': emitting it is refused', '22023', pg_temp.emit_error(v_org, v_t));
  end loop;

  -- The seeded type count is a floor, so a seed that silently emptied would not look like "all the gaps are real".
  insert into results values ('real', 'the bus has at least 13 seeded event types', 'true', ((select count(*) from public.event_types) >= 13)::text);
  insert into results values ('real', 'the bus has at least 7 subscribers', 'true', ((select count(*) from public.event_subscribers) >= 7)::text);
end $$;

-- 4. SABOTAGE. Same checks, damaged database. Each must flip.
do $$
declare v_org uuid; v_n integer;
begin
  select id into v_org from public.organisations where name = 'S85 event map proof';
  update public.event_subscribers set is_active = false where subscriber_key = 'triage.grade_observation';
  select pg_temp.fan_out(v_org, 'observation.recorded', 's85-sabotage-obs') into v_n;
  insert into results values ('sabotaged', 'observation.recorded still has its triage delivery', '1', v_n::text);

  insert into public.event_subscribers (subscriber_key, event_type, handler_key) values ('s85.sabotage_dose', 'dose.recorded', 'bus.noop');
  select pg_temp.fan_out(v_org, 'dose.recorded', 's85-sabotage-dose') into v_n;
  insert into results values ('sabotaged', 'dose.recorded still has no delivery (gap registry)', '0', v_n::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S85 event map proof FAILED on the real database: %',
      (select string_agg(check_name || ' => expected [' || expected || '] got [' || coalesce(actual, 'null') || ']', '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: sabotage flipped % of 2 checks (the subscriber switch-off and the added gap subscriber must both be caught)', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- The sabotaged rows are asserted to FAIL inside the DO block above. They are deliberately not printed: the runner treats
-- any FAIL verdict in the output as a failed proof.

rollback;
