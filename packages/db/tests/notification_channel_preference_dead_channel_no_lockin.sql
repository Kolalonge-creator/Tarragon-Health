-- ===========================================================================
-- Regression: 20260918073148_stop_honouring_dead_whatsapp_sms_channel_
--             preference.sql
--
-- THE BUG. private.remap_notification_channel() used to honour an explicit
-- 'whatsapp' or 'sms' notification_channel_preference by locking a routine
-- reminder to that exact channel. Both channels are structurally dead right
-- now (Meta WABA template approval and Termii sender-ID approval are both
-- off the founder's near-term plan, per CLAUDE.md 2026-09-15) -- live data at
-- the time of the fix showed 100% failure on both (whatsapp 382/382 failed,
-- sms 337/337 failed, zero successes ever). A patient with NO preference at
-- least got a push fallback when they had a subscription; a patient who
-- explicitly chose "WhatsApp" or "SMS" was worse off than choosing nothing --
-- locked onto a channel guaranteed to fail.
--
-- THE FIX. Only 'email' is still honoured as a direct channel pick.
-- 'whatsapp'/'sms'/null preference all fall through to the same
-- push-if-subscribed-else-whatsapp-fallback ladder that no-preference
-- already used.
--
-- This script proves, against the real trigger:
--   * an explicit 'sms' preference with no push subscription no longer
--     locks a routine notification onto 'sms' -- it falls back to the
--     whatsapp default;
--   * an explicit 'sms' preference WITH a push subscription remaps to push,
--     same as no preference at all;
--   * an explicit 'whatsapp' preference behaves identically to no preference
--     (no special-case lock-in for whatsapp either);
--   * CONTROL: an explicit 'email' preference is still honoured directly;
--   * SABOTAGE: reverting the fix (restoring a direct sms/whatsapp lock-in)
--     makes the first check fail, proving it discriminates rather than
--     passing vacuously.
--
-- Wrapped in BEGIN/ROLLBACK -- mints its own patient and redefines the
-- trigger function once for the sabotage step; the rollback undoes both.
-- ===========================================================================

begin;
create temporary table ncp_result(check_name text, observed text, expected text, verdict text) on commit drop;
create temporary table ncp_fixture(k text primary key, v uuid) on commit drop;

do $$
declare
  v_org uuid;
  v_pat uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'no organisation exists at all -- the core migrations did not run'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_pat, 'ncp-patient@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_pat, v_org, 'patient', 'Notification Channel Preference Test Patient')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = 'patient';

  insert into ncp_fixture values ('org', v_org), ('pat', v_pat);
end $$;

-- ============ 1. sms preference + no push subscription -> whatsapp fallback, NOT sms ==
do $$
declare
  v_pat uuid := (select v from ncp_fixture where k = 'pat');
  v_ch  public.notification_channel;
begin
  update public.profiles set notification_channel_preference = 'sms' where id = v_pat;

  insert into public.notifications (organisation_id, recipient_id, channel, template, priority)
  values ((select v from ncp_fixture where k = 'org'), v_pat, 'whatsapp', 'ncp_case1', 'routine')
  returning channel into v_ch;

  insert into ncp_result values
    ('explicit sms preference, no push subscription -> falls back to whatsapp, never locks to sms',
     v_ch::text, 'whatsapp', case when v_ch = 'whatsapp' then 'PASS' else 'FAIL' end);
  if v_ch = 'sms' then
    raise exception 'HOLE OPEN: an explicit sms preference still locked a routine notification onto the dead sms channel';
  end if;
end $$;

-- ============ 2. sms preference + an active push subscription -> push =================
do $$
declare
  v_pat uuid := (select v from ncp_fixture where k = 'pat');
  v_org uuid := (select v from ncp_fixture where k = 'org');
  v_ch  public.notification_channel;
begin
  insert into public.push_subscriptions (organisation_id, profile_id, endpoint, p256dh_key, auth_key)
  values (v_org, v_pat, 'https://push.example.invalid/ncp-test-endpoint', 'p256dh-test-key', 'auth-test-key');

  insert into public.notifications (organisation_id, recipient_id, channel, template, priority)
  values (v_org, v_pat, 'whatsapp', 'ncp_case2', 'routine')
  returning channel into v_ch;

  insert into ncp_result values
    ('explicit sms preference + an active push subscription -> remaps to push, same as no preference',
     v_ch::text, 'push', case when v_ch = 'push' then 'PASS' else 'FAIL' end);
  if v_ch <> 'push' then
    raise exception 'FAIL: an sms preference with a push subscription on file did not remap to push (got %)', v_ch;
  end if;
end $$;

-- ============ 3. whatsapp preference behaves identically -- no special-case lock-in ====
do $$
declare
  v_pat uuid := (select v from ncp_fixture where k = 'pat');
  v_org uuid := (select v from ncp_fixture where k = 'org');
  v_ch  public.notification_channel;
begin
  update public.profiles set notification_channel_preference = 'whatsapp' where id = v_pat;

  -- still has the push subscription from case 2 -- must still remap to push,
  -- proving 'whatsapp' gets no special-case treatment either.
  insert into public.notifications (organisation_id, recipient_id, channel, template, priority)
  values (v_org, v_pat, 'whatsapp', 'ncp_case3', 'routine')
  returning channel into v_ch;

  insert into ncp_result values
    ('explicit whatsapp preference + an active push subscription -> remaps to push, not specially honoured',
     v_ch::text, 'push', case when v_ch = 'push' then 'PASS' else 'FAIL' end);
  if v_ch <> 'push' then
    raise exception 'FAIL: an explicit whatsapp preference is being specially honoured again (got %)', v_ch;
  end if;
end $$;

-- ============ 4. CONTROL: email preference is still honoured directly ==================
do $$
declare
  v_pat uuid := (select v from ncp_fixture where k = 'pat');
  v_org uuid := (select v from ncp_fixture where k = 'org');
  v_ch  public.notification_channel;
begin
  update public.profiles set notification_channel_preference = 'email' where id = v_pat;

  insert into public.notifications (organisation_id, recipient_id, channel, template, priority)
  values (v_org, v_pat, 'whatsapp', 'ncp_case4', 'routine')
  returning channel into v_ch;

  insert into ncp_result values
    ('CONTROL: an explicit email preference is still honoured directly',
     v_ch::text, 'email', case when v_ch = 'email' then 'PASS' else 'FAIL' end);
  if v_ch <> 'email' then
    raise exception 'REGRESSION: an email preference is no longer honoured (got %)', v_ch;
  end if;

  update public.profiles set notification_channel_preference = null where id = v_pat;
end $$;

-- ============ 5. SABOTAGE: restoring the old sms/whatsapp lock-in reopens the hole =====
do $$
declare
  v_pat uuid := (select v from ncp_fixture where k = 'pat');
  v_org uuid := (select v from ncp_fixture where k = 'org');
  v_ch  public.notification_channel;
begin
  create or replace function private.remap_notification_channel()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $function$
  declare
    v_has_push boolean;
    v_pref public.notification_channel;
  begin
    if new.priority = 'critical' then
      return new;
    end if;

    if new.channel = 'whatsapp' and new.recipient_id is not null then
      select notification_channel_preference into v_pref
      from public.profiles where id = new.recipient_id;

      -- SABOTAGE: reinstate the pre-fix direct lock-in for sms/whatsapp.
      if v_pref in ('email', 'sms', 'whatsapp') then
        new.channel := v_pref;
        return new;
      end if;

      select exists (
        select 1 from public.push_subscriptions
        where profile_id = new.recipient_id and disabled_at is null
      ) into v_has_push;
      if v_has_push then
        new.channel := 'push';
      end if;
    end if;
    return new;
  end;
  $function$;

  update public.profiles set notification_channel_preference = 'sms' where id = v_pat;

  insert into public.notifications (organisation_id, recipient_id, channel, template, priority)
  values (v_org, v_pat, 'whatsapp', 'ncp_sabotage', 'routine')
  returning channel into v_ch;

  insert into ncp_result values
    ('SABOTAGE: reinstating the old sms/whatsapp lock-in reopens the hole (proves check 1 discriminates)',
     v_ch::text, 'sms', case when v_ch = 'sms' then 'PASS' else 'FAIL' end);
  if v_ch <> 'sms' then
    raise exception 'VACUOUS TEST: sabotaging the fix did not reopen the hole -- check 1 proves nothing (got %)', v_ch;
  end if;
end $$;

select check_name, observed, expected, verdict from ncp_result order by check_name;
rollback;
