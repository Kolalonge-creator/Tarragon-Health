-- S11i proof: bp_care_triage v3 (version 2 plus a 7 day silence line) is an unapproved draft that differs from v2 in exactly the version and
-- the silence days, and the database now refuses to approve an older rule set than one already approved (the 2026-10-06 roll-back).
-- One rolled-back transaction. Raises on any failure. Sabotage: a second difference slipped into the draft must be caught, and the
-- roll-back guard dropped must let the roll-back through.
begin;

create or replace function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's11i-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S11i ' || p_label, (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;

do $$
declare v2 jsonb; v3 jsonb; v3row public.triage_rule_sets%rowtype; v_err text := 'accepted'; v_cmo uuid; v_older uuid; v_org uuid; v_admin uuid;
begin
  select rules into v2 from public.triage_rule_sets where code = 'bp_care_triage' and version = 2;
  select * into v3row from public.triage_rule_sets where code = 'bp_care_triage' and version = 3;
  v3 := v3row.rules;
  if v2 is null or v3 is null then raise exception 'FAIL 1: bp_care_triage v2 and v3 must both exist'; end if;
  if v3row.status <> 'draft' or v3row.approved_by is not null or v3row.approved_at is not null then
    raise exception 'FAIL 2: v3 must be an unapproved draft, found % / approved_by %', v3row.status, v3row.approved_by;
  end if;
  if (v3 #>> '{params,silence,days}')::int <> 7 then raise exception 'FAIL 3: v3 silence line must be 7'; end if;
  if (v2 #>> '{params,silence,days}')::int <> 5 then raise exception 'FAIL 4: v2 must still say 5 (a rule set is never edited)'; end if;
  if (v3 -> 'code') <> to_jsonb('bp_care_triage'::text) or (v3 -> 'version') <> to_jsonb(3) then
    raise exception 'FAIL 5: the JSON must repeat the row code and version';
  end if;
  if ((v3 #- '{params,silence,days}') - 'version') is distinct from ((v2 #- '{params,silence,days}') - 'version') then
    raise exception 'FAIL 6: v3 differs from v2 in more than the version and the silence line';
  end if;
  if jsonb_array_length(v3 -> 'rules') <> jsonb_array_length(v2 -> 'rules') then raise exception 'FAIL 7: v3 must have the same rules as v2'; end if;

  -- the roll-back guard: with a newer version approved, approving an older draft is refused
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, license_verified_at, employment_type, indemnity_exempt, indemnity_exempt_by)
  values (v_cmo, v_org, 'S11i CMO', 'chief_medical_officer', true, now(), 'employed', true, v_admin)
  on conflict do nothing;
  insert into public.triage_rule_sets (code, version, status, rules, approved_by, approved_at)
  values ('zz_guard_set', 5, 'approved', jsonb_build_object('code', 'zz_guard_set', 'version', 5), v_cmo, now());
  insert into public.triage_rule_sets (code, version, status, rules) values ('zz_guard_set', 4, 'draft', jsonb_build_object('code', 'zz_guard_set', 'version', 4))
  returning id into v_older;
  begin
    update public.triage_rule_sets set status = 'retired' where code = 'zz_guard_set' and version = 5;
    update public.triage_rule_sets set status = 'approved', approved_by = v_cmo, approved_at = now() where id = v_older;
  exception when others then v_err := sqlstate;
  end;
  if v_err <> '22023' then raise exception 'FAIL 8: approving an older version than one already approved must be refused (22023), got %', v_err; end if;

  -- control: approving a NEWER draft is allowed
  insert into public.triage_rule_sets (code, version, status, rules) values ('zz_guard_set', 6, 'draft', jsonb_build_object('code', 'zz_guard_set', 'version', 6));
  update public.triage_rule_sets set status = 'retired' where code = 'zz_guard_set' and version = 5;
  update public.triage_rule_sets set status = 'approved', approved_by = v_cmo, approved_at = now() where code = 'zz_guard_set' and version = 6;
  if (select status from public.triage_rule_sets where code = 'zz_guard_set' and version = 6) <> 'approved' then raise exception 'FAIL 9: approving a newer version must work'; end if;

  -- SABOTAGE 1: a second difference in v3 must be caught by the "only the silence line differs" check
  update public.triage_rule_sets set rules = jsonb_set(rules, '{params,severe,systolic}', '170'::jsonb) where id = v3row.id;
  select rules into v3 from public.triage_rule_sets where id = v3row.id;
  if ((v3 #- '{params,silence,days}') - 'version') is not distinct from ((v2 #- '{params,silence,days}') - 'version') then
    raise exception 'VACUOUS TEST: a second difference in v3 was not caught';
  end if;

  -- SABOTAGE 2: drop the guard; the roll-back must then go through (proves FAIL 8 would have caught it)
  drop trigger triage_rule_sets_never_approve_older on public.triage_rule_sets;
  update public.triage_rule_sets set status = 'retired' where code = 'zz_guard_set' and status = 'approved';
  update public.triage_rule_sets set status = 'approved', approved_by = v_cmo, approved_at = now() where id = v_older;
  if (select status from public.triage_rule_sets where id = v_older) <> 'approved' then
    raise exception 'VACUOUS TEST: with the guard dropped the roll-back was still refused';
  end if;
  raise notice 'S11i proof: all checks passed, both sabotages caught';
end $$;

rollback;
