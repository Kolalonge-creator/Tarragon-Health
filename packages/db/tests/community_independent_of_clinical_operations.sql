-- Community no longer waits on the clinical-operations master (migration 20261030223010).
--   1. The guard has no parent, is still a feature, and is still OFF (the migration never switches it on).
--   2. With clinical operations OFF, Community reads closed while its own switch is off and OPEN once its own switch is on.
--   3. Another clinical feature (symptom checker) still reads closed under the same closed master.
--   SABOTAGE: community's parent put back; the open check must fail, and the script raises if it does not.
begin;

-- same fixture approach as gate_model_masters_and_features.sql: the guard trigger is paused inside this rolled-back transaction
alter table public.go_live_guards disable trigger go_live_guards_guard;

do $$
declare
  v_org uuid; v_admin uuid := gen_random_uuid();
  v_caught boolean := false;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_admin, 'comgl-' || substr(v_admin::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v_admin, v_org, 'admin'::public.user_role, 'Community go-live proof admin', true)
  on conflict (id) do update set is_test = true, is_active = true;

  if (select parent_key from public.go_live_guards where key = 'community') is not null then raise exception 'FAIL 1a: community still has a parent'; end if;
  if (select kind from public.go_live_guards where key = 'community') <> 'feature' then raise exception 'FAIL 1b: community is not a feature'; end if;
  if (select is_on from public.go_live_guards where key = 'community') then raise exception 'FAIL 1c: migration switched community on'; end if;

  update public.go_live_guards set is_on = false where key = 'clinical_operations_enabled';
  if private.go_live_guard_on('community') then raise exception 'FAIL 2a: community open while its own switch is off'; end if;

  update public.go_live_guards
     set is_on = true, changed_at = now(), changed_by = v_admin, change_note = 'proof, rolled back', held_reason = null
   where key = 'community';
  if not private.go_live_guard_on('community') then raise exception 'FAIL 2b: community closed although its own switch is on and it has no parent'; end if;

  update public.go_live_guards
     set is_on = true, changed_at = now(), changed_by = v_admin, change_note = 'proof, rolled back', held_reason = null
   where key = 'symptom_checker_enabled';
  if private.go_live_guard_on('symptom_checker_enabled') then raise exception 'FAIL 3: a clinical feature opened under a closed master'; end if;

  -- sabotage: restore the old parent, the open check must now fail
  update public.go_live_guards set parent_key = 'clinical_operations_enabled' where key = 'community';
  begin
    if not private.go_live_guard_on('community') then raise exception 'sabotage detected'; end if;
  exception when others then v_caught := true; end;
  if not v_caught then raise exception 'FAIL sabotage: the proof did not discriminate'; end if;
end $$;

rollback;
