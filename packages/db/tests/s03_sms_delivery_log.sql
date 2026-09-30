-- ===========================================================================
-- Proof: 20260930*_s03_sms_delivery_log.sql (v5 S03; INV-08, OQ-21).
--
-- Proves, against the real migrated schema:
--   1. anon and authenticated (a patient, a clinician) can neither read nor write sms_delivery_log.
--   2. service_role (the auth hook) can insert and read.
--   3. The table refuses any purpose other than 'auth_otp' (INV-08 enforced in the database).
--   4. phone_hash must be a 64-character digest (a raw phone number cannot be stored by mistake).
--   5. reserve_auth_sms_slot: only service_role can execute it; it hands out exactly p_max reservations per phone per
--      hour; failed and refused rows do not use the quota; another phone is unaffected.
--   6. SABOTAGE: dropping the purpose CHECK lets a 'reminder' row in (check 3 can fail), and granting EXECUTE on the
--      reservation function to PUBLIC reaches anon (check 5 can fail).
--
-- Wrapped in BEGIN/ROLLBACK.
-- Run:  psql -f packages/db/tests/s03_sms_delivery_log.sql  (CI: scripts/run-db-proofs.sh)
-- ===========================================================================

begin;

do $$
declare
  v_hash text := repeat('a', 64);
  v_n integer;
  v_failed boolean;
begin
  -- 2. service_role can write and read.
  set local role service_role;
  insert into public.sms_delivery_log (phone_hash, provider, status) values (v_hash, 'mock', 'sent');
  select count(*) into v_n from public.sms_delivery_log where phone_hash = v_hash;
  if v_n <> 1 then raise exception 'FAIL service_role could not write and read its own log row'; end if;

  -- 3. purpose is CHECKed.
  v_failed := false;
  begin
    insert into public.sms_delivery_log (purpose, phone_hash, provider, status) values ('reminder', v_hash, 'mock', 'sent');
  exception when check_violation then v_failed := true; end;
  if not v_failed then raise exception 'FAIL a non-auth_otp purpose was accepted (INV-08 hole)'; end if;

  -- 4. phone_hash shape.
  v_failed := false;
  begin
    insert into public.sms_delivery_log (phone_hash, provider, status) values ('+2348031234567', 'mock', 'sent');
  exception when check_violation then v_failed := true; end;
  if not v_failed then raise exception 'FAIL a raw phone number was accepted as phone_hash'; end if;
  reset role;

  -- 1. anon and authenticated: no read, no write.
  foreach v_hash in array array['anon', 'authenticated'] loop
    execute format('set local role %I', v_hash);
    v_failed := false;
    begin
      perform 1 from public.sms_delivery_log limit 1;
    exception when insufficient_privilege then v_failed := true; end;
    if not v_failed then raise exception 'FAIL role % could read sms_delivery_log', v_hash; end if;
    v_failed := false;
    begin
      insert into public.sms_delivery_log (phone_hash, provider, status) values (repeat('b', 64), 'mock', 'sent');
    exception when insufficient_privilege then v_failed := true; end;
    if not v_failed then raise exception 'FAIL role % could write sms_delivery_log', v_hash; end if;
    reset role;
  end loop;
end $$;

-- 5. SABOTAGE: remove the purpose CHECK and confirm the proof's check 3 would have caught it.
do $$
declare
  v_con text;
  v_accepted boolean := false;
begin
  select conname into v_con from pg_constraint
   where conrelid = 'public.sms_delivery_log'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%auth_otp%';
  if v_con is null then raise exception 'VACUOUS TEST: purpose CHECK not found to sabotage'; end if;
  execute format('alter table public.sms_delivery_log drop constraint %I', v_con);
  begin
    insert into public.sms_delivery_log (purpose, phone_hash, provider, status) values ('reminder', repeat('c', 64), 'mock', 'sent');
    v_accepted := true;
  exception when others then v_accepted := false; end;
  if not v_accepted then raise exception 'VACUOUS TEST: sabotage did not open the hole, so check 3 proves nothing'; end if;
end $$;

-- 5. The atomic hourly cap.
do $$
declare
  v_a text := repeat('d', 64);
  v_b text := repeat('e', 64);
  v_id uuid;
  v_n integer;
  v_blocked boolean;
begin
  if has_function_privilege('anon', 'public.reserve_auth_sms_slot(text,uuid,text,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.reserve_auth_sms_slot(text,uuid,text,integer)', 'EXECUTE') then
    raise exception 'FAIL anon or authenticated can execute reserve_auth_sms_slot';
  end if;

  set local role service_role;
  for v_n in 1..5 loop
    v_id := public.reserve_auth_sms_slot(v_a, null, 'mock', 5);
    if v_id is null then raise exception 'FAIL reservation % of 5 was refused', v_n; end if;
  end loop;
  if public.reserve_auth_sms_slot(v_a, null, 'mock', 5) is not null then
    raise exception 'FAIL a sixth reservation was granted inside the hour';
  end if;
  -- Another phone is unaffected.
  if public.reserve_auth_sms_slot(v_b, null, 'mock', 5) is null then
    raise exception 'FAIL one phone exhausted another phone''s quota';
  end if;
  -- A failed send gives its slot back; refused attempts (rate_limited rows) never used one.
  update public.sms_delivery_log set status = 'failed'
   where id = (select id from public.sms_delivery_log where phone_hash = v_a and status = 'reserved' order by created_at limit 1);
  if public.reserve_auth_sms_slot(v_a, null, 'mock', 5) is null then
    raise exception 'FAIL a failed send did not free its slot';
  end if;
  if public.reserve_auth_sms_slot(v_a, null, 'mock', 5) is not null then
    raise exception 'FAIL refused attempts extended the quota instead of being capped';
  end if;
  reset role;
end $$;

-- 6b. SABOTAGE: if EXECUTE on the reservation function reached PUBLIC, anon would get it. Prove the privilege check sees that.
do $$
declare v_reached boolean;
begin
  grant execute on function public.reserve_auth_sms_slot(text, uuid, text, integer) to public;
  v_reached := has_function_privilege('anon', 'public.reserve_auth_sms_slot(text,uuid,text,integer)', 'EXECUTE');
  if not v_reached then
    raise exception 'VACUOUS TEST: granting PUBLIC did not reach anon, so the privilege check proves nothing';
  end if;
  revoke all on function public.reserve_auth_sms_slot(text, uuid, text, integer) from public;
end $$;

select 'PASS: s03_sms_delivery_log' as result;

rollback;
