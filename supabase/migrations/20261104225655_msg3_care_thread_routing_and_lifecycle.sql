-- MSG-3 (founder decisions MSG-2 and MSG-3, 2026-11-04; design docs/design/MESSAGING-2.md): patient messages are routed, owned and
-- tracked instead of landing in one shared inbox.
--
-- 1. Queue. care_message_threads.queue is 'clinical' only when the patient is a Member NOW and the topic is clinical, medicine or a lab
--    result; everything else is 'support'. It is recomputed on every patient or supporter message, so a lapsed Member's old clinical
--    thread, or a clinical thread a doctor opened to a Free patient, moves to support on the next message (the gap MSG-1 left open).
-- 2. Owner. The existing care_thread_owners row (the manual "Take it" / "Hand over" table) is filled automatically on a patient or
--    supporter message, coordinator first with doctor fallback (MSG-2):
--      * an owner who is still active staff and not on leave keeps the thread (continuity), unless the thread needs a doctor and the
--        owner is not one, or the system put a doctor on a support thread only because no coordinator was free and one now is;
--      * a staff member who starts or answers a thread nobody owns becomes its owner, so the patient's reply comes back to them;
--      * a thread for a test patient goes to the test cover (private.test_patient_cover), as escalations do since 2026-11-03;
--      * otherwise a thread that needs a doctor goes to a doctor; any other thread goes to the patient's own Care Coordinator
--        (care_team_assignment.care_coordinator_id) or else the least-loaded active one not on leave, and when there is none (0 today) to a doctor: the patient's assigned clinician if they qualify, else the
--        least-loaded active Senior Medical Officer or CMO not on leave. Load = open threads owned that are waiting on a reply.
--        Anyone blocked or outside their declared hours ranks behind anyone free (private.clinician_deprioritised_now), as escalations do.
--        If every doctor is on leave the CMO (else any active doctor) still gets it, so a message is never left with nobody.
--      * the owner gets an in-app notification on each patient message, unless they are the patient's assigned clinician, whom the
--        existing after-insert trigger already tells.
--    System assignment writes care_thread_owners with assigned_by null (automatic) or the staff member who started the thread.
--    enforce_care_thread_owner (redefined from its LIVE body) lets that through only when private.write_care_thread_owner has set a
--    transaction-local flag; the table's own RLS still admits staff only, so a patient cannot write an owner row at all. The doctor
--    flag's reason lives only in that staff-only hand-over note, never on the thread row.
-- 3. Needs a doctor. public.flag_care_thread_for_doctor(thread, reason): any staff member of the thread's organisation, a reason of at
--    least 10 characters; sets needs_doctor and hands the thread to a doctor with the reason as the hand-over note. The reason is kept
--    ONLY in care_thread_owners.handover_note (staff-only RLS), never on the thread row, which the patient and their supporters read. A reply from a
--    doctor (Senior Medical Officer or CMO) clears it. Only a doctor may close a thread that needs a doctor; a coordinator or an admin is
--    refused. Coordinators therefore cannot close what needs clinical judgement, and nobody can clear the flag with a direct update:
--    the routing columns are written only by the system paths in this file.
-- 4. Reply clock. awaiting_reply_since is the first patient or supporter message since the last care-team reply; a second message from
--    the patient does not reset it. A care-team reply clears it and stamps last_care_team_reply_at.
-- 4b. Review fixes (ultra review, 2026-11-04): the guard also runs on INSERT, so a patient cannot create a thread with a forged clock
--    or doctor flag; every owner candidate passes the same checks enforce_care_thread_owner makes (active profile, same organisation,
--    staff role), and a routing failure raises an ops incident instead of blocking the patient's message; a doctor given a thread by a
--    flag owns it as a human assignment (attributed to whoever flagged it), so continuity keeps it with that doctor; the flag reason
--    has its own staff-only column (care_thread_owners.doctor_flag_reason) that ordinary owner writes never touch; the doctor is
--    notified when flagged; closing a thread clears the flag; flagging fails loudly when no doctor can be assigned.
-- 5. The unread-clinical sweep (private.raise_unread_clinical_message_alerts, redefined from its LIVE body) now also covers a clinical-
--    queue thread and a thread that needs a doctor, on top of the clinical category it already watched. It only widens.
--
-- Live counts before (2026-11-04): 1 thread (general, open), 2 active memberships, 0 Care Coordinators, 3 active doctors, 0 owner rows.

