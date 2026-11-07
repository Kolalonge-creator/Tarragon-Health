-- CC-1..CC-4 (founder decisions 2026-11-07, docs/DECISIONS.md): one shared care coordination workspace.
--
-- Doctors do every Care Coordinator task while no coordinator is employed (0 live on 2026-11-07), and the work hands over to a
-- coordinator automatically once one is active and not on leave. Same rule messages (MSG-2) and care gaps (S90) already follow.
--
--   1. private.is_coordination_actor: who may do coordinator work. An active Care Coordinator, or an active doctor at Senior Medical
--      Officer level or above who is employed by Tarragon, or the Chief Medical Officer however employed. A contracted partner
--      specialist is not part of the day-to-day care team and does not do logistics. Honours the 2FA group rule (mfa_requirement_met).
--   2. The coordinator-only gates widened to that rule, each redefined from its LIVE body (pg_get_functiondef, 2026-11-07):
--        private.cde_uploader_org        (lab report upload, hand-entered results, upload patient search)
--        public.coordinator_find_patient (patient search in "book for a patient")
--        private.is_care_coordinator_for (monthly meeting booked on a patient's behalf: my_followups / pick_followup_slot)
--        public.hold_appointment_slot    (a doctor booking on a call is stamped 'coordinator_phone' when it comes through
--                                         public.hold_appointment_slot_by_phone, so the pay-link and auto-confirm flow works for them)
--      private.guard_staff_lab_assignment is deliberately NOT widened: a laboratory assignment is a coordinator's standing duty, and
--      uploading does not need one.
--   3. Routing: private.pick_coordination_owner = the patient's own coordinator, else the least-loaded coordinator, else the
--      least-loaded doctor (the doctor eligibility is S90's care_gap_pick_doctor rule). New outreach
--      tasks, support requests (navigation_requests) and chronic programme tasks with no assignee get one at insert, marked
--      auto_assigned. Claiming by hand clears the mark, so the sweep never takes a person's work away from them.
--   4. Handover: private.coordination_handover_sweep (cron every 10 minutes) moves untouched, system-assigned items from a doctor to
--      a coordinator once one is available, and gives an owner to any item that arrived when nobody could take it. S90 gap tasks
--      are left to S90's own hand-back. Routing balances on private.coordination_load (all coordination items, gaps and queue
--      tasks) and one rule decides who is an active coordinator (private.is_active_coordinator: role, staff row, not on leave).
--   5. S16 queue: a task type whose minimum tier is care_coordinator is pushed to an offerable, competent coordinator first; with
--      none, create_clinical_task carries on exactly as before (lead, then an employed doctor, then the pool).
--   6. Read models for the workspace, all security_invoker so the caller's own RLS applies:
--        public.coordination_work_items      one row per open item across the four sources
--        public.coordination_recent_activity what was done in the last 14 days
--        public.coordination_patient_roster  "My patients" (or everyone, for a doctor covering)
--
-- Proof: packages/db/tests/cc1_coordination_shared_workspace.sql

-- 1. Who may do coordinator work ---------------------------------------------------------------------------------------------------

create or replace function private.is_coordination_actor(p_org uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
     where p.id = (select auth.uid())
       and p.is_active
       and p.organisation_id is not null
       and (p_org is null or p.organisation_id = p_org)
       and (
         p.role = 'care_coordinator'
         or (p.role = 'clinician' and exists (
               select 1 from public.clinical_staff cs
                where cs.profile_id = p.id
                  and cs.organisation_id = p.organisation_id
                  and cs.active and cs.status = 'active'
                  and (cs.doctor_tier = 'chief_medical_officer'
                       or (cs.doctor_tier = 'senior_medical_officer' and cs.employment_type = 'employed'))))
       )
  ) and private.mfa_requirement_met();
$$;
revoke all on function private.is_coordination_actor(uuid) from public, anon;
grant execute on function private.is_coordination_actor(uuid) to authenticated;

-- 2. Gates ---------------------------------------------------------------------------------------------------------------------------

create or replace function private.cde_uploader_org()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.organisation_id from public.profiles p
   where p.id = (select auth.uid()) and p.is_active and p.organisation_id is not null
     and (p.role in ('care_coordinator', 'lab_liaison')
          or (p.role = 'clinician' and private.is_coordination_actor(p.organisation_id)));
$$;

create or replace function private.is_care_coordinator_for(p_patient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles c
      join public.profiles p on p.organisation_id = c.organisation_id
     where c.id = (select auth.uid())
       and c.is_active
       and (c.role = 'care_coordinator' or private.is_coordination_actor(c.organisation_id))
       and p.id = p_patient
       and p.role = 'patient'
  );
$$;

create or replace function public.coordinator_find_patient(p_query text)
returns table(patient_id uuid, full_name text, state text, phone text, membership_tier text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_q text := btrim(coalesce(p_query, ''));
  v_digits text := regexp_replace(coalesce(p_query, ''), '\D', '', 'g');
  v_like text;
  r record;
begin
  -- CC-1: a doctor covering coordinator work may look a patient up too (private.is_coordination_actor).
  select organisation_id into v_org
    from public.profiles
   where id = v_uid and is_active and (role = 'care_coordinator' or private.is_coordination_actor(organisation_id));
  if v_org is null then
    raise exception 'only a care coordinator or a doctor covering coordination can look up a patient to book for them' using errcode = '42501';
  end if;
  if length(v_q) < 3 then
    raise exception 'type at least 3 characters of a name or phone number' using errcode = 'P0001';
  end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  for r in
    select p.id, p.full_name, p.state, p.phone
      from public.profiles p
     where p.role = 'patient'
       and p.organisation_id = v_org
       and p.is_active
       and coalesce(p.receives_care, true)
       and (p.full_name ilike v_like
            or (length(v_digits) >= 6
                and right(regexp_replace(coalesce(p.phone, ''), '\D', '', 'g'), least(length(v_digits), 10))
                    = right(v_digits, least(length(v_digits), 10))))
     order by p.full_name
     limit 10
  loop
    -- scope must be one of the closed list in care_access_events_scope_known, and log_care_access swallows a violation with only a
    -- warning, so a wrong scope here would lose the audit line silently (the proof checks the row exists). 'booking' is what this is for.
    perform private.log_care_access(r.id, 'record_viewed', 'booking',
      jsonb_build_object('stage', 'lookup', 'fields', jsonb_build_array('full_name', 'state', 'phone')));
    -- Fail closed: log_care_access never raises, so check the line is really there before handing over the details.
    if not exists (select 1 from public.care_access_events e
                    where e.patient_id = r.id and e.actor_profile_id = v_uid and e.kind = 'record_viewed' and e.scope = 'booking'
                      and e.occurred_at > now() - interval '1 hour') then
      raise exception 'the lookup could not be recorded, so nothing was shown' using errcode = 'P0001';
    end if;
    patient_id := r.id;
    full_name := r.full_name;
    state := r.state;
    phone := r.phone;
    membership_tier := private.patient_membership_tier(r.id);
    return next;
  end loop;
end;
$function$;

-- hold_appointment_slot: redefined from its live body; the only change is the v_via case (CC-1, marked below).
create or replace function public.hold_appointment_slot(p_organisation_id uuid, p_clinician_id uuid, p_appointment_type appointment_type, p_consultation_method appointment_consultation_method, p_scheduled_for timestamp with time zone, p_ends_at timestamp with time zone, p_reason text default null::text, p_service text default null::text, p_location text default null::text, p_specialist_referral_id uuid default null::uuid, p_care_plan_id uuid default null::uuid, p_patient_id uuid default null::uuid, p_hold_minutes integer default 10)
returns appointments
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_patient uuid;
  v_org uuid;
  v_is_high_priority boolean := false;
  v_payment_status public.appointment_payment_status;
  v_result public.appointments;
  v_caller_role public.user_role;
  v_via text;
  v_hold_minutes integer := p_hold_minutes;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  v_patient := coalesce(p_patient_id, v_uid);
  select organisation_id, role into v_org, v_caller_role from public.profiles where id = v_uid;
  if v_org is distinct from p_organisation_id then
    raise exception 'not authorized for this organisation';
  end if;
  if v_patient <> v_uid
     and not private.is_org_staff(p_organisation_id)
     and not private.can_act_for(v_patient, 'book_appointments'::public.caregiver_permission) then
    raise exception 'only staff, or someone with permission to book appointments for this person, may book on their behalf';
  end if;

  v_via := case
    when v_patient = v_uid then 'self'
    when v_caller_role = 'care_coordinator' then 'coordinator_phone'
    -- CC-1: a doctor covering coordination, booking through hold_appointment_slot_by_phone (which sets this transaction-local flag)
    when coalesce(current_setting('tarragon.phone_booking', true), '') = 'on'
         and private.is_coordination_actor(p_organisation_id) then 'coordinator_phone'
    when private.is_org_staff(p_organisation_id) then 'staff'
    else 'caregiver'
  end;

  v_payment_status := case p_appointment_type
    when 'telemedicine' then 'pending'
    when 'result_interpretation' then 'pending'
    when 'dietitian' then 'pending'      -- S64
    when 'pharmacist' then 'pending'     -- S64
    else 'not_required'
  end;

  -- Coordinator phone booking: the patient must be a patient of this organisation, and an item that has to be paid for
  -- is for members only (founder decision 2026-10-29: a Free patient upgrades first). Checked before the slot rules so
  -- the refusal does not depend on what is open.
  if v_via = 'coordinator_phone' then
    if not exists (select 1 from public.profiles
                    where id = v_patient and role = 'patient' and organisation_id = p_organisation_id) then
      raise exception 'that person is not a patient of this organisation' using errcode = 'P0001';
    end if;
    -- a phone call takes longer than a screen
    v_hold_minutes := greatest(p_hold_minutes, 30);
  end if;

  -- S37 (INV-14): consultations stay closed until the clinical_operations_enabled guard is on (a test patient with a test clinician passes).
  -- A consultation is any remote clinician appointment: the two consultation types, or any type booked with the telemedicine method.
  if (p_appointment_type in ('telemedicine', 'result_interpretation') or p_consultation_method = 'telemedicine')
     and not private.go_live_open('clinical_operations_enabled', v_patient, p_clinician_id) then
    raise exception 'consultations are not open yet' using errcode = 'P0001', hint = 'go_live_guard:clinical_operations_enabled';
  end if;

  -- S21 (OQ-129): a remote consultation is for adults only; fail closed when the age is unknown
  if p_consultation_method = 'telemedicine' then
    perform private.assert_adult_for_consultation(v_patient);
  end if;

  -- An extra meeting is for paid members (founder decision 2026-10-29), for whoever is booking it: the patient, someone acting for them,
  -- a coordinator on a call, or staff. A patient who already holds an unspent credit for the item needs no new purchase and is let through.
  -- Staff are held to it too: a staff booking for a Free patient could never be paid and nothing would release it. Checked before the slot
  -- rules so the refusal does not depend on what is open. After the go-live guard and the adult check: while consultations are closed,
  -- or for a minor, that is what everyone is told.
  if v_payment_status = 'pending'
     and private.patient_membership_tier(v_patient) is null
     and not private.has_available_service_credit(v_patient, private.booking_product_code(p_appointment_type::text)) then
    raise exception '%', case when v_patient = v_uid
                              then 'You need to join Membership before an extra meeting can be booked'
                              else 'This patient needs to join Membership before an extra meeting can be booked' end
      using errcode = 'P0001', hint = 'upgrade_first';
  end if;

  -- S64 (Q23): a dietitian or pharmacist visit is a remote consultation priced per item. It is closed while its product is inactive or
  -- unpriced, and it is booked only with a clinician of that role (and a doctor visit only with a doctor).
  if p_appointment_type in ('dietitian', 'pharmacist') then
    if p_consultation_method <> 'telemedicine' then
      raise exception 'that visit is booked as a remote consultation' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.service_products sp
                    where sp.code = private.booking_product_code(p_appointment_type::text) and sp.is_active and sp.price_kobo > 0) then
      raise exception 'that visit cannot be booked yet' using errcode = 'P0001', hint = 'product_not_priced';
    end if;
  end if;
  if p_appointment_type in ('telemedicine', 'dietitian', 'pharmacist')
     and not private.clinician_matches_booking_type(p_clinician_id, p_appointment_type::text) then
    raise exception 'that clinician is not available for this kind of visit' using errcode = 'P0001';
  end if;

  -- S21 (OQ-124): a consultation is booked only from time the clinician has declared and the rota has confirmed
  -- (S64: the same single source of open time serves the dietitian and pharmacist visits)
  if p_appointment_type in ('telemedicine', 'dietitian', 'pharmacist') and not private.slot_is_open(p_clinician_id, v_patient, p_scheduled_for, p_ends_at) then
    raise exception 'that time is not open for consultations: pick another slot' using errcode = 'P0001';
  end if;

  if p_scheduled_for <= now() then
    raise exception 'that time has passed — pick another slot';
  end if;
  if p_ends_at <= p_scheduled_for then
    raise exception 'invalid time range';
  end if;

  if p_specialist_referral_id is not null then
    select (urgency in ('urgent', 'priority')) into v_is_high_priority
    from public.specialist_referrals
    where id = p_specialist_referral_id and organisation_id = p_organisation_id;
  end if;

  begin
    insert into public.appointments (
      organisation_id, patient_id, clinician_id, appointment_type, consultation_method,
      scheduled_for, ends_at, status, reason, service, location,
      specialist_referral_id, care_plan_id, booked_by, is_high_priority, hold_expires_at,
      payment_status, booked_via
    ) values (
      p_organisation_id, v_patient, p_clinician_id, p_appointment_type, p_consultation_method,
      p_scheduled_for, p_ends_at, 'held', p_reason, p_service, p_location,
      p_specialist_referral_id, p_care_plan_id, v_uid, coalesce(v_is_high_priority, false),
      now() + (v_hold_minutes * interval '1 minute'),
      v_payment_status, v_via
    )
    returning * into v_result;
  exception
    when exclusion_violation then
      raise exception 'that time was just taken — pick another slot';
  end;

  if v_patient <> v_uid then
    perform private.log_care_access(v_patient, 'acted_for', 'booking',
      jsonb_build_object('appointment_id', v_result.id, 'stage', 'held', 'booked_via', v_via));
  end if;

  return v_result;
end;
$function$;

-- The phone-booking door for a doctor covering coordination. A coordinator's own bookings are stamped by role and need no flag;
-- anyone else who is not a coordination actor is refused here. The flag is transaction-local and cleared before returning.
create or replace function public.hold_appointment_slot_by_phone(p_organisation_id uuid, p_clinician_id uuid, p_appointment_type appointment_type, p_consultation_method appointment_consultation_method, p_scheduled_for timestamp with time zone, p_ends_at timestamp with time zone, p_patient_id uuid, p_reason text default null::text, p_service text default null::text, p_location text default null::text)
returns appointments
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_result public.appointments;
begin
  if not private.is_coordination_actor(p_organisation_id) then
    raise exception 'only a care coordinator or a doctor covering coordination can book on a call' using errcode = '42501';
  end if;
  if p_patient_id is null or p_patient_id = (select auth.uid()) then
    raise exception 'a phone booking is for a patient, not for yourself' using errcode = '22023';
  end if;
  perform set_config('tarragon.phone_booking', 'on', true);
  v_result := public.hold_appointment_slot(
    p_organisation_id => p_organisation_id, p_clinician_id => p_clinician_id, p_appointment_type => p_appointment_type,
    p_consultation_method => p_consultation_method, p_scheduled_for => p_scheduled_for, p_ends_at => p_ends_at,
    p_reason => p_reason, p_service => p_service, p_location => p_location, p_patient_id => p_patient_id);
  perform set_config('tarragon.phone_booking', 'off', true);
  return v_result;
end;
$$;
revoke all on function public.hold_appointment_slot_by_phone(uuid, uuid, appointment_type, appointment_consultation_method, timestamptz, timestamptz, uuid, text, text, text) from public, anon;
grant execute on function public.hold_appointment_slot_by_phone(uuid, uuid, appointment_type, appointment_consultation_method, timestamptz, timestamptz, uuid, text, text, text) to authenticated;

-- 3. Routing -------------------------------------------------------------------------------------------------------------------------

-- Columns first: the SQL functions below are checked against them when they are created (a fresh replay failed otherwise).
alter table public.care_outreach_tasks add column if not exists auto_assigned boolean not null default false;
alter table public.navigation_requests add column if not exists auto_assigned boolean not null default false;
alter table public.chronic_programme_coordinator_tasks
  add column if not exists assigned_to uuid references public.profiles(id) on delete set null,
  add column if not exists auto_assigned boolean not null default false;
create index if not exists chronic_programme_coordinator_tasks_assigned_open_idx
  on public.chronic_programme_coordinator_tasks (assigned_to) where status = 'open';
create index if not exists care_outreach_tasks_auto_open_idx
  on public.care_outreach_tasks (organisation_id) where auto_assigned and status = 'open';
create index if not exists navigation_requests_auto_open_idx
  on public.navigation_requests (organisation_id) where auto_assigned and status = 'open';

comment on column public.care_outreach_tasks.auto_assigned is
  'CC-2: true while the assignee was chosen by the system (private.pick_coordination_owner); a hand claim clears it, and only auto-assigned untouched items move to a coordinator in the handover sweep.';
comment on column public.navigation_requests.auto_assigned is 'CC-2: see care_outreach_tasks.auto_assigned.';
comment on column public.chronic_programme_coordinator_tasks.auto_assigned is 'CC-2: see care_outreach_tasks.auto_assigned.';
comment on column public.chronic_programme_coordinator_tasks.assigned_to is 'CC-2: who holds this task; chosen by private.pick_coordination_owner at insert.';

-- One load measure for everything a person holds: coordination items, care gaps and queue tasks. The S90 pickers count only gaps and
-- queue tasks, so routing coordination work through them would send every new item to the same person (review finding, 2026-11-07).
create or replace function private.coordination_load(p_profile uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select (select count(*) from public.care_outreach_tasks t where t.assigned_to = p_profile and t.status in ('open', 'in_progress', 'contacted'))
       + (select count(*) from public.navigation_requests n where n.assigned_to = p_profile and n.status <> 'resolved')
       + (select count(*) from public.chronic_programme_coordinator_tasks c where c.assigned_to = p_profile and c.status = 'open')
       + (select count(*) from public.care_gaps g where g.owner_id = p_profile and g.status = 'open')
       + (select count(*) from public.clinical_tasks q where (q.pushed_to = p_profile or q.claimed_by = p_profile)
                                                       and q.state in ('offered_to_lead', 'open', 'claimed', 'escalated'));
$$;
revoke all on function private.coordination_load(uuid) from public;

-- Who is an active Care Coordinator right now: the account role AND an active coordinator staff row, not on leave. One rule for
-- routing, the sweep and the S16 push (care_gap_pick_coordinator checks the staff row only; MSG-2 checks the role only).
create or replace function private.is_active_coordinator(p_profile uuid, p_now timestamptz default now())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile is not null and exists (
    select 1 from public.profiles p
      join public.clinical_staff cs on cs.profile_id = p.id and cs.organisation_id = p.organisation_id
     where p.id = p_profile and p.role = 'care_coordinator' and p.is_active
       and cs.active and cs.status = 'active' and cs.doctor_tier = 'care_coordinator'
       and not private.clinician_on_leave(cs.profile_id, p_now));
$$;
revoke all on function private.is_active_coordinator(uuid, timestamptz) from public;

create or replace function private.pick_coordination_coordinator(p_org uuid, p_now timestamptz default now())
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select cs.profile_id
    from public.clinical_staff cs
   where cs.organisation_id = p_org and cs.doctor_tier = 'care_coordinator'
     and private.is_active_coordinator(cs.profile_id, p_now)
   order by private.clinician_deprioritised_now(cs.profile_id, p_now), private.coordination_load(cs.profile_id), cs.profile_id
   limit 1;
$$;
revoke all on function private.pick_coordination_coordinator(uuid, timestamptz) from public;

-- The doctor fallback: the same eligibility as S90's care_gap_pick_doctor, balanced on the full coordination load.
create or replace function private.pick_coordination_doctor(p_org uuid, p_patient uuid, p_now timestamptz default now())
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select cs.profile_id
    from public.clinical_staff cs
   where cs.organisation_id = p_org and cs.active and cs.status = 'active' and cs.profile_id is not null
     and cs.employment_type = 'employed'
     and cs.doctor_tier is not null
     and private.doctor_tier_rank(cs.doctor_tier) >= private.doctor_tier_rank('senior_medical_officer'::public.doctor_tier)
     and private.clinician_is_eligible(cs.profile_id)
     and not private.clinician_on_leave(cs.profile_id, p_now)
     and not private.clinician_in_post_call_rest(cs.profile_id)
     and not private.has_conflict(cs.profile_id, p_patient)
   order by private.clinician_deprioritised_now(cs.profile_id, p_now), private.coordination_load(cs.profile_id), cs.profile_id
   limit 1;
$$;
revoke all on function private.pick_coordination_doctor(uuid, uuid, timestamptz) from public;

create or replace function private.pick_coordination_owner(p_org uuid, p_patient uuid, p_now timestamptz default now())
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    -- the patient's own coordinator, while active and not on leave
    (select cta.care_coordinator_id
       from public.care_team_assignment cta
      where cta.patient_id = p_patient and cta.organisation_id = p_org
        and private.is_active_coordinator(cta.care_coordinator_id, p_now)
      limit 1),
    private.pick_coordination_coordinator(p_org, p_now),
    private.pick_coordination_doctor(p_org, p_patient, p_now));
$$;
revoke all on function private.pick_coordination_owner(uuid, uuid, timestamptz) from public;

-- One trigger function for all three tables. BEFORE INSERT: no assignee -> pick one, mark auto. BEFORE UPDATE: a changed assignee
-- by anyone but the sweep clears the mark; a caller who is not org staff (a patient editing their own support request) cannot move
-- the assignee or the mark at all.
create or replace function private.coordination_route_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sweep boolean := coalesce(current_setting('tarragon.coordination_sweep', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.assigned_to is null and new.organisation_id is not null and new.patient_id is not null then
      new.assigned_to := private.pick_coordination_owner(new.organisation_id, new.patient_id);
      new.auto_assigned := new.assigned_to is not null;
    elsif not v_sweep then
      new.auto_assigned := false;
    end if;
    return new;
  end if;

  if v_sweep then
    return new;
  end if;
  if (select auth.uid()) is not null and not private.is_org_staff(old.organisation_id) then
    new.assigned_to := old.assigned_to;
    new.auto_assigned := old.auto_assigned;
    return new;
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    new.auto_assigned := false;
  elsif new.auto_assigned and not old.auto_assigned then
    new.auto_assigned := false;  -- the mark is the system's to set, never a caller's
  end if;
  return new;
end;
$$;

drop trigger if exists zz_coordination_route on public.care_outreach_tasks;
create trigger zz_coordination_route before insert or update of assigned_to, auto_assigned on public.care_outreach_tasks
  for each row execute function private.coordination_route_item();
drop trigger if exists zz_coordination_route on public.navigation_requests;
create trigger zz_coordination_route before insert or update of assigned_to, auto_assigned on public.navigation_requests
  for each row execute function private.coordination_route_item();
drop trigger if exists zz_coordination_route on public.chronic_programme_coordinator_tasks;
create trigger zz_coordination_route before insert or update of assigned_to, auto_assigned on public.chronic_programme_coordinator_tasks
  for each row execute function private.coordination_route_item();

-- 4. Handover sweep ------------------------------------------------------------------------------------------------------------------

create or replace function private.coordination_handover_sweep()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_to uuid;
  v_moved integer := 0;
begin
  perform set_config('tarragon.coordination_sweep', 'on', true);

  -- Two jobs, one pass per table:
  --   (a) an item nobody holds (no owner could be found when it arrived, e.g. everyone on leave) gets the current pick, whoever it is;
  --   (b) an item the system gave a doctor that nobody has started moves to a coordinator, but only when the pick is one.
  -- S90 gap tasks are left to S90's own hand-back. A hand claim (auto_assigned false) is never touched.
  for r in
    select t.id, t.organisation_id, t.patient_id, t.assigned_to
      from public.care_outreach_tasks t
     where t.status = 'open'
       and not exists (select 1 from public.care_gaps g where g.outreach_task_id = t.id)
       and (t.assigned_to is null
            or (t.auto_assigned and not private.is_active_coordinator(t.assigned_to)
                and private.pick_coordination_coordinator(t.organisation_id) is not null))
     order by t.created_at
  loop
    v_to := private.pick_coordination_owner(r.organisation_id, r.patient_id);
    if v_to is not null and (r.assigned_to is null or private.is_active_coordinator(v_to)) then
      update public.care_outreach_tasks set assigned_to = v_to, auto_assigned = true where id = r.id;
      v_moved := v_moved + 1;
    end if;
  end loop;

  -- support requests: an auto-placed one moves only while nobody has acknowledged it
  for r in
    select n.id, n.organisation_id, n.patient_id, n.assigned_to
      from public.navigation_requests n
     where n.status <> 'resolved'
       and (n.assigned_to is null
            or (n.auto_assigned and n.status = 'open' and n.acknowledged_at is null
                and not private.is_active_coordinator(n.assigned_to)
                and private.pick_coordination_coordinator(n.organisation_id) is not null))
     order by n.created_at
  loop
    v_to := private.pick_coordination_owner(r.organisation_id, r.patient_id);
    if v_to is not null and (r.assigned_to is null or private.is_active_coordinator(v_to)) then
      update public.navigation_requests set assigned_to = v_to, auto_assigned = true where id = r.id;
      v_moved := v_moved + 1;
    end if;
  end loop;

  for r in
    select c.id, c.organisation_id, c.patient_id, c.assigned_to
      from public.chronic_programme_coordinator_tasks c
     where c.status = 'open'
       and (c.assigned_to is null
            or (c.auto_assigned and not private.is_active_coordinator(c.assigned_to)
                and private.pick_coordination_coordinator(c.organisation_id) is not null))
     order by c.created_at
  loop
    v_to := private.pick_coordination_owner(r.organisation_id, r.patient_id);
    if v_to is not null and (r.assigned_to is null or private.is_active_coordinator(v_to)) then
      update public.chronic_programme_coordinator_tasks set assigned_to = v_to, auto_assigned = true where id = r.id;
      v_moved := v_moved + 1;
    end if;
  end loop;

  perform set_config('tarragon.coordination_sweep', 'off', true);
  return v_moved;
end;
$$;
revoke all on function private.coordination_handover_sweep() from public;

-- Existing open items with no owner get one now, through the same sweep (no system marker existed before this migration, so nothing
-- already assigned is touched). Live on 2026-11-07: 15 open unassigned outreach tasks across two organisations.
select private.coordination_handover_sweep();

do $$
begin
  if exists (select 1 from cron.job where jobname = 'coordination-handover-sweep') then
    perform cron.unschedule('coordination-handover-sweep');
  end if;
  perform cron.schedule('coordination-handover-sweep', '*/10 * * * *', $c$ select private.coordination_handover_sweep(); $c$);
end $$;

-- 5. S16 queue: coordinator first for coordinator-level task types ------------------------------------------------------------------

create or replace function private.pick_task_coordinator(p_org uuid, p_patient uuid, p_req text[], p_until timestamptz)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select cs.profile_id
    from public.clinical_staff cs
   where cs.organisation_id = p_org and cs.doctor_tier = 'care_coordinator' and cs.employment_type = 'employed'
     and private.is_active_coordinator(cs.profile_id)
     and private.clinician_offerable(cs.profile_id, now(), p_until)
     and not private.has_conflict(cs.profile_id, p_patient)
     and coalesce(array_length(private.clinician_missing_competencies(cs.profile_id, p_req), 1), 0) = 0
   order by private.clinician_deprioritised_now(cs.profile_id, now()), private.coordination_load(cs.profile_id), cs.profile_id
   limit 1;
$$;
revoke all on function private.pick_task_coordinator(uuid, uuid, text[], timestamptz) from public;

-- create_clinical_task: redefined from its live body; the only change is the CC-3 block marked below.
create or replace function private.create_clinical_task(p_patient uuid, p_type text, p_due_minutes integer default null::integer, p_dedup_key text default null::text, p_triage_event uuid default null::uuid, p_rule_set_version integer default null::integer, p_source_event uuid default null::uuid, p_extra_competencies text[] default '{}'::text[])
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  ty public.task_types%rowtype;
  pr public.profiles%rowtype;
  v_due timestamptz;
  v_id uuid;
  v_existing public.clinical_tasks%rowtype;
  v_lead uuid;
  v_push uuid;
  v_window_ends timestamptz;
  v_frac numeric := (private.task_layer_setting('lead_window_cap_fraction') #>> '{}')::numeric;
  v_cap_minutes integer;
  v_new_due timestamptz;
  v_req text[];
  v_missing text[];
  v_skip text;
begin
  if v_frac is null then raise exception 'queue_task_layer_config has no active row' using errcode = 'P0001'; end if;
  select * into ty from public.task_types where code = p_type and is_active;
  if not found or not ty.creatable then raise exception 'unknown or non-creatable task type %', p_type using errcode = '22023'; end if;
  select * into pr from public.profiles where id = p_patient and role = 'patient';
  if not found then raise exception 'unknown patient' using errcode = '22023'; end if;
  v_due := now() + make_interval(mins => coalesce(p_due_minutes, ty.default_due_minutes));
  -- OQ-433: what the task requires is the type's list, the producer's extras, and the type's prescription subtype rule.
  v_req := (select coalesce(array_agg(distinct x order by x), '{}')
              from unnest(ty.required_competencies || coalesce(p_extra_competencies, '{}') || private.task_extra_competencies(ty.code, p_dedup_key)) x);

  -- A repeat trigger merges into the live task; the merge is counted and a tighter due time wins. Never dropped silently.
  if p_dedup_key is not null then
    -- A task already claimed is being worked on without the new information, so a repeat must not vanish into it:
    -- it becomes a follow-up task under its own key (a further repeat merges into that one, or into the next).
    loop
      select * into v_existing from public.clinical_tasks
       where dedup_key = p_dedup_key and state not in ('completed', 'cancelled') for update;
      exit when not found or v_existing.state <> 'claimed';
      p_dedup_key := p_dedup_key || '+';
    end loop;
    if found then
      v_new_due := case when coalesce((private.queue_setting('dedup_tightens_due'))::boolean, true) then least(v_existing.due_at, v_due) else v_existing.due_at end;
      perform set_config('tarragon.task_transition', 'on', true);
      -- D9: a tighter due time tightens an offer still running, by the same fraction of the task's own life
      update public.clinical_tasks set merged_count = merged_count + 1, due_at = v_new_due,
             required_competencies = case when state in ('open', 'escalated')
                                          then (select coalesce(array_agg(distinct x order by x), '{}') from unnest(required_competencies || v_req) x)
                                          else required_competencies end,
             lead_window_ends_at = case when state = 'offered_to_lead' and lead_window_ends_at is not null
                                        then least(lead_window_ends_at, created_at + (v_new_due - created_at) * v_frac)
                                        else lead_window_ends_at end
       where id = v_existing.id;
      perform set_config('tarragon.task_transition', 'off', true);
      return v_existing.id;
    end if;
  end if;

  perform set_config('tarragon.task_transition', 'on', true);
  insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id,
      source_event_id, triage_event_id, rule_set_version, required_competencies, min_tier, due_at, dedup_key, is_test)
  values (pr.organisation_id, ty.code, ty.version, ty.priority_class, ty.priority_class, p_patient,
      p_source_event, p_triage_event, p_rule_set_version,
      v_req,
      ty.min_doctor_tier, v_due, p_dedup_key, pr.is_test)
  returning id into v_id;
  perform set_config('tarragon.task_transition', 'off', true);

  insert into public.clinical_task_transitions (organisation_id, task_id, from_state, to_state, actor_kind, reason, is_test)
  values (pr.organisation_id, v_id, null, 'created', 'system', 'created', pr.is_test);
  perform private.emit_domain_event('clinical_task.created', pr.organisation_id,
    jsonb_build_object('task_id', v_id, 'type', ty.code, 'priority_class', ty.priority_class),
    'clinical_task.created:' || v_id, p_patient, 'clinical_task', v_id);

  -- D1: the window is the type's window or a fraction of the time this task has, whichever is shorter. Less than a minute
  -- of window is no window: the task goes straight to the pool.
  v_cap_minutes := floor(least(ty.lead_window_minutes::numeric, v_frac * extract(epoch from (v_due - now())) / 60));

  -- Where it goes first. A red-class task never waits (INV-05).
  if ty.priority_class > 1 and v_cap_minutes >= 1 then
    v_window_ends := least(v_due, now() + make_interval(mins => v_cap_minutes));
    -- CC-3: coordinator-level work goes to an offerable, competent Care Coordinator first. With none, nothing below changes.
    if ty.min_doctor_tier = 'care_coordinator' and ty.pushable then
      v_push := private.pick_task_coordinator(pr.organisation_id, p_patient, v_req, v_window_ends);
      if v_push is not null then
        perform set_config('tarragon.task_transition', 'on', true);
        update public.clinical_tasks set delivery_path = 'push', pushed_to = v_push, lead_window_ends_at = v_window_ends where id = v_id;
        perform set_config('tarragon.task_transition', 'off', true);
        perform private.apply_task_transition(v_id, 'offered_to_lead', 'system', null, 'pushed to a care coordinator');
        return v_id;
      end if;
    end if;
    -- S18 (OQ-111): the patient's lead clinician; care_team_assignment is only the fallback for patients with no lead row.
    select coalesce(
             (select la.clinician_id from public.lead_assignments la where la.patient_id = p_patient and la.state = 'active'),
             (select cta.clinician_id from public.care_team_assignment cta where cta.patient_id = p_patient))
      into v_lead;
    -- OQ-435: a lead who lacks a competency the task requires cannot claim it, so the offer would only lapse. Skip the lead and
    -- say why on the transition that follows (the audit trail), then carry on as if there were no lead.
    if v_lead is not null then
      v_missing := private.clinician_missing_competencies(v_lead, v_req);
      if coalesce(array_length(v_missing, 1), 0) > 0 then
        v_skip := 'lead not offered: lacks ' || array_to_string(v_missing, ', ');
        v_lead := null;
      end if;
    end if;
    -- S18 (OQ-112): working hours and post-call rest for contracted clinicians; never offered to a conflicted clinician.
    if v_lead is not null
       and private.clinician_offerable(v_lead, now(), v_window_ends)
       and not private.has_conflict(v_lead, p_patient)
       and exists (select 1 from public.clinical_staff cs where cs.profile_id = v_lead and cs.doctor_tier is not null
                    and private.doctor_tier_rank(cs.doctor_tier) >= private.doctor_tier_rank(ty.min_doctor_tier)) then
      perform set_config('tarragon.task_transition', 'on', true);
      update public.clinical_tasks set lead_clinician_id = v_lead, lead_window_ends_at = v_window_ends where id = v_id;
      if exists (select 1 from public.clinical_staff cs where cs.profile_id = v_lead and cs.employment_type = 'employed') and ty.pushable then
        update public.clinical_tasks set delivery_path = 'push', pushed_to = v_lead where id = v_id;
      end if;
      perform set_config('tarragon.task_transition', 'off', true);
      perform private.apply_task_transition(v_id, 'offered_to_lead', 'system', null, 'offered to the named clinician');
      return v_id;
    end if;
    if ty.pushable then
      v_push := private.pick_employed_clinician_competent(pr.organisation_id, ty.min_doctor_tier, p_patient, v_req);
      if v_push is not null then
        perform set_config('tarragon.task_transition', 'on', true);
        update public.clinical_tasks set delivery_path = 'push', pushed_to = v_push, lead_window_ends_at = v_window_ends where id = v_id;
        perform set_config('tarragon.task_transition', 'off', true);
        perform private.apply_task_transition(v_id, 'offered_to_lead', 'system', null, 'pushed to an employed doctor' || coalesce(' (' || v_skip || ')', ''));
        return v_id;
      end if;
    end if;
  end if;
  perform private.apply_task_transition(v_id, 'open', 'system', null, 'to the pool' || coalesce(' (' || v_skip || ')', ''));
  return v_id;
end;
$function$;

-- 6. Read models ---------------------------------------------------------------------------------------------------------------------

-- Priority is unified to 1 (act first), 2 (normal), 3 (when there is time). Status is unified to open / in_progress / awaiting_patient
-- / awaiting_external / awaiting_clinician; raw_status keeps the source's own word.
create or replace view public.coordination_work_items
with (security_invoker = true) as
with items as (
  select 'outreach'::text as source, t.id as item_id, t.organisation_id, t.patient_id,
         case when t.trigger_type = 'awaiting_result' then 'follow_up' else 'outreach' end as category,
         t.trigger_type::text as kind,
         least(greatest(t.priority::int, 1), 3) as priority,
         coalesce(g.next_attempt_due_at, (g.due_date::timestamp at time zone 'Africa/Lagos')) as due_at,
         case t.status when 'open' then 'open' when 'in_progress' then 'in_progress' else 'awaiting_patient' end as status,
         t.status::text as raw_status, t.assigned_to, t.auto_assigned, t.created_at, t.updated_at as last_activity_at
    from public.care_outreach_tasks t
    -- at most one gap per task (the earliest due), so a task linked to two open gaps is still one row
    left join lateral (select g0.next_attempt_due_at, g0.due_date from public.care_gaps g0
                        where g0.outreach_task_id = t.id and g0.status = 'open'
                        order by coalesce(g0.next_attempt_due_at, g0.due_date::timestamptz) limit 1) g on true
   where t.status in ('open', 'in_progress', 'contacted')
  union all
  select 'support', n.id, n.organisation_id, n.patient_id, 'support', n.category::text,
         case when n.is_urgent then 1 else 2 end, null::timestamptz,
         case n.status when 'waiting_on_patient' then 'awaiting_patient' when 'waiting_on_provider' then 'awaiting_external'
                       else case when n.acknowledged_at is null then 'open' else 'in_progress' end end,
         n.status::text, n.assigned_to, n.auto_assigned, n.created_at, n.updated_at
    from public.navigation_requests n
   where n.status <> 'resolved'
  union all
  select 'programme', c.id, c.organisation_id, c.patient_id, 'programme', c.task_type::text,
         case when c.task_type = 'lab_panel_due_soon' then 3 else 2 end, null::timestamptz,
         'open', c.status::text, c.assigned_to, c.auto_assigned, c.created_at, c.created_at
    from public.chronic_programme_coordinator_tasks c
   where c.status = 'open'
  union all
  select 'queue', q.id, q.organisation_id, q.patient_id, 'queue', q.type,
         case when q.priority_class <= 3 then 1 when q.priority_class <= 6 then 2 else 3 end, q.due_at,
         case q.state when 'claimed' then 'in_progress' when 'escalated' then 'awaiting_clinician' else 'open' end,
         q.state::text, coalesce(q.claimed_by, q.pushed_to), false, q.created_at, q.updated_at
    from public.clinical_tasks q
   where q.min_tier = 'care_coordinator' and q.state in ('offered_to_lead', 'open', 'claimed', 'escalated')
)
select i.source, i.item_id, i.organisation_id, i.patient_id, pt.full_name as patient_name, pt.patient_number,
       i.category, i.kind, i.priority, i.due_at, i.status, i.raw_status,
       i.assigned_to, ow.full_name as assigned_name, (ow.role = 'care_coordinator') as assigned_is_coordinator,
       i.auto_assigned, i.created_at, i.last_activity_at
  from items i
  left join public.profiles pt on pt.id = i.patient_id
  left join public.profiles ow on ow.id = i.assigned_to
 -- staff only: a patient can read their own support request, but this workspace view is not for them
 where private.is_org_staff(i.organisation_id);

revoke all on public.coordination_work_items from anon, public;
grant select on public.coordination_work_items to authenticated;

create or replace view public.coordination_recent_activity
with (security_invoker = true) as
with ev as (
  select 'contact_logged'::text as kind, c.id as event_id, c.organisation_id, c.patient_id, c.contacted_at as occurred_at,
         c.contacted_by as actor_id, c.channel::text as detail
    from public.care_outreach_contacts c
   where c.contacted_at > now() - interval '14 days'
  union all
  select 'outreach_resolved', t.id, t.organisation_id, t.patient_id, t.resolved_at, t.resolved_by, t.trigger_type::text
    from public.care_outreach_tasks t
   where t.status in ('resolved', 'dismissed') and t.resolved_at > now() - interval '14 days'
  union all
  select 'support_resolved', n.id, n.organisation_id, n.patient_id, n.resolved_at, n.resolved_by, n.category::text
    from public.navigation_requests n
   where n.status = 'resolved' and n.resolved_at > now() - interval '14 days'
  union all
  select 'programme_done', c.id, c.organisation_id, c.patient_id, c.done_at, c.done_by, c.task_type::text
    from public.chronic_programme_coordinator_tasks c
   where c.status in ('done', 'dismissed') and c.done_at > now() - interval '14 days'
)
select ev.kind, ev.event_id, ev.organisation_id, ev.patient_id, pt.full_name as patient_name, ev.occurred_at,
       ev.actor_id, ac.full_name as actor_name, ev.detail
  from ev
  left join public.profiles pt on pt.id = ev.patient_id
  left join public.profiles ac on ac.id = ev.actor_id
 where private.is_org_staff(ev.organisation_id);

revoke all on public.coordination_recent_activity from anon, public;
grant select on public.coordination_recent_activity to authenticated;

-- "My patients": patients tied to the caller as coordinator, as assigned clinician or as lead clinician. p_scope 'all' lists every
-- patient in the caller's organisation (a doctor covering coordination with nobody tied to them yet). security invoker: the caller's
-- own RLS decides every row; a caller who is not a coordination actor gets nothing.
create or replace function public.coordination_patient_roster(p_scope text default 'mine', p_limit integer default 300)
returns table (
  patient_id uuid, full_name text, patient_number text,
  clinician_id uuid, clinician_name text, coordinator_id uuid, coordinator_name text,
  open_items integer, overdue_items integer, next_appointment_at timestamptz, last_contact_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with me as (select (select auth.uid()) as uid where private.is_coordination_actor()),
  pts as (
    select p.id, p.full_name, p.patient_number
      from public.profiles p, me
     where p.role = 'patient' and p.is_active and coalesce(p.receives_care, true)
       and p.organisation_id = (select organisation_id from public.profiles where id = me.uid)
       and (p_scope = 'all'
            or exists (select 1 from public.care_team_assignment cta
                        where cta.patient_id = p.id and me.uid in (cta.care_coordinator_id, cta.clinician_id))
            or exists (select 1 from public.lead_assignments la
                        where la.patient_id = p.id and la.state = 'active' and la.clinician_id = me.uid))
     order by p.full_name
     limit least(greatest(coalesce(p_limit, 300), 1), 1000)
  )
  , work as (
    -- one pass over the work items for all listed patients, not two scans per patient
    select w.patient_id, count(*)::int as open_items, (count(*) filter (where w.due_at < now()))::int as overdue_items
      from public.coordination_work_items w
     where w.patient_id in (select id from pts)
     group by w.patient_id
  ), next_appt as (
    select a.patient_id, min(a.scheduled_for) as next_at
      from public.appointments a
     where a.patient_id in (select id from pts) and a.scheduled_for >= now()
       and a.status in ('scheduled', 'booked', 'confirmed', 'held')
     group by a.patient_id
  ), last_contact as (
    select c.patient_id, max(c.contacted_at) as last_at
      from public.care_outreach_contacts c
     where c.patient_id in (select id from pts)
     group by c.patient_id
  )
  select pts.id, pts.full_name, pts.patient_number,
         cta.clinician_id, cl.full_name, cta.care_coordinator_id, co.full_name,
         coalesce(work.open_items, 0), coalesce(work.overdue_items, 0), next_appt.next_at, last_contact.last_at
    from pts
    left join work on work.patient_id = pts.id
    left join next_appt on next_appt.patient_id = pts.id
    left join last_contact on last_contact.patient_id = pts.id
    left join public.care_team_assignment cta on cta.patient_id = pts.id
    left join public.profiles cl on cl.id = cta.clinician_id
    left join public.profiles co on co.id = cta.care_coordinator_id
   order by pts.full_name;
$$;
revoke all on function public.coordination_patient_roster(text, integer) from public, anon;
grant execute on function public.coordination_patient_roster(text, integer) to authenticated;

-- Self-checks ------------------------------------------------------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.coordination_patient_roster(text, integer)', 'EXECUTE') then
    raise exception 'anon can execute coordination_patient_roster';
  end if;
  if has_function_privilege('anon', 'public.hold_appointment_slot_by_phone(uuid, uuid, appointment_type, appointment_consultation_method, timestamptz, timestamptz, uuid, text, text, text)', 'EXECUTE') then
    raise exception 'anon can execute hold_appointment_slot_by_phone';
  end if;
  if has_table_privilege('anon', 'public.coordination_work_items', 'SELECT') or has_table_privilege('anon', 'public.coordination_recent_activity', 'SELECT') then
    raise exception 'anon can read a coordination view';
  end if;
  if not exists (select 1 from pg_class where relname = 'coordination_work_items' and 'security_invoker=true' = any(reloptions)) then
    raise exception 'coordination_work_items is not security_invoker';
  end if;
end $$;
