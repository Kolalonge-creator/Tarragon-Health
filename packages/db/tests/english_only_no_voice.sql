-- Voice is unreachable, and removing it did not break push-first routing.
--
-- The second half is the point: the voice branch used to share a function with
-- the push-first rule, so a careless removal would silently take both out and
-- nobody would notice until reminders quietly stopped reaching phones. Since
-- the 2026-09-30 channel cleanup, that rule lives in
-- private.patient_reminder_channel(), which must never return voice.
--
-- Run:  npx supabase db query --linked -f packages/db/tests/english_only_no_voice.sql

begin;

do $$
declare
  -- Minted rather than a hardcoded live patient id: that id exists only on the
  -- populated project, so on a fresh `supabase db reset` the UPDATE below
  -- touched zero rows and the notifications INSERT died on its foreign key.
  -- A fresh patient is also the right fixture for check 1, which depends on
  -- there being NO push subscription yet.
  v_patient uuid := gen_random_uuid();
  v_org     uuid := '00000000-0000-0000-0000-000000000001';
  v_channel text;
  v_sub     uuid;
begin
  if not exists (select 1 from public.organisations where id = v_org) then
    insert into public.organisations (id, name, type)
    values (v_org, 'English Only Test Org', 'clinic');
  end if;
  insert into auth.users (id, email)
  values (v_patient, 'englishonly-test-patient@example.invalid');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_patient, v_org, 'patient', 'English Only Test Patient')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role,
        full_name = excluded.full_name;

  -- 1. A stale voice preference must NOT produce a voice notification.
  update public.profiles set preferred_reminder_channel = 'voice' where id = v_patient;
  if not found then
    raise exception 'VACUOUS: the voice preference was not applied to the fixture patient';
  end if;

  v_channel := private.patient_reminder_channel(v_patient)::text;

  if v_channel = 'voice' then
    raise exception 'FAIL 1: a stale voice preference still routed a reminder to voice';
  end if;
  if v_channel <> 'in_app' then
    raise exception 'FAIL 1b: expected in_app with no push subscription, got %', v_channel;
  end if;
  raise notice 'PASS 1: a stale voice preference no longer routes to voice (channel=%)', v_channel;

  -- 2. POSITIVE CONTROL: push-first still works. Without this, check 1 would
  --    pass just as well on a function that had been gutted entirely.
  insert into public.push_subscriptions
    (organisation_id, profile_id, endpoint, p256dh_key, auth_key)
  values (v_org, v_patient, 'https://example.test/endpoint-' || gen_random_uuid()::text, 'k', 'a')
  returning id into v_sub;

  v_channel := private.patient_reminder_channel(v_patient)::text;

  if v_channel <> 'push' then
    raise exception 'FAIL 2: push-first routing was lost, got % instead of push', v_channel;
  end if;
  raise notice 'PASS 2: push-first routing survives, even for a voice-preferring patient';

  -- 3. Nothing anywhere still assigns voice.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('private', 'public')
      -- prokind 'f' only: pg_get_functiondef raises on aggregates and window
      -- functions, which is how an earlier draft of this check failed.
      and p.prokind = 'f'
      and pg_get_functiondef(p.oid) like '%channel := ''voice''%'
  ) then
    raise exception 'FAIL 3: some function still assigns the voice channel';
  end if;
  raise notice 'PASS 3: no function on the platform assigns the voice channel';

  -- 4. SABOTAGE: a helper that honoured the stored voice preference must trip
  --    check 1 (proves the voice check can fail).
  declare v_sab text;
  begin
    begin
      create or replace function private.patient_reminder_channel(p_recipient uuid, p_allow_email boolean default true)
      returns public.notification_channel language sql stable as $f$ select 'voice'::public.notification_channel $f$;
      v_sab := private.patient_reminder_channel(v_patient)::text;
      raise exception 'sabotage_undo';
    exception when others then
      if sqlerrm <> 'sabotage_undo' then raise; end if;
    end;
    if v_sab is distinct from 'voice' then
      raise exception 'VACUOUS: the sabotaged helper did not return voice, so check 1 proves nothing';
    end if;
  end;
  raise notice 'PASS 4: sabotage (a helper returning voice) is what check 1 detects';

  raise notice 'ALL ENGLISH-ONLY / NO-VOICE CHECKS PASSED';
end $$;

rollback;
