-- Wire up the broadcast content guard, which has existed and done nothing.
--
-- `private.broadcast_content_flags(text)` is live and correct: it matches the
-- phrasings that turn a bulk message into a disclosure of somebody's personal
-- clinical result ("your diagnosis", "your test result", "abnormal result",
-- "you have been diagnosed", and nine more). Found 2026-09-05 while moving
-- proof scripts into CI: **nothing calls it.**
--
--   private.broadcast_content_flags               exists
--   public.admin_send_broadcast calls it          false
--   CHECK constraints on notification_broadcasts  channels_nonempty, only
--   triggers on notification_broadcasts           set_updated_at, only
--
-- So a broadcast reading "Your diagnosis is confirmed, please call the clinic"
-- is accepted and delivered to `all_patients`. The helper was written to stop
-- exactly that and was never connected to anything.
--
-- Enforced with a trigger rather than inside `admin_send_broadcast`, because
-- the RPC is one way in and the table is directly writable by an admin session.
-- A guard that only covers the tidy path is the same class of mistake as the
-- one this fixes: the function existed, the call site did not.
--
-- Both `title` and `body` are scanned. A title is the part most likely to be
-- read on a lock screen, so exempting it would leave the worst case open.
--
-- Deliberately NOT scoped to non-marketing broadcasts: `is_marketing` says who
-- the message is for, not whether it may quote somebody's result.

create or replace function private.enforce_broadcast_content_class()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_flags text[];
begin
  v_flags := private.broadcast_content_flags(coalesce(new.title, '') || ' ' || coalesce(new.body, ''));

  if array_length(v_flags, 1) is not null then
    raise exception using
      errcode = '23514',
      message = 'This broadcast reads like a personal clinical result, which cannot be sent to a group.',
      detail  = 'Matched: ' || array_to_string(v_flags, '; '),
      hint    = 'A broadcast goes to many people at once, so it must not quote anybody''s diagnosis, test result or reading. Tell people a result is ready and let them open it in the app.';
  end if;

  return new;
end;
$function$;

revoke all on function private.enforce_broadcast_content_class() from public, anon;
grant execute on function private.enforce_broadcast_content_class() to authenticated, service_role;

drop trigger if exists notification_broadcasts_content_class on public.notification_broadcasts;
create trigger notification_broadcasts_content_class
  before insert or update of title, body on public.notification_broadcasts
  for each row execute function private.enforce_broadcast_content_class();

-- Prove it, both directions, plus the anon-execute check this project keeps
-- regressing on.
do $$
declare
  v_org uuid; v_admin uuid := gen_random_uuid(); v_blocked boolean := false; v_id uuid;
begin
  if has_function_privilege('anon', 'private.enforce_broadcast_content_class()', 'EXECUTE') then
    raise exception 'anon can execute the new guard';
  end if;

  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_admin, 'broadcast-guard-proof@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_admin, v_org, 'admin', 'Broadcast Guard Proof')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;

  begin
    insert into public.notification_broadcasts (created_by, title, body, audience, channels)
    values (v_admin, 'Clinic update', 'Your diagnosis is confirmed, please call the clinic.',
            'all_patients', array['in_app']::public.notification_channel[]);
  exception when check_violation then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'FAIL: a broadcast quoting a diagnosis was accepted';
  end if;

  -- Control: an ordinary broadcast must still go through, or the guard is
  -- just an outage.
  insert into public.notification_broadcasts (created_by, title, body, audience, channels)
  values (v_admin, 'Clinic hours', 'We are open until 6pm on Saturdays this month.',
          'all_patients', array['in_app']::public.notification_channel[])
  returning id into v_id;
  if v_id is null then
    raise exception 'FAIL: an ordinary broadcast was refused';
  end if;

  raise notice 'broadcast content guard: personal-result phrasing refused, ordinary broadcast accepted';
end $$;
