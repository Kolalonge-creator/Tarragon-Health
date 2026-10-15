-- S04b-1c: guard the patient tables that reached production after 20261013215731 (S04b-1b).
--
-- Found by the release-integrity job (check-minor-guard-gaps.mjs) on 2026-10-14: 12 public tables keyed by patient_id are not in
-- minor_dependant_table_policy, so a dependant under 18 is not blocked from holding rows in them: access_fund_grants, birth_plans,
-- challenge_participation, clinic_slot_reservations, cohort_members, cohort_preferences, contractions, discount_code_attempts,
-- hmo_eligibility_checks, kick_counts, pharmacy_threads, pregnancies (pregnancy-tracking, S69 cohort/challenge, S72 checkout and S11-S15 tables).
-- Founder rule (2026-10-13, runbook docs/runbooks/minor-guard-gaps.md): a dependant under 18 holds immunisation and preventive tracking only,
-- and none of these is that, so all twelve are guarded. No under-18 dependant exists live (0 rows), so there is nothing to convert.
-- Same mechanism as S04b-1b: anything private.minor_guard_gaps() reports as unclassified is guarded, never silently exempted; a table that
-- is classified allowed or exempt and also guarded is left for a person to decide (the self-check fails the migration).
-- Idempotent. Declares no transaction of its own (the apply workflow wraps it).

do $$
declare
  r record;
  v_col text;
begin
  for r in select g.table_name from private.minor_guard_gaps() g where g.problem = 'not in minor_dependant_table_policy' loop
    v_col := case when r.table_name in ('booking_requests', 'risk_assessment_responses', 'prevention_risk_scores', 'ai_conversations')
                  then 'profile_id' else 'patient_id' end;
    raise notice 'S04b-1c: guarding unclassified patient table %', r.table_name;
    perform private.guard_minor_dependant_table(r.table_name, v_col);
  end loop;
  for r in select g.table_name from private.minor_guard_gaps() g where g.problem like 'listed guarded but has no%' loop
    v_col := case when r.table_name in ('booking_requests', 'risk_assessment_responses', 'prevention_risk_scores', 'ai_conversations')
                  then 'profile_id' else 'patient_id' end;
    perform private.guard_minor_dependant_table(r.table_name, v_col);
  end loop;

  if exists (select 1 from private.minor_guard_gaps()) then
    raise exception 'S04b-1c: patient tables still escape the under-18 scope guard: %',
      (select string_agg(g.table_name || ' (' || g.problem || ')', ', ') from private.minor_guard_gaps() g);
  end if;
  if exists (
    select 1 from unnest(array['access_fund_grants','birth_plans','challenge_participation','clinic_slot_reservations','cohort_members',
        'cohort_preferences','contractions','discount_code_attempts','hmo_eligibility_checks','kick_counts','pharmacy_threads','pregnancies']) t(name)
     where to_regclass('public.' || t.name) is not null
       and not exists (select 1 from public.minor_dependant_table_policy p where p.table_name = t.name and p.policy = 'guarded'))
  then
    raise exception 'S04b-1c: one of the twelve late patient tables is not guarded';
  end if;
end $$;
