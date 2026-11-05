-- Proof: the seat-invite pre-flight checks (migration *_seat_invite_preflight_checks.sql, security audit 2026-11-05 H-1).
--   1. Neither function is executable by anon.
--   2. A patient session gets false from both; no session gets false.
--   3. An admin session gets true from can_manage_provider_org_seats (private.is_admin()).
--   4. SABOTAGE: with the "auth.uid() is not null" guard and the authority check replaced by a bare true, the patient check flips.
begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table ids(k text primary key, v uuid) on commit drop;
grant all on ids to public;

do $$
declare v_org uuid; v_patient uuid := gen_random_uuid(); v_admin uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_patient, 'sip-patient-' || v_patient || '@example.invalid', 'x', now(), '{}', '{}'),
         (v_admin,   'sip-admin-'   || v_admin   || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v_patient, v_org, 'patient', 'SIP patient', true), (v_admin, v_org, 'admin', 'SIP admin', true)
  on conflict (id) do update set role = excluded.role, organisation_id = excluded.organisation_id, is_test = true, is_active = true;
  insert into ids values ('patient', v_patient), ('admin', v_admin);
end $$;

insert into results values
  ('anon cannot execute can_manage_payer_seats', 'false', has_function_privilege('anon', 'public.can_manage_payer_seats(uuid)', 'EXECUTE')::text),
  ('anon cannot execute can_manage_provider_org_seats', 'false', has_function_privilege('anon', 'public.can_manage_provider_org_seats(uuid)', 'EXECUTE')::text),
  ('no session: payer', 'false', public.can_manage_payer_seats(gen_random_uuid())::text);

select set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k = 'patient'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into results values
  ('patient: payer seats', 'false', public.can_manage_payer_seats(gen_random_uuid())::text),
  ('patient: provider-org seats', 'false', public.can_manage_provider_org_seats(gen_random_uuid())::text);
reset role;

select set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into results values ('admin: provider-org seats', 'true', public.can_manage_provider_org_seats(gen_random_uuid())::text);
reset role;

-- SABOTAGE
create or replace function public.can_manage_payer_seats(p_insurer_id uuid) returns boolean
language sql stable security definer set search_path to '' as $$ select true $$;
select set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k = 'patient'), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into results values ('SABOTAGE: without the authority check a patient passes', 'true', public.can_manage_payer_seats(gen_random_uuid())::text);
reset role;
select set_config('request.jwt.claims', null, true);

select check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as outcome from results;

do $$
declare v_fail text;
begin
  select string_agg(check_name || ' (expected ' || expected || ', got ' || coalesce(actual, 'null') || ')', '; ') into v_fail
  from results where expected is distinct from actual;
  if v_fail is not null then raise exception 'seat_invite_preflight_checks FAILED: %', v_fail; end if;
  if (select count(*) from results) <> 7 then raise exception 'seat_invite_preflight_checks: expected 7 checks'; end if;
end $$;

rollback;
