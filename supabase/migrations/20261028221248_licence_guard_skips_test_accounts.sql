-- The credentialing activation guard refused to switch on "a missing licence date counts as ineligible" while ANY active clinician had no licence
-- expiry date, including the synthetic clinician the chain canary (p1_chain_canary) creates and runs against every few minutes. That account is
-- is_test, never sees a real patient, and has no licence to record, so it blocked the Chief Medical Officer's signature on credentialing
-- configuration version 6 for good (found 2026-10-28: "record the licence expiry date of 2 active clinician(s)", one of them the canary).
--
-- Test clinicians are already exempt from the gate elsewhere (OQ-350: a test clinician is never labelled verification_missing; INV-13: test rows
-- are left out of every report), so the guard now counts only real clinicians. Redefined from the LIVE body (checked 2026-10-28), changing only the
-- is_test filter. The real clinician with no date still blocks, as intended.
--
-- Second half, found in review: once credentialing v6 is active, the eligibility functions (credentialing_config 'missing_licence_date_ineligible')
-- also make a clinician with no licence date INELIGIBLE, test or not, so the canary's synthetic clinician would drop off its synthetic rota and the
-- chain canary would start failing the moment the CMO signs. The canary clinician therefore gets a licence expiry (10 years out, synthetic, is_test),
-- and private.chain_canary_ensure() sets one on any future re-creation. Redefined from the LIVE body (which carries an advisory lock the original
-- migration file lacks), changing only the clinical_staff insert. Rows affected: the one canary clinician (is_test).

create or replace function private.guard_credentialing_activation() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  if coalesce((new.rules ->> 'missing_licence_date_ineligible')::boolean, false) then
    select count(*) into v_n from public.clinical_staff
     where active and status = 'active' and profile_id is not null and license_expires_at is null and not coalesce(is_test, false);
    if v_n > 0 then
      raise exception 'record the licence expiry date of % active clinician(s) before a missing date counts as ineligible', v_n using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_credentialing_activation() from public, anon, authenticated;

do $$
begin
  if position('is_test' in pg_get_functiondef('private.guard_credentialing_activation()'::regprocedure)) = 0 then
    raise exception 'guard_credentialing_activation must skip test clinicians';
  end if;
  if has_function_privilege('anon', 'private.guard_credentialing_activation()', 'EXECUTE') or has_function_privilege('authenticated', 'private.guard_credentialing_activation()', 'EXECUTE') then
    raise exception 'guard_credentialing_activation must stay closed to anon and authenticated';
  end if;
end $$;

create or replace function private.chain_canary_ensure() returns public.chain_canary_subjects
language plpgsql security definer set search_path = ''
as $$
declare
  s public.chain_canary_subjects;
  v_org uuid; v_pat uuid; v_doc uuid; v_adm uuid;
begin
  select * into s from public.chain_canary_subjects;
  if found then return s; end if;
  perform pg_advisory_xact_lock(hashtext('chain_canary_ensure'));
  select * into s from public.chain_canary_subjects;
  if found then return s; end if;

  insert into public.organisations (name, type, metadata) values ('Tarragon canary (synthetic, no real people)', 'direct_consumer', '{"canary": true}'::jsonb)
    returning id into v_org;

  v_adm := gen_random_uuid(); v_pat := gen_random_uuid(); v_doc := gen_random_uuid();
  -- organisation and role travel in the metadata so private.handle_new_user creates each profile directly in the synthetic organisation with the
  -- right role (without them it files a patient in the real default organisation). Unconfirmed on purpose: a confirmed account triggers a programme claim.
  insert into auth.users (id, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
  values (v_adm, 'canary-admin-' || v_adm || '@example.invalid', 'x', jsonb_build_object('organisation_id', v_org, 'role', 'admin'), '{"full_name": "Canary admin"}'),
         (v_pat, 'canary-patient-' || v_pat || '@example.invalid', 'x', jsonb_build_object('organisation_id', v_org, 'role', 'patient'), '{"full_name": "Canary patient"}'),
         (v_doc, 'canary-clinician-' || v_doc || '@example.invalid', 'x', jsonb_build_object('organisation_id', v_org, 'role', 'clinician'), '{"full_name": "Canary clinician"}');
  update public.profiles set is_test = true, is_active = true, language = 'en', date_of_birth = (current_date - interval '45 years')::date
   where id in (v_adm, v_pat, v_doc);

  -- A Member: a red event pages only a Member (two-tier model), and doctor tasks are for Members.
  insert into public.patient_memberships (organisation_id, patient_id, source, state, is_test) values (v_org, v_pat, 'purchase', 'active', true);

  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, is_test)
  values (v_org, v_doc, 'Canary clinician', 'MDCN', 'CANARY-' || substr(v_doc::text, 1, 8), true, 'active',
      now(), now() + interval '10 years', v_adm, 'senior_medical_officer', 'employed', 2, false, true);

  insert into public.chain_canary_subjects (organisation_id, patient_id, clinician_id, admin_id) values (v_org, v_pat, v_doc, v_adm)
    returning * into s;
  return s;
end $$;
revoke all on function private.chain_canary_ensure() from public, anon, authenticated;

update public.clinical_staff cs set license_expires_at = now() + interval '10 years'
 where cs.is_test and cs.license_expires_at is null
   and cs.profile_id in (select clinician_id from public.chain_canary_subjects);

do $$
begin
  if exists (select 1 from public.clinical_staff cs join public.chain_canary_subjects c on c.clinician_id = cs.profile_id where cs.license_expires_at is null) then
    raise exception 'the canary clinician must have a licence expiry date';
  end if;
  if has_function_privilege('anon', 'private.chain_canary_ensure()', 'EXECUTE') or has_function_privilege('authenticated', 'private.chain_canary_ensure()', 'EXECUTE') then
    raise exception 'chain_canary_ensure must stay closed to anon and authenticated';
  end if;
end $$;
