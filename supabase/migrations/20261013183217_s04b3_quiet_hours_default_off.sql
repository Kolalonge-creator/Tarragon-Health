-- S04b-3: quiet hours are OFF until a person turns them on (founder decision 2026-10-13); discreet mode and quiet hours
-- are enforced for every sender in send-pending-notifications (code change, no schema needed for that).
--   1. notification_rules_config v3: same as v2 but quietHours.enabled = false (PROPOSED, mirrored as notifications.rules v3).
--   2. notification_settings.quiet_enabled defaults to false, and set_my_notification_settings() treats a null as false.
--   3. Saving settings releases that person's own held reminders (the sender decides them again), so nothing waits for a
--      window they no longer use. A null choice means "no change" (off if there is no row yet).
-- Row counts at writing (live): notification_settings 0 rows, profiles.discreet_mode true 0 rows, so no conversion step.
-- Safety rule unchanged: critical rows, safety templates and the in-app inbox are never held (sender code, delivery.ts).

-- Read the live active row rather than a copy of it: take max(version) + 1, keep every other setting as it is, and
-- only switch quiet hours off.
do $rules$
declare v_cfg jsonb; v_next integer;
begin
  select config into v_cfg from public.notification_rules_config where is_active order by version desc limit 1;
  if v_cfg is null then raise exception 'S04b-3: no active notification_rules_config row to copy'; end if;
  select max(version) + 1 into v_next from public.notification_rules_config;
  update public.notification_rules_config set is_active = false where is_active;
  insert into public.notification_rules_config (version, is_active, config, note) values
    (v_next, true, jsonb_set(v_cfg, '{quietHours,enabled}', 'false'::jsonb, true),
     'S04b-3 PROPOSED: quiet hours default off; a person turns them on in settings (window 21:00 to 07:00 Africa/Lagos until they change it). All other values copied from the previous active row.');
end $rules$;

-- One new delivery event: a discreet patient's email carried no document; it is open in the app.
alter table public.notification_delivery_events drop constraint if exists notification_delivery_events_event_check;
alter table public.notification_delivery_events add constraint notification_delivery_events_event_check
  check (event in ('accepted','receipt_pending','delivered','opened','failed','bounced','complained','deferred_quiet','suppressed_cap','blocked_inv07','token_dead','email_fallback_queued','discreet_document_in_app'));

alter table public.notification_settings alter column quiet_enabled set default false;

-- Reminders already held under the old default (quiet hours on for everyone) belong to people who never chose that:
-- release them so the sender decides them again under the new default. Anyone who did opt in is re-held by the sender.
update public.notifications n set send_after = null
 where n.status = 'pending' and n.priority = 'routine' and n.channel in ('push', 'email') and n.send_after > now()
   and exists (select 1 from public.notification_delivery_events e where e.notification_id = n.id and e.event = 'deferred_quiet')
   and not exists (select 1 from public.notification_settings s where s.profile_id = n.recipient_id and s.quiet_enabled);

create or replace function public.set_my_notification_settings(p_quiet_enabled boolean, p_quiet_start time, p_quiet_end time, p_discreet boolean)
returns void language plpgsql security definer set search_path = pg_catalog, public as $fn$
declare v_uid uuid := auth.uid(); v_org uuid; v_on boolean; v_old_on boolean; v_old_start time; v_old_end time;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_quiet_start is null or p_quiet_end is null or p_quiet_start = p_quiet_end then
    raise exception 'quiet hours need two different times' using errcode = '22023';
  end if;
  select organisation_id into v_org from public.profiles where id = v_uid;
  if v_org is null then raise exception 'no profile' using errcode = '42501'; end if;
  -- A null choice means "no change": keep what is stored, or off for someone with no row yet.
  select quiet_enabled, quiet_start, quiet_end into v_old_on, v_old_start, v_old_end from public.notification_settings where profile_id = v_uid;
  v_on := coalesce(p_quiet_enabled, v_old_on, false);
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
  -- Only when the quiet-hours choice itself changed (not on a discreet-only save).
  if v_old_on is not null and (v_old_on is distinct from v_on or v_old_start is distinct from p_quiet_start or v_old_end is distinct from p_quiet_end) then
    update public.notifications n set send_after = null
     where n.recipient_id = v_uid and n.status = 'pending' and n.priority = 'routine'
       and n.channel in ('push', 'email') and n.send_after > now()
       and exists (select 1 from public.notification_delivery_events e where e.notification_id = n.id and e.event = 'deferred_quiet');
  end if;
end $fn$;
revoke all on function public.set_my_notification_settings(boolean, time, time, boolean) from public, anon;
grant execute on function public.set_my_notification_settings(boolean, time, time, boolean) to authenticated;

do $do$
begin
  if (select count(*) from public.notification_rules_config where is_active) <> 1 then raise exception 'S04b-3: not exactly one active rules row'; end if;
  if coalesce((select (config -> 'quietHours' ->> 'enabled')::boolean from public.notification_rules_config where is_active), true) then raise exception 'S04b-3: quiet hours default must be off'; end if;
  if has_function_privilege('anon', 'public.set_my_notification_settings(boolean,time,time,boolean)', 'EXECUTE') then raise exception 'S04b-3: anon can execute the settings function'; end if;
end $do$;
