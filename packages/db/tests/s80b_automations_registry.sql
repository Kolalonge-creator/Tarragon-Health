-- S80b proof: the automations registry mirrors cron.job, keeps owner fields across a sync, flags unowned / failed / stale, is read-only
-- for non-admin ops, refused for patients and anon. Own fixtures; BEGIN/ROLLBACK; sabotage at the end.
begin;

do $$
declare
  v_org uuid; v_admin uuid := gen_random_uuid(); v_pat uuid; v_n int; v_id uuid; v_h text; v_ok boolean; v_jobs int; v_reg int;
begin
  select id into v_org from public.organisations limit 1;
  select id into v_pat from public.profiles where role = 'patient' limit 1;
  if v_org is null or v_pat is null then raise exception 'fixture missing'; end if;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_admin, 's80b-admin@example.invalid','x',now(),'{}','{}');
  update public.profiles set organisation_id = v_org, role = 'admin', full_name = 'S80b Admin', is_test = true where id = v_admin;

  perform private.sync_automations_from_cron();
  select count(*) into v_jobs from cron.job;
  select count(*) into v_reg from public.automations where kind = 'pg_cron' and enabled;
  if v_jobs = 0 then raise exception 'control failure: no cron jobs, this proves nothing'; end if;
  if v_reg <> v_jobs then raise exception 'FAIL: registry has % enabled pg_cron rows for % jobs', v_reg, v_jobs; end if;
  if not exists (select 1 from public.automations where name = 'cron:automations-registry-sync') then raise exception 'FAIL: sync job not registered'; end if;
  if (select count(*) from public.automations where kind = 'vercel_cron') < 23 then raise exception 'FAIL: vercel crons not seeded'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  select a.id into v_id from public.automations a where a.name = 'vercel:fraud-sweep';
  perform public.set_automation_owner(v_id, 'finance', null, 'https://example.invalid/runbook', 1440);
  begin perform public.set_automation_owner(v_id, null, null, null); v_ok := true; exception when others then v_ok := false; end;
  if v_ok then raise exception 'FAIL: an automation can be left with no owner'; end if;
  reset role;
  perform private.sync_automations_from_cron();
  if (select owner_role from public.automations where id = v_id) is distinct from 'finance' then raise exception 'FAIL: sync overwrote the owner'; end if;

  update public.automations set last_status = 'failed' where id = v_id;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  select health into v_h from public.automations_overview() where id = v_id;
  if v_h <> 'failed' then raise exception 'FAIL: failed job shown as %', v_h; end if;
  reset role;
  update public.automations set last_status = 'succeeded', last_run_at = now() - interval '10 days' where id = v_id;
  set local role authenticated;
  select health into v_h from public.automations_overview() where id = v_id;
  if v_h <> 'stale' then raise exception 'FAIL: stale job shown as %', v_h; end if;
  reset role;
  update public.automations set last_run_at = now() where id = v_id;
  set local role authenticated;
  select health into v_h from public.automations_overview() where id = v_id;
  if v_h <> 'ok' then raise exception 'FAIL: healthy owned job shown as %', v_h; end if;
  select count(*) into v_n from public.automations_overview() where health = 'unowned';
  if v_n = 0 then raise exception 'FAIL: nothing shown as unowned although most jobs have no owner'; end if;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform * from public.automations_overview(); v_ok := true; exception when others then v_ok := false; end;
  if v_ok then raise exception 'FAIL: patient read the overview'; end if;
  select count(*) into v_n from public.automations;
  if v_n <> 0 then raise exception 'FAIL: patient reads the table (%)', v_n; end if;
  begin perform public.set_automation_owner(v_id, 'admin', null, null); v_ok := true; exception when others then v_ok := false; end;
  if v_ok then raise exception 'FAIL: patient set an owner'; end if;
  reset role;
  raise notice 'PASS: registry mirror, owner kept across sync, health flags, refusals';

  create or replace function private.sync_automations_from_cron() returns integer language plpgsql security definer set search_path = '' as $f$
  begin update public.automations set owner_role = null, owner_user = null; return 0; end $f$;
  perform private.sync_automations_from_cron();
  if (select owner_role from public.automations where id = v_id) is not null then
    raise exception 'sabotage did not change the owner, the test would not discriminate';
  end if;
  raise notice 'PASS: sabotage confirmed';
end $$;

rollback;
