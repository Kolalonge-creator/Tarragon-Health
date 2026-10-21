-- S48b: activity on the phone, workout-plan shape rules, route-recording status (builds on 20261020180745_s48a_activity_safety_gate.sql).
--   1. activity_log_entries.client_id: an id minted on the phone so a retried offline send is a duplicate (23505), not a second activity (S06 pattern).
--      Counts before: activity_log_entries 0 rows live at S48a; the column is nullable, so no conversion step exists.
--   2. workout_plans shape rules: every session is 10 to 20 minutes (spec 5.3), a chair-based class is gentle, and an audio clip id may be listed
--      only on a clinician-reviewed plan. NO audio or video exists; the three starter plans stay unreviewed, inactive and text only.
--   3. public.route_recording_status(): tells the signed-in person (only) whether private route recording is open for them (guard on AND their own switch
--      on). No route is read or written here. Routes stay owner-only with the three S48a policies and no share or export path.
-- No new table, no new governed config, no guard added, nothing signed.

-- 1 ------------------------------------------------------------------------------------------------------------------------------------
alter table public.activity_log_entries add column if not exists client_id uuid;
create unique index if not exists activity_log_entries_client_id_uidx
  on public.activity_log_entries (patient_id, client_id) where client_id is not null;
comment on column public.activity_log_entries.client_id is
  'S48b: id minted on the phone so a retried offline send is a duplicate (23505), not a second activity (S06 pattern).';

-- 2 ------------------------------------------------------------------------------------------------------------------------------------
-- Every session is 10 to 20 minutes. jsonb_path_exists is immutable, so a plain CHECK can say "no session outside the range, or without minutes".
alter table public.workout_plans add constraint workout_plans_session_minutes_chk
  check (not jsonb_path_exists(sessions, '$[*] ? (!exists(@.minutes) || @.minutes < 10 || @.minutes > 20)'));
alter table public.workout_plans add constraint workout_plans_chair_is_gentle_chk
  check (format <> 'chair_class' or level = 'gentle');
alter table public.workout_plans add constraint workout_plans_audio_needs_review_chk
  check (audio_clip_ids = '{}' or clinician_reviewed);

-- 3 ------------------------------------------------------------------------------------------------------------------------------------
create function public.route_recording_status() returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select auth.uid()) is not null and private.route_recording_open(), false);
$$;
revoke all on function public.route_recording_status() from public, anon;
grant execute on function public.route_recording_status() to authenticated;
comment on function public.route_recording_status() is
  'S48b: true only when the go-live guard private_route_recording is on AND the caller''s own switch is on. Answers about the caller only.';

do $$
begin
  if has_function_privilege('anon', 'public.route_recording_status()', 'EXECUTE') then raise exception 'S48b: anon can ask route status'; end if;
  if exists (select 1 from public.workout_plans where audio_clip_ids <> '{}') then raise exception 'S48b: no audio exists yet'; end if;
end $$;
