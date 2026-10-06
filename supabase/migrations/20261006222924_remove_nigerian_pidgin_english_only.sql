-- Remove Nigerian Pidgin ('pcm'): the product is English-only (founder decision 2026-10-06, reverses D-13).
--
-- Why: an unreviewed clinical translation is a patient-safety risk. Counts on the live project at writing
-- (2026-10-06): 0 profiles with language 'pcm', and 0 'pcm' rows in patient_result_explanations,
-- notification_template_locales, health_education_translations, scribe_consents, scribe_transcripts,
-- clinical_encounter_notes.patient_summary_language and clinical_staff.languages. So there is no conversion step:
-- this migration asserts the zero counts and aborts if any row has appeared since, then narrows the CHECKs.
--
-- Removes the VALUE from every CHECK that allowed it (not just the app path), so the feature cannot grow back
-- through an unreachable member. Yoruba, Hausa and Igbo members of the reminder / explanation / education /
-- template-locale lists are deliberately left alone. The platform_switches table and its functions stay (a general
-- mechanism); only the 'pidgin_language' row goes.
--
-- Already-applied migrations are not edited. Never apply with a hand-typed timestamp.

begin;

do $$
declare
  v_n bigint;
begin
  select count(*) into v_n from public.profiles where language = 'pcm';
  if v_n <> 0 then raise exception 'profiles has % rows with language pcm; convert them before removing Pidgin', v_n; end if;
  select count(*) into v_n from public.patient_result_explanations where language = 'pcm';
  if v_n <> 0 then raise exception 'patient_result_explanations has % pcm rows', v_n; end if;
  select count(*) into v_n from public.notification_template_locales where locale = 'pcm';
  if v_n <> 0 then raise exception 'notification_template_locales has % pcm rows', v_n; end if;
  select count(*) into v_n from public.health_education_translations where language = 'pcm';
  if v_n <> 0 then raise exception 'health_education_translations has % pcm rows', v_n; end if;
  select count(*) into v_n from public.scribe_consents where language = 'pcm';
  if v_n <> 0 then raise exception 'scribe_consents has % pcm rows', v_n; end if;
  select count(*) into v_n from public.scribe_transcripts where language = 'pcm';
  if v_n <> 0 then raise exception 'scribe_transcripts has % pcm rows', v_n; end if;
  select count(*) into v_n from public.clinical_encounter_notes where patient_summary_language = 'pcm';
  if v_n <> 0 then raise exception 'clinical_encounter_notes has % pcm summaries', v_n; end if;
end $$;

-- Replace each CHECK that mentions 'pcm' on the given column with a named one that does not.
create function pg_temp.narrow_check(p_table regclass, p_column text, p_new_name text, p_expr text)
returns void language plpgsql as $f$
declare
  r record;
begin
  for r in
    select c.conname from pg_constraint c
    where c.conrelid = p_table and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%pcm%'
      and pg_get_constraintdef(c.oid) like '%' || p_column || '%'
  loop
    execute format('alter table %s drop constraint %I', p_table, r.conname);
  end loop;
  execute format('alter table %s add constraint %I check (%s)', p_table, p_new_name, p_expr);
end $f$;

select pg_temp.narrow_check('public.profiles', 'language', 'profiles_language_check', $$language in ('en')$$);
select pg_temp.narrow_check('public.patient_result_explanations', 'language', 'patient_result_explanations_language_check', $$language in ('en', 'yo', 'ha', 'ig')$$);
select pg_temp.narrow_check('public.notification_template_locales', 'locale', 'notification_template_locales_locale_check', $$locale in ('en', 'yo', 'ha', 'ig')$$);
select pg_temp.narrow_check('public.health_education_translations', 'language', 'health_education_translations_language_check', $$language in ('yo', 'ha', 'ig')$$);
select pg_temp.narrow_check('public.scribe_consents', 'language', 'scribe_consents_language_check', $$language in ('en-NG')$$);
select pg_temp.narrow_check('public.scribe_transcripts', 'language', 'scribe_transcripts_language_check', $$language in ('en-NG')$$);
select pg_temp.narrow_check('public.clinical_encounter_notes', 'patient_summary_language', 'clinical_encounter_notes_patient_summary_language_check', $$patient_summary_language in ('en-NG')$$);

comment on column public.profiles.language is
  'Interface language for the patient app: en only. Nigerian Pidgin was removed 2026-10-06 (founder decision, English only).';

delete from public.platform_switches where key = 'pidgin_language';

-- The AI-017 scribe suite carried a case that only made sense for a Pidgin summary (live: 0 recorded results, so
-- no audit history is lost). The runner iterates every case in the suite and needs a fixture for each, so it goes.
-- The AI-003 'pidgin_language_fidelity' case is deliberately kept: it has one recorded (failed) result, and recorded
-- evaluation history is never deleted; the runner for that suite does not iterate DB cases.
delete from public.ai_evaluation_cases c
 where c.case_code = 'pidgin_summary_in_pidgin'
   and not exists (select 1 from public.ai_evaluation_case_results r where r.case_id = c.id);

do $$
declare
  v_def text;
  t record;
begin
  -- no CHECK on any of these tables still allows pcm
  for t in
    select unnest(array['profiles','patient_result_explanations','notification_template_locales','health_education_translations',
                        'scribe_consents','scribe_transcripts','clinical_encounter_notes']) as name
  loop
    for v_def in
      select pg_get_constraintdef(c.oid) from pg_constraint c
      where c.conrelid = ('public.' || t.name)::regclass and c.contype = 'c'
    loop
      if v_def like '%pcm%' then raise exception 'FAIL: % still has a CHECK allowing pcm: %', t.name, v_def; end if;
    end loop;
  end loop;

  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.profiles'::regclass and conname = 'profiles_language_check';
  if v_def is null or v_def not like '%en%' then raise exception 'FAIL: profiles_language_check missing or wrong: %', v_def; end if;

  if exists (select 1 from public.platform_switches where key = 'pidgin_language') then
    raise exception 'FAIL: pidgin_language switch still present';
  end if;
  if exists (select 1 from public.ai_evaluation_cases where case_code = 'pidgin_summary_in_pidgin') then
    raise exception 'FAIL: the Pidgin scribe eval case is still present';
  end if;
  if exists (select 1 from public.profiles where language <> 'en') then
    raise exception 'FAIL: a profile holds a non-English language';
  end if;
end $$;

commit;
