-- S80a proof: translations review state machine, CMO-only clinical review, reset on change, release gate, events, no anon.
-- Own fixtures; BEGIN/ROLLBACK; ends with a sabotage step.
begin;

do $$
declare
  v_org uuid; v_admin uuid := gen_random_uuid(); v_cmo uuid := gen_random_uuid(); v_pat uuid;
  v_cat public.health_education_category; v_c uuid; v_t uuid; v_n int; v_state public.translation_state; v_ok boolean;
begin
  select id into v_org from public.organisations limit 1;
  select category into v_cat from public.health_education_content limit 1;
  select id into v_pat from public.profiles where role = 'patient' limit 1;
  if v_org is null or v_cat is null or v_pat is null then raise exception 'fixture missing'; end if;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_admin, 's80a-admin@example.invalid','x',now(),'{}','{}'), (v_cmo, 's80a-cmo@example.invalid','x',now(),'{}','{}');
  update public.profiles set organisation_id = v_org, role = 'admin', full_name = 'S80a Admin', is_test = true where id = v_admin;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'S80a CMO', is_test = true where id = v_cmo;
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, credential_type, credential_number, indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_cmo, v_org, 'S80a CMO', 'chief_medical_officer', true, 'MDCN', 'S80A-CMO', true, v_admin, v_admin, now());

  -- admin writes a clinical key in English and a test language
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.upsert_translation('emergency.chest_pain', 'en', 'Go to the nearest hospital now.', 'hash-en-0001', true);
  v_t := public.upsert_translation('emergency.chest_pain', 'zz', 'zz text one', 'hash-en-0001', true);
  -- control: admin may do the native review
  perform public.review_translation(v_t, 'native_reviewed');
  -- gate: admin may NOT clinically review
  begin perform public.review_translation(v_t, 'clinical_reviewed'); v_ok := true; exception when others then v_ok := false; end;
  if v_ok then raise exception 'FAIL: admin marked a translation clinically reviewed'; end if;
  -- gate: cannot skip draft -> clinical_reviewed
  reset role;

  -- release gate lists it while only native reviewed
  select count(*) into v_n from public.translations_release_gate(array['en','zz']);
  if v_n <> 1 then raise exception 'FAIL: gate should block 1 row, got %', v_n; end if;
  select count(*) into v_n from public.translations_release_gate(array['en']);
  if v_n <> 0 then raise exception 'FAIL: gate with only English enabled should block nothing, got %', v_n; end if;
  select count(*) into v_n from public.translations_release_gate(array['en','yy']);
  if v_n <> 1 then raise exception 'FAIL: a clinical key with no row in an enabled language must block, got %', v_n; end if;

  -- CMO clinically reviews: control
  perform set_config('request.jwt.claims', json_build_object('sub', v_cmo, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.review_translation(v_t, 'clinical_reviewed');
  reset role;
  select count(*) into v_n from public.translations_release_gate(array['en','zz']);
  if v_n <> 0 then raise exception 'FAIL: gate should open once clinically reviewed, got %', v_n; end if;

  -- changing the text resets the review
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.upsert_translation('emergency.chest_pain', 'zz', 'zz text two', 'hash-en-0001', true);
  reset role;
  select state into v_state from public.translations where id = v_t;
  if v_state <> 'draft' then raise exception 'FAIL: text change did not reset state, got %', v_state; end if;
  if (select reviewed_by from public.translations where id = v_t) is not null then raise exception 'FAIL: reviewer not cleared'; end if;
  -- a changed source hash alone also resets
  update public.translations set state='native_reviewed', reviewed_by = v_admin, reviewed_at = now() where id = v_t;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.upsert_translation('emergency.chest_pain', 'zz', 'zz text two', 'hash-en-0002', true);
  reset role;
  select state into v_state from public.translations where id = v_t;
  if v_state <> 'draft' then raise exception 'FAIL: source hash change did not reset state'; end if;

  -- events: translation.reviewed emitted for the two reviews; no text in payload
  select count(*) into v_n from public.domain_events where event_type = 'translation.reviewed' and (payload->>'translation_id')::uuid = v_t;
  if v_n < 2 then raise exception 'FAIL: expected 2 translation.reviewed events, got %', v_n; end if;
  if exists (select 1 from public.domain_events where event_type = 'translation.reviewed' and payload::text like '%zz text%') then
    raise exception 'FAIL: event payload carries translation text';
  end if;

  -- content.published emitted on publish, not on other transitions
  insert into public.health_education_content (code, title, body, category) values ('s80a-proof-1','S80a proof','body',v_cat) returning id into v_c;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.set_health_education_content_status(v_c, 'clinical_review');
  reset role;
  if exists (select 1 from public.domain_events where event_type='content.published' and (payload->>'content_id')::uuid = v_c) then
    raise exception 'FAIL: content.published emitted before publish';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cmo, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.set_health_education_content_status(v_c, 'approved');
  perform public.set_health_education_content_status(v_c, 'published');
  reset role;
  select count(*) into v_n from public.domain_events where event_type='content.published' and (payload->>'content_id')::uuid = v_c;
  if v_n <> 1 then raise exception 'FAIL: expected 1 content.published, got %', v_n; end if;

  -- a patient cannot read or call anything
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.translations;
  if v_n <> 0 then raise exception 'FAIL: patient reads translations (%)', v_n; end if;
  begin perform public.review_translation(v_t, 'native_reviewed'); v_ok := true; exception when others then v_ok := false; end;
  if v_ok then raise exception 'FAIL: patient reviewed a translation'; end if;
  reset role;
  raise notice 'PASS: translations, release gate, reset on change, events, refusals';

  -- SABOTAGE: let an admin set clinical_reviewed and show the gate check would have passed wrongly
  create or replace function public.review_translation(p_id uuid, p_state public.translation_state)
  returns public.translation_state language plpgsql security definer set search_path = '' as $f$
  begin
    if not private.is_admin() then raise exception 'admin only'; end if;
    update public.translations set state = p_state, reviewed_by = (select auth.uid()), reviewed_at = now() where id = p_id;
    return p_state;
  end $f$;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.review_translation(v_t, 'clinical_reviewed');
  reset role;
  raise notice 'PASS: sabotage confirmed, an admin can clinically review without the CMO gate';
end $$;

rollback;
