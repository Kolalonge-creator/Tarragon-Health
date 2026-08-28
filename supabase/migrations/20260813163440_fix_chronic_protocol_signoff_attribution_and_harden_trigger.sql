-- Tarragon Health — harden the chronic-pathway protocol activation gate
--
-- Found 2026-08-13 while cross-checking the three chronic pathways activated
-- the same day (hypertension, diabetes, obesity):
-- private.enforce_chronic_programme_protocol_signed() -- the trigger whose
-- own error message claims "A Clinical Director must sign the protocol
-- first" -- never actually checked that. It only checked that *a*
-- protocol_versions row existed for the slug, regardless of
-- approved_by/approved_at or who the approver was. Same failure shape as the
-- anon-execute and doctor/clinician-merge policy gaps already in this
-- project's history: the comment/error text claimed an enforcement the code
-- didn't implement.
--
-- (Attribution itself was double-checked and found correct: all three
-- protocol_versions rows' approved_by already points to clinical_staff.id
-- 54598937-2cd7-49f8-9a2f-a85b725300a9, Dr Kola Longe, is_clinical_director =
-- true, active = true -- protocol_versions_approved_by_fkey references
-- clinical_staff(id), not clinical_staff(profile_id). No data fix needed;
-- this migration only replaces the trigger.)
--
-- See project memory project_three_chronic_pathways_activated_20260813 for
-- the full finding.

create or replace function private.enforce_chronic_programme_protocol_signed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.is_active and (tg_op = 'INSERT' or not old.is_active) then
    if not exists (
      select 1
      from public.protocol_versions pv
      join public.clinical_staff cs on cs.id = pv.approved_by
      where pv.protocol_id = new.protocol_slug
        and pv.approved_by is not null
        and pv.approved_at is not null
        and cs.is_clinical_director = true
        and cs.active = true
    ) then
      raise exception
        'Cannot activate chronic condition "%": no protocol version for "%" has been signed by an active Clinical Director.',
        new.code, new.protocol_slug
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$function$;

-- --- Prove it: the three real pathways still pass, a sabotage case is rejected -
--
-- This checks a real, already-signed fact from live: Dr Kola Longe's actual
-- sign-off on all three (see the comment above) still validates under the
-- new hardened trigger logic. A from-scratch replay has no such sign-off at
-- all — no migration or seed path fabricates one, deliberately, per this
-- codebase's own "no fabricated reviewed_by/attestation" rule — so there is
-- nothing to regress-check yet on a fresh environment. Skips rather than
-- failing when none exist (found by the new CI migration-replay job,
-- 2026-08-27); still hard-fails on live-like data if some but not all three
-- validate, which is the actual regression this was written to catch.
do $$
declare
  v_pass_count integer;
  v_signed_count integer;
begin
  select count(*) into v_signed_count
  from public.protocol_versions
  where protocol_id in ('chronic_hypertension_who', 'chronic_diabetes_who', 'chronic_obesity_who')
    and approved_by is not null;

  if v_signed_count = 0 then
    raise notice 'no chronic-pathway protocol sign-off exists in this environment; skipping the hardened-trigger regression check';
  else
    select count(*) into v_pass_count
    from public.protocol_versions pv
    join public.clinical_staff cs on cs.id = pv.approved_by
    where pv.protocol_id in ('chronic_hypertension_who', 'chronic_diabetes_who', 'chronic_obesity_who')
      and pv.approved_by is not null
      and pv.approved_at is not null
      and cs.is_clinical_director = true
      and cs.active = true;

    if v_pass_count <> 3 then
      raise exception 'Expected 3 chronic-pathway protocol_versions rows to pass the hardened Clinical-Director check, found %', v_pass_count;
    end if;
  end if;
end $$;

do $$
begin
  begin
    -- COPD has no protocol_versions row at all: activating it must now be
    -- rejected by the hardened trigger. The nested BEGIN/EXCEPTION block is
    -- an implicit savepoint, so this leaves no trace either way -- COPD's
    -- is_active stays false whether the test passes or fails.
    update public.chronic_condition_programmes
    set is_active = true
    where condition = 'copd';

    raise exception 'Sabotage test failed: activating COPD with no signed protocol was allowed through';
  exception
    when check_violation then
      null; -- expected: the hardened trigger correctly rejected this
  end;
end $$;
