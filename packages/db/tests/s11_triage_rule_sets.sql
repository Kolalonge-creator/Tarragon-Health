-- S11 proof: versioned triage rule sets (migration *_s11_triage_rule_sets.sql).
--
--   1. The seed is one DRAFT bp_care_triage v1 whose JSON repeats its code and version.
--   2. Constraints: rules code/version must match the columns; approved needs approver and time;
--      one approved version per code.
--   3. Immutability: an approved row cannot change, be deleted or return to draft; approved -> retired
--      is the only allowed change; a draft can be edited and deleted.
--   4. RLS and grants: a patient and an ordinary clinician see no rows; admin and the active clinical
--      director see them; nobody signed in can insert, update or delete; anon has nothing.
--   5. get_approved_triage_rule_set: null for a draft-only code, the rules once approved, callable by
--      a patient, not by anon.
--   6. SABOTAGE: with the guard trigger dropped, changing an approved rule set must succeed, which
--      proves check 3 can fail.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;

create or replace function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's11-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S11 ' || p_label, (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_p uuid; v_admin uuid; v_clin uuid; v_cmo uuid;
  v_err text; v_n integer; v_buf text[] := '{}'; v_rules jsonb; v_id2 uuid; v_row text; v_parts text[];
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_p := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_clin := pg_temp.mkuser(v_org, 'clinician', 'clinician');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, license_verified_at, employment_type)
  values (v_cmo, v_org, 'S11 CMO', 'chief_medical_officer', true, now(), 'employed')
  on conflict do nothing;

  -- 1. Seed
  insert into results values ('real', 'seed is one draft bp_care_triage v1', 'bp_care_triage|1|draft|1',
    (select code || '|' || version || '|' || status || '|' || (select count(*) from public.triage_rule_sets) from public.triage_rule_sets limit 1));
  insert into results values ('real', 'seed has no approver', 'null', coalesce((select approved_by::text from public.triage_rule_sets where code = 'bp_care_triage'), 'null'));
  select rules into v_rules from public.triage_rule_sets where code = 'bp_care_triage' and version = 1;
  insert into results values ('real', 'seed red rules all page on-call', '5',
    (select count(*)::text from jsonb_array_elements(v_rules -> 'rules') rr
      where rr ->> 'grade' = 'red' and rr -> 'actions' @> '[{"kind":"page_on_call"}]'::jsonb));

  -- 2. Constraints
  begin
    insert into public.triage_rule_sets (code, version, rules) values ('x_set', 1, jsonb_build_object('code', 'other', 'version', 1));
    v_err := 'accepted';
  exception when check_violation then v_err := 'check'; end;
  insert into results values ('real', 'rules code must equal the column', 'check', v_err);
  begin
    insert into public.triage_rule_sets (code, version, rules) values ('x_set', 1, jsonb_build_object('code', 'x_set', 'version', 2));
    v_err := 'accepted';
  exception when check_violation then v_err := 'check'; end;
  insert into results values ('real', 'rules version must equal the column', 'check', v_err);
  begin
    insert into public.triage_rule_sets (code, version, status, rules) values ('x_set', 1, 'approved', jsonb_build_object('code', 'x_set', 'version', 1));
    v_err := 'accepted';
  exception when check_violation then v_err := 'check'; end;
  insert into results values ('real', 'approved needs an approver and time', 'check', v_err);
  begin
    insert into public.triage_rule_sets (code, version, rules) values ('Bad Code', 1, jsonb_build_object('code', 'Bad Code', 'version', 1));
    v_err := 'accepted';
  exception when check_violation then v_err := 'check'; end;
  insert into results values ('real', 'code format is enforced', 'check', v_err);

  -- 3. Immutability
  insert into public.triage_rule_sets (code, version, rules) values ('x_set', 1, jsonb_build_object('code', 'x_set', 'version', 1, 'n', 1));
  begin update public.triage_rule_sets set status = 'approved', approved_by = v_admin, approved_at = now() where code = 'x_set'; v_err := 'accepted';
  exception when insufficient_privilege then v_err := '42501'; end;
  insert into results values ('real', 'an admin cannot be the approver', '42501', v_err);
  begin update public.triage_rule_sets set status = 'approved', approved_by = v_clin, approved_at = now() where code = 'x_set'; v_err := 'accepted';
  exception when insufficient_privilege then v_err := '42501'; end;
  insert into results values ('real', 'an ordinary clinician cannot be the approver', '42501', v_err);
  update public.triage_rule_sets set rules = jsonb_build_object('code', 'x_set', 'version', 1, 'n', 2) where code = 'x_set';
  insert into results values ('real', 'a draft can be edited', '2', (select rules ->> 'n' from public.triage_rule_sets where code = 'x_set'));
  update public.triage_rule_sets set status = 'approved', approved_by = v_cmo, approved_at = now() where code = 'x_set' and version = 1;
  insert into results values ('real', 'a draft can be approved', 'approved', (select status from public.triage_rule_sets where code = 'x_set' and version = 1));
  begin update public.triage_rule_sets set rules = jsonb_build_object('code', 'x_set', 'version', 1, 'n', 3) where code = 'x_set' and version = 1; v_err := 'accepted';
  exception when insufficient_privilege then v_err := '42501'; end;
  insert into results values ('real', 'an approved rule set cannot change', '42501', v_err);
  begin update public.triage_rule_sets set approved_by = v_admin where code = 'x_set' and version = 1; v_err := 'accepted';
  exception when insufficient_privilege then v_err := '42501'; end;
  insert into results values ('real', 'the approver cannot be rewritten', '42501', v_err);
  begin update public.triage_rule_sets set status = 'draft', approved_by = null, approved_at = null where code = 'x_set' and version = 1; v_err := 'accepted';
  exception when insufficient_privilege then v_err := '42501'; end;
  insert into results values ('real', 'an approved rule set cannot go back to draft', '42501', v_err);
  begin delete from public.triage_rule_sets where code = 'x_set' and version = 1; v_err := 'accepted';
  exception when insufficient_privilege then v_err := '42501'; end;
  insert into results values ('real', 'an approved rule set cannot be deleted', '42501', v_err);
  insert into public.triage_rule_sets (code, version, rules) values ('x_set', 2, jsonb_build_object('code', 'x_set', 'version', 2)) returning id into v_id2;
  begin update public.triage_rule_sets set status = 'approved', approved_by = v_cmo, approved_at = now() where id = v_id2; v_err := 'accepted';
  exception when unique_violation then v_err := 'unique'; end;
  insert into results values ('real', 'only one approved version per code', 'unique', v_err);
  delete from public.triage_rule_sets where id = v_id2;
  insert into results values ('real', 'a draft can be deleted', '0', (select count(*)::text from public.triage_rule_sets where id = v_id2));
  update public.triage_rule_sets set status = 'retired' where code = 'x_set' and version = 1;
  insert into results values ('real', 'approved can be retired', 'retired', (select status from public.triage_rule_sets where code = 'x_set' and version = 1));
  begin update public.triage_rule_sets set status = 'approved' where code = 'x_set' and version = 1; v_err := 'accepted';
  exception when insufficient_privilege then v_err := '42501'; end;
  insert into results values ('real', 'a retired rule set cannot come back', '42501', v_err);

  -- 5a. RPC before any approval
  insert into results values ('real', 'rpc is null while only a draft exists', 'null', coalesce(public.get_approved_triage_rule_set('bp_care_triage')::text, 'null'));
  insert into public.triage_rule_sets (code, version, status, rules, approved_by, approved_at)
    values ('rpc_set', 1, 'approved', jsonb_build_object('code', 'rpc_set', 'version', 1, 'n', 7), v_cmo, now());

  -- 4. RLS as each role
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  v_buf := v_buf || ('a patient sees no rule sets' || '|' || '0' || '|' || (select count(*)::text from public.triage_rule_sets));
  begin insert into public.triage_rule_sets (code, version, rules) values ('p_set', 1, jsonb_build_object('code', 'p_set', 'version', 1)); v_err := 'accepted';
  exception when insufficient_privilege then v_err := '42501'; end;
  v_buf := v_buf || ('a patient cannot insert' || '|' || '42501' || '|' || v_err);
  begin update public.triage_rule_sets set note = 'x'; v_err := 'accepted'; exception when insufficient_privilege then v_err := '42501'; end;
  v_buf := v_buf || ('a patient cannot update' || '|' || '42501' || '|' || v_err);
  v_buf := v_buf || ('a patient can read the approved rules through the rpc' || '|' || '7' || '|' || coalesce((public.get_approved_triage_rule_set('rpc_set') -> 'rules' ->> 'n'), 'null'));
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_buf := v_buf || ('an ordinary clinician sees no rule sets' || '|' || '0' || '|' || (select count(*)::text from public.triage_rule_sets));
  begin delete from public.triage_rule_sets; v_err := 'accepted'; exception when insufficient_privilege then v_err := '42501'; end;
  v_buf := v_buf || ('a clinician cannot delete' || '|' || '42501' || '|' || v_err);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_buf := v_buf || ('an admin sees the rule sets' || '|' || 'true' || '|' || ((select count(*) from public.triage_rule_sets) >= 3)::text);
  begin update public.triage_rule_sets set note = 'x'; v_err := 'accepted'; exception when insufficient_privilege then v_err := '42501'; end;
  v_buf := v_buf || ('an admin cannot write through the api' || '|' || '42501' || '|' || v_err);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_cmo, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_buf := v_buf || ('the clinical director can review drafts' || '|' || 'true' || '|' || ((select count(*) from public.triage_rule_sets where status = 'draft') >= 1)::text);
  reset role;

  perform set_config('request.jwt.claims', '', true);
  set local role anon;
  begin perform count(*) from public.triage_rule_sets; v_err := 'accepted'; exception when insufficient_privilege then v_err := '42501'; end;
  v_buf := v_buf || ('anon cannot read the table' || '|' || '42501' || '|' || v_err);
  begin perform public.get_approved_triage_rule_set('rpc_set'); v_err := 'accepted'; exception when insufficient_privilege then v_err := '42501'; end;
  v_buf := v_buf || ('anon cannot call the rpc' || '|' || '42501' || '|' || v_err);
  reset role;

  foreach v_row in array v_buf loop
    v_parts := string_to_array(v_row, '|');
    insert into results values ('real', v_parts[1], v_parts[2], v_parts[3]);
  end loop;

  -- 6. SABOTAGE: without the guard an approved rule set can be changed
  drop trigger triage_rule_sets_guard on public.triage_rule_sets;
  update public.triage_rule_sets set rules = jsonb_build_object('code', 'rpc_set', 'version', 1, 'n', 8) where code = 'rpc_set';
  insert into results values ('sabotaged', 'an approved rule set cannot change', 'unchanged', case when (select rules ->> 'n' from public.triage_rule_sets where code = 'rpc_set') = '7' then 'unchanged' else 'changed' end);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S11 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught = 0 then
    raise exception 'VACUOUS TEST: dropping the guard did not let an approved rule set change';
  end if;
end $$;

select phase, check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
