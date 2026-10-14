-- S05b-e: the screens for allergy correction requests need three things from the database.
--   1. A tied clinician (not a care coordinator) gets ONE in-app notice when a patient's request arrives. The words name no entry, no value
--      and no clinical term (INV-07); there is no SMS (INV-08). Who counts as tied: the people private.clinician_has_patient_access accepts
--      by care team, open escalation or open alert, filtered to an active non-coordinator clinical_staff row. (That function reads
--      auth.uid(), so it cannot be asked about somebody else, and the other ways it ties a clinician (a booked visit, a task, a page, a
--      referral) are not notified. The queue screen still shows a request to every clinician the real test admits, because it reads under
--      row level security, and the sidebar count is the signal for those.)
--   2. The patient gets one in-app notice when a request is confirmed (a rejection already sends one). Same plain wording rule.
--   3. A patient may raise at most 3 requests per allergy in any rolling 7 days (any outcome counts, so withdrawing and asking again cannot
--      be used to flood the queue). Enforced here, by a trigger on the request table, whatever path inserts the row.
-- Nothing here changes who can decide a request, what a decision does, or any grant.

-- 1. Recipients and the clinician notice --------------------------------------------------------------------------------------------
insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('record_change_request_waiting', 'operational', 'routine', 'clinician', array['in_app']::public.notification_channel[], 'immediate',
   'S05b-e: a patient asked for a change in her record and it waits for a clinician. Names no entry, value or reason (INV-07), in-app only (INV-08).'),
  ('record_change_confirmed', 'operational', 'routine', 'patient', array['in_app']::public.notification_channel[], 'immediate',
   'S05b-e: a clinician made the change the patient asked for in her record. Names no entry or value (INV-07), in-app only (INV-08).')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('record_change_request_waiting', 'en', 'in_app', 'A record change is waiting',
   'A patient has asked for a change in her record. Open your record changes queue to look at it.'),
  ('record_change_confirmed', 'en', 'in_app', 'Your record was updated',
   'Your care team made the change you asked for in your record. Open the app to see it.')
on conflict (template_key, locale, channel) do nothing;

create function private.allergy_request_recipients(p_patient uuid) returns table (profile_id uuid)
language sql stable security definer set search_path = '' as
$$
  select distinct cs.profile_id
    from public.clinical_staff cs
   where cs.active and cs.doctor_tier is not null and cs.doctor_tier <> 'care_coordinator'
     and (
       exists (select 1 from public.care_team_assignment cta
                where cta.patient_id = p_patient and cs.profile_id in (cta.clinician_id, cta.clinical_director_id))
       or exists (select 1 from public.escalations e
                   where e.patient_id = p_patient and e.assigned_doctor_id = cs.profile_id and e.status in ('open', 'under_review'))
       or exists (select 1 from public.clinician_alerts a
                   where a.patient_id = p_patient and cs.id in (a.responsible_clinician_id, a.backup_clinician_id)
                     and a.status in ('open', 'acknowledged', 'snoozed'))
     )
$$;
revoke all on function private.allergy_request_recipients(uuid) from public, anon, authenticated;

create function private.notify_allergy_request_arrived() returns trigger
language plpgsql security definer set search_path = '' as
$$
declare
  r record;
begin
  for r in select profile_id from private.allergy_request_recipients(new.patient_id) loop
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
    values (new.organisation_id, r.profile_id, 'in_app', 'pending', 'record_change_request_waiting',
            jsonb_build_object('request_id', new.id), 'non_clinical');
  end loop;
  return null;
end;
$$;
revoke all on function private.notify_allergy_request_arrived() from public, anon, authenticated;
create trigger patient_allergy_correction_requests_notify_arrived after insert on public.patient_allergy_correction_requests
  for each row execute function private.notify_allergy_request_arrived();

-- 2. The patient's notice when a request is confirmed ------------------------------------------------------------------------------
create function private.notify_allergy_request_confirmed() returns trigger
language plpgsql security definer set search_path = '' as
$$
begin
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
  values (new.organisation_id, new.patient_id, 'in_app', 'pending', 'record_change_confirmed',
          jsonb_build_object('request_id', new.id), 'non_clinical');
  return null;
end;
$$;
revoke all on function private.notify_allergy_request_confirmed() from public, anon, authenticated;
create trigger patient_allergy_correction_requests_notify_confirmed after update of status on public.patient_allergy_correction_requests
  for each row when (old.status = 'pending' and new.status = 'confirmed')
  execute function private.notify_allergy_request_confirmed();

-- 3. At most 3 requests per allergy in a rolling 7 days -------------------------------------------------------------------------------
create function private.patient_allergy_request_rate_limit() returns trigger
language plpgsql security definer set search_path = '' as
$$
begin
  -- one request at a time per allergy while counting, so two quick taps cannot both slip under the limit
  perform pg_advisory_xact_lock(hashtextextended('allergy_request_rate:' || new.allergy_id::text, 0));
  if (select count(*) from public.patient_allergy_correction_requests r
       where r.allergy_id = new.allergy_id and r.created_at > now() - interval '7 days') >= 3 then
    raise exception 'You have asked about this entry a few times this week. Please message your care team about it instead, and they will help.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.patient_allergy_request_rate_limit() from public, anon, authenticated;
create trigger patient_allergy_correction_requests_rate_limit before insert on public.patient_allergy_correction_requests
  for each row execute function private.patient_allergy_request_rate_limit();

-- 4. Self-check ------------------------------------------------------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array['private.allergy_request_recipients(uuid)', 'private.notify_allergy_request_arrived()',
                           'private.notify_allergy_request_confirmed()', 'private.patient_allergy_request_rate_limit()'] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'S05b-e self-check: % must not be executable by clients', f;
    end if;
  end loop;
  if (select count(*) from pg_trigger where tgrelid = 'public.patient_allergy_correction_requests'::regclass
       and tgname in ('patient_allergy_correction_requests_notify_arrived', 'patient_allergy_correction_requests_notify_confirmed',
                      'patient_allergy_correction_requests_rate_limit')) <> 3 then
    raise exception 'S05b-e self-check: a trigger is missing';
  end if;
  if (select count(*) from public.notification_template_locales where template_key in ('record_change_request_waiting', 'record_change_confirmed')) <> 2 then
    raise exception 'S05b-e self-check: a notice wording is missing';
  end if;
end $$;