create type public.care_thread_queue as enum ('support', 'clinical');

alter table public.care_message_threads
  add column queue public.care_thread_queue not null default 'support',
  add column needs_doctor boolean not null default false,
  add column needs_doctor_at timestamptz,
  add column needs_doctor_by uuid references public.profiles (id) on delete set null,
  add column awaiting_reply_since timestamptz,
  add column last_care_team_reply_at timestamptz;

-- The reason a thread needs a doctor. On the staff-only owner table (RLS: is_org_staff), never on the patient-readable thread row, and in
-- its own column so a "Take it", a hand-over note or an automatic reassignment cannot overwrite it while the flag stands.
alter table public.care_thread_owners
  add column doctor_flag_reason text check (doctor_flag_reason is null or length(doctor_flag_reason) between 10 and 1000);

comment on column public.care_message_threads.queue is 'MSG-3: clinical when the patient is a Member now and the topic is clinical, medication or laboratory; else support. Recomputed on every patient or supporter message.';
comment on column public.care_message_threads.needs_doctor is 'MSG-3: set by flag_care_thread_for_doctor; cleared by a doctor''s reply. Only a doctor may close the thread while it is set.';
comment on column public.care_message_threads.awaiting_reply_since is 'MSG-3: first patient or supporter message since the last care-team reply. The reply target counts from here.';

-- Nobody sets routing fields directly, staff included: a coordinator clearing needs_doctor by hand would get round the rule that only
-- a doctor's reply clears it, and a patient inserting a thread with a back-dated clock or a doctor flag would jump every queue. Only
-- the system paths below (routing flag on) and calls with no signed-in user (migrations, cron) write them. A direct write of these
-- columns is not refused, it is ignored (reset to the defaults on insert, kept as they were on update), so an ordinary write of the
-- same row still works. Closing a thread clears the doctor flag: guard_care_thread_close (which fires first) has already refused
-- anyone but a doctor closing a flagged thread.
create or replace function private.guard_care_thread_routing_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and current_setting('tarragon.care_thread_routing', true) is distinct from 'on' then
    if tg_op = 'INSERT' then
      new.queue := 'support';
      new.needs_doctor := false;
      new.needs_doctor_at := null;
      new.needs_doctor_by := null;
      new.awaiting_reply_since := null;
      new.last_care_team_reply_at := null;
    else
      new.queue := old.queue;
      new.needs_doctor := old.needs_doctor;
      new.needs_doctor_at := old.needs_doctor_at;
      new.needs_doctor_by := old.needs_doctor_by;
      new.awaiting_reply_since := old.awaiting_reply_since;
      new.last_care_team_reply_at := old.last_care_team_reply_at;
    end if;
  end if;
  if tg_op = 'UPDATE' and new.status = 'closed' and old.status is distinct from 'closed' then
    new.needs_doctor := false;
    new.needs_doctor_at := null;
    new.needs_doctor_by := null;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_care_thread_routing_columns() from public, anon, authenticated;

-- Named to sort after care_message_threads_guard_close, so the close guard sees the flag before this clears it.
create trigger care_message_threads_guard_routing
  before insert or update on public.care_message_threads
  for each row execute function private.guard_care_thread_routing_columns();

create or replace function private.care_thread_queue_for(p_patient uuid, p_category public.care_message_category)
returns public.care_thread_queue
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_category in ('clinical', 'medication', 'laboratory') and private.patient_is_member(p_patient) then 'clinical'
    else 'support'
  end::public.care_thread_queue;
$$;
revoke all on function private.care_thread_queue_for(uuid, public.care_message_category) from public, anon, authenticated;

