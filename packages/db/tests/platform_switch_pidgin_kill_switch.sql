-- Proof: the Pidgin kill switch. An admin turns it off in one call (no note
-- needed) and it reads false for signed-in AND signed-out callers; a patient
-- cannot change it; anon cannot change it but can read it; an unknown key reads
-- false; every change is audited; sabotage proves the anon read is gated by the
-- row's opt-in rather than passing vacuously.
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

  -- Ships on, readable by a signed-in caller and by anon.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  if not public.platform_switch_is_on('pidgin_language') then
    raise exception 'FAIL: pidgin_language should ship on for a signed-in caller';
  end if;
  perform set_config('request.jwt.claims', '', true);
  if not public.platform_switch_is_on('pidgin_language') then
    raise exception 'FAIL: pidgin_language should be readable (on) with no session';
  end if;

  -- A patient cannot flip it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  begin
    perform public.set_platform_switch('pidgin_language', false);
    raise exception 'FAIL: a patient switched Pidgin off';
  exception when insufficient_privilege then null;
  end;

  -- Anon cannot execute the writer at all.
  set local role anon;
  begin
    perform public.set_platform_switch('pidgin_language', false);
    raise exception 'FAIL: anon executed set_platform_switch';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- An admin turns it off with no note (one step), and it is audited.
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  select count(*) into v_audit_before from public.audit_log where action = 'platform_switch.off';
  perform public.set_platform_switch('pidgin_language', false);
  select count(*) into v_audit_after from public.audit_log where action = 'platform_switch.off';
  if v_audit_after <> v_audit_before + 1 then
    raise exception 'FAIL: switching off was not audited exactly once (% -> %)', v_audit_before, v_audit_after;
  end if;
  if public.platform_switch_is_on('pidgin_language') then
    raise exception 'FAIL: still on for an admin after switching off';
  end if;

  -- Off for everyone: a patient, and a signed-out caller on the anon role.
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  if public.platform_switch_is_on('pidgin_language') then
    raise exception 'FAIL: still on for a patient after switching off';
  end if;
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  v_ok := public.platform_switch_is_on('pidgin_language');
  reset role;
  if v_ok then
    raise exception 'FAIL: still on for anon after switching off';
  end if;

  -- Back on restores it (the saved language choices were never touched).
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.set_platform_switch('pidgin_language', true, 'wording fixed');
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  v_ok := public.platform_switch_is_on('pidgin_language');
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
  update public.platform_switches set readable_by_anon = false where key = 'pidgin_language';
  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  v_ok := public.platform_switch_is_on('pidgin_language');
  reset role;
  if v_ok then
    raise exception 'FAIL (sabotage): anon still read the switch with readable_by_anon = false';
  end if;

  raise notice 'PASS: Pidgin kill switch: admin one-step off/on, audited, patient/anon cannot write, anon read gated by opt-in';
end $$;

rollback;
