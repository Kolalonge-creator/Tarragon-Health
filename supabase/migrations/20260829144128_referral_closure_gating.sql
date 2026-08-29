-- Tarragon Health — Specialist Care Coordination & Continuity Engine, part 7/7a
-- Referral closure gating — spec §70.12:
--   "A referral is only closed when: Consultation completed + Report
--    received + Plan acknowledged + Required action assigned."
--
-- Until now useCloseReferral let any org staff flip status to 'completed'
-- unconditionally — a pure worklist checkbox with no guarantee the loop this
-- whole module exists to close was actually closed. This is the DB-level
-- guardrail, same posture as specialist_referrals_waitlist_requires_plan
-- (the existing "doctor must document an interim plan before waitlisting"
-- CHECK) and the other regulated-clinical-action CHECK constraints CLAUDE.md
-- calls for.
--
-- A trigger, not a plain CHECK constraint, because "no action item still
-- open" requires looking at OTHER tables (care_outreach_tasks /
-- care_plan_review_prompts), which a CHECK constraint cannot do.
--
-- 'declined' is unaffected — cancelling a referral never needed any of this
-- and still doesn't.

create or replace function private.enforce_referral_closure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_open_items integer;
begin
  if new.status <> 'completed' or old.status = 'completed' then
    return new;
  end if;

  if new.treatment_plan_received_at is null then
    raise exception 'Cannot close this referral yet — no specialist report has been received. Upload the report or record the treatment plan first.'
      using errcode = '23514';
  end if;

  if new.plan_acknowledged_at is null then
    raise exception 'Cannot close this referral yet — the specialist''s plan has not been acknowledged by a clinician.'
      using errcode = '23514';
  end if;

  select count(*) into v_open_items
  from public.specialist_referral_action_items i
  left join public.care_outreach_tasks t on t.id = i.linked_outreach_task_id
  left join public.care_plan_review_prompts p on p.id = i.linked_care_plan_review_prompt_id
  where i.referral_id = new.id
    and (
      (t.id is not null and t.status not in ('resolved', 'dismissed'))
      or (p.id is not null and p.status = 'open')
    );

  if v_open_items > 0 then
    raise exception 'Cannot close this referral yet — % action item(s) from the specialist''s plan are still open.', v_open_items
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

comment on function private.enforce_referral_closure() is
  'Spec §70.12 — blocks a referral from reaching status=completed until a report has been received, the plan acknowledged by a clinician, and every specialist_referral_action_items row for it is resolved on its routed downstream table.';

drop trigger if exists specialist_referrals_enforce_closure on public.specialist_referrals;
create trigger specialist_referrals_enforce_closure
  before update on public.specialist_referrals
  for each row execute function private.enforce_referral_closure();

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'specialist_referrals_enforce_closure'
      and tgrelid = 'public.specialist_referrals'::regclass and not tgisinternal
  ) then
    raise exception 'specialist_referrals_enforce_closure trigger is missing';
  end if;
end $$;
