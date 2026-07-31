-- Founder direction 2026-07-30: two-way patient<->care-team conversation is
-- in-app only now (see CLAUDE.md). The care_messages "new reply waiting"
-- notification previously queued as 'whatsapp' (20260719110000); move it to
-- 'in_app' so opening it never depends on WhatsApp at all, matching the
-- precedent already set for health_education_unlock (20260724000000).
create or replace function private.after_care_message_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.care_message_threads
    set last_message_at = new.created_at, updated_at = now()
    where id = new.thread_id;

  perform private.record_timeline_event(
    new.organisation_id, new.patient_id, 'message_posted',
    'care_messages', new.id,
    'New message',
    case when new.author_role = 'care_team'
      then 'Your care team sent you a message'
      else 'You messaged your care team' end,
    new.created_at,
    new.actor_clinical_staff_id,
    jsonb_build_object('thread_id', new.thread_id::text, 'author_role', new.author_role)
  );

  if new.author_role = 'care_team' then
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id, new.patient_id, 'in_app', 'pending', 'new_care_message',
      jsonb_build_object('thread_id', new.thread_id::text)
    );
  end if;
  return new;
end;
$$;

-- Patient-facing copy fix: the "Dedicated Care Coordinator" add-on promised
-- "One named doctor/clinician coordinator" — the founder's direction is that
-- continuity is real (a dedicated coordinator, not a rotating queue) but no
-- promise names a single fixed individual with zero backup, since coverage
-- is genuinely shared across the care team for effective staffing.
update public.add_ons
set description = 'One dedicated care coordinator (not a rotating queue), a scheduled monthly doctor appointment, quarterly PDF report, priority escalation.'
where code = 'care-coordinator';

update public.add_ons
set description = 'One dedicated care coordinator (not a rotating queue), a scheduled monthly doctor appointment, quarterly PDF report, priority escalation.'
where code in ('care-coordinator_usd', 'care-coordinator_gbp');

do $$
declare
  v_bad_addons int;
begin
  select count(*) into v_bad_addons from public.add_ons where description ilike '%named doctor coordinator%' or description ilike '%named clinician coordinator%';
  if v_bad_addons > 0 then
    raise exception 'still % add_ons rows with named-coordinator copy', v_bad_addons;
  end if;
end $$;
