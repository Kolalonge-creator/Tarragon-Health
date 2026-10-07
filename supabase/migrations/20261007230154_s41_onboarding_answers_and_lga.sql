-- S41 (Module 1, part 1): onboarding answers that drive Home, and a local government area on the profile.
--
-- WHAT THIS ADDS
--   1. public.onboarding_answers: the patient's own goal and condition choices from onboarding (spec 1.10), one row per question,
--      replacing the auth-metadata `signup_intent` as the thing Home reads. Written only through public.save_onboarding_answers
--      (validated, audited, one outbox event). The patient reads their own rows; nobody else can read them through the API.
--   2. profiles.lga: local government area (spec 1.9). Free text, 2 to 60 characters. There is no canonical list of the 774 areas
--      in the repository, so no list is enforced here (OQ-292). profiles.area stays as the neighbourhood.
--   3. Event types `onboarding.answers_saved` (emitted here) and `cohort.joined` (registered only, see below).
--
-- WHAT THIS DELIBERATELY DOES NOT ADD (reconciled, see docs/design/S41.md)
--   * cohort_codes: spec 1.8 is already built by S38e as public.sponsor_cohorts + public.profile_cohorts + public.join_cohort(text)
--     (live on 20261007112207, on PR #988). Creating a second table would put two code systems in front of one sign-up box.
--     The `cohort.joined` event type is registered here so join_cohort can emit it when #988 lands; this migration cannot call
--     join_cohort because it does not exist on main-dev yet.
--   * ussd_pins: USSD is not built (founder decision 2026-10-07). Design note only.
--   * patient_blood_profile already carries provenance (lab_document vs patient_attested), so 1.9's self-reported flag needs no schema.
--
-- Counts before this change: 0 rows (new table). profiles.lga is new and null for every existing profile.

-- 1. Local government area ---------------------------------------------------------------------------------------------
alter table public.profiles
  add column if not exists lga text
  constraint profiles_lga_length check (lga is null or char_length(btrim(lga)) between 2 and 60);

comment on column public.profiles.lga is 'S41: local government area, free text typed by the person. No canonical list is enforced (OQ-292).';

-- 2. Onboarding answers ------------------------------------------------------------------------------------------------
create table public.onboarding_answers (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  question_code   text not null check (question_code in ('goals', 'conditions')),
  answer          jsonb not null check (jsonb_typeof(answer) = 'array' and jsonb_array_length(answer) between 1 and 6),
  answered_at     timestamptz not null default now(),
  source          text not null default 'patient_self_report' check (source = 'patient_self_report'),
  -- Always the patient themselves (the source above says so). Cascades with patient_id so closing an account is not blocked.
  recorded_by     uuid not null references public.profiles (id) on delete cascade,
  is_test         boolean not null default false,
  unique (patient_id, question_code),
  check (recorded_by = patient_id)
);

alter table public.onboarding_answers enable row level security;
revoke all on public.onboarding_answers from public, anon, authenticated;
grant select on public.onboarding_answers to authenticated;
create policy onboarding_answers_own_select on public.onboarding_answers
  for select to authenticated using (patient_id = (select auth.uid()));

comment on table public.onboarding_answers is 'S41: the patient''s own goal and condition choices (spec 1.10). Self-reported, never a diagnosis, never read by staff through the API. Written only by save_onboarding_answers.';

-- The allowed option codes live in one place. The web and mobile mirrors are checked against this text by a scan test.
create function private.onboarding_option_ok(p_question text, p_option text)
returns boolean language sql immutable set search_path = ''
as $$
  select case p_question
    when 'goals' then p_option in ('manage_condition', 'stay_ahead', 'screening_check', 'family_care', 'not_sure')
    when 'conditions' then p_option in ('hypertension', 'diabetes', 'asthma', 'kidney', 'heart', 'other', 'none')
    else false end
$$;
revoke all on function private.onboarding_option_ok(text, text) from public, anon, authenticated;

create function public.save_onboarding_answers(p_goals text[], p_conditions text[])
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  p public.profiles%rowtype;
  v_goals text[]; v_conds text[]; o text;
begin
  if v_uid is null then raise exception 'onboarding_not_authorised' using errcode = '42501'; end if;
  select * into p from public.profiles where id = v_uid and role = 'patient' and is_active;
  if not found or p.organisation_id is null then raise exception 'onboarding_not_authorised' using errcode = '42501'; end if;

  -- de-duplicate, keep order
  select coalesce(array_agg(x order by n), '{}') into v_goals from (select x, min(n) n from unnest(coalesce(p_goals, '{}')) with ordinality as u(x, n) group by x) s;
  select coalesce(array_agg(x order by n), '{}') into v_conds from (select x, min(n) n from unnest(coalesce(p_conditions, '{}')) with ordinality as u(x, n) group by x) s;

  if cardinality(v_goals) not between 1 and 5 or cardinality(v_conds) not between 1 and 6 then
    raise exception 'onboarding_answers_invalid' using errcode = '22023';
  end if;
  foreach o in array v_goals loop
    if not private.onboarding_option_ok('goals', o) then raise exception 'onboarding_answers_invalid' using errcode = '22023'; end if;
  end loop;
  foreach o in array v_conds loop
    if not private.onboarding_option_ok('conditions', o) then raise exception 'onboarding_answers_invalid' using errcode = '22023'; end if;
  end loop;
  -- "none" and "not sure" stand alone: they contradict any other choice.
  if ('none' = any (v_conds) and cardinality(v_conds) > 1) or ('not_sure' = any (v_goals) and cardinality(v_goals) > 1) then
    raise exception 'onboarding_answers_invalid' using errcode = '22023';
  end if;

  insert into public.onboarding_answers (organisation_id, patient_id, question_code, answer, recorded_by, is_test)
  values (p.organisation_id, v_uid, 'goals', to_jsonb(v_goals), v_uid, coalesce(p.is_test, false)),
         (p.organisation_id, v_uid, 'conditions', to_jsonb(v_conds), v_uid, coalesce(p.is_test, false))
  on conflict (patient_id, question_code) do update set answer = excluded.answer, answered_at = now();

  -- Ids and counts only: the choices themselves can be a condition (INV-07 spirit for events).
  perform private.emit_domain_event('onboarding.answers_saved', p.organisation_id, jsonb_build_object('question_count', 2),
            'onboarding.answers_saved:' || gen_random_uuid()::text, v_uid, 'profile', v_uid);
  perform private.log_audit('onboarding.answers_saved', 'profile', v_uid, jsonb_build_object('question_count', 2));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.save_onboarding_answers(text[], text[]) from public, anon;
grant execute on function public.save_onboarding_answers(text[], text[]) to authenticated;

-- 3. Event types -------------------------------------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('onboarding.answers_saved', 'A patient saved their onboarding goal and condition choices', 'S41', false),
  ('cohort.joined', 'A patient joined a sponsor programme with a code', 'S41', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys) values
  ('onboarding.answers_saved', 1, array['question_count']),
  ('cohort.joined', 1, array['cohort_id'])
on conflict do nothing;

-- 4. Self-check --------------------------------------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('anon', 'public.onboarding_answers', 'SELECT') then raise exception 'S41: anon can read onboarding_answers'; end if;
  if has_table_privilege('authenticated', 'public.onboarding_answers', 'INSERT,UPDATE,DELETE') then raise exception 'S41: onboarding_answers is writable directly'; end if;
  if has_function_privilege('anon', 'public.save_onboarding_answers(text[],text[])', 'EXECUTE') then raise exception 'S41: anon can execute save_onboarding_answers'; end if;
  if has_function_privilege('authenticated', 'private.onboarding_option_ok(text,text)', 'EXECUTE') then raise exception 'S41: private helper callable'; end if;
end $$;
