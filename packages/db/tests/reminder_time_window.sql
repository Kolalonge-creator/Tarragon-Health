-- Tarragon Health — preferred reminder time-window verification
--
-- Proves private.next_send_after_for_hour() (the helper queue_vitals_reminders
-- and queue_medication_checkin_reminders use to respect
-- profiles.preferred_reminder_hour) resolves correctly relative to whatever
-- moment the test actually runs at: an hour still ahead today resolves to
-- today, an hour already passed resolves to tomorrow, a null preference
-- returns null (no time-window applied — send as soon as due, unchanged
-- behaviour), and the result is always strictly in the future.
--
-- Deliberately does not invoke queue_vitals_reminders()/
-- queue_medication_checkin_reminders() themselves — those operate over every
-- real patient with a due reminder and would queue real notification rows;
-- testing the pure, side-effect-free helper they both call is sufficient and
-- safer to run against the live database.
--
-- Run inside a transaction that is always rolled back — nothing here should
-- ever be committed.

begin;

do $$
declare
  v_now_lagos timestamp := now() at time zone 'Africa/Lagos';
  v_current_hour int := extract(hour from v_now_lagos)::int;
  v_past_hour smallint;
  v_future_hour smallint;
  v_result timestamptz;
begin
  v_past_hour := greatest(v_current_hour - 1, 0);
  v_future_hour := least(v_current_hour + 1, 23);

  v_result := private.next_send_after_for_hour(null::smallint);
  if v_result is not null then
    raise exception 'FAIL: next_send_after_for_hour(null) = %, expected null', v_result;
  end if;
  raise notice 'PASS: null preference returns null (no time-window applied)';

  if v_future_hour > v_current_hour then
    v_result := private.next_send_after_for_hour(v_future_hour);
    if (v_result at time zone 'Africa/Lagos')::date <> (v_now_lagos)::date then
      raise exception 'FAIL: an hour still ahead today (%) should resolve to TODAY, got %', v_future_hour, v_result;
    end if;
    if extract(hour from (v_result at time zone 'Africa/Lagos')) <> v_future_hour then
      raise exception 'FAIL: resolved hour = %, expected %', extract(hour from (v_result at time zone 'Africa/Lagos')), v_future_hour;
    end if;
    raise notice 'PASS: an hour still ahead today resolves to today at that Lagos hour';
  end if;

  if v_past_hour < v_current_hour then
    v_result := private.next_send_after_for_hour(v_past_hour);
    if (v_result at time zone 'Africa/Lagos')::date <> (v_now_lagos + interval '1 day')::date then
      raise exception 'FAIL: an hour already passed today (%) should resolve to TOMORROW, got %', v_past_hour, v_result;
    end if;
    raise notice 'PASS: an hour already passed today resolves to tomorrow at that Lagos hour';
  end if;

  if v_result <= now() then
    raise exception 'FAIL: a resolved send_after must always be in the future, got % (now=%)', v_result, now();
  end if;

  raise notice 'ALL NEXT_SEND_AFTER_FOR_HOUR CHECKS PASSED';
end $$;

rollback;
