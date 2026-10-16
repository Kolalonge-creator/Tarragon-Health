-- Shift-start test page. Shortly before an on-call shift begins, the primary and the backup each get a clearly labelled TEST page by the
-- real paging path (push, in-app, email; never SMS or voice, INV-08; fixed wording with no patient data, INV-07). They acknowledge it on
-- /clinician/on-call. Until they do, within a grace window, the shift is NOT counted as covered:
--   * private.rota_gaps reports it (so the ONE rota gap incident per organisation from FU-db, S18's rota_gap:<org>, carries it; no new alert),
--   * an unconfirmed primary with a confirmed backup promotes the backup in private.page_recipient (the real paging path never gets worse:
--     if nobody is confirmed the old order stands, INV-05),
--   * the backup and the reviewers (admins and the Chief Medical Officer) are told in-app (and by email through the credential notice).
-- It reuses page_tests (kind 'shift_start'), the delivered receipts (page_delivered_acks), acknowledge_test_page, the S19c page_notify_ref,
-- the S18 rota and rota_gap_alert, and the existing one-minute ops tick (no new cron job).
--
-- Ships OFF: go-live guard 'shift_start_test' is born off. While it is off nothing is sent and rota_gaps / page_recipient behave exactly as
-- before. Values are PROPOSED (owner CMO) in shift_start_test_config, mirrored in packages/shared proposed-config (shift_start.test_rules).
-- Live counts before this change: no shift_start_tests table existed; page_tests had no shift_start rows; the guard did not exist.

-- 1. Config ------------------------------------------------------------------------------------------------------------------------------
create table public.shift_start_test_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index shift_start_test_config_one_active on public.shift_start_test_config (is_active) where is_active;

create function private.shift_start_rules_valid(r jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare k text;
begin
  foreach k in array array['lead_minutes', 'grace_minutes', 'undelivered_after_minutes', 'late_send_minutes', 'max_per_run', 'proof_lookback_days'] loop
    if not coalesce((r ->> k) ~ '^[0-9]+$' and (r ->> k)::integer between 1 and 10080, false) then return false; end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;
revoke all on function private.shift_start_rules_valid(jsonb) from public, anon, authenticated;
alter table public.shift_start_test_config add constraint shift_start_test_config_rules_valid check (private.shift_start_rules_valid(rules));

-- shift-start-rules-begin
insert into public.shift_start_test_config (version, is_active, effective_from, rules) values (1, true, '2026-10-16', $json$
{
  "lead_minutes": 10,
  "grace_minutes": 15,
  "undelivered_after_minutes": 5,
  "late_send_minutes": 3,
  "max_per_run": 20,
  "proof_lookback_days": 30
}
$json$::jsonb);
-- shift-start-rules-end

alter table public.shift_start_test_config enable row level security;
create policy shift_start_test_config_read on public.shift_start_test_config for select to authenticated using (true);
revoke all on public.shift_start_test_config from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.shift_start_test_config from authenticated;
grant select on public.shift_start_test_config to authenticated;

create function private.shift_rule(p_key text) returns integer
language sql stable security definer set search_path = ''
as $$ select (rules ->> p_key)::integer from public.shift_start_test_config where is_active order by version desc limit 1 $$;
revoke all on function private.shift_rule(text) from public, anon, authenticated;

-- 2. The test page kind and the per-shift record ---------------------------------------------------------------------------------------------
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.page_tests'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%' loop
    execute format('alter table public.page_tests drop constraint %I', c.conname);
  end loop;
  alter table public.page_tests add constraint page_tests_kind_check check (kind in ('readiness', 'drill', 'shift_start'));
end $$;

create table public.shift_start_tests (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  rota_id               uuid not null references public.on_call_rota (id) on delete cascade,
  role                  text not null check (role in ('primary', 'backup')),
  clinician_id          uuid not null references public.profiles (id) on delete cascade,
  page_test_id          uuid not null unique references public.page_tests (id) on delete cascade,
  shift_starts_at       timestamptz not null,
  sent_at               timestamptz not null default now(),
  deadline_at           timestamptz not null,
  acknowledged_at       timestamptz,
  ack_channel           text check (ack_channel in ('push', 'in_app', 'alarm')),
  ack_device            text,
  shown_latency_seconds integer,
  ack_latency_seconds   integer,
  escalated_at          timestamptz,
  cmo_told_at           timestamptz,
  config_version        integer not null,
  is_test               boolean not null default false,
  unique (rota_id, role)
);
create index shift_start_tests_org_idx on public.shift_start_tests (organisation_id, shift_starts_at desc);
create index shift_start_tests_clinician_idx on public.shift_start_tests (clinician_id, shift_starts_at desc);
create index shift_start_tests_due_idx on public.shift_start_tests (deadline_at) where acknowledged_at is null and escalated_at is null;
alter table public.shift_start_tests enable row level security;
create policy shift_start_tests_read on public.shift_start_tests for select to authenticated
  using (clinician_id = (select auth.uid())
         or (private.can_credential_review() and organisation_id = (select pr.organisation_id from public.profiles pr where pr.id = (select auth.uid()))));
revoke all on public.shift_start_tests from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.shift_start_tests from authenticated;
grant select on public.shift_start_tests to authenticated;
create trigger shift_start_tests_guard before insert or update or delete on public.shift_start_tests for each row execute function private.guard_paging_write();

-- The acknowledgement (acknowledge_test_page, unchanged) fills in the record: channel, device and both latencies come from the delivered receipts.
create function private.shift_start_ack_sync() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_ack record; v_org uuid;
begin
  select a.channel, a.device_id, a.acked_at into v_ack from public.page_delivered_acks a where a.test_id = new.id order by a.acked_at limit 1;
  perform set_config('tarragon.paging_write', 'on', true);
  update public.shift_start_tests s
     set acknowledged_at = new.acknowledged_at, ack_channel = v_ack.channel, ack_device = v_ack.device_id,
         shown_latency_seconds = case when v_ack.acked_at is not null then greatest(0, extract(epoch from (v_ack.acked_at - new.sent_at)))::integer end,
         ack_latency_seconds = greatest(0, extract(epoch from (new.acknowledged_at - new.sent_at)))::integer
   where s.page_test_id = new.id returning s.organisation_id into v_org;
  perform set_config('tarragon.paging_write', 'off', true);
  if v_org is not null then
    begin
      perform private.rota_gap_alert(v_org);   -- the one incident clears at once when cover is back; a failure never undoes the acknowledgement
    exception when others then
      raise warning 'shift start test: gap refresh failed (%)', sqlerrm;
    end;
  end if;
  return new;
end;
$$;
revoke all on function private.shift_start_ack_sync() from public, anon, authenticated;
create trigger page_tests_shift_start_ack after update of acknowledged_at on public.page_tests
  for each row when (old.acknowledged_at is null and new.acknowledged_at is not null and new.kind = 'shift_start')
  execute function private.shift_start_ack_sync();

-- 3. What the shift looks like to the rest of the system -----------------------------------------------------------------------------------
-- null = nothing wrong (or the guard is off). Otherwise the gap kind rota_gaps reports.
create function private.shift_start_gap_kind(p_rota uuid) returns text
language sql stable security definer set search_path = ''
as $$
  with s as (
    select bool_or(role = 'primary' and acknowledged_at is null and deadline_at <= now()) as p_bad,
           bool_or(role = 'backup' and acknowledged_at is null and deadline_at <= now()) as b_bad
      from public.shift_start_tests where rota_id = p_rota)
  select case when not private.go_live_guard_on('shift_start_test') then null
              when coalesce(s.p_bad, false) and coalesce(s.b_bad, false) then 'start_test_failed'
              when coalesce(s.p_bad, false) then 'primary_unconfirmed'
              when coalesce(s.b_bad, false) then 'backup_unconfirmed' end
    from s
$$;
revoke all on function private.shift_start_gap_kind(uuid) from public, anon, authenticated;

-- true when the primary missed the test, the backup acknowledged it, and the guard is on: the backup is first on call.
create function private.shift_start_promoted(p_rota uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.go_live_guard_on('shift_start_test')
     and exists (select 1 from public.shift_start_tests p where p.rota_id = p_rota and p.role = 'primary' and p.acknowledged_at is null and p.deadline_at <= now())
     and exists (select 1 from public.shift_start_tests b where b.rota_id = p_rota and b.role = 'backup' and b.acknowledged_at is not null)
$$;
revoke all on function private.shift_start_promoted(uuid) from public, anon, authenticated;

-- rota_gaps: patched from the CURRENT definition (one inserted block before the cursor moves on); stops if the anchor is gone.
do $patch$
declare
  v_def text := pg_get_functiondef('private.rota_gaps(uuid,timestamptz,timestamptz)'::regprocedure);
  v_anchor constant text := '    v_cursor := greatest(v_cursor, r.ends_at);';
  v_new text;
begin
  if v_def like '%shift_start_gap_kind%' then return; end if;
  if position(v_anchor in v_def) = 0 then raise exception 'shift start: private.rota_gaps no longer has the expected cursor line; patch by hand'; end if;
  v_new := replace(v_def, v_anchor,
    E'    if private.shift_start_gap_kind(r.id) is not null then\n      gap_start := greatest(r.starts_at, p_from); gap_end := least(r.ends_at, p_to); kind := private.shift_start_gap_kind(r.id); return next;\n    end if;\n' || v_anchor);
  execute v_new;
end
$patch$;

-- page_recipient: a confirmed backup goes first when the primary missed the start test. Everything after the inserted block is the old order,
-- so with no promotion (guard off, no rows, nobody confirmed) the result is exactly what it was.
do $patch$
declare
  v_def text := pg_get_functiondef('private.page_recipient(uuid,boolean,uuid)'::regprocedure);
  v_anchor constant text := E'  if not found then return null; end if;\n';
  v_new text;
begin
  if v_def like '%shift_start_promoted%' then return; end if;
  if position(v_anchor in v_def) = 0 or (length(v_def) - length(replace(v_def, v_anchor, ''))) <> length(v_anchor) then
    raise exception 'shift start: private.page_recipient no longer has exactly one "if not found" line; patch by hand';
  end if;
  v_new := replace(v_def, v_anchor, v_anchor ||
    E'  if r.backup_id is not null and private.shift_start_promoted(r.rota_id) and private.clinician_is_eligible(r.backup_id)\n' ||
    E'     and r.backup_id is distinct from p_patient and not coalesce(private.has_conflict(r.backup_id, p_patient), false) then return r.backup_id; end if;\n');
  execute v_new;
end
$patch$;

-- 4. The sweep (called from the existing one-minute ops tick) ------------------------------------------------------------------------------
create function private.shift_start_sweep() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r record; t record; v_cs public.clinical_staff%rowtype; v_pt uuid; v_n integer := 0; v_orgs uuid[] := '{}';
  v_ver integer; v_sibling public.shift_start_tests%rowtype; v_test boolean;
begin
  if not private.go_live_guard_on('shift_start_test') then return 0; end if;
  select version into v_ver from public.shift_start_test_config where is_active order by version desc limit 1;
  if v_ver is null then return 0; end if;
  perform set_config('tarragon.paging_write', 'on', true);

  -- send: shifts starting within lead_minutes (or that started less than late_send_minutes ago), one test page per person per shift
  for r in
    select o.id as rota_id, o.organisation_id, o.starts_at, x.role, x.clinician
      from public.on_call_rota o
      cross join lateral (values ('primary', o.primary_clinician_id), ('backup', o.backup_clinician_id)) as x(role, clinician)
     where o.cancelled_at is null and x.clinician is not null and o.ends_at > now()
       and o.starts_at <= now() + make_interval(mins => private.shift_rule('lead_minutes'))
       and o.starts_at > now() - make_interval(mins => private.shift_rule('late_send_minutes'))
       and not exists (select 1 from public.shift_start_tests s where s.rota_id = o.id and s.role = x.role)
     order by o.starts_at, x.role
     limit private.shift_rule('max_per_run')
  loop
    begin
      select * into v_cs from public.clinical_staff where profile_id = r.clinician and active and status = 'active';
      if not found then continue; end if;   -- rota_gaps already reports an ineligible person
      v_test := coalesce((select pr.is_test from public.profiles pr where pr.id = r.clinician), false);
      insert into public.page_tests (organisation_id, clinician_id, requested_by, kind, is_test)
        values (r.organisation_id, r.clinician, null, 'shift_start', v_test) returning id into v_pt;
      insert into public.shift_start_tests (organisation_id, rota_id, role, clinician_id, page_test_id, shift_starts_at, deadline_at, config_version, is_test)
        values (r.organisation_id, r.rota_id, r.role, r.clinician, v_pt, r.starts_at,
                greatest(r.starts_at, now()) + make_interval(mins => private.shift_rule('grace_minutes')), v_ver, v_test);
      perform private.page_notify_ref(r.clinician, r.organisation_id, 'on_call_test_page', v_pt, 'page_tests');
      insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
        values (r.organisation_id, null, 'shift_start_test.sent', 'shift_start_test', v_pt, jsonb_build_object('role', r.role, 'rota_id', r.rota_id, 'clinician_id', r.clinician));
      v_n := v_n + 1;
    exception when others then
      raise warning 'shift start test not sent for rota % role %: %', r.rota_id, r.role, sqlerrm;
    end;
  end loop;

  -- escalate: a test page nobody acknowledged by its deadline. Once per row. Never silent: reviewers are told, the one gap incident is refreshed.
  for t in select * from public.shift_start_tests where acknowledged_at is null and escalated_at is null and deadline_at <= now() order by deadline_at for update skip locked loop
    update public.shift_start_tests set escalated_at = now() where id = t.id;
    select * into v_sibling from public.shift_start_tests where rota_id = t.rota_id and role <> t.role;
    if t.role = 'primary' and v_sibling.id is not null and v_sibling.acknowledged_at is not null then
      perform private.credential_notify(v_sibling.clinician_id, t.organisation_id, 'You are first on call',
        'The primary on-call clinician has not confirmed the start-of-shift test page, so you are first on call for this shift. Open On call.',
        jsonb_build_object('audience', 'rota'), true);
    end if;
    if v_sibling.id is null or v_sibling.cmo_told_at is null then
      perform private.credential_notify_reviewers(t.organisation_id, 'On-call start check missed',
        'A clinician starting an on-call shift has not acknowledged the start-of-shift test page, so that shift is not counted as covered. Open the rota.',
        jsonb_build_object('rota_id', t.rota_id), 'rota_review');
      update public.shift_start_tests set cmo_told_at = now() where id = t.id;
    end if;
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
      values (t.organisation_id, null, 'shift_start_test.missed', 'shift_start_test', t.page_test_id, jsonb_build_object('role', t.role, 'rota_id', t.rota_id, 'clinician_id', t.clinician_id));
    v_orgs := v_orgs || t.organisation_id;
  end loop;
  perform set_config('tarragon.paging_write', 'off', true);

  -- the ONE rota gap incident per organisation (S18) is refreshed at once; the tick's own call a moment later would also do it
  for r in select distinct u as org from unnest(v_orgs) u loop
    perform private.rota_gap_alert(r.org);
  end loop;
  return v_n;
end;
$$;
revoke all on function private.shift_start_sweep() from public, anon, authenticated;

-- The existing one-minute tick (SR5 evaluator -> ops_check_rota_gap_12h, FU-db) runs it first. A failure only warns: the gap check still runs.
do $patch$
declare
  v_def text := pg_get_functiondef('private.ops_check_rota_gap_12h(jsonb,boolean)'::regprocedure);
  v_anchor constant text := E'  for o in select distinct cs.organisation_id';
  v_new text;
begin
  if v_def like '%shift_start_sweep%' then return; end if;
  if position(v_anchor in v_def) = 0 then raise exception 'shift start: ops_check_rota_gap_12h no longer has the expected loop; patch by hand'; end if;
  v_new := replace(v_def, v_anchor,
    E'  begin\n    perform private.shift_start_sweep();\n  exception when others then\n    raise warning ''shift start sweep failed: %'', sqlerrm;\n  end;\n' || v_anchor);
  execute v_new;
end
$patch$;

-- 5. Reads for the screen ------------------------------------------------------------------------------------------------------------------
create function public.my_shift_start_tests() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'guard_on', private.go_live_guard_on('shift_start_test'),
    'grace_minutes', private.shift_rule('grace_minutes'),
    'tests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'page_test_id', s.page_test_id, 'role', s.role, 'shift_starts_at', s.shift_starts_at, 'shift_ends_at', o.ends_at,
        'sent_at', s.sent_at, 'deadline_at', s.deadline_at, 'acknowledged_at', s.acknowledged_at, 'ack_channel', s.ack_channel,
        'shown_latency_seconds', s.shown_latency_seconds, 'ack_latency_seconds', s.ack_latency_seconds,
        'shown', exists (select 1 from public.page_delivered_acks a where a.test_id = s.page_test_id),
        'undelivered', s.acknowledged_at is null
                       and not exists (select 1 from public.page_delivered_acks a where a.test_id = s.page_test_id)
                       and s.sent_at < now() - make_interval(mins => private.shift_rule('undelivered_after_minutes')),
        'state', case when s.acknowledged_at is not null then 'acknowledged' when s.deadline_at <= now() then 'missed' else 'awaiting' end)
        order by s.shift_starts_at desc)
      from (select * from public.shift_start_tests x where x.clinician_id = (select auth.uid()) and x.shift_starts_at > now() - interval '2 days'
             order by x.shift_starts_at desc limit 10) s
      join public.on_call_rota o on o.id = s.rota_id), '[]'::jsonb))
