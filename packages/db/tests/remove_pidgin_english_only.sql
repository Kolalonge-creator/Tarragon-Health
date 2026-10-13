-- ===========================================================================
-- Proof: English-only languages (migration 20261006222924_remove_nigerian_pidgin_english_only).
--   1. profiles.language accepts 'en' and rejects 'pcm', 'yo', 'ha', 'ig' and any other value.
--   2. No language/locale CHECK on patient_result_explanations, notification_template_locales,
--      health_education_translations or the scribe tables allows a non-English code, and the scribe CHECKs still accept 'en-NG'.
--   3. The 'pidgin_language' platform switch is gone and an unknown key still reads false.
--   4. SABOTAGE: a scratch table carrying the OLD expression ('en','pcm') accepts 'pcm' and 'yo', proving the probe can fail.
-- BEGIN/ROLLBACK; no fixtures survive.
-- ===========================================================================
begin;

do $$
declare
  v_def text;
  v_org uuid;
  v_id uuid := gen_random_uuid();
  v_rejected boolean;
begin
  -- 1. profiles: pcm rejected by the live constraint, en accepted by it.
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.profiles'::regclass and conname = 'profiles_language_check';
  if v_def is null or v_def like '%pcm%' then raise exception 'FAIL 1a: profiles_language_check missing or still allows pcm: %', v_def; end if;

  select id into v_org from public.organisations limit 1;
  insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pidgin-proof-' || v_id || '@tarragon.test', '{}', '{}', now(), now());
  -- the signup trigger (if any) makes the profile row; make sure one exists
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v_id, v_org, 'patient', 'Pidgin proof', true) on conflict (id) do nothing;

  update public.profiles set language = 'en' where id = v_id;  -- en accepted

  v_rejected := false;
  begin update public.profiles set language = 'pcm' where id = v_id;
  exception when check_violation then v_rejected := true; end;
  if not v_rejected then raise exception 'FAIL 1b: profiles.language accepted pcm'; end if;

  v_rejected := false;
  begin update public.profiles set language = 'fr' where id = v_id;
  exception when check_violation then v_rejected := true; end;
  if not v_rejected then raise exception 'FAIL 1c: profiles.language accepted fr'; end if;

  -- 1d. the other language codes are rejected too
  foreach v_def in array array['yo', 'ha', 'ig'] loop
    v_rejected := false;
    begin execute format('update public.profiles set language = %L where id = %L', v_def, v_id);
    exception when check_violation then v_rejected := true; end;
    if not v_rejected then raise exception 'FAIL 1d: profiles.language accepted %', v_def; end if;
  end loop;

  -- 2. every other language CHECK is English only
  for v_def in
    select c.conrelid::regclass::text || ': ' || pg_get_constraintdef(c.oid) from pg_constraint c
    where c.contype = 'c'
      and c.conrelid in ('public.patient_result_explanations'::regclass, 'public.notification_template_locales'::regclass,
                         'public.health_education_translations'::regclass)
      and pg_get_constraintdef(c.oid) ~ '''en'''
  loop
    if v_def ~ '''(pcm|yo|ha|ig)''' then raise exception 'FAIL 2c: a CHECK still allows a non-English code: %', v_def; end if;
  end loop;

  -- 2. scribe language columns
  for v_def in
    select pg_get_constraintdef(c.oid) from pg_constraint c
    where c.contype = 'c' and c.conrelid in ('public.scribe_consents'::regclass, 'public.scribe_transcripts'::regclass, 'public.clinical_encounter_notes'::regclass)
      and pg_get_constraintdef(c.oid) like '%en-NG%'
  loop
    if v_def like '%pcm%' then raise exception 'FAIL 2a: a scribe CHECK still allows pcm: %', v_def; end if;
  end loop;
  if (select count(*) from pg_constraint c where c.contype = 'c'
        and c.conrelid in ('public.scribe_consents'::regclass, 'public.scribe_transcripts'::regclass, 'public.clinical_encounter_notes'::regclass)
        and pg_get_constraintdef(c.oid) like '%en-NG%') < 3 then
    raise exception 'FAIL 2b: expected three en-NG language CHECKs';
  end if;

  -- 3. the switch is gone and an unknown key reads false
  if exists (select 1 from public.platform_switches where key = 'pidgin_language') then raise exception 'FAIL 3a: pidgin_language switch still present'; end if;
  if public.platform_switch_is_on('pidgin_language') then raise exception 'FAIL 3b: removed switch reads true'; end if;

  -- 4. sabotage: the old expression accepts pcm, so the probe above is capable of failing
  create temp table _old_language (language text check (language in ('en', 'pcm', 'yo', 'ha', 'ig'))) on commit drop;
  insert into _old_language values ('pcm'), ('yo');
  if (select count(*) from _old_language) <> 2 then raise exception 'FAIL 4: sabotage control did not accept the old codes'; end if;

  raise notice 'PASS: remove_pidgin_english_only';
end $$;

rollback;
