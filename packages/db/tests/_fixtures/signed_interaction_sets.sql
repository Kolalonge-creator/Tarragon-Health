-- Fixture, included with \ir by proofs that sign a prescription (T2-11b, 2026-11-05).
-- Signing now fails closed unless a SIGNED interaction dataset and an active SIGNED ingredient rule set exist (both are signed live,
-- 2026-11-03, by the CMO). A fresh local replay has neither, so these proofs sign them INSIDE their own transaction (they all end in
-- rollback) with a throwaway signer. It does nothing when both are already signed. This is a test fixture, never a real signature.
do $$
declare v_p uuid; v_cs uuid; v_org uuid;
begin
  if private.signed_interaction_dataset_version() is not null and private.signed_interaction_rule_set() is not null then
    return;
  end if;
  select id into v_org from public.organisations order by created_at limit 1;
  v_p := gen_random_uuid();
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_p, 'interaction-fixture-' || substr(v_p::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test) values (v_p, v_org, 'clinician', 'Interaction fixture signer', true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name, is_test = true;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, doctor_tier, active)
  values (v_org, v_p, 'Interaction fixture signer', 'senior_medical_officer', false) returning id into v_cs;
  if private.signed_interaction_dataset_version() is null then
    perform set_config('tarragon.sign_dataset', 'on', true);
    update public.interaction_dataset_versions
       set status = 'approved', signed_by = v_p, signed_at = now(), sign_note = 'proof fixture, rolled back'
     where version = (select max(version) from public.interaction_dataset_versions where status = 'draft');
    perform set_config('tarragon.sign_dataset', 'off', true);
  end if;
  if private.signed_interaction_rule_set() is null then
    update public.medicine_interaction_rule_sets set is_active = false where is_active;
    update public.medicine_interaction_rule_sets set approved_by = v_cs, approved_at = now(), is_active = true
     where id = (select id from public.medicine_interaction_rule_sets where jsonb_array_length(config -> 'rules') > 0 order by version desc limit 1);
  end if;
  if private.signed_interaction_dataset_version() is null or private.signed_interaction_rule_set() is null then
    raise exception 'fixture: could not put a signed interaction dataset and rule set in place';
  end if;
end $$;
