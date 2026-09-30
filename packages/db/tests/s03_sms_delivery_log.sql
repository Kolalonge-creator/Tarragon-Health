-- ===========================================================================
-- Proof: 20260930*_s03_sms_delivery_log.sql (v5 S03; INV-08, OQ-21).
--
-- Proves, against the real migrated schema:
--   1. anon and authenticated (a patient, a clinician) can neither read nor write sms_delivery_log.
--   2. service_role (the auth hook) can insert and read.
--   3. The table refuses any purpose other than 'auth_otp' (INV-08 enforced in the database).
--   4. phone_hash must be a 64-character digest (a raw phone number cannot be stored by mistake).
--   5. SABOTAGE: dropping the purpose CHECK lets a 'reminder' row in, proving check 3 can fail.
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

select 'PASS: s03_sms_delivery_log' as result;

rollback;
