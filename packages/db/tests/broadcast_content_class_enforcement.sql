-- Verifies the I1 broadcast follow-up: admin_send_broadcast rejects
-- personal-result/diagnosis phrasing, and does NOT false-positive on a
-- legitimate general campaign that merely names a screened-for condition
-- (this platform markets confidential HIV/Hep B/cervical screening as a
-- general service, e.g. /annual-health-check).
--
-- Run inside a transaction, roll back at the end. Assumes an admin profile
-- exists in org 0000000000000000000000000000zzz seed data — adjust the
-- admin lookup below if run against a different fixture set.

begin;

do $$
declare
  v_admin_id uuid;
  v_org_id   uuid;
  v_flags    text[];
  v_broadcast_id uuid;
  v_caught boolean;
begin
  select id, organisation_id into v_admin_id, v_org_id
  from public.profiles where role = 'admin' limit 1;

  if v_admin_id is null then
    raise notice 'No admin profile found — skipping (fixture-dependent test)';
    return;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin_id, 'role', 'authenticated')::text, true);
  set local role authenticated;

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

  raise notice 'ALL CASES PASSED';
end $$;

rollback;
