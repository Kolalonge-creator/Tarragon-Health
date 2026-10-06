-- English only: remove Nigerian Pidgin ('pcm') and every other non-English language (Yoruba, Hausa, Igbo)
-- (founder decisions 2026-10-06; reverses D-13, see D-14 in docs/DECISIONS.md).
--
-- Why: an unreviewed clinical translation is a patient-safety risk.
-- Live counts read 2026-10-06 (read-only): 0 non-English rows in profiles.language (12 'en'),
-- patient_result_explanations.language, notification_template_locales.locale, health_education_translations (0 rows
-- in total), 0 non-'en-NG' rows in scribe_consents, scribe_transcripts and clinical_encounter_notes.patient_summary_language.
-- So there is no conversion step: this migration asserts the zero counts and aborts if any row has appeared since
-- (it never deletes patient or content rows), then narrows the CHECKs.
--
-- Removes the VALUES from every CHECK that allowed them (not just the app code), so the feature cannot grow back
-- through an unreachable member. 'en-NG' stays the value stored in the scribe tables.
--
-- NOT done, on purpose:
-- * public.health_education_translations is kept (empty, English-only CHECK, no UI or query left in the app). Four live
--   SQL functions still LEFT JOIN it (health_education_feed, health_education_library,
--   health_education_content_detail, health_education_programme_detail); SQL-language function bodies record no
--   dependency, so DROP TABLE would succeed and break all four at call time. Dropping it needs those four functions
--   rewritten from their live definitions: a separate, reviewed change.
-- * ai_evaluation_cases 'pidgin_language_fidelity' (AI-003) has one recorded failed result and the table has no
--   is_active/retired column, so it is left as audit history (the TypeScript eval no longer runs it).
-- * clinical_staff.languages and the specialist/therapy/applicant `languages` columns are free text describing what a
--   clinician speaks, not an app language; untouched.
-- * The platform_switches table and its functions stay (a general mechanism); only the 'pidgin_language' row goes.
--
-- Already-applied migrations are not edited.

begin;

do $$
declare
  v_n bigint;
begin
  select count(*) into v_n from public.profiles where language is distinct from 'en';
  if v_n <> 0 then raise exception 'profiles has % rows with a non-English language; convert them first', v_n; end if;
  select count(*) into v_n from public.patient_result_explanations where language <> 'en';
  if v_n <> 0 then raise exception 'patient_result_explanations has % non-English rows', v_n; end if;
  select count(*) into v_n from public.notification_template_locales where locale <> 'en';
  if v_n <> 0 then raise exception 'notification_template_locales has % non-English rows', v_n; end if;
  select count(*) into v_n from public.health_education_translations;
  if v_n <> 0 then raise exception 'health_education_translations has % rows', v_n; end if;
  select count(*) into v_n from public.scribe_consents where language <> 'en-NG';
  if v_n <> 0 then raise exception 'scribe_consents has % non en-NG rows', v_n; end if;
  select count(*) into v_n from public.scribe_transcripts where language <> 'en-NG';
  if v_n <> 0 then raise exception 'scribe_transcripts has % non en-NG rows', v_n; end if;
  select count(*) into v_n from public.clinical_encounter_notes
   where patient_summary_language is not null and patient_summary_language <> 'en-NG';
  if v_n <> 0 then raise exception 'clinical_encounter_notes has % non en-NG summaries', v_n; end if;
end $$;

-- Replace each CHECK that names a language code on the given column with a named English-only one.
create function pg_temp.narrow_check(p_table regclass, p_column text, p_new_name text, p_expr text)
returns void language plpgsql as $f$
declare
  r record;
begin
  for r in
    select c.conname from pg_constraint c
    where c.conrelid = p_table and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ~ '''(pcm|yo|ha|ig)'''
      and pg_get_constraintdef(c.oid) like '%' || p_column || '%'
  loop
    execute format('alter table %s drop constraint %I', p_table, r.conname);
  end loop;
  execute format('alter table %s add constraint %I check (%s)', p_table, p_new_name, p_expr);
end $f$;

select pg_temp.narrow_check('public.profiles', 'language', 'profiles_language_check', $$language in ('en')$$);
select pg_temp.narrow_check('public.patient_result_explanations', 'language', 'patient_result_explanations_language_check', $$language in ('en')$$);
select pg_temp.narrow_check('public.notification_template_locales', 'locale', 'notification_template_locales_locale_check', $$locale in ('en')$$);
select pg_temp.narrow_check('public.health_education_translations', 'language', 'health_education_translations_language_check', $$language in ('en')$$);
select pg_temp.narrow_check('public.scribe_consents', 'language', 'scribe_consents_language_check', $$language in ('en-NG')$$);
select pg_temp.narrow_check('public.scribe_transcripts', 'language', 'scribe_transcripts_language_check', $$language in ('en-NG')$$);
select pg_temp.narrow_check('public.clinical_encounter_notes', 'patient_summary_language', 'clinical_encounter_notes_patient_summary_language_check', $$patient_summary_language in ('en-NG')$$);

comment on column public.profiles.language is
  'Interface language for the app: en only. Nigerian Pidgin and every other non-English language were removed 2026-10-06 (founder decision, English only).';
comment on table public.health_education_translations is
  'UNUSED since 2026-10-06 (English only): empty, English-only CHECK, no app code reads or writes it. Four SQL functions still LEFT JOIN it; drop it only after rewriting them.';

delete from public.platform_switches where key = 'pidgin_language';

-- The AI-017 scribe suite carried a case that only made sense for a Pidgin summary (live: 0 recorded results, so
-- no audit history is lost). The runner iterates every case in the suite and needs a fixture for each, so it goes.
delete from public.ai_evaluation_cases c
 where c.case_code = 'pidgin_summary_in_pidgin'
   and not exists (select 1 from public.ai_evaluation_case_results r where r.case_id = c.id);

do $$
declare
  v_def text;
  t record;
begin
  -- no CHECK on any of these tables still allows a non-English language code
  for t in
    select unnest(array['profiles','patient_result_explanations','notification_template_locales','health_education_translations',
                        'scribe_consents','scribe_transcripts','clinical_encounter_notes']) as name
  loop
    for v_def in
      select pg_get_constraintdef(c.oid) from pg_constraint c
      where c.conrelid = ('public.' || t.name)::regclass and c.contype = 'c'
    loop
      if v_def ~ '''(pcm|yo|ha|ig)''' then raise exception 'FAIL: % still has a CHECK allowing a non-English language: %', t.name, v_def; end if;
    end loop;
  end loop;

  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.profiles'::regclass and conname = 'profiles_language_check';
  if v_def is null or v_def not like '%''en''%' then raise exception 'FAIL: profiles_language_check missing or wrong: %', v_def; end if;

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
