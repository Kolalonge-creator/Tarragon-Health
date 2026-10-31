-- Staff chat follow-ups (founder go-ahead 2026-10-30; 14-day ceiling and the 24h / 48h / two-reminder timings confirmed in chat).
--
-- 1. Threads with no author role (from before read-tracking) get one, taken from their latest message. A metadata-only update:
--    nothing notifies. Live count at the time of writing: 0 of 3 threads, so this is a safeguard for other environments.
-- 2. The patient unread reminder ignores a conversation whose last message is older than 14 days, so an old thread that is
--    suddenly given a role can never start a wave of nudges. Same signature and body as the live function (read with
--    pg_get_functiondef before editing) plus one condition; no overload is added.
-- 3. public.first_care_message_id: the id of the first message of a thread the caller wrote. It returns an id only, no
--    content, so it writes no audit row. It replaces a second audited open (open_care_thread_audited) that the staff
--    composer made just to find that id when attaching buttons or a file to a new conversation.

-- One row at a time: a thread that belongs to an under-18 dependant is refused by the 00_minor_dependant_scope trigger (42501), and one
-- such row must not abort the whole migration. Such a thread is simply left as it was.
do $$
declare r record;
begin
  for r in
    select distinct on (m.thread_id) m.thread_id, m.author_role
      from public.care_messages m
      join public.care_message_threads t on t.id = m.thread_id and t.last_message_author_role is null
     order by m.thread_id, m.created_at desc, m.id desc
  loop
    begin
      update public.care_message_threads set last_message_author_role = r.author_role where id = r.thread_id;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
end $$;

create or replace function private.remind_patients_of_unread_care_messages(
  p_first interval default interval '24 hours',
  p_gap interval default interval '48 hours',
  p_max smallint default 2,
  p_now timestamptz default now(),
  p_include_test boolean default false
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_sent integer := 0;
  v_hour integer := extract(hour from (p_now at time zone 'Africa/Lagos'))::integer;
begin
  if v_hour < 8 or v_hour >= 20 then return 0; end if;
  for r in
    select t.id, t.organisation_id, t.patient_id, t.patient_reminder_count
      from public.care_message_threads t
      join public.profiles pr on pr.id = t.patient_id
     where t.status = 'open'
       and (p_include_test or not pr.is_test)
       and t.last_message_author_role = 'care_team'
       and (t.patient_last_read_at is null or t.patient_last_read_at < t.last_message_at)
       and t.patient_reminder_count < p_max
       and p_now - t.last_message_at >= p_first
       and p_now - t.last_message_at <= interval '14 days'
       and (t.patient_last_reminded_at is null or p_now - t.patient_last_reminded_at >= p_gap)
     order by t.last_message_at
     limit 500
  loop
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
    values (r.organisation_id, r.patient_id, private.patient_reminder_channel(r.patient_id), 'pending',
            'care_message_reminder', jsonb_build_object('thread_id', r.id::text, 'reminder_no', r.patient_reminder_count + 1),
            'non_clinical');
    -- Setting the count and time in the same statement as the insert is what stops a second sweep repeating it.
    update public.care_message_threads
       set patient_reminder_count = r.patient_reminder_count + 1, patient_last_reminded_at = p_now
     where id = r.id;
    v_sent := v_sent + 1;
  end loop;
  return v_sent;
end $$;
revoke all on function private.remind_patients_of_unread_care_messages(interval, interval, smallint, timestamptz, boolean) from public, anon, authenticated;

create or replace function public.first_care_message_id(p_thread uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select m.id
    from public.care_messages m
   where m.thread_id = p_thread and m.author_profile_id = (select auth.uid())
   order by m.created_at, m.id
   limit 1
$$;
revoke all on function public.first_care_message_id(uuid) from public, anon;
grant execute on function public.first_care_message_id(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.first_care_message_id(uuid)', 'EXECUTE') then raise exception 'anon can execute first_care_message_id'; end if;
  if has_function_privilege('anon', 'private.remind_patients_of_unread_care_messages(interval,interval,smallint,timestamptz,boolean)', 'EXECUTE') then raise exception 'anon can execute the reminder sweep'; end if;
end $$;
