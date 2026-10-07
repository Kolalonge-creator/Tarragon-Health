-- S42 proof: dependants (migration *_s42_dependants_handover_and_permissions.sql). One rolled-back transaction. Proves:
--   1. HAND-OVER AT 18: the sweep creates the row and emits dependant.handover_due once (a second run adds none); before completion a guardian can read the
--      young person's vitals (control: access existed); completion needs the young person's own login and the 18th birthday; completing ends every guardian
--      grant not chosen (that guardian then reads ZERO rows) and keeps the chosen one at view only (still reads); a second completion, a stranger, a guardian,
--      anon and an unknown guardian id are all refused; one completed event with counts and no names; the guardian sees the state, a stranger does not.
--   2. OQ-47: an elder_proxy manager no longer reaches the elder's reproductive health (control: still reaches vitals; opens again once the elder grants
--      that category); a minor child's guardian is unchanged.
--   3. OQ-51: confirm_proxy_setup writes permissions from the categories; changing categories keeps a restricted grant in step; an unrestricted grant
--      (permissions null) is never touched; no category maps to an acting permission.
--   4. The 03:30 job leaves an elder_proxy's manage grant alone.
--   SABOTAGE A: the reproductive exclusion removed, the elder's reproductive data must then be readable. SABOTAGE B: category_permissions returns nothing,
--   the proxy permissions check must then flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_dob date default null) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid(); v_phone text := '+23481' || lpad((random() * 99999999)::int::text, 8, '0');
begin
  insert into auth.users (id, email, phone, phone_confirmed_at, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's42-' || p_label || '-' || v || '@example.invalid', v_phone, now(), 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S42 ' || p_label || ' Person', v_phone, coalesce(p_dob, (current_date - interval '45 years')::date), true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, full_name = excluded.full_name, phone = excluded.phone, date_of_birth = excluded.date_of_birth;
  return v;
end $f$;
create function pg_temp.vitals_seen_by(p_uid uuid, p_patient uuid) returns text language sql as
$$ select pg_temp.q_as(p_uid, format('select count(*)::text from public.vitals_readings where patient_id = %L', p_patient)) $$;

do $$
declare
  v_org uuid; v_c uuid; v_g1 uuid; v_g2 uuid; v_x uuid; v_adm uuid; v_c2 uuid; v_e uuid; v_g3 uuid; v_m uuid; v_g4 uuid;
  v_pa uuid; v_px uuid; v_grant1 uuid; v_grant2 uuid; v_set uuid; v_n integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_adm := pg_temp.mkuser(v_org, 'adm', 'admin');
  v_g1 := pg_temp.mkuser(v_org, 'guardian-one', 'patient'); v_g2 := pg_temp.mkuser(v_org, 'guardian-two', 'patient'); v_x := pg_temp.mkuser(v_org, 'stranger', 'patient');
  -- C turns 18 in ten days: inside the 30-day window.
  v_c := pg_temp.mkuser(v_org, 'child', 'patient', (current_date - interval '18 years' + interval '10 days')::date);
  update public.profiles set is_dependent_account = true, dependent_kind = 'minor_child' where id = v_c;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v_c, v_g1, 'manage', v_g1), (v_c, v_g2, 'manage', v_g2);
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg) values (v_org, v_c, 'weight', 50);
  insert into fx values ('adm', v_adm), ('g1', v_g1), ('g2', v_g2), ('x', v_x), ('c', v_c);

  -- 1a. the sweep, 30 days before
  perform private.sweep_dependant_handovers();
  perform pg_temp.ck('sweep creates the hand-over row', '1|due', (select count(*)::text || '|' || min(state) from public.dependant_handovers where patient_id = v_c));
  perform pg_temp.ck('one handover_due event', '1', (select count(*)::text from public.domain_events where event_type = 'dependant.handover_due' and patient_id = v_c));
  perform private.sweep_dependant_handovers();
  perform pg_temp.ck('a second sweep adds no event', '1', (select count(*)::text from public.domain_events where event_type = 'dependant.handover_due' and patient_id = v_c));
  perform pg_temp.ck('event carries ids and a date only', 'false', (select (payload::text ilike '%S42%')::text from public.domain_events where event_type = 'dependant.handover_due' and patient_id = v_c));
  perform pg_temp.ck('a guardian sees the hand-over state', '1', pg_temp.q_as(v_g1, format('select count(*)::text from public.dependant_handovers where patient_id = %L', v_c)));
  perform pg_temp.ck('a stranger sees none', '0', pg_temp.q_as(v_x, format('select count(*)::text from public.dependant_handovers where patient_id = %L', v_c)));
  -- control: before hand-over a guardian can read the record
  perform pg_temp.ck('control: guardian one reads the child''s vitals before', '1', pg_temp.vitals_seen_by(v_g1, v_c));
  perform pg_temp.ck('control: guardian two reads the child''s vitals before', '1', pg_temp.vitals_seen_by(v_g2, v_c));

  -- 1b. the birthday: the 03:30 job steps manage down and keeps the row
  update public.profiles set date_of_birth = (current_date - interval '18 years' - interval '1 day')::date where id = v_c;
  -- ten days pass: the stored 18th birthday is the one the sweep computed, so it moves with the clock
  update public.dependant_handovers set birthday_18 = current_date - 1 where patient_id = v_c;
  perform private.refresh_dependent_transition_statuses();
  perform pg_temp.ck('at 18 the guardians are stepped down to view', 'view|view', (select string_agg(permission_level::text, '|' order by grantee_user_id) from public.profile_access where profile_id = v_c));
  perform pg_temp.ck('not yet the young person: a dependant record cannot complete', '23514', pg_temp.try_as(v_c, 'select public.complete_dependant_handover(''{}'')'));
  -- the parent claims a login for them (the existing claim flow flips these two columns)
  update public.profiles set is_dependent_account = false, dependent_kind = null where id = v_c;
  -- the young person chooses which guardians may keep looking: both are given a category first so access existed
  select id into v_grant1 from public.profile_access where profile_id = v_c and grantee_user_id = v_g1;
  select id into v_grant2 from public.profile_access where profile_id = v_c and grantee_user_id = v_g2;
  perform pg_temp.ck('young person grants guardian one vitals', 'ok', pg_temp.try_as(v_c, format($q$select public.set_care_access_categories(%L, array['vitals_readings']::public.care_access_category[])$q$, v_grant1)));
  perform pg_temp.ck('young person grants guardian two vitals', 'ok', pg_temp.try_as(v_c, format($q$select public.set_care_access_categories(%L, array['vitals_readings']::public.care_access_category[])$q$, v_grant2)));
  perform pg_temp.ck('control: guardian one can read before completion', '1', pg_temp.vitals_seen_by(v_g1, v_c));
  perform pg_temp.ck('control: guardian two can read before completion', '1', pg_temp.vitals_seen_by(v_g2, v_c));
  perform pg_temp.ck('my_handover shows it is pending with two guardians', 'true|2', pg_temp.q_as(v_c, $q$select (public.my_handover() ->> 'pending') || '|' || jsonb_array_length(public.my_handover() -> 'guardians')::text$q$));

  -- refusals
  perform pg_temp.ck('a stranger cannot complete', 'P0002', pg_temp.try_as(v_x, 'select public.complete_dependant_handover(''{}'')'));
  perform pg_temp.ck('a guardian cannot complete for them', 'P0002', pg_temp.try_as(v_g1, 'select public.complete_dependant_handover(''{}'')'));
  perform pg_temp.ck('anon cannot complete', '42501', pg_temp.try_anon('select public.complete_dependant_handover(''{}'')'));
  perform pg_temp.ck('an id that is not a guardian is refused', '22023', pg_temp.try_as(v_c, format('select public.complete_dependant_handover(array[%L]::uuid[])', v_x)));
  perform pg_temp.ck('nothing changed by the refusals', '2', (select count(*)::text from public.profile_access where profile_id = v_c));

  -- completion: keep guardian two only
  perform pg_temp.ck('young person completes, keeping guardian two', 'ok', pg_temp.try_as(v_c, format('select public.complete_dependant_handover(array[%L]::uuid[])', v_g2)));
  perform pg_temp.ck('guardian one lost access: zero rows', '0', pg_temp.vitals_seen_by(v_g1, v_c));
  perform pg_temp.ck('guardian one grant is gone', '0', (select count(*)::text from public.profile_access where profile_id = v_c and grantee_user_id = v_g1));
  perform pg_temp.ck('guardian two (consented) still reads', '1', pg_temp.vitals_seen_by(v_g2, v_c));
  perform pg_temp.ck('guardian two is view only', 'view', (select permission_level::text from public.profile_access where profile_id = v_c and grantee_user_id = v_g2));
  perform pg_temp.ck('hand-over recorded', 'completed|1', (select state || '|' || guardians_ended::text from public.dependant_handovers where patient_id = v_c));
  perform pg_temp.ck('completing twice is refused', 'P0002', pg_temp.try_as(v_c, 'select public.complete_dependant_handover(''{}'')'));
  perform pg_temp.ck('one completed event with counts', '1|false', (select count(*)::text || '|' || (bool_or(payload::text ilike '%S42%'))::text from public.domain_events where event_type = 'dependant.handover_completed' and patient_id = v_c));
  perform pg_temp.ck('audit row written', '1', (select count(*)::text from public.audit_log where action = 'dependant.handover_completed' and entity_id = v_c));

  -- before the birthday (a login of their own, but 17 and some): refused
  v_c2 := pg_temp.mkuser(v_org, 'child-two', 'patient', (current_date - interval '18 years' + interval '10 days')::date);
  insert into public.dependant_handovers (organisation_id, patient_id, birthday_18, is_test) values (v_org, v_c2, (current_date + 10), true);
  perform pg_temp.ck('before the 18th birthday completion is refused', '23514', pg_temp.try_as(v_c2, 'select public.complete_dependant_handover(''{}'')'));

  -- 2. OQ-47
  v_e := pg_temp.mkuser(v_org, 'elder', 'patient', (current_date - interval '75 years')::date);
  v_g3 := pg_temp.mkuser(v_org, 'elder-manager', 'patient');
  update public.profiles set is_dependent_account = true, dependent_kind = 'elder_proxy' where id = v_e;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v_e, v_g3, 'manage', v_g3);
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg) values (v_org, v_e, 'weight', 60);
  perform pg_temp.ck('control: elder manager reads vitals', '1', pg_temp.vitals_seen_by(v_g3, v_e));
  perform pg_temp.ck('elder manager does NOT read reproductive health', 'false', pg_temp.q_as(v_g3, format($q$select private.can_read_clinical(%L, 'reproductive_health'::public.care_access_category)::text$q$, v_e)));
  perform pg_temp.ck('elder manager still reads medical history', 'true', pg_temp.q_as(v_g3, format($q$select private.can_read_clinical(%L, 'medical_history'::public.care_access_category)::text$q$, v_e)));
  select id into v_set from public.profile_access where profile_id = v_e and grantee_user_id = v_g3;
  perform pg_temp.ck('the elder grants reproductive health explicitly', 'ok', pg_temp.try_as(v_e, format($q$select public.set_care_access_categories(%L, array['reproductive_health']::public.care_access_category[])$q$, v_set)));
  perform pg_temp.ck('control: the gate opens once granted', 'true', pg_temp.q_as(v_g3, format($q$select private.can_read_clinical(%L, 'reproductive_health'::public.care_access_category)::text$q$, v_e)));
  v_m := pg_temp.mkuser(v_org, 'minor', 'patient', (current_date - interval '8 years')::date);
  v_g4 := pg_temp.mkuser(v_org, 'minor-parent', 'patient');
  update public.profiles set is_dependent_account = true, dependent_kind = 'minor_child' where id = v_m;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v_m, v_g4, 'manage', v_g4);
  perform pg_temp.ck('a young child''s parent is unchanged', 'true', pg_temp.q_as(v_g4, format($q$select private.can_read_clinical(%L, 'reproductive_health'::public.care_access_category)::text$q$, v_m)));
  -- 4. the 03:30 job leaves the elder alone
  perform private.refresh_dependent_transition_statuses();
  perform pg_temp.ck('the daily job leaves an elder proxy at manage', 'manage', (select permission_level::text from public.profile_access where profile_id = v_e and grantee_user_id = v_g3));

  -- 3. OQ-51
  perform pg_temp.ck('mapping: view categories only', '{view_medication,view_results}',
    (select private.category_permissions(array['medications', 'labs_results', 'vitals_readings', 'reproductive_health']::public.care_access_category[])::text));
  perform pg_temp.ck('mapping never yields an acting permission', '0',
    (select count(*)::text from unnest(enum_range(null::public.care_access_category)) c, unnest(private.category_permissions(array[c])) p where p::text in ('book_appointments', 'manage_pharmacy', 'manage_payments', 'receive_alerts')));
  v_pa := pg_temp.mkuser(v_org, 'parent', 'patient'); v_px := pg_temp.mkuser(v_org, 'proxy', 'patient');
  insert into public.proxy_setups (organisation_id, created_by_profile_id, target_full_name, target_phone_e164, expires_at)
    select v_org, v_px, 'Parent', phone, now() + interval '2 days' from auth.users where id = v_pa returning id into v_set;
  perform pg_temp.ck('parent confirms with two categories', 'ok', pg_temp.try_as(v_pa, format($q$select public.confirm_proxy_setup(%L, array['medications','labs_results']::public.care_access_category[])$q$, v_set)));
  perform pg_temp.ck('permissions written from the categories', '{view_medication,view_results}', (select permissions::text from public.profile_access where profile_id = v_pa and grantee_user_id = v_px));
  select id into v_grant1 from public.profile_access where profile_id = v_pa and grantee_user_id = v_px;
  perform pg_temp.ck('parent adds a category', 'ok', pg_temp.try_as(v_pa, format($q$select public.set_care_access_categories(%L, array['medications','labs_results','messaging']::public.care_access_category[])$q$, v_grant1)));
  perform pg_temp.ck('permissions follow', '{view_medication,view_results,communicate_with_care_team}', (select permissions::text from public.profile_access where id = v_grant1));
  perform pg_temp.ck('parent removes everything', 'ok', pg_temp.try_as(v_pa, format($q$select public.set_care_access_categories(%L, array[]::public.care_access_category[])$q$, v_grant1)));
  perform pg_temp.ck('permissions empty again', '{}', (select permissions::text from public.profile_access where id = v_grant1));
  -- an unrestricted grant (permissions null) is never narrowed by a category change
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, permissions) values (v_pa, v_x, 'view', v_pa, null);
  select id into v_grant2 from public.profile_access where profile_id = v_pa and grantee_user_id = v_x;
  perform pg_temp.ck('owner adds a category to an unrestricted grant', 'ok', pg_temp.try_as(v_pa, format($q$select public.set_care_access_categories(%L, array['medications']::public.care_access_category[])$q$, v_grant2)));
  perform pg_temp.ck('unrestricted grant stays unrestricted', 'true', (select (permissions is null)::text from public.profile_access where id = v_grant2));
