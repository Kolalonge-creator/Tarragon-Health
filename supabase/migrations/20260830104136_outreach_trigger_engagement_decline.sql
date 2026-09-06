-- Tarragon Health — new outreach_trigger_type value for a patient newly
-- crossing into at_risk/disengaged (Engagement/Retention gap #2).
-- Own migration per the ALTER TYPE ADD VALUE transaction restriction.

alter type public.outreach_trigger_type add value if not exists 'engagement_decline';

do $$
begin
  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'outreach_trigger_type' and e.enumlabel = 'engagement_decline'
  ) then
    raise exception 'FAIL: outreach_trigger_type is missing engagement_decline';
  end if;
  raise notice 'PASS: outreach_trigger_type.engagement_decline added';
end $$;
