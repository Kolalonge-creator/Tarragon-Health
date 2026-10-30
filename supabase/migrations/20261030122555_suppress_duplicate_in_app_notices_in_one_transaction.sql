-- Events harness sweep: one guard so the same in-app notice is never shown twice.
--
-- About 22 producers write an explicit in-app row and then a second row on private.patient_reminder_channel(), which falls back to the
-- in-app inbox for any patient with no email preference and no push subscription. The patient then saw the same notice twice
-- (docs/design/EVENTS-HARNESS-NOTICE-SWEEP.md has the list; production showed it for medication check-ins, prescribed notices and
-- emergency follow-ups). The lab producers were fixed one by one in E8 (20261030094754); doing the same to twenty more bodies is slow
-- and the next producer repeats it.
--
-- This marks an in-app notice `suppressed` when an identical one (same recipient, template, payload and source) was already written
-- in the same transaction. Same transaction means the same `created_at` (the default now()), so a legitimate repeat later is untouched.
-- The row is kept rather than dropped so a producer that does `insert ... returning id` still gets an id, and the inbox already hides
-- suppressed rows (web and mobile both filter `status not in (failed, suppressed)`). It acts only on pending in-app rows; every other
-- channel is untouched.
-- Proof: packages/db/tests/events_duplicate_in_app_notice_guard.sql.

create or replace function private.suppress_duplicate_in_app_notice()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.channel = 'in_app' and new.status = 'pending' and new.recipient_id is not null
     and exists (
       select 1 from public.notifications n
        where n.recipient_id = new.recipient_id
          and n.created_at = new.created_at
          and n.channel = 'in_app'
          and n.status <> 'suppressed'
          and n.id <> new.id
          and n.template is not distinct from new.template
          and n.payload is not distinct from new.payload
          and n.source_table is not distinct from new.source_table
          and n.source_id is not distinct from new.source_id
     )
  then
    new.status := 'suppressed';
  end if;
  return new;
end;
$function$;

revoke all on function private.suppress_duplicate_in_app_notice() from public;

-- Named to run after every other BEFORE INSERT trigger on the table, so it sees the final channel and status.
drop trigger if exists notifications_zz_suppress_duplicate_in_app on public.notifications;
create trigger notifications_zz_suppress_duplicate_in_app
  before insert on public.notifications
  for each row execute function private.suppress_duplicate_in_app_notice();

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'notifications_zz_suppress_duplicate_in_app' and tgrelid = 'public.notifications'::regclass and not tgisinternal) then
    raise exception 'the duplicate in-app guard was not created';
  end if;
end $$;
