-- OQ-82 / OQ-83 proof: a symptom ticked on the phone's blood pressure form pages the care team on a paid plan, and only gives self-care guidance on Free.
--
-- The phone stores each tick as a symptoms row at the severity in versioned config bp.symptom_checklist (PROPOSED, 6 today). The server symptom trigger
-- private.handle_symptom_red_flag decides from that row alone. Read live 2026-10-30: 'breathlessness' is already in the trigger's low-threshold list
-- (red flag from severity 6, since 20260714120000), and so are 'weakness_or_numbness' and 'difficulty_speaking' (since S11d/S11e). So a trouble-breathing
-- tick at 6 pages as Priority 1; the older note in OQ-82 saying it records without paging was wrong. This proof pins that, so a later edit of the trigger or
-- of the configured severity cannot quietly stop a ticked emergency symptom paging.
--
-- BP_FORM_SEVERITY=6   (a Jest test in apps/mobile reads this line and fails if bp.symptom_checklist moves away from it)
--
--  1. Each red-flag tick the form offers (severe headache, chest pain, trouble breathing, vision change, confusion, weakness or numbness, trouble speaking)
--     stored at the form severity is a red flag, opens one open urgent_escalation alert and enqueues as many notifications as the chest pain control.
--  2. The same ticks for a patient WITHOUT the doctor-escalation entitlement (Free) open no clinician alert (the plan gate is unchanged).
--  3. Controls that must not change: dizziness at 6 is a review alert and not a red flag; palpitations at 6 stays a red flag; trouble breathing stored at
--     3 (the glucose form's severity) pages nobody, which is why the stored severity matters and why the glucose config is capped at 3.
--  4. SABOTAGE (two separate ones, each from the live body): trouble breathing taken out of the trigger's list, then weakness or numbness and trouble
--     speaking taken out. In each case the matching check must flip, or the proof raises VACUOUS TEST.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;

do $$
declare
  v_form_severity constant integer := 6;
  v_org uuid; v_doc uuid := gen_random_uuid(); v_paid uuid := gen_random_uuid(); v_free uuid := gen_random_uuid();
  v_product uuid; v_price bigint; v_t text;
  v_a0 integer; v_a1 integer; v_n0 integer; v_n1 integer; v_flag boolean; v_ctl_notifs integer;
  v_orig text; v_src text; v_anchor_breath text := $q$'breathlessness', 'palpitations', 'swelling',$q$;
  v_anchor_neuro text := $q$'weakness_or_numbness', 'difficulty_speaking', 'back_pain'$q$;
  v_hits integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_doc, 'bpform-doc@example.invalid', 'x', now(), '{}', '{}'),
    (v_paid, 'bpform-paid@example.invalid', 'x', now(), '{}', '{}'),
    (v_free, 'bpform-free@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test) values
    (v_doc, v_org, 'clinician', 'BP form Clinician', (current_date - interval '40 years')::date, true),
    (v_paid, v_org, 'patient', 'BP form Paid', (current_date - interval '40 years')::date, true),
    (v_free, v_org, 'patient', 'BP form Free', (current_date - interval '40 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true;
  select id, price_kobo into v_product, v_price from public.service_products
   where 'vitals_red_flag_doctor_escalation' = any(features) order by code limit 1;
  insert into public.service_purchases (organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency, purchased_at, expires_at)
    values (v_org, v_paid, v_paid, v_product, 'active', v_price, 'NGN', now(), now() + interval '84 days');
  if not private.patient_has_feature_access(v_paid, 'vitals_red_flag_doctor_escalation')
     or private.patient_has_feature_access(v_free, 'vitals_red_flag_doctor_escalation') then
    raise exception 'fixtures do not give the entitled/free split this proof needs';
  end if;

  v_orig := pg_get_functiondef('private.handle_symptom_red_flag()'::regprocedure);

  -- Control: chest pain at the form severity, the type the older tests treat as the reference.
  select count(*) into v_a0 from public.clinician_alerts where patient_id = v_paid and level = 'urgent_escalation';
  select count(*) into v_n0 from public.notifications;
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, description)
    values (v_org, v_paid, 'chest_pain', v_form_severity, 'Ticked on the blood pressure form (not rated by the patient).') returning is_red_flag into v_flag;
  select count(*) into v_a1 from public.clinician_alerts where patient_id = v_paid and level = 'urgent_escalation';
  select count(*) into v_n1 from public.notifications;
  v_ctl_notifs := v_n1 - v_n0;
  insert into results values ('real', 'control: chest pain tick is a red flag with one urgent alert', 'true|1', v_flag::text || '|' || (v_a1 - v_a0));
  insert into results values ('real', 'control: a page notification is enqueued at all', 'true', (v_ctl_notifs > 0)::text);

  foreach v_t in array array['severe_headache', 'breathlessness', 'visual_disturbance', 'confusion', 'weakness_or_numbness', 'difficulty_speaking'] loop
    select count(*) into v_a0 from public.clinician_alerts where patient_id = v_paid and level = 'urgent_escalation';
    select count(*) into v_n0 from public.notifications;
    execute format('insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, description) values ($1, $2, %L::public.symptom_type, $3, $4) returning is_red_flag', v_t)
      into v_flag using v_org, v_paid, v_form_severity, 'Ticked on the blood pressure form (not rated by the patient).';
    select count(*) into v_a1 from public.clinician_alerts where patient_id = v_paid and level = 'urgent_escalation';
    select count(*) into v_n1 from public.notifications;
    insert into results values ('real', v_t || ' tick on a paid plan is a red flag with one urgent alert', 'true|1', v_flag::text || '|' || (v_a1 - v_a0));
    insert into results values ('real', v_t || ' tick enqueues as many notifications as chest pain', v_ctl_notifs::text, (v_n1 - v_n0)::text);

    select count(*) into v_a0 from public.clinician_alerts where patient_id = v_free;
    execute format('insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, description) values ($1, $2, %L::public.symptom_type, $3, $4)', v_t)
      using v_org, v_free, v_form_severity, 'Ticked on the blood pressure form (not rated by the patient).';
    select count(*) into v_a1 from public.clinician_alerts where patient_id = v_free;
    insert into results values ('real', v_t || ' tick on Free opens no clinician alert', '0', (v_a1 - v_a0)::text);
  end loop;

  -- Controls that must not change.
  select count(*) into v_a0 from public.clinician_alerts where patient_id = v_paid and level = 'clinician_review';
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, description)
    values (v_org, v_paid, 'dizziness', v_form_severity, 'tick') returning is_red_flag into v_flag;
  select count(*) into v_a1 from public.clinician_alerts where patient_id = v_paid and level = 'clinician_review';
  insert into results values ('real', 'control: dizziness tick is a review, not a red flag', 'false|1', v_flag::text || '|' || (v_a1 - v_a0));

  select count(*) into v_a0 from public.clinician_alerts where patient_id = v_paid and level = 'urgent_escalation';
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, description)
    values (v_org, v_paid, 'palpitations', v_form_severity, 'tick') returning is_red_flag into v_flag;
  select count(*) into v_a1 from public.clinician_alerts where patient_id = v_paid and level = 'urgent_escalation';
  insert into results values ('real', 'control: palpitations tick stays a red flag', 'true|1', v_flag::text || '|' || (v_a1 - v_a0));

  select count(*) into v_a0 from public.clinician_alerts where patient_id = v_paid;
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, description)
    values (v_org, v_paid, 'breathlessness', 3, 'stored at the glucose form severity') returning is_red_flag into v_flag;
  select count(*) into v_a1 from public.clinician_alerts where patient_id = v_paid;
  insert into results values ('real', 'control: trouble breathing stored at 3 pages nobody', 'false|0', v_flag::text || '|' || (v_a1 - v_a0));

  -- SABOTAGE 1: trouble breathing out of the trigger's low-threshold list, patched from the live body.
  v_hits := (length(v_orig) - length(replace(v_orig, v_anchor_breath, ''))) / length(v_anchor_breath);
  if v_hits <> 1 then raise exception 'breathlessness anchor found % times in the live body, expected once', v_hits; end if;
  v_src := replace(v_orig, v_anchor_breath, $q$'palpitations', 'swelling',$q$);
  execute v_src;
  select count(*) into v_a0 from public.clinician_alerts where patient_id = v_paid and level = 'urgent_escalation';
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, description) values (v_org, v_paid, 'breathlessness', v_form_severity, 'sabotaged');
  select count(*) into v_a1 from public.clinician_alerts where patient_id = v_paid and level = 'urgent_escalation';
  insert into results values ('sabotaged', 'breathlessness tick raises an urgent alert', '1', (v_a1 - v_a0)::text);

  -- SABOTAGE 2: weakness or numbness and trouble speaking out of the list (restoring the live body first).
  execute v_orig;
  v_hits := (length(v_orig) - length(replace(v_orig, v_anchor_neuro, ''))) / length(v_anchor_neuro);
  if v_hits <> 1 then raise exception 'neuro anchor found % times in the live body, expected once', v_hits; end if;
  v_src := replace(v_orig, v_anchor_neuro, $q$'back_pain'$q$);
  execute v_src;
  select count(*) into v_a0 from public.clinician_alerts where patient_id = v_paid and level = 'urgent_escalation';
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, description) values (v_org, v_paid, 'weakness_or_numbness', v_form_severity, 'sabotaged');
  select count(*) into v_a1 from public.clinician_alerts where patient_id = v_paid and level = 'urgent_escalation';
  insert into results values ('sabotaged', 'weakness_or_numbness tick raises an urgent alert', '1', (v_a1 - v_a0)::text);
  select count(*) into v_a0 from public.clinician_alerts where patient_id = v_paid and level = 'urgent_escalation';
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, description) values (v_org, v_paid, 'difficulty_speaking', v_form_severity, 'sabotaged');
  select count(*) into v_a1 from public.clinician_alerts where patient_id = v_paid and level = 'urgent_escalation';
  insert into results values ('sabotaged', 'difficulty_speaking tick raises an urgent alert', '1', (v_a1 - v_a0)::text);

  execute v_orig;
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'BP form ticks proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
      from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: only % of the 3 sabotage checks flipped', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
rollback;