$$;

create function public.shift_start_tests_overview() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid;
begin
  if not private.can_credential_review() then raise exception 'not authorised' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = (select auth.uid());
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'rota_id', s.rota_id, 'name', coalesce(cs.full_name, 'Unknown'), 'role', s.role, 'shift_starts_at', s.shift_starts_at,
      'sent_at', s.sent_at, 'deadline_at', s.deadline_at, 'acknowledged_at', s.acknowledged_at, 'ack_channel', s.ack_channel,
      'ack_latency_seconds', s.ack_latency_seconds,
      'state', case when s.acknowledged_at is not null then 'acknowledged' when s.deadline_at <= now() then 'missed' else 'awaiting' end)
      order by s.shift_starts_at desc, s.role)
    from (select * from public.shift_start_tests x where x.organisation_id = v_org and x.shift_starts_at > now() - interval '2 days'
           order by x.shift_starts_at desc limit 40) s
    left join public.clinical_staff cs on cs.profile_id = s.clinician_id), '[]'::jsonb);
end;
$$;

revoke all on function public.my_shift_start_tests() from public, anon;
revoke all on function public.shift_start_tests_overview() from public, anon;
grant execute on function public.my_shift_start_tests() to authenticated;
grant execute on function public.shift_start_tests_overview() to authenticated;

