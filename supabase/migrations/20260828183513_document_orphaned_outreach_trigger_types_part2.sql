-- Tarragon Health — second half of documenting the two outreach_trigger_type
-- enum values found live with no migration record. See
-- document_orphaned_outreach_trigger_types for the full explanation; split
-- into two migrations because Postgres only allows one new enum value per
-- ALTER TYPE ... ADD VALUE statement per migration boundary here.

alter type public.outreach_trigger_type add value if not exists 'consultation_follow_up';

do $$
begin
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'outreach_trigger_type' and e.enumlabel = 'repeated_no_show'
  ) then
    raise exception 'FAIL: repeated_no_show is not on outreach_trigger_type';
  end if;
  if not exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'outreach_trigger_type' and e.enumlabel = 'consultation_follow_up'
  ) then
    raise exception 'FAIL: consultation_follow_up is not on outreach_trigger_type';
  end if;
  raise notice 'PASS: both previously-undocumented outreach_trigger_type values now recorded';
end $$;
