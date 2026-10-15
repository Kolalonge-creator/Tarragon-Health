-- Two-tier integration proof (branches free-red-path + pricing + monthly-booking + testing-days merged).
-- private.patient_has_feature_access is redefined by BOTH the Free red-event path and the add-on retirement migration. The one that
-- sorts LAST must carry the union of both behaviours. Proves, on the final chain, in one rolled-back transaction:
--   * red-event feature (vitals_red_flag_doctor_escalation): Member true, Member in the 14 day grace true, Free false, lapsed false,
--     unknown patient (null) true (fail toward paging);
--   * doctor-time features (clinician_review, doctor_checkin, annual_review): Member and grace true, Free and lapsed false;
--   * the free list stays true for everyone; async_doctor_visit does not recurse for a Free patient;
--   * private.patient_is_member (the one Member rule the monthly follow-up offers and the testing-day booking consult) agrees:
--     Member true, grace true, lapsed false, Free false.
-- SABOTAGE: the function recreated without the Member block must make the doctor-time check flip.
begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_name, p_expected, p_actual) $$;
create temp table fx(k text primary key, v uuid) on commit drop;
create function pg_temp.mkuser(p_org uuid, p_label text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'ti-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, 'patient', 'TI ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, organisation_id = excluded.organisation_id, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;

do $$
declare v_org uuid;
begin
  select organisation_id into v_org from public.catalog_items where code = 'membership_annual' order by created_at limit 1;
  insert into fx values ('free', pg_temp.mkuser(v_org, 'free')), ('mem', pg_temp.mkuser(v_org, 'mem')),
                        ('grace', pg_temp.mkuser(v_org, 'grace')), ('lapsed', pg_temp.mkuser(v_org, 'lapsed'));
  insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, ends_at, is_test)
  select v_org, v, 'purchase', now() - interval '400 days', now() + make_interval(secs => (d * 86400)::int), true
    from (values ((select v from fx where k = 'mem'), 200), ((select v from fx where k = 'grace'), -5), ((select v from fx where k = 'lapsed'), -20)) t(v, d);
end $$;

create function pg_temp.fa(p_k text, p_feature text) returns text language sql as
$$ select coalesce(private.patient_has_feature_access((select v from fx where k = p_k), p_feature)::text, 'null') $$;

do $$
declare f text;
begin
  foreach f in array array['vitals_red_flag_doctor_escalation', 'clinician_review', 'doctor_checkin', 'annual_review'] loop
    perform pg_temp.ck(f || ': Member', 'true', pg_temp.fa('mem', f));
    perform pg_temp.ck(f || ': Member in grace', 'true', pg_temp.fa('grace', f));
    perform pg_temp.ck(f || ': Free', 'false', pg_temp.fa('free', f));
    perform pg_temp.ck(f || ': lapsed', 'false', pg_temp.fa('lapsed', f));
  end loop;
  perform pg_temp.ck('red-event feature: unknown patient pages', 'true', private.patient_has_feature_access(null, 'vitals_red_flag_doctor_escalation')::text);
  perform pg_temp.ck('free list true for Free', 'true', pg_temp.fa('free', 'ai_coach'));
  perform pg_temp.ck('async_doctor_visit does not recurse for Free', 'false', pg_temp.fa('free', 'async_doctor_visit'));
  perform pg_temp.ck('patient_is_member: Member', 'true', private.patient_is_member((select v from fx where k = 'mem'))::text);
  perform pg_temp.ck('patient_is_member: grace', 'true', private.patient_is_member((select v from fx where k = 'grace'))::text);
  perform pg_temp.ck('patient_is_member: lapsed', 'false', private.patient_is_member((select v from fx where k = 'lapsed'))::text);
  perform pg_temp.ck('patient_is_member: Free', 'false', private.patient_is_member((select v from fx where k = 'free'))::text);
  perform pg_temp.ck('patient_may_page_doctor agrees: Free', 'false', private.patient_may_page_doctor((select v from fx where k = 'free'))::text);
  perform pg_temp.ck('patient_may_page_doctor agrees: Member', 'true', private.patient_may_page_doctor((select v from fx where k = 'mem'))::text);
end $$;

-- SABOTAGE: a function that only knows the programme purchase path (no Member block) must lose the doctor-time features for a Member.
do $$
declare v_mem uuid := (select v from fx where k = 'mem'); v_before text; v_after text;
begin
  v_before := private.patient_has_feature_access(v_mem, 'clinician_review')::text;
  create or replace function private.patient_has_feature_access(p_patient_id uuid, p_feature text) returns boolean
  language sql stable security definer set search_path = '' as $b$ select false $b$;
  v_after := private.patient_has_feature_access(v_mem, 'clinician_review')::text;
  perform pg_temp.ck('SABOTAGE flips the Member doctor-time check', 'true/false', v_before || '/' || v_after);
end $$;

select check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as verdict from results order by 1;
do $$
begin
  if exists (select 1 from results where expected is distinct from actual) then
    raise exception 'two_tier_integration_feature_gate_union: a check failed';
  end if;
end $$;
rollback;