-- 6. The go-live guard (born OFF) -----------------------------------------------------------------------------------------------------------
create function private.shift_start_go_live_conditions(p_key text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  return jsonb_build_array(
    private.go_live_cond('config_present', 'The shift-start test values (lead time, grace window) are in force',
      exists (select 1 from public.shift_start_test_config where is_active), 'data', (select 'version ' || version from public.shift_start_test_config where is_active)),
    private.go_live_cond('test_page_route_proven', 'A test page has been acknowledged by an on-call clinician in the last days, so the route is known to work',
      exists (select 1 from public.page_tests t where t.acknowledged_at is not null and t.is_test is not true
                and t.acknowledged_at > now() - make_interval(days => coalesce(private.shift_rule('proof_lookback_days'), 30))), 'data', null),
    private.go_live_cond('cmo_switch', 'Chief Medical Officer sign-off', true, 'switch', 'Given by the Chief Medical Officer pressing the switch'));
end $$;
revoke all on function private.shift_start_go_live_conditions(text) from public, anon, authenticated, service_role;

do $$
declare
  v_def text;
  v_anchor constant text := E'\n  end if;\n  -- An unknown key has no conditions';
  v_new text;
begin
  v_def := pg_get_functiondef('private.go_live_conditions(text, uuid)'::regprocedure);
  if v_def like '%shift_start_go_live_conditions%' then return; end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'private.go_live_conditions no longer ends with the expected fall-through; add the shift start branch by hand' using errcode = '55000';
  end if;
  v_new := replace(v_def, v_anchor,
    E'\n  elsif p_key = ''shift_start_test'' then\n    return private.shift_start_go_live_conditions(p_key);\n  end if;\n  -- An unknown key has no conditions');
  execute v_new;
end $$;

insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('shift_start_test', 'Shift-start test page',
   'Counting an on-call shift as covered until the primary and backup have acknowledged the start-of-shift test page',
   'The test values are in force and a test page has been acknowledged recently, so the route is known to work',
   'cmo', array['rota_gaps', 'page_recipient', 'shift_start_sweep'],
   'A red event page is never held back by this: when nobody has confirmed, the old order of who is paged stands. The test page itself never carries patient data and never goes by SMS or voice.')
on conflict (key) do nothing;

-- 7. Self-check ---------------------------------------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.go_live_guards where key = 'shift_start_test' and is_on) then raise exception 'shift start: the guard must be born off'; end if;
  if not exists (select 1 from public.go_live_guards where key = 'shift_start_test') then raise exception 'shift start: guard row missing'; end if;
  if has_function_privilege('anon', 'public.my_shift_start_tests()', 'EXECUTE') or has_function_privilege('anon', 'public.shift_start_tests_overview()', 'EXECUTE')
     or has_function_privilege('anon', 'private.shift_start_sweep()', 'EXECUTE') or has_function_privilege('authenticated', 'private.shift_start_sweep()', 'EXECUTE')
     or has_table_privilege('anon', 'public.shift_start_tests', 'SELECT') or has_table_privilege('authenticated', 'public.shift_start_tests', 'INSERT') then
    raise exception 'shift start: grants are wrong';
  end if;
  if pg_get_functiondef('private.rota_gaps(uuid,timestamptz,timestamptz)'::regprocedure) not like '%shift_start_gap_kind%'
     or pg_get_functiondef('private.page_recipient(uuid,boolean,uuid)'::regprocedure) not like '%shift_start_promoted%'
     or pg_get_functiondef('private.ops_check_rota_gap_12h(jsonb,boolean)'::regprocedure) not like '%shift_start_sweep%' then
    raise exception 'shift start: a patch did not land';
  end if;
end $$;
