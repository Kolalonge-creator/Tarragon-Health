-- S04b-3: quiet hours are OFF until a person turns them on (founder decision 2026-10-13); discreet mode and quiet hours
-- are enforced for every sender in send-pending-notifications (code change, no schema needed for that).
--   1. notification_rules_config v3: same as v2 but quietHours.enabled = false (PROPOSED, mirrored as notifications.rules v3).
--   2. notification_settings.quiet_enabled defaults to false, and set_my_notification_settings() treats a null as false.
--   3. Saving settings releases that person's own held reminders (the sender decides them again), so nothing waits for a
--      window they no longer use. A null choice means "no change" (off if there is no row yet).
-- Row counts at writing (live): notification_settings 0 rows, profiles.discreet_mode true 0 rows, so no conversion step.
-- Safety rule unchanged: critical rows, safety templates and the in-app inbox are never held (sender code, delivery.ts).

update public.notification_rules_config set is_active = false where is_active;
insert into public.notification_rules_config (version, is_active, config, note) values
  (3, true,
   '{"quietHours":{"enabled":false,"start":"21:00","end":"07:00"},"routinePushPerDay":4,"receiptCheckMinutes":15,"receiptGiveUpHours":24,"pushFallback":{"enabled":true,"afterMinutes":240,"maxAgeHours":24,"perRecipientPerDay":1,"batchSize":200}}'::jsonb,
   'S04b-3 PROPOSED: quiet hours default off; a person turns them on in settings (window 21:00 to 07:00 Africa/Lagos until they change it).');

alter table public.notification_settings alter column quiet_enabled set default false;

create or replace function public.set_my_notification_settings(p_quiet_enabled boolean, p_quiet_start time, p_quiet_end time, p_discreet boolean)
returns void language plpgsql security definer set search_path = pg_catalog, public as $fn$
declare v_uid uuid := auth.uid(); v_org uuid; v_on boolean;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_quiet_start is null or p_quiet_end is null or p_quiet_start = p_quiet_end then
    raise exception 'quiet hours need two different times' using errcode = '22023';
  end if;
  select organisation_id into v_org from public.profiles where id = v_uid;
  if v_org is null then raise exception 'no profile' using errcode = '42501'; end if;
  -- A null choice means "no change": keep what is stored, or off for someone with no row yet.
  v_on := coalesce(p_quiet_enabled, (select quiet_enabled from public.notification_settings where profile_id = v_uid), false);
  insert into public.notification_settings (profile_id, organisation_id, quiet_enabled, quiet_start, quiet_end)
  values (v_uid, v_org, v_on, p_quiet_start, p_quiet_end)
  on conflict (profile_id) do update
    set quiet_enabled = excluded.quiet_enabled, quiet_start = excluded.quiet_start,
        quiet_end = excluded.quiet_end, updated_at = now();
  if p_discreet is not null then
    update public.profiles set discreet_mode = p_discreet where id = v_uid;
  end if;
  -- On any save, release this person's own reminders that were held only because of quiet hours (they have a
  -- deferred_quiet event). The sender decides them again on its next pass, so a shorter window or quiet hours turned
  -- off take effect at once, and a window still in force simply holds them again.
  update public.notifications n set send_after = null
   where n.recipient_id = v_uid and n.status = 'pending' and n.priority = 'routine'
     and n.channel in ('push', 'email') and n.send_after > now()
     and exists (select 1 from public.notification_delivery_events e where e.notification_id = n.id and e.event = 'deferred_quiet');
end $fn$;
revoke all on function public.set_my_notification_settings(boolean, time, time, boolean) from public, anon;
grant execute on function public.set_my_notification_settings(boolean, time, time, boolean) to authenticated;

do $do$
begin
  if (select count(*) from public.notification_rules_config where is_active) <> 1 then raise exception 'S04b-3: not exactly one active rules row'; end if;
  if (select (config -> 'quietHours' ->> 'enabled')::boolean from public.notification_rules_config where is_active) then raise exception 'S04b-3: quiet hours default must be off'; end if;
  if has_function_privilege('anon', 'public.set_my_notification_settings(boolean,time,time,boolean)', 'EXECUTE') then raise exception 'S04b-3: anon can execute the settings function'; end if;
end $do$;
