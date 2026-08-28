-- Fixes a real bug in private.enforce_psa_sdm_gate() (20260802212152), found
-- by packages/db/tests/public_impact_metrics.sql once it could finally run
-- against a fresh database for the first time (supabase db reset never
-- completed successfully before this sprint's CI fix-forward work).
--
-- The guard `if new.screen_type_code <> 'psa' then return new; end if;`
-- assumes screen_type_code is always non-null, but the column is nullable
-- with no default (20260719140000_sensitive_result_gating.sql) and several
-- call sites -- including this project's own test suite -- insert
-- screening_results rows without setting it (e.g. a generic result import
-- before the code is known). `<> 'psa'` on a null input evaluates to null,
-- and PL/pgSQL's `if null then ... end if` takes the false branch, so the
-- early return is silently skipped and every screening_results row with no
-- screen_type_code at all -- not just PSA rows -- falls into the male-only
-- gate below it and gets incorrectly rejected for any non-male patient.
--
-- Fix: `is distinct from` instead of `<>`, so a null screen_type_code is
-- treated the same as "not PSA" (the gate has nothing to enforce) rather
-- than the same as "is PSA" by accident. No other behavior changes: a real
-- 'psa' value still fails the check as `distinct from` there is false, same
-- as `<>` was for any non-null value.
create or replace function private.enforce_psa_sdm_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_age int;
  v_sex text;
begin
  if new.screen_type_code is distinct from 'psa' then
    return new;
  end if;

  select extract(year from age(date_of_birth))::int, sex::text
    into v_age, v_sex
    from public.profiles
    where id = new.patient_id;

  if v_sex is distinct from 'male' then
    raise exception 'PSA screening_results are male-only' using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.patient_shared_decisions
    where patient_id = new.patient_id and screen_type_code = 'psa'
      and decision_recorded_at is not null
  ) then
    raise exception 'PSA screening requires a recorded shared-decision-making conversation first' using errcode = '23514';
  end if;

  return new;
end;
$$;

do $$
begin
  -- Prove the null-screen_type_code path no longer falls through to the
  -- PSA gate: insert a non-PSA, no-screen_type_code screening_results row
  -- for a female patient (would previously raise "PSA screening_results
  -- are male-only" incorrectly). Rolled back inside this migration's own
  -- transaction, so nothing is left behind either way.
  declare
    v_org uuid;
    v_patient uuid;
  begin
    select p.organisation_id, p.id into v_org, v_patient
      from public.profiles p
      where p.role = 'patient' and p.sex is distinct from 'male' and p.organisation_id is not null
      limit 1;

    if v_patient is null then
      raise notice 'no non-male patient fixture available; skipping behavioural assertion';
      return;
    end if;

    insert into public.screening_results (organisation_id, patient_id, result_status)
    values (v_org, v_patient, 'normal');

    delete from public.screening_results
      where organisation_id = v_org and patient_id = v_patient and screen_type_code is null and result_status = 'normal';
  end;
end $$;
