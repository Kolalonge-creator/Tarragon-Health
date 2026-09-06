-- Verifies the I1 broadcast follow-up: admin_send_broadcast rejects
-- personal-result/diagnosis phrasing, and does NOT false-positive on a
-- legitimate general campaign that merely names a screened-for condition
-- (this platform markets confidential HIV/Hep B/cervical screening as a
-- general service, e.g. /annual-health-check).
--
-- Run inside a transaction, roll back at the end. The admin is minted here:
-- the old shape looked one up and, finding none, printed
-- "skipping (fixture-dependent test)" and returned -- which on a fresh
-- `supabase db reset` meant every case below silently did not run.

begin;

do $$
declare
  v_admin_id uuid;
  v_org_id   uuid;
  v_flags    text[];
  v_broadcast_id uuid;
  v_caught boolean;
begin
  select id into v_org_id from public.organisations limit 1;
  if v_org_id is null then
    insert into public.organisations (name, type)
    values ('Broadcast Content Test Org', 'clinic')
    returning id into v_org_id;
  end if;

  v_admin_id := gen_random_uuid();
  insert into auth.users (id, email)
  values (v_admin_id, 'broadcast-content-admin@example.invalid');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_admin_id, v_org_id, 'admin', 'Broadcast Content Test Admin')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role,
        full_name = excluded.full_name;

  -- Cases 1-3 call private.broadcast_content_flags directly and therefore must
  -- run as the session role. They used to sit AFTER `set local role
  -- authenticated`, which has no USAGE on schema private, so the file aborted
  -- with 42501 before reaching any assertion at all -- it never once ran to
  -- completion. The role switch now happens where it belongs: immediately
  -- before case 4, which is the case that is actually about what an admin
  -- ACCOUNT may do.
  -- Case 1: clean general campaign copy passes the preview check.
  select private.broadcast_content_flags(
    'Free BP checks this weekend — book your confidential HIV or Hep B screening today.'
  ) into v_flags;
  if coalesce(array_length(v_flags, 1), 0) <> 0 then
    raise exception 'FAIL case1: legitimate campaign copy was flagged: %', v_flags;
  end if;
  raise notice 'PASS case1: clean campaign copy not flagged';

  -- Case 2: personal-result phrasing is flagged by the heuristic.
  select private.broadcast_content_flags('Hi, your test result was abnormal.') into v_flags;
  if coalesce(array_length(v_flags, 1), 0) = 0 then
    raise exception 'FAIL case2: personal result phrasing was NOT flagged';
  end if;
  raise notice 'PASS case2: personal result phrasing flagged (%)', v_flags;

  -- Case 3: "you tested positive" phrasing is flagged.
  select private.broadcast_content_flags('You tested positive for the condition.') into v_flags;
  if coalesce(array_length(v_flags, 1), 0) = 0 then
    raise exception 'FAIL case3: "tested positive" phrasing was NOT flagged';
  end if;
  raise notice 'PASS case3: "tested positive" phrasing flagged (%)', v_flags;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- Case 4: admin_send_broadcast itself refuses to enqueue a flagged message —
  -- proves the block is server-side, not just a UI-level check.
  insert into public.notification_broadcasts
    (created_by, title, body, audience, channels)
  values
    (v_admin_id, 'Update', 'Your diagnosis is confirmed, please call the clinic.',
     'all_patients', array['email']::public.notification_channel[])
  returning id into v_broadcast_id;

  v_caught := false;
  begin
    perform public.admin_send_broadcast(v_broadcast_id);
  exception when sqlstate '23514' then
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'FAIL case4: admin_send_broadcast enqueued a flagged message';
  end if;
  raise notice 'PASS case4: admin_send_broadcast blocked the flagged message';

  -- Case 5: a clean broadcast still sends normally (no regression).
  insert into public.notification_broadcasts
    (created_by, title, body, audience, channels)
  values
    (v_admin_id, 'Weekend clinic', 'Free BP checks this weekend at our Lekki centre.',
     'all_patients', array['email']::public.notification_channel[])
  returning id into v_broadcast_id;

  perform public.admin_send_broadcast(v_broadcast_id);
  if (select status from public.notification_broadcasts where id = v_broadcast_id) <> 'sent' then
    raise exception 'FAIL case5: clean broadcast did not send';
  end if;
  raise notice 'PASS case5: clean broadcast still sends';

  reset role;

  raise notice 'ALL CASES PASSED';
end $$;

rollback;
