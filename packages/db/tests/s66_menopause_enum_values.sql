-- Proof: S66 menopause symptom types. The two new values exist and can be logged (this runs after the enum migration has committed, as a
-- replay does; it cannot run in the same transaction that adds the values). SABOTAGE: a value that is not in the enum is refused.
begin;
do $$
declare v_org uuid; v_pat uuid := gen_random_uuid(); v_failed boolean := false; v_n integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values (v_pat, 's66m-pat@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, is_test) values (v_pat, v_org, 'patient', 'S66M Patient', '+2348066000011', true) on conflict (id) do update set role = 'patient';
  if not ('irregular_bleeding' = any (enum_range(null::public.menopause_symptom_type)::text[])) or not ('vaginal_discomfort' = any (enum_range(null::public.menopause_symptom_type)::text[])) then
    raise exception 'FAIL: the new menopause symptom types are missing';
  end if;
  insert into public.menopause_symptom_logs (organisation_id, patient_id, symptom_types)
  values (v_org, v_pat, array['irregular_bleeding', 'vaginal_discomfort', 'hot_flashes']::public.menopause_symptom_type[]);
  select count(*) into v_n from public.menopause_symptom_logs where patient_id = v_pat and 'irregular_bleeding' = any (symptom_types);
  if v_n <> 1 then raise exception 'FAIL: the new types were not stored'; end if;
  begin
    insert into public.menopause_symptom_logs (organisation_id, patient_id, symptom_types) values (v_org, v_pat, array['not_a_symptom']::public.menopause_symptom_type[]);
  exception when invalid_text_representation then v_failed := true; end;
  if not v_failed then raise exception 'SABOTAGE did not flip: an unknown symptom type was accepted'; end if;
  raise notice 'PASS: S66 menopause symptom types';
end $$;
rollback;
