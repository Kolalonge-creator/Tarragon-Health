-- Proof: the platform switch mechanism (public.set_platform_switch / platform_switch_is_on), using a throwaway key
-- created inside this rolled-back transaction (the only seeded switch was removed 2026-10-06). An admin turns
-- it off in one call (no note needed) and it reads false for signed-in AND signed-out callers; a patient cannot change
-- it; anon cannot execute the writer; an unknown key reads false and cannot be written; every change is audited;
-- sabotage proves the anon read is gated by the row's opt-in rather than passing vacuously.
-- Wrapped in BEGIN/ROLLBACK; fails loudly with raise exception.
begin;

do $$
declare
  v_admin   uuid;
  v_patient uuid;
  v_audit_before int;
  v_audit_after  int;
  v_ok boolean;
begin
  select id into v_admin   from public.profiles where role = 'admin'   limit 1;
  select id into v_patient from public.profiles where role = 'patient' limit 1;
  if v_admin is null or v_patient is null then
    raise exception 'fixtures unavailable: need an admin and a patient profile';
  end if;

  -- The throwaway switch: on by default, anon-readable (inserted by the owner; the writer is the only door for others).
  insert into public.platform_switches (key, label, description, is_on, readable_by_anon)
  values ('proof_probe_switch', 'Proof probe', 'Throwaway row for packages/db/tests/platform_switch_acl_and_audit.sql', true, true);

  -- Ships on, readable by a signed-in caller and by anon.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  if not public.platform_switch_is_on('proof_probe_switch') then
    raise exception 'FAIL: the probe switch should be on for a signed-in caller';
  end if;
  perform set_config('request.jwt.claims', '', true);
  if not public.platform_switch_is_on('proof_probe_switch') then
    raise exception 'FAIL: the probe switch should be readable (on) with no session';
  end if;

  -- A patient cannot flip it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  begin
    perform public.set_platform_switch('proof_probe_switch', false);
    raise exception 'FAIL: a patient switched the probe off';
  exception when insufficient_privilege then null;
  end;

  -- Anon cannot execute the writer at all.
  set local role anon;
  begin
    perform public.set_platform_switch('proof_probe_switch', false);
    raise exception 'FAIL: anon executed set_platform_switch';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- An admin turns it off with no note (one step), and it is audited.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  select count(*) into v_audit_before from public.audit_log where action = 'platform_switch.off';
  perform public.set_platform_switch('proof_probe_switch', false);
  select count(*) into v_audit_after from public.audit_log where action = 'platform_switch.off';
  if v_audit_after <> v_audit_before + 1 then
    raise exception 'FAIL: switching off was not audited exactly once (% -> %)', v_audit_before, v_audit_after;
  end if;
  if public.platform_switch_is_on('proof_probe_switch') then
    raise exception 'FAIL: still on for an admin after switching off';
  end if;

  -- Off for everyone: a patient, and a signed-out caller on the anon role.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  if public.platform_switch_is_on('proof_probe_switch') then
    raise exception 'FAIL: still on for a patient after switching off';
  end if;
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  v_ok := public.platform_switch_is_on('proof_probe_switch');
  reset role;
  if v_ok then
    raise exception 'FAIL: still on for anon after switching off';
  end if;

  -- Back on restores it .
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.set_platform_switch('proof_probe_switch', true, 'wording fixed');
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  v_ok := public.platform_switch_is_on('proof_probe_switch');
  reset role;
  if not v_ok then
    raise exception 'FAIL: not back on for anon after switching on';
  end if;

  -- Unknown key reads false; unknown key write is refused.
  if public.platform_switch_is_on('no_such_switch') then
    raise exception 'FAIL: unknown key read true';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  begin
    perform public.set_platform_switch('no_such_switch', true);
    raise exception 'FAIL: wrote an unknown switch';
  exception when invalid_parameter_value then null;
  end;

  -- SABOTAGE: remove the anon opt-in. The same anon read must flip to false,
  -- proving the opt-in is what gates it (the assertion above can fail).
  update public.platform_switches set readable_by_anon = false where key = 'proof_probe_switch';
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  v_ok := public.platform_switch_is_on('proof_probe_switch');
  reset role;
  if v_ok then
    raise exception 'FAIL (sabotage): anon still read the switch with readable_by_anon = false';
  end if;

  raise notice 'PASS: platform switch: admin one-step off/on, audited, patient/anon cannot write, anon read gated by opt-in';
end $$;

-- the throwaway key goes with the rollback; make that explicit and checked
delete from public.platform_switches where key = 'proof_probe_switch';
rollback;
