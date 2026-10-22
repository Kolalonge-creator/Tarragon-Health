-- ===========================================================================
-- The "is this person 18" rules compare a date of birth with the Lagos date, not the server (UTC) date.
--
-- Bug (seen 2026-10-20, packages/db/tests/s47_handover_grace.sql failing in CI replay between about 23:00 and 24:00 UTC):
-- the adult-only registration gate and the other 18-year rules used `current_date`, the UTC date. Between 23:00 and 24:00 UTC
-- the Lagos date is already one day ahead, so a person whose 18th birthday is today in Lagos was still 17 to the trigger and
-- was refused with `adult_only_registration` for about an hour a day. The platform rule is Africa/Lagos.
--
-- Fix: the existing helper private.lagos_today(), and every function below now compares against it. Each body is read from the LIVE
-- definition (pg_get_functiondef), changed with an anchored replacement, and the migration raises if the text it expects is
-- missing, so it cannot silently do nothing. Search path, owner, security mode and every grant are untouched (CREATE OR
-- REPLACE keeps them; the end of the block compares each function's ACL and config before and after).
--
-- Same rule, fixed here (all compared a date of birth with current_date - interval '18 years'):
--   private.enforce_adult_registration()     the registration gate on profiles
--   private.handle_new_user()                the same gate on sign-up metadata
--   private.is_minor_dependant(uuid)         who counts as a minor (the minor guard on patient tables, minor_guard_gaps)
--   private.enforce_async_consult_entitlement_or_credit()   written questions are for adults
--   private.community_adult(uuid)             community is for adults
--   private.nutrition_targets_withheld(uuid) no nutrition targets under 18
--   private.proxy_review_state(uuid, uuid)   proxy yearly review applies to adults
--   private.sweep_dependent_majority_review()  flags a dependant who has turned 18
--   private.report_caregiver_scope(uuid, uuid) hand-over at 18 for a guardian's read
--   private.compute_dependent_transition_state(date), private.adolescent_age_band(uuid)
--                                              the child / independent switch at 18 (age(current_date, dob))
-- Other age(current_date, dob) uses (screening schedules, vitals plausibility, patient_age_years, clinical context) are a
-- display or eligibility age, not the 18 boundary, and are left for a separate pass.
-- Not changed on purpose: private.sweep_dependant_handovers, private.threshold_override_ineligible and private.cohort_patient
-- already use the Lagos date; other uses of current_date that are not an age check are left alone.
--
-- No data changes. Rows are not touched; only function bodies.
-- ===========================================================================

-- private.lagos_today() already exists (20261013004659, owner postgres, executable by service_role only) with exactly this body:
-- select (now() at time zone 'Africa/Lagos')::date. It is reused as is, not redefined; the block below raises if it is missing
-- or has a different body, so this migration cannot run against a function that does something else.

do $$
declare
  r record;
  v_def text;
  v_new text;
  v_acl_before text;
  v_cfg_before text;
  v_secdef_before boolean;
  v_oid oid;
  v_pattern text;
  v_changed integer := 0;
begin
  if to_regprocedure('private.lagos_today()') is null
     or (select regexp_replace(p.prosrc, '[\s;]+', ' ', 'g') from pg_proc p where p.oid = 'private.lagos_today()'::regprocedure)
        not like '%(now() at time zone ''Africa/Lagos'')::date%' then
    raise exception 'lagos date fix: private.lagos_today() is missing or is not the Lagos date';
  end if;
  for r in
    select * from (values
      ('private.enforce_adult_registration()',                              'age'),
      ('private.handle_new_user()',                                          'age'),
      ('private.is_minor_dependant(uuid)',                                  'age'),
      ('private.enforce_async_consult_entitlement_or_credit()',             'age'),
      ('private.community_adult(uuid)',                                     'age'),
      ('private.nutrition_targets_withheld(uuid)',                          'age'),
      ('private.proxy_review_state(uuid,uuid)',                             'age'),
      ('private.sweep_dependent_majority_review()',                         'age'),
      ('private.report_caregiver_scope(uuid,uuid)',                         'turned18'),
      ('private.compute_dependent_transition_state(date)',                  'agefn'),
      ('private.adolescent_age_band(uuid)',                                 'agefn')
    ) as t(sig, kind)
  loop
    v_oid := to_regprocedure(r.sig);
    if v_oid is null then
      raise exception 'lagos date fix: function % not found', r.sig;
    end if;

    select p.proacl::text, p.proconfig::text, p.prosecdef
      into v_acl_before, v_cfg_before, v_secdef_before
      from pg_proc p where p.oid = v_oid;

    v_def := pg_get_functiondef(v_oid);
    if r.kind = 'age' then
      v_pattern := 'current_date(\s*-\s*interval\s*''18 years'')';
      v_new := regexp_replace(v_def, v_pattern, 'private.lagos_today()\1', 'g');
    elsif r.kind = 'agefn' then
      -- age(current_date, dob): the child / adolescent / independent bands switch at 18 on the same day as the gate
      v_pattern := 'age\(\s*current_date\s*,';
      v_new := regexp_replace(v_def, v_pattern, 'age(private.lagos_today(),', 'g');
    else
      -- (p.date_of_birth + interval '18 years')::date <= current_date
      v_pattern := '(interval\s*''18 years''\)::date\s*<=\s*)current_date';
      v_new := regexp_replace(v_def, v_pattern, '\1private.lagos_today()', 'g');
    end if;

    if v_new = v_def or v_def !~ v_pattern then
      raise exception 'lagos date fix: expected text not found in %', r.sig;
    end if;
    if v_new ~ ('current_date\s*-\s*interval\s*''18 years''') then
      raise exception 'lagos date fix: a UTC age comparison is left in %', r.sig;
    end if;

    execute v_new;
    v_changed := v_changed + 1;

    -- nothing but the body changed
    if exists (
      select 1 from pg_proc p
       where p.oid = v_oid
         and (p.proacl::text is distinct from v_acl_before
              or p.proconfig::text is distinct from v_cfg_before
              or p.prosecdef is distinct from v_secdef_before)
    ) then
      raise exception 'lagos date fix: grants, config or security mode of % changed', r.sig;
    end if;
  end loop;

  if v_changed <> 11 then
    raise exception 'lagos date fix: expected 11 functions, changed %', v_changed;
  end if;

  -- final assertions: no 18-year rule in private/public still reads the UTC date, and nothing is reachable by anon
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and (p.prosrc ~ 'current_date\s*-\s*interval\s*''18 years'''
            or p.oid in ('private.compute_dependent_transition_state(date)'::regprocedure,
                         'private.adolescent_age_band(uuid)'::regprocedure) and p.prosrc ~ 'age\(\s*current_date')
  ) then
    raise exception 'lagos date fix: a function still compares an 18 year age with current_date';
  end if;
  if has_function_privilege('anon', 'private.lagos_today()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.lagos_today()', 'EXECUTE') then
    raise exception 'lagos date fix: lagos_today must not be executable by anon or authenticated';
  end if;
  if has_function_privilege('anon', 'private.enforce_adult_registration()', 'EXECUTE')
     or has_function_privilege('anon', 'private.is_minor_dependant(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'private.handle_new_user()', 'EXECUTE') then
    raise exception 'lagos date fix: anon can execute a gate function';
  end if;
  if private.lagos_today() <> (now() at time zone 'Africa/Lagos')::date then
    raise exception 'lagos date fix: lagos_today is wrong';
  end if;
end $$;
