-- ===========================================================================
-- Follow-up to 20261021182834_adult_gate_uses_lagos_date.sql (PR 1266): the remaining age rules that still read the UTC date.
--
-- That migration fixed the 18-year gate. Every other function that turns a date of birth into an age, or tests "has turned
-- 18" / "is a minor", with current_date or now() has the same one-hour error between 23:00 and 24:00 UTC (the Lagos date is
-- a day ahead). Fixed here, from the LIVE bodies, with the same guards as before (anchored replacement that raises if the
-- text is missing; ACL, config and security mode compared before and after; nothing but the body changes):
--   age(current_date, dob) / age(now(), dob) -> age(private.lagos_today(), dob):
--     private.auto_enrol_preventive_programmes(), private.patient_age_years(uuid), private.run_screening_scheduler(uuid),
--     private.screening_due(uuid, uuid), private.vitals_impossible_reasons(public.vitals_readings),
--     private.evaluate_bp_pattern(uuid), private.patient_delivered_test_codes(uuid, uuid, text[]),
--     public.list_screening_packages(), public.read_skin_photo_audited(uuid, text),
--     public.read_symptom_session_audited(uuid, text), public.symptom_check_context(uuid, integer)
--   current_date - make_interval(years => ...) : private.points_status_for(uuid) (minor under the rewards rules)
--   current_date < h.birthday_18               : public.complete_dependant_handover(uuid[], date) (could not be completed on the
--                                                 18th birthday itself, in Lagos, for the first hour of a UTC evening)
-- Not changed: current_date uses that are not about a person's age (for example private.open_annual_review's cycle date,
-- private.chain_canary_ensure's fixture date of birth).
-- No data changes.
-- ===========================================================================

do $$
declare
  r record;
  v_oid oid;
  v_def text;
  v_new text;
  v_pattern text;
  v_repl text;
  v_acl text;
  v_cfg text;
  v_secdef boolean;
  v_changed integer := 0;
begin
  if to_regprocedure('private.lagos_today()') is null
     or (select regexp_replace(p.prosrc, '[\s;]+', ' ', 'g') from pg_proc p where p.oid = 'private.lagos_today()'::regprocedure)
        not like '%(now() at time zone ''Africa/Lagos'')::date%' then
    raise exception 'lagos age fix: private.lagos_today() is missing or is not the Lagos date';
  end if;

  for r in
    select * from (values
      ('private.auto_enrol_preventive_programmes()',            'age'),
      ('private.patient_age_years(uuid)',                       'age'),
      ('private.run_screening_scheduler(uuid)',                 'age'),
      ('private.screening_due(uuid,uuid)',                      'age'),
      ('private.vitals_impossible_reasons(public.vitals_readings)', 'age'),
      ('private.evaluate_bp_pattern(uuid)',                     'age'),
      ('private.patient_delivered_test_codes(uuid,uuid,text[])','age'),
      ('public.list_screening_packages()',                      'age'),
      ('public.read_skin_photo_audited(uuid,text)',             'age'),
      ('public.read_symptom_session_audited(uuid,text)',        'age'),
      ('public.symptom_check_context(uuid,integer)',            'age'),
      ('private.points_status_for(uuid)',                       'minor'),
      ('public.complete_dependant_handover(uuid[],date)',        'birthday18')
    ) as t(sig, kind)
  loop
    v_oid := to_regprocedure(r.sig);
    if v_oid is null then raise exception 'lagos age fix: function % not found', r.sig; end if;
    select p.proacl::text, p.proconfig::text, p.prosecdef into v_acl, v_cfg, v_secdef from pg_proc p where p.oid = v_oid;

    v_def := pg_get_functiondef(v_oid);
    if r.kind = 'age' then
      v_pattern := 'age\(\s*(?:current_date|now\(\))\s*,';
      v_repl := 'age(private.lagos_today(),';
    elsif r.kind = 'minor' then
      v_pattern := 'current_date(\s*-\s*make_interval\(\s*years)';
      v_repl := 'private.lagos_today()\1';
    else
      v_pattern := 'current_date(\s*<\s*h\.birthday_18)';
      v_repl := 'private.lagos_today()\1';
    end if;
    if v_def !~ v_pattern then
      raise exception 'lagos age fix: expected text not found in %', r.sig;
    end if;
    v_new := regexp_replace(v_def, v_pattern, v_repl, 'g');
    if v_new = v_def then raise exception 'lagos age fix: nothing changed in %', r.sig; end if;
    if r.kind = 'age' and v_new ~ 'age\(\s*(?:current_date|now\(\))' then
      raise exception 'lagos age fix: a UTC age() call is left in %', r.sig;
    end if;
    execute v_new;
    v_changed := v_changed + 1;

    if exists (
      select 1 from pg_proc p
       where p.oid = v_oid
         and (p.proacl::text is distinct from v_acl or p.proconfig::text is distinct from v_cfg or p.prosecdef is distinct from v_secdef)
    ) then
      raise exception 'lagos age fix: grants, config or security mode of % changed', r.sig;
    end if;
  end loop;

  if v_changed <> 13 then raise exception 'lagos age fix: expected 13 functions, changed %', v_changed; end if;

  -- final assertions: no function in public or private reads a person's age from the UTC date any more
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private')
       and (p.prosrc ~ 'age\(\s*(?:current_date|now\(\))\s*,'
            or p.prosrc ~ 'current_date\s*-\s*interval\s*''18 years'''
            or p.prosrc ~ 'current_date\s*-\s*make_interval\(\s*years'
            or p.prosrc ~ 'current_date\s*<\s*h\.birthday_18')
  ) then
    raise exception 'lagos age fix: a function still reads a person''s age from the UTC date';
  end if;
end $$;
