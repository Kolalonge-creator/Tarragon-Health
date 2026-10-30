-- Fixes found by the first real nightly screening run (2026-10-30 02:15 / 02:45 / 06:36 UTC).
--
-- 1. DUPLICATE IN-APP REMINDERS. private.queue_screening_reminders queued each reminder twice for a patient whose reminder channel is
--    the in-app inbox: once through private.patient_reminder_channel() (which returned 'in_app') and once more explicitly as 'in_app'.
--    109 schedules produced 218 notifications, two identical rows each. The channel row is now queued only when the channel is not
--    in_app, so an email or push patient still gets that message plus the in-app copy, and an in-app patient gets one.
-- 2. TEST ACCOUNTS IN THE FULL NIGHTLY RUN. The scheduler and the request automation processed every active patient including
--    accounts flagged is_test (two Apple App Review logins and a test applicant got 48 schedules, 24 requests and 98 reminders).
--    Both jobs keep their per-patient mode (p_patient set), which deliberately lets a test account be exercised; only the full run,
--    p_patient null, now skips test accounts.
--
-- Each function is patched from its LIVE body (not from an older migration file) by string replacement, and every patch asserts
-- how many places it changed and that the result still contains the new text.
--
-- Data cleanup, narrow and only for the first-run window 2026-10-30 06:30 to 07:00 UTC (and 02:15 to 02:46 for schedules):
--   * the second copy of each duplicated in-app screening_due reminder is set to status 'suppressed' (the web inbox hides suppressed
--     rows; the phone app is fixed in the same change);
--   * every screening reminder sent to a test account in that window is suppressed;
--   * the test accounts' open screening schedules are closed as not_applicable with a stated reason, so the daily reminders stop
--     advancing for them. Their issued lab requests are left as history.
-- Real patients' schedules, requests and the first copy of each reminder are untouched.
do $$
declare
  v_def text;
  v_new text;
  v_pat text;
  v_n integer;
  v_expected integer;
begin
  -- 1. reminders: queue the channel row only when the channel is not in_app
  v_def := pg_get_functiondef('private.queue_screening_reminders()'::regprocedure);
  v_pat := E'    from due\n    returning id\n  ),\n  queued_in_app as (';
  v_n := (length(v_def) - length(replace(v_def, v_pat, ''))) / length(v_pat);
  v_expected := (length(v_def) - length(replace(v_def, 'queued_in_app as (', ''))) / length('queued_in_app as (');
  if v_n = 0 or v_n <> v_expected then
    raise exception 'FAIL: expected % reminder stages to patch, matched % (the live body has changed; re-read it)', v_expected, v_n;
  end if;
  v_new := replace(v_def, v_pat, E'    from due\n    where private.patient_reminder_channel(patient_id) <> ''in_app''\n    returning id\n  ),\n  queued_in_app as (');
  execute v_new;
  if position('where private.patient_reminder_channel(patient_id) <> ''in_app''' in pg_get_functiondef('private.queue_screening_reminders()'::regprocedure)) = 0 then
    raise exception 'FAIL: the reminder patch did not take';
  end if;

  -- 2a. scheduler: the full run skips test accounts (due rows, and the HIV cervical care-team flag)
  v_def := pg_get_functiondef('private.run_screening_scheduler(uuid)'::regprocedure);
  v_pat := E'         and (p_patient is null or p.id = p_patient)\n';
  v_n := (length(v_def) - length(replace(v_def, v_pat, ''))) / length(v_pat);
  if v_n <> 2 then raise exception 'FAIL: expected 2 patient filters in run_screening_scheduler, matched % (the live body has changed)', v_n; end if;
  v_new := replace(v_def, v_pat, v_pat || E'         and (p_patient is not null or not coalesce(p.is_test, false))\n');
  execute v_new;
  if (length(pg_get_functiondef('private.run_screening_scheduler(uuid)'::regprocedure)) - length(replace(pg_get_functiondef('private.run_screening_scheduler(uuid)'::regprocedure), 'p_patient is not null or not coalesce(p.is_test, false)', ''))) / length('p_patient is not null or not coalesce(p.is_test, false)') <> 2 then
    raise exception 'FAIL: the scheduler patch did not take in both places';
  end if;

  -- 2b. request automation: the full run skips test accounts
  v_def := pg_get_functiondef('private.run_screening_request_automation(uuid)'::regprocedure);
  v_pat := E'       and (p_patient is null or s.patient_id = p_patient)\n';
  v_n := (length(v_def) - length(replace(v_def, v_pat, ''))) / length(v_pat);
  if v_n <> 1 then raise exception 'FAIL: expected 1 patient filter in run_screening_request_automation, matched % (the live body has changed)', v_n; end if;
  v_new := replace(v_def, v_pat, v_pat || E'       and (p_patient is not null or not coalesce(p.is_test, false))\n');
  execute v_new;
  if position('p_patient is not null or not coalesce(p.is_test, false)' in pg_get_functiondef('private.run_screening_request_automation(uuid)'::regprocedure)) = 0 then
    raise exception 'FAIL: the request automation patch did not take';
  end if;
end $$;

-- the patched functions keep their privileges (create or replace preserves them); assert it
do $$
begin
  if has_function_privilege('anon', 'private.queue_screening_reminders()', 'EXECUTE')
     or has_function_privilege('anon', 'private.run_screening_scheduler(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'private.run_screening_request_automation(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute a screening job function';
  end if;
end $$;

-- data cleanup for the first-run window (a no-op on any database that did not have that run)
with ranked as (
  select n.id, row_number() over (partition by n.recipient_id, n.template, n.payload ->> 'schedule_id' order by n.created_at, n.id) as rn
    from public.notifications n
   where n.template = 'screening_due' and n.channel = 'in_app' and n.status = 'pending'
     and n.created_at >= timestamptz '2026-10-30 06:30:00+00' and n.created_at < timestamptz '2026-10-30 07:00:00+00'
)
update public.notifications n set status = 'suppressed'
  from ranked r where n.id = r.id and r.rn > 1;

update public.notifications n set status = 'suppressed'
  from public.profiles p
 where p.id = n.recipient_id and coalesce(p.is_test, false)
   and n.template like 'screening\_%' and n.status = 'pending'
   and n.created_at >= timestamptz '2026-10-30 06:30:00+00' and n.created_at < timestamptz '2026-10-30 07:00:00+00';

update public.screening_schedules s
   set status = 'not_applicable', not_applicable_at = now(),
       not_applicable_reason = 'Test account: closed after the first nightly run included test accounts (2026-10-30). No clinical meaning.'
  from public.profiles p
 where p.id = s.patient_id and coalesce(p.is_test, false)
   and s.status in ('pending', 'booked', 'overdue')
   and s.created_at >= timestamptz '2026-10-30 02:00:00+00' and s.created_at < timestamptz '2026-10-30 03:00:00+00';
