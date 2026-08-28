-- Tarragon Health — polypharmacy detection, enum groundwork (13.15)
--
-- Adds the 6th trigger-event value to care_plan_review_trigger_event
-- (20260717223000_care_plan_review_prompts.sql's 5-source worklist) ahead of
-- the trigger that will use it — same split-migration reasoning as
-- medication_log_status above: ALTER TYPE ... ADD VALUE cannot be used in
-- the same transaction that references the new value.

do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'care_plan_review_trigger_event' and e.enumlabel = 'polypharmacy_threshold'
  ) then
    alter type public.care_plan_review_trigger_event add value 'polypharmacy_threshold';
  end if;
end $$;

do $$
begin
  if (select count(*) from pg_enum where enumtypid = 'public.care_plan_review_trigger_event'::regtype) <> 6 then
    raise exception 'care_plan_review_trigger_event must have exactly 6 values';
  end if;
  raise notice 'PASS: care_plan_review_trigger_event gained polypharmacy_threshold';
end $$;
