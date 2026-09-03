-- Emergency card hardening: expiry, renewal nudge, and per-day view
-- notification dedupe. Every check pairs a negative with a positive control.
--
-- NOTE: emergency_cards has SELECT-only RLS for the patient — expires_at /
-- renewal_nudged_at / last_viewed_on are all mutable only through the
-- SECURITY DEFINER RPCs. So test-fixture mutations of those columns run under
-- the connection's own (superuser) role, which bypasses RLS entirely, same as
-- any other fixture setup in this repo's test suites; only the RPC calls
-- themselves are run under a simulated authenticated/anon session.
--
-- Run:  npx supabase db query --linked -f packages/db/tests/emergency_card_hardening.sql

begin;

do $$
declare
  v_patient uuid := '8487376b-7844-428a-bcb8-8795e89eb0f5';
  v_token   text;
  v_payload jsonb;
  v_count   integer;
  v_id      uuid;
begin
  -- Create the card as the real patient session, since create_emergency_card
  -- deliberately only ever acts on auth.uid().
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_token := public.create_emergency_card();
  reset role;

  -- 1. A fresh card carries a real 12-month expiry.
  if (select expires_at from public.emergency_cards where patient_id = v_patient)
     < now() + interval '11 months' then
    raise exception 'FAIL 1: a fresh card does not carry a 12-month expiry';
  end if;
  raise notice 'PASS 1: a fresh card expires roughly 12 months out';

  -- 2. NEGATIVE: an expired card resolves to nothing, same as revoked.
  update public.emergency_cards set expires_at = now() - interval '1 day'
  where patient_id = v_patient;

  perform set_config('request.jwt.claims', null, true);
  set local role anon;
  v_payload := public.emergency_card_by_token(v_token);
  reset role;

  if v_payload is not null then
    raise exception 'FAIL 2: an expired card still resolved';
  end if;
  raise notice 'PASS 2: an expired card stops resolving, same as a revoked one';

  -- 3. POSITIVE CONTROL: a not-yet-expired card still works — proves check 2
  --    is really about expiry, not something else broken.
  update public.emergency_cards set expires_at = now() + interval '6 months'
  where patient_id = v_patient;

  perform set_config('request.jwt.claims', null, true);
  set local role anon;
  v_payload := public.emergency_card_by_token(v_token);
  reset role;

  if v_payload is null then
    raise exception 'FAIL 3: a card with real time left did not resolve';
  end if;
  raise notice 'PASS 3: a card with time left still resolves';

  -- 4. Per-day view-notification dedupe: a second read the SAME day must not
  --    add a second notification pair.
  perform set_config('request.jwt.claims', null, true);
  set local role anon;
  perform public.emergency_card_by_token(v_token);
  reset role;

  select count(*) into v_count from public.notifications
  where recipient_id = v_patient and template = 'emergency_card_viewed';
  if v_count <> 2 then  -- exactly one in_app + one email, from check 3's read
    raise exception 'FAIL 4: expected exactly 2 view notifications after 2 reads same day, got %', v_count;
  end if;
  raise notice 'PASS 4: two reads in one day produced exactly one notification pair, not two';

  -- 5. POSITIVE CONTROL: simulate a new day and confirm a fresh read DOES
  --    notify again — proves check 4 is real dedupe, not a broken insert.
  update public.emergency_cards set last_viewed_on = current_date - 1
  where patient_id = v_patient;

  perform set_config('request.jwt.claims', null, true);
  set local role anon;
  perform public.emergency_card_by_token(v_token);
  reset role;

  select count(*) into v_count from public.notifications
  where recipient_id = v_patient and template = 'emergency_card_viewed';
  if v_count <> 4 then
    raise exception 'FAIL 5: a new day did not produce a fresh notification pair, got %', v_count;
  end if;
  raise notice 'PASS 5: a new calendar day produces a fresh view notification';

  -- 6. Renewal nudge: a card 10 days from expiry gets nudged exactly once.
  update public.emergency_cards
  set expires_at = now() + interval '10 days', renewal_nudged_at = null
  where patient_id = v_patient
  returning id into v_id;

  perform private.queue_emergency_card_expiry_nudges();
  select count(*) into v_count from public.notifications
  where recipient_id = v_patient and template = 'emergency_card_expiring_soon';
  if v_count <> 2 then
    raise exception 'FAIL 6: expected 2 nudge notifications (in_app+email), got %', v_count;
  end if;
  if (select renewal_nudged_at from public.emergency_cards where id = v_id) is null then
    raise exception 'FAIL 6b: renewal_nudged_at was not stamped';
  end if;
  raise notice 'PASS 6: a card 10 days from expiry is nudged, exactly once';

  -- 7. NEGATIVE: running the nudge cron again does NOT re-notify the same card.
  perform private.queue_emergency_card_expiry_nudges();
  select count(*) into v_count from public.notifications
  where recipient_id = v_patient and template = 'emergency_card_expiring_soon';
  if v_count <> 2 then
    raise exception 'FAIL 7: a second cron run re-notified an already-nudged card, count=%', v_count;
  end if;
  raise notice 'PASS 7: re-running the nudge cron does not double-notify';

  -- 8. NEGATIVE: a card 60 days out is not nudged at all.
  update public.emergency_cards
  set expires_at = now() + interval '60 days', renewal_nudged_at = null
  where patient_id = v_patient;
  perform private.queue_emergency_card_expiry_nudges();
  if (select renewal_nudged_at from public.emergency_cards where patient_id = v_patient) is not null then
    raise exception 'FAIL 8: a card 60 days from expiry was nudged early';
  end if;
  raise notice 'PASS 8: a card well outside the 30-day window is left alone';

  -- 9. Rotating (renewing) resets the nudge/expiry state cleanly — this call
  --    is the one genuinely acting as the patient, per create_emergency_card's
  --    own contract.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.create_emergency_card();
  reset role;

  if (select renewal_nudged_at from public.emergency_cards where patient_id = v_patient) is not null then
    raise exception 'FAIL 9: rotating did not clear renewal_nudged_at';
  end if;
  if (select expires_at from public.emergency_cards where patient_id = v_patient) < now() + interval '11 months' then
    raise exception 'FAIL 9b: rotating did not reset the 12-month expiry';
  end if;
  raise notice 'PASS 9: rotating renews the card cleanly';

  raise notice 'ALL EMERGENCY CARD HARDENING CHECKS PASSED';
end $$;

rollback;