-- Exactly what enforce_care_thread_owner demands of an owner. Every candidate the router considers passes this first, so an owner write
-- inside the message trigger cannot be refused by that check.
create or replace function private.is_eligible_thread_owner(p_profile uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_profile and p.organisation_id = p_org and p.is_active
      and p.role in ('clinician', 'care_coordinator', 'admin')
  );
$$;
revoke all on function private.is_eligible_thread_owner(uuid, uuid) from public, anon, authenticated;

-- A doctor for routing: an active Senior Medical Officer or CMO whose login is an active clinician account in the same organisation.
create or replace function private.is_routable_doctor(p_profile uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinical_staff cs
    join public.profiles p on p.id = cs.profile_id
    where cs.profile_id = p_profile and cs.organisation_id = p_org and cs.active
      and cs.doctor_tier in ('senior_medical_officer', 'chief_medical_officer')
      and p.organisation_id = p_org and p.is_active and p.role = 'clinician'
  );
$$;
revoke all on function private.is_routable_doctor(uuid, uuid) from public, anon, authenticated;

create or replace function private.care_thread_owner_load(p_profile uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from public.care_thread_owners o
  join public.care_message_threads t on t.id = o.thread_id
  where o.owner_id = p_profile and t.status = 'open' and t.awaiting_reply_since is not null;
$$;
revoke all on function private.care_thread_owner_load(uuid) from public, anon, authenticated;

-- Chooses who should own a thread now. Never raises; returns null only when nobody in the organisation qualifies.
create or replace function private.pick_care_thread_owner(p_thread uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  t record;
  v_owner uuid;
  v_owner_by uuid;
  v_coord uuid;
  v_pick uuid;
begin
  select th.id, th.organisation_id, th.patient_id, th.needs_doctor, th.queue into t from public.care_message_threads th where th.id = p_thread;
  if not found then return null; end if;

  -- The coordinator who would take it now: the patient's own, else the least-loaded one. Not used when a doctor is needed.
  if not t.needs_doctor then
    select cta.care_coordinator_id into v_coord
    from public.care_team_assignment cta join public.profiles p on p.id = cta.care_coordinator_id
    where cta.patient_id = t.patient_id and p.organisation_id = t.organisation_id and p.role = 'care_coordinator' and p.is_active
      and not private.clinician_on_leave(p.id);
    if v_coord is null then
      select p.id into v_coord
      from public.profiles p
      where p.organisation_id = t.organisation_id and p.role = 'care_coordinator' and p.is_active
        and not private.clinician_on_leave(p.id)
      order by private.clinician_deprioritised_now(p.id)::int, private.care_thread_owner_load(p.id), p.created_at
      limit 1;
    end if;
  end if;

  -- Continuity: the current owner keeps it while still active, not on leave, and a doctor when one is needed. One exception: a doctor
  -- the SYSTEM put on a support thread (because no coordinator was free then) gives it up once a coordinator is free. A doctor who
  -- took the thread, was handed it, or started it keeps it.
  select o.owner_id, o.assigned_by into v_owner, v_owner_by
  from public.care_thread_owners o join public.profiles p on p.id = o.owner_id
  where o.thread_id = p_thread and p.is_active and p.organisation_id = t.organisation_id
    and p.role in ('clinician', 'care_coordinator', 'admin');
  if v_owner is not null and not private.clinician_on_leave(v_owner)
     and (not t.needs_doctor or private.is_routable_doctor(v_owner, t.organisation_id))
     and not (v_owner_by is null and t.queue = 'support' and v_coord is not null
              and private.is_routable_doctor(v_owner, t.organisation_id)) then
    return v_owner;
  end if;

  -- A test patient's conversation is the test cover's, never a working colleague's (same rule as escalations, 2026-11-03).
  if coalesce((select pr.is_test from public.profiles pr where pr.id = t.patient_id), false) then
    select cs.profile_id into v_pick from public.clinical_staff cs
    where cs.id = private.test_patient_cover(t.organisation_id) and cs.profile_id is not null
      and private.is_eligible_thread_owner(cs.profile_id, t.organisation_id);
    if v_pick is not null then return v_pick; end if;
  end if;

  if v_coord is not null then return v_coord; end if;

  -- Doctor: the patient's own assigned clinician if they qualify and are free of leave, else the least-loaded doctor.
  select cta.clinician_id into v_pick
  from public.care_team_assignment cta
  where cta.patient_id = t.patient_id
    and private.is_routable_doctor(cta.clinician_id, t.organisation_id)
    and not private.clinician_on_leave(cta.clinician_id);
  if v_pick is not null then return v_pick; end if;

  select cs.profile_id into v_pick
  from public.clinical_staff cs
  where cs.organisation_id = t.organisation_id and cs.profile_id is not null
    and private.is_routable_doctor(cs.profile_id, t.organisation_id)
    and not private.clinician_on_leave(cs.profile_id)
  order by private.clinician_deprioritised_now(cs.profile_id)::int, private.care_thread_owner_load(cs.profile_id), cs.created_at
  limit 1;
  if v_pick is not null then return v_pick; end if;

  -- Last resort, so a message is never left with nobody: everyone qualifying is on leave. The CMO first, then any active doctor.
  select cs.profile_id into v_pick
  from public.clinical_staff cs
  where cs.organisation_id = t.organisation_id and cs.profile_id is not null
    and private.is_routable_doctor(cs.profile_id, t.organisation_id)
  order by (cs.doctor_tier = 'chief_medical_officer') desc, cs.created_at
  limit 1;
  return v_pick;
end;
$$;
revoke all on function private.pick_care_thread_owner(uuid) from public, anon, authenticated;

-- Writes the owner row as the system. The flag is transaction-local and reset straight after; care_thread_owners' RLS admits staff
-- only, so nobody else can write the table to make use of it. p_by is who the assignment is attributed to: null for an automatic
-- choice, the staff member themselves when they start or answer a thread nobody owns. p_force_note writes the note even when the owner
-- does not change (a doctor flag must never lose its reason); routine routing leaves an existing hand-over note alone.
create or replace function private.write_care_thread_owner(p_thread uuid, p_owner uuid, p_by uuid, p_note text, p_force_note boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current uuid;
  v_org uuid;
begin
  if p_owner is null then return null; end if;
  select organisation_id into v_org from public.care_message_threads where id = p_thread;
  if not private.is_eligible_thread_owner(p_owner, v_org) then return null; end if;
  select owner_id into v_current from public.care_thread_owners where thread_id = p_thread;
  if v_current = p_owner and not p_force_note then return p_owner; end if;
  perform set_config('tarragon.care_thread_routing', 'on', true);
  insert into public.care_thread_owners (thread_id, organisation_id, owner_id, assigned_by, handover_note)
  values (p_thread, v_org, p_owner, p_by, left(p_note, 2000))
  on conflict (thread_id) do update
    set owner_id = excluded.owner_id, assigned_by = excluded.assigned_by, handover_note = excluded.handover_note;
  perform set_config('tarragon.care_thread_routing', 'off', true);
  return p_owner;
end;
$$;
revoke all on function private.write_care_thread_owner(uuid, uuid, uuid, text, boolean) from public, anon, authenticated;

-- p_by null = an automatic choice. A doctor flag passes the person who flagged it, so the doctor holds the thread as a human assignment
-- and keeps it on the patient's next message (pick_care_thread_owner only takes back a support thread from a doctor the SYSTEM placed).
create or replace function private.assign_care_thread_owner(p_thread uuid, p_note text, p_force_note boolean default false, p_by uuid default null)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select private.write_care_thread_owner(p_thread, private.pick_care_thread_owner(p_thread), p_by, p_note, p_force_note);
$$;
revoke all on function private.assign_care_thread_owner(uuid, text, boolean, uuid) from public, anon, authenticated;

-- Redefined from the LIVE body (read 2026-11-04). Only change: a system write (flag on) is accepted without a signed-in staff caller,
-- and keeps the attribution private.write_care_thread_owner chose (null = automatic) so the event log shows how it happened.
create or replace function private.enforce_care_thread_owner()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_org uuid;
  v_uid uuid := (select auth.uid());
  v_system boolean := current_setting('tarragon.care_thread_routing', true) = 'on';
begin
  select organisation_id into v_org from public.care_message_threads where id = new.thread_id;
  if v_org is null then raise exception 'thread not found'; end if;
  if not v_system and not private.is_org_staff(v_org) then raise exception 'not authorised' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.profiles p
     where p.id = new.owner_id and p.organisation_id = v_org and p.is_active
       and p.role in ('clinician', 'care_coordinator', 'admin')
  ) then
    raise exception 'owner must be active staff in the same organisation';
  end if;
  new.organisation_id := v_org;
  new.assigned_by := case when v_system then new.assigned_by else v_uid end;
  new.assigned_at := now();
  return new;
end $function$;

-- Routing on every message. Runs after the existing after-insert trigger has stamped last_message_at and the author role (AFTER
-- triggers fire in name order: care_messages_after_insert, care_messages_reset_reminders, care_messages_route_thread, ...safety_screen).
create or replace function private.route_care_thread_on_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category public.care_message_category;
  v_queue public.care_thread_queue;
  v_doctor_reply boolean;
  v_owner uuid;
  v_assigned_clinician uuid;
  v_needs_doctor boolean;
  v_flagged_by uuid;
begin
  -- Routing must never stop a message being sent. Anything that fails in here is rolled back to this block and raised as an ops
  -- incident (thread id and error text only, no patient detail), and the message itself is kept.
  begin
  perform set_config('tarragon.care_thread_routing', 'on', true);
  if new.author_role in ('patient', 'sponsor') then
    select category, needs_doctor, needs_doctor_by into v_category, v_needs_doctor, v_flagged_by
    from public.care_message_threads where id = new.thread_id;
    v_queue := private.care_thread_queue_for(new.patient_id, v_category);
    update public.care_message_threads
      set queue = v_queue,
          awaiting_reply_since = coalesce(awaiting_reply_since, new.created_at)
      where id = new.thread_id;
    -- While the thread needs a doctor, a reassignment to a doctor is credited to whoever flagged it: a human decision, so continuity
    -- keeps the thread with that doctor after they reply, instead of handing it back to a coordinator as a system placement would.
    v_owner := private.assign_care_thread_owner(
      new.thread_id,
      case when v_needs_doctor then 'Still needs a doctor'
           when v_queue = 'clinical' then 'Assigned automatically: clinical question'
           else 'Assigned automatically: support question' end,
      false,
      case when v_needs_doctor then v_flagged_by end
    );
    -- Tell the owner. after_care_message_insert already tells the patient's assigned clinician, so they are not told twice.
    select clinician_id into v_assigned_clinician from public.care_team_assignment where patient_id = new.patient_id;
    if v_owner is not null and v_owner is distinct from v_assigned_clinician then
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
      values (
        new.organisation_id, v_owner, 'in_app', 'pending', 'clinician_new_care_message',
        jsonb_build_object('thread_id', new.thread_id::text, 'patient_id', new.patient_id::text,
                           'author_role', new.author_role, 'author_display', new.author_display)
      );
    end if;
  elsif new.author_role = 'care_team' then
    v_doctor_reply := private.is_routable_doctor(new.author_profile_id, new.organisation_id);
    update public.care_message_threads
      set awaiting_reply_since = null,
          last_care_team_reply_at = new.created_at,
          needs_doctor = case when v_doctor_reply then false else needs_doctor end,
          needs_doctor_at = case when v_doctor_reply then null else needs_doctor_at end,
          needs_doctor_by = case when v_doctor_reply then null else needs_doctor_by end
      where id = new.thread_id;
    -- A staff member who starts or answers a conversation nobody owns becomes its owner, so the patient's reply comes back to them.
    if v_doctor_reply then
      update public.care_thread_owners set doctor_flag_reason = null where thread_id = new.thread_id and doctor_flag_reason is not null;
    end if;
    -- write_care_thread_owner skips anyone enforce_care_thread_owner would refuse (e.g. an admin of another organisation).
    if not exists (select 1 from public.care_thread_owners where thread_id = new.thread_id) then
      perform private.write_care_thread_owner(new.thread_id, new.author_profile_id, new.author_profile_id, null, false);
    end if;
  end if;
  perform set_config('tarragon.care_thread_routing', 'off', true);
  exception when others then
    perform private.ops_alert_incident(
      'care-thread-routing:' || new.thread_id::text,
      'Message routing failed',
      format('Routing a new message on care thread %s failed (%s: %s). The message was saved; check its owner and queue.',
             new.thread_id, sqlstate, sqlerrm),
      'sev3'
    );
  end;
  return new;
end;
$$;
revoke all on function private.route_care_thread_on_message() from public, anon, authenticated;

create trigger care_messages_route_thread
  after insert on public.care_messages
  for each row execute function private.route_care_thread_on_message();

-- Only a doctor closes a thread that needs a doctor.
create or replace function private.guard_care_thread_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if new.status = 'closed' and old.status is distinct from 'closed' and old.needs_doctor
     and v_uid is not null and not private.is_routable_doctor(v_uid, old.organisation_id) then
    raise exception 'A doctor needs to look at this conversation before it is closed.'
      using errcode = '42501', hint = 'needs_doctor';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_care_thread_close() from public, anon, authenticated;

create trigger care_message_threads_guard_close
  before update of status on public.care_message_threads
  for each row execute function private.guard_care_thread_close();

create or replace function public.flag_care_thread_for_doctor(p_thread uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_status public.care_message_thread_status;
  v_owner uuid;
  v_patient uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if length(coalesce(trim(p_reason), '')) < 10 then
    raise exception 'Say in a sentence what the doctor needs to look at.' using errcode = '22023';
  end if;
  select organisation_id, status into v_org, v_status from public.care_message_threads where id = p_thread;
  if v_org is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if not private.is_org_staff(v_org) then raise exception 'not authorised' using errcode = '42501'; end if;
  if v_status = 'closed' then raise exception 'thread is closed'; end if;

  select patient_id into v_patient from public.care_message_threads where id = p_thread;

  perform set_config('tarragon.care_thread_routing', 'on', true);
  update public.care_message_threads
    set needs_doctor = true, needs_doctor_at = now(), needs_doctor_by = v_uid
    where id = p_thread;
  perform set_config('tarragon.care_thread_routing', 'off', true);

  -- Attributed to the person who flagged it, so it counts as a human assignment and the doctor keeps the thread.
  v_owner := private.assign_care_thread_owner(p_thread, 'Needs a doctor: ' || left(trim(p_reason), 1000), true, v_uid);
  if v_owner is null then
    -- Nothing has been kept: raising rolls back the flag above. Better a clear refusal than a flag nobody can see or clear.
    raise exception 'No doctor can take this conversation right now. Ask the Chief Medical Officer to assign one.'
      using errcode = 'P0001', hint = 'no_doctor_available';
  end if;

  perform set_config('tarragon.care_thread_routing', 'on', true);
  update public.care_thread_owners set doctor_flag_reason = left(trim(p_reason), 1000) where thread_id = p_thread;
  perform set_config('tarragon.care_thread_routing', 'off', true);

  -- Tell the doctor now; they must not have to wait for the patient to write again. Ids only, never the reason.
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (v_org, v_owner, 'in_app', 'pending', 'clinician_care_thread_needs_doctor',
          jsonb_build_object('thread_id', p_thread::text, 'patient_id', v_patient::text));
  return v_owner;
end;
$$;
revoke execute on function public.flag_care_thread_for_doctor(uuid, text) from public, anon;
grant execute on function public.flag_care_thread_for_doctor(uuid, text) to authenticated;

-- Redefined from the LIVE body (read 2026-11-04). Only change: the thread filter also admits a clinical-queue thread and a thread that
-- needs a doctor. It never narrows what was already watched.
create or replace function private.raise_unread_clinical_message_alerts()
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  r record;
  v_alert_id uuid;
  v_recipient uuid;
  v_notified boolean;
begin
  for r in
    select t.id as thread_id, t.organisation_id, t.patient_id, t.subject, t.last_message_at, t.last_message_author_role
    from public.care_message_threads t
    where t.status = 'open'
      and (t.category = 'clinical' or t.queue = 'clinical' or t.needs_doctor)
      and t.last_message_author_role in ('patient', 'sponsor')
      and (t.care_team_last_read_at is null or t.care_team_last_read_at < t.last_message_at)
      and t.unread_alert_id is null
      and now() - t.last_message_at >= interval '120 minutes'
  loop
    v_alert_id := private.raise_clinician_alert(
      r.organisation_id, r.patient_id, 'clinician_review',
      'Unread patient message',
      format(
        'A clinical-category care-team message ("%s") has not been opened by anyone on the care team %s after it was sent. Read and reply in Messages.',
        r.subject,
        case
          when now() - r.last_message_at >= interval '24 hours' then to_char(extract(hours from now() - r.last_message_at)::int / 24, 'FM999') || ' day(s)'
          else to_char(extract(epoch from now() - r.last_message_at)::int / 3600, 'FM999') || ' hour(s)'
        end
      ),
      'care_management', 'unread_clinical_care_message'
    );

    update public.care_message_threads set unread_alert_id = v_alert_id where id = r.thread_id;

    v_notified := false;
    select p.id into v_recipient
    from public.clinician_alerts ca
    join public.clinical_staff cs on cs.id = ca.responsible_clinician_id
    join public.profiles p on p.id = cs.profile_id
    where ca.id = v_alert_id;

    if v_recipient is not null then
      perform private.notify_clinician_alert(
        v_alert_id, v_recipient, 'clinician_unread_care_message_alert',
        jsonb_build_object('thread_id', r.thread_id::text, 'patient_id', r.patient_id::text)
      );
      v_notified := true;
    end if;

    if not v_notified then
      for v_recipient in select id from public.profiles where role = 'admin' and organisation_id = r.organisation_id loop
        perform private.notify_clinician_alert(
          v_alert_id, v_recipient, 'clinician_unread_care_message_alert',
          jsonb_build_object('thread_id', r.thread_id::text, 'patient_id', r.patient_id::text)
        );
        v_notified := true;
      end loop;
    end if;
  end loop;
end;
$function$;

-- The widened sweep filter no longer matches care_message_threads_unread_care_team_idx (category = 'clinical' only), so it would scan
-- every thread every 15 minutes. This index carries the sweep's own predicate.
create index care_message_threads_unread_sweep_idx on public.care_message_threads (last_message_at)
  where status = 'open' and unread_alert_id is null and (category = 'clinical' or queue = 'clinical' or needs_doctor);

-- Backfill: queue from today's Membership, the reply clock from the messages already sent, and an owner for every open thread still
-- waiting on a reply.
do $$
declare r record;
begin
  perform set_config('tarragon.care_thread_routing', 'on', true);
  update public.care_message_threads t
    set queue = private.care_thread_queue_for(t.patient_id, t.category),
        last_care_team_reply_at = (select max(m.created_at) from public.care_messages m where m.thread_id = t.id and m.author_role = 'care_team'),
        awaiting_reply_since = case
          when t.status = 'open' and t.last_message_author_role in ('patient', 'sponsor') then (
            select min(m.created_at) from public.care_messages m
            where m.thread_id = t.id and m.author_role in ('patient', 'sponsor')
              and m.created_at > coalesce((select max(c.created_at) from public.care_messages c where c.thread_id = t.id and c.author_role = 'care_team'), '-infinity'))
          end;
  for r in select id from public.care_message_threads where status = 'open' and awaiting_reply_since is not null loop
    perform private.assign_care_thread_owner(r.id, 'Assigned automatically when routing started', false);
  end loop;
  perform set_config('tarragon.care_thread_routing', 'off', true);
end $$;

do $$
begin
  if has_function_privilege('anon', 'public.flag_care_thread_for_doctor(uuid,text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute flag_care_thread_for_doctor';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'care_messages_route_thread' and not tgisinternal) then
    raise exception 'FAIL: routing trigger missing';
  end if;
  if pg_get_functiondef('private.raise_unread_clinical_message_alerts()'::regprocedure) not like '%t.category = ''clinical''%' then
    raise exception 'FAIL: the unread sweep no longer watches the clinical category';
  end if;
end $$;