end $$;

-- SABOTAGE A: the reproductive exclusion is removed (the original two-argument function). The elder's reproductive data must then be readable.
create or replace function private.can_read_clinical(p_patient uuid, p_category public.care_access_category) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profile_access pa join public.profiles p on p.id = pa.profile_id
    where pa.profile_id = p_patient and pa.grantee_user_id = (select auth.uid()) and (pa.expires_at is null or pa.expires_at > now())
      and ((pa.permission_level = 'manage' and p.is_dependent_account)
           or exists (select 1 from public.profile_access_categories pac where pac.profile_access_id = pa.id and pac.category = p_category)));
$$;
do $$
declare v_org uuid; v_e uuid; v_g uuid; v_set uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_e := pg_temp.mkuser(v_org, 'sab-elder', 'patient', (current_date - interval '75 years')::date);
  v_g := pg_temp.mkuser(v_org, 'sab-manager', 'patient');
  update public.profiles set is_dependent_account = true, dependent_kind = 'elder_proxy' where id = v_e;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v_e, v_g, 'manage', v_g);
  insert into results values ('sabotaged', 'elder manager does not read reproductive health', 'false',
    pg_temp.q_as(v_g, format($q$select private.can_read_clinical(%L, 'reproductive_health'::public.care_access_category)::text$q$, v_e)));
end $$;

-- SABOTAGE B: the mapping returns nothing, so confirmation can no longer write the permissions the parent chose.
create or replace function private.category_permissions(p_categories public.care_access_category[]) returns public.caregiver_permission[]
language sql immutable set search_path = '' as $$ select '{}'::public.caregiver_permission[] $$;
do $$
declare v_org uuid; v_pa uuid; v_px uuid; v_set uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_pa := pg_temp.mkuser(v_org, 'sab-parent', 'patient'); v_px := pg_temp.mkuser(v_org, 'sab-proxy', 'patient');
  insert into public.proxy_setups (organisation_id, created_by_profile_id, target_full_name, target_phone_e164, expires_at)
    select v_org, v_px, 'Parent', phone, now() + interval '2 days' from auth.users where id = v_pa returning id into v_set;
  perform pg_temp.try_as(v_pa, format($q$select public.confirm_proxy_setup(%L, array['medications']::public.care_access_category[])$q$, v_set));
  insert into results values ('sabotaged', 'permissions written from the categories', '{view_medication}',
    (select permissions::text from public.profile_access where profile_id = v_pa and grantee_user_id = v_px));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S42 dependants proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;
