-- Tarragon Health — Diagnostic Safety Pathway, part 2/6: closure criteria
-- (60.12).
--
-- "A result should not be marked Closed until the defined action has been
-- completed." This is the headline safety mechanic of the whole spec — the
-- closest existing precedent is clinician_alerts_closed_requires_resolved
-- (a CHECK that closed implies resolved_at is set) and
-- case_review_actions' required_authority gating, but neither enforces a
-- multi-step checklist. This migration adds that enforcement as a BEFORE
-- UPDATE trigger (not a CHECK constraint) because the required steps are
-- conditional on requires_referral/requires_repeat_test, which a plain
-- column CHECK cannot express clearly — a trigger can name exactly what's
-- still missing in the raised exception, which a generic constraint
-- violation cannot.
--
-- Runs BEFORE private.stamp_diagnostic_episode_lifecycle() (part 1) so a
-- rejected close never reaches the stamping trigger at all — Postgres fires
-- BEFORE ROW triggers in alphabetical order by trigger name, and
-- 'diagnostic_episodes_enforce_closure' sorts before
-- 'diagnostic_episodes_stamp_lifecycle', so the gate is checked first.

create or replace function private.enforce_diagnostic_episode_closure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_missing text[] := '{}';
begin
  if new.status <> 'closed' or old.status = 'closed' then
    return new;
  end if;

  if new.reviewed_at is null then
    v_missing := v_missing || 'clinical review not recorded';
  end if;

  if new.patient_informed_at is null then
    v_missing := v_missing || 'patient not informed';
  end if;

  if new.requires_referral and new.referral_id is null then
    v_missing := v_missing || 'referral required but not created';
  end if;

  if new.requires_referral and new.referral_id is not null and new.referral_completed_at is null then
    v_missing := v_missing || 'referral created but specialist not yet seen';
  end if;

  if new.requires_repeat_test and new.repeat_test_completed_at is null then
    v_missing := v_missing || 'repeat test required but not completed';
  end if;

  if (new.requires_referral or new.requires_repeat_test) and new.outcome_received_at is null then
    v_missing := v_missing || 'outcome not received/reviewed';
  end if;

  if new.follow_up_completed_at is null then
    v_missing := v_missing || 'follow-up not completed';
  end if;

  if array_length(v_missing, 1) > 0 then
    raise exception 'Cannot close diagnostic episode %: %', new.id, array_to_string(v_missing, '; ')
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function private.enforce_diagnostic_episode_closure() is
  '60.12 closure criteria. Blocks status -> closed unless: reviewed, patient informed, referral made + specialist seen (only if requires_referral), repeat test completed (only if requires_repeat_test), outcome received (whenever either follow-up track was required), and follow-up completed. Names exactly what''s missing in the exception so a clinician sees a real checklist, not a generic constraint failure. Runs before diagnostic_episodes_stamp_lifecycle (alphabetical BEFORE-trigger ordering) so a rejected close never reaches the stamping step.';

create trigger diagnostic_episodes_enforce_closure
  before update on public.diagnostic_episodes
  for each row execute function private.enforce_diagnostic_episode_closure();

-- Belt-and-suspenders structural backstop matching
-- clinician_alerts_closed_requires_resolved's own precedent: even if some
-- future code path bypassed the trigger (it can't, on this table's own
-- normal UPDATE path — this is defence in depth, not the primary gate).
alter table public.diagnostic_episodes
  add constraint diagnostic_episodes_closed_requires_review
  check (status <> 'closed' or (reviewed_at is not null and patient_informed_at is not null and follow_up_completed_at is not null));

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'diagnostic_episodes_enforce_closure'
      and tgrelid = 'public.diagnostic_episodes'::regclass and not tgisinternal
  ) then
    raise exception 'diagnostic_episodes_enforce_closure trigger was not created';
  end if;
  raise notice 'PASS: diagnostic episode closure-criteria trigger + backstop CHECK installed';
end $$;
