-- ===========================================================================
-- DW-03, DW-10..DW-13 (founder and CMO, 2026-11-06): three real working states for an escalation, the rules that govern them, and the
-- database-enforced resolve note (gap G11).
--
-- The states were added in the previous migration (an enum value cannot be used in the transaction that adds it):
--   awaiting_information      -- the doctor is waiting for something (an outside result, a letter, a call back)
--   patient_contact_required  -- the next step is reaching the patient
--   monitoring                -- watch and wait, with a review-by date; the case comes back on its own
--
-- Decisions this migration encodes:
--   DW-10  the contact SLA never pauses. The clock lives on the linked clinician_alert (sla_due_at), which none of these states touch.
--          Nothing here reads or writes sla_due_at, and no state is treated as "not open" anywhere.
--   DW-11  monitoring needs a review-by date at most 14 days ahead; when it passes, the case returns to under_review by itself
--          (private.return_due_escalation_monitoring, every 15 minutes).
--   DW-12  a written note (10+ characters, new each time) is required to enter any of the three states, and a resolution note
--          (10+ characters) is required to resolve. Enforced here, not only in the form.
--   DW-13  the assigned doctor (or the Chief Medical Officer) owns these moves. A care coordinator may log a contact attempt on the case
--          (public.log_escalation_contact_attempt) but can never change its state; that rule is the clinical-tier check below.
--
-- Live data: 0 rows in public.escalations on 2026-11-06, so no existing row needs converting (the CHECK below holds trivially).
--
-- Every function that treated "open work" as status in ('open', 'under_review') is redefined to "not resolved and not referred", so
-- a case in a new state still counts as open, still routes load, and still ties its doctor to the patient. Each redefinition starts
-- from the LIVE body (checked by md5 of prosrc on 2026-11-06), changing only that predicate:
--   private.clinician_has_patient_access   live body differs from the last committed file (s19c); rebuilt from production
--   private.allergy_request_recipients     live body differs from the last committed file (s05b_e); rebuilt from production
--   private.auto_assign_escalation         matches 20261103023419_test_patient_cases_route_to_cmo.sql
--   public.ops_today_summary               matches 20261102135803_ops_today_summary_real_data_only.sql
-- public.reassign_escalation is unchanged: it sets status 'open', and the trigger below clears monitor_until on any move out of
-- monitoring, so a reassigned case never carries a stale review-by date.
-- ===========================================================================

-- 1. Columns ---------------------------------------------------------------------------------------------------------------------
alter table public.escalations
  add column status_note text,
  add column status_changed_at timestamptz,
  add column status_changed_by uuid references public.profiles(id) on delete restrict,
  add column monitor_until timestamptz;

alter table public.escalations
  add constraint escalations_status_note_length check (status_note is null or length(status_note) <= 2000),
  add constraint escalations_monitor_until_only_when_monitoring check ((status = 'monitoring') = (monitor_until is not null));

comment on column public.escalations.status_note is
  'DW-12: why the case is in its current working state (awaiting information, patient contact required, monitoring). Required, and new, on each move into one of those states.';
comment on column public.escalations.monitor_until is
  'DW-11: review-by date while status = monitoring (at most 14 days ahead when set). At or after it the case returns to under_review automatically.';

-- 2. The rules -------------------------------------------------------------------------------------------------------------------
create or replace function private.enforce_escalation_state_rules()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_working constant public.escalation_status[] := array['awaiting_information', 'patient_contact_required', 'monitoring']::public.escalation_status[];
  v_owner boolean;
begin
  if tg_op = 'INSERT' then
    if new.status = any (v_working) then
      raise exception 'A new escalation starts as open. Start reviewing it before moving it to %.', new.status using errcode = '23514';
    end if;
    new.monitor_until := null;
    return new;
  end if;

  -- The owner of a working-state move: the assigned doctor, or an active Chief Medical Officer of the case's organisation, and in
  -- either case a clinical-tier member (a care coordinator never passes, DW-13).
  v_owner := v_uid is not null
    and private.is_clinical_tier(new.organisation_id)
    and (
      new.assigned_doctor_id = v_uid
      or exists (
        select 1 from public.clinical_staff cs
         where cs.profile_id = v_uid and cs.organisation_id = new.organisation_id
           and cs.active and cs.doctor_tier = 'chief_medical_officer'
      )
    );

  if new.status is not distinct from old.status then
    -- Same state. Only monitoring has something to change in place: extending or shortening the review-by date, under the same
    -- owner, window and fresh-note rules as entering it.
    if new.status = 'monitoring' and new.monitor_until is distinct from old.monitor_until then
      if not v_owner then
        raise exception 'Only the doctor this case is assigned to, or the Chief Medical Officer, can change its review-by date.' using errcode = '42501';
      end if;
      if new.monitor_until <= now() or new.monitor_until > now() + interval '14 days' then
        raise exception 'The review-by date must be in the future and no more than 14 days away.' using errcode = '23514';
      end if;
      if length(btrim(coalesce(new.status_note, ''))) < 10 or new.status_note is not distinct from old.status_note then
        raise exception 'Write a new note (at least 10 characters) saying why the review-by date changed.' using errcode = '23514';
      end if;
      new.status_changed_at := now();
      new.status_changed_by := v_uid;
    else
      -- The note and its attribution belong to the state change; they are not edited in place. Refuse a note change rather than
      -- dropping it silently (a client that thinks it saved a note must hear that it did not).
      if new.status_note is distinct from old.status_note then
        raise exception 'A note is saved with a change of state. Choose the state to move the case to, then write the note.' using errcode = '23514';
      end if;
      new.monitor_until := old.monitor_until;
      new.status_changed_at := old.status_changed_at;
      new.status_changed_by := old.status_changed_by;
    end if;
    return new;
  end if;

  -- The state is changing.
  if new.status <> 'monitoring' then
    new.monitor_until := null;
  end if;

  if new.status = any (v_working) then
    if old.status <> 'under_review' and not (old.status = any (v_working)) then
      raise exception 'Start reviewing this case before moving it to %.', new.status using errcode = '23514';
    end if;
    if not v_owner then
      raise exception 'Only the doctor this case is assigned to, or the Chief Medical Officer, can move it to %. A care coordinator can log a contact attempt but cannot change the case.', new.status
        using errcode = '42501';
    end if;
    if length(btrim(coalesce(new.status_note, ''))) < 10 or new.status_note is not distinct from old.status_note then
      raise exception 'Write a note (at least 10 characters) saying why this case is moving to %.', new.status using errcode = '23514';
    end if;
    if new.status = 'monitoring'
       and (new.monitor_until is null or new.monitor_until <= now() or new.monitor_until > now() + interval '14 days') then
      raise exception 'Monitoring needs a review-by date in the future and no more than 14 days away.' using errcode = '23514';
    end if;
  elsif new.status = 'under_review' and old.status = any (v_working) then
    if v_uid is null then
      -- The only caller with no session is the scheduled return (private.return_due_escalation_monitoring), and only a monitoring
      -- case whose review-by date has passed may come back that way.
      if old.status <> 'monitoring' or old.monitor_until > now() then
        raise exception 'Only a monitoring case past its review-by date returns to review without a doctor.' using errcode = '42501';
      end if;
    elsif not v_owner then
      raise exception 'Only the doctor this case is assigned to, or the Chief Medical Officer, can take it back into review.' using errcode = '42501';
    end if;
  elsif new.status = 'open' and old.status = any (v_working) then
    -- Back to open is a reassignment (public.reassign_escalation, CMO) or the owner's own choice; never a coordinator or bystander.
    if not v_owner then
      raise exception 'Only the doctor this case is assigned to, or the Chief Medical Officer, can take it out of %.', old.status using errcode = '42501';
    end if;
  elsif new.status = 'resolved' then
    -- G11: a resolved case always says how it was resolved.
    if length(btrim(coalesce(new.resolution_note, ''))) < 10 then
      raise exception 'Write a resolution note (at least 10 characters) before resolving this case.' using errcode = '23514';
    end if;
  end if;

  new.status_changed_at := now();
  new.status_changed_by := v_uid;
  return new;
end;
$function$;

revoke all on function private.enforce_escalation_state_rules() from public, anon, authenticated;

create trigger escalations_enforce_state_rules
  before insert or update on public.escalations
  for each row execute function private.enforce_escalation_state_rules();

-- 3. Monitoring returns on its own (DW-11) ---------------------------------------------------------------------------------------
create or replace function private.return_due_escalation_monitoring()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_count integer;
begin
  update public.escalations e
     set status = 'under_review',
         status_note = 'Monitoring period ended '
           || to_char(e.monitor_until at time zone 'Africa/Lagos', 'DD Mon YYYY HH24:MI')
           || '. Back for review.'
   where e.status = 'monitoring' and e.monitor_until <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function private.return_due_escalation_monitoring() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'escalation-monitoring-return') then
    perform cron.unschedule('escalation-monitoring-return');
  end if;
  perform cron.schedule('escalation-monitoring-return', '*/15 * * * *', 'select private.return_due_escalation_monitoring()');
end;
$$;

-- 4. Contact attempts (DW-13) ----------------------------------------------------------------------------------------------------
create table public.escalation_contact_attempts (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  escalation_id uuid not null references public.escalations(id) on delete restrict,
  patient_id uuid not null references public.profiles(id) on delete restrict,
  attempted_by uuid not null references public.profiles(id) on delete restrict,
  outcome text not null check (outcome in ('reached', 'no_answer', 'left_message', 'wrong_number', 'declined')),
  note text check (note is null or length(note) <= 1000),
  attempted_at timestamptz not null default now()
);

create index escalation_contact_attempts_escalation_idx on public.escalation_contact_attempts (escalation_id, attempted_at desc);

comment on table public.escalation_contact_attempts is
  'DW-13: each attempt to reach the patient on an escalation. Written and read only through log_escalation_contact_attempt and escalation_contact_attempts_for; no direct table access.';

alter table public.escalation_contact_attempts enable row level security;
revoke all on table public.escalation_contact_attempts from public, anon, authenticated;

-- Who may log or read attempts on a case: its assigned doctor, an active CMO, or an active care coordinator of the same organisation.
create or replace function private.may_work_escalation_contact(p_escalation public.escalations)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select (select auth.uid()) is not null
    and (select auth.uid()) <> p_escalation.patient_id
    and (
      p_escalation.assigned_doctor_id = (select auth.uid())
      or exists (
        select 1 from public.clinical_staff cs
         where cs.profile_id = (select auth.uid()) and cs.organisation_id = p_escalation.organisation_id and cs.active
           and cs.doctor_tier in ('chief_medical_officer', 'care_coordinator')
      )
    );
$function$;

revoke all on function private.may_work_escalation_contact(public.escalations) from public, anon, authenticated;

create or replace function public.log_escalation_contact_attempt(p_escalation_id uuid, p_outcome text, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_esc public.escalations;
  v_id uuid;
begin
  select * into v_esc from public.escalations where id = p_escalation_id;
  if not found or not private.may_work_escalation_contact(v_esc) then
    raise exception 'You cannot log a contact attempt on this case.' using errcode = '42501';
  end if;
  if v_esc.status in ('resolved', 'referred') then
    raise exception 'This case is closed; contact attempts can no longer be added.' using errcode = '23514';
  end if;

  insert into public.escalation_contact_attempts (organisation_id, escalation_id, patient_id, attempted_by, outcome, note)
  values (v_esc.organisation_id, v_esc.id, v_esc.patient_id, (select auth.uid()), p_outcome, nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.escalation_contact_attempts_for(p_escalation_id uuid)
returns table (id uuid, outcome text, note text, attempted_at timestamptz, attempted_by uuid, attempted_by_name text)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_esc public.escalations;
begin
  select * into v_esc from public.escalations where escalations.id = p_escalation_id;
  if not found
     or not (private.may_work_escalation_contact(v_esc) or private.clinician_has_patient_access(v_esc.patient_id)) then
    raise exception 'You cannot see the contact attempts on this case.' using errcode = '42501';
  end if;
  return query
    select a.id, a.outcome, a.note, a.attempted_at, a.attempted_by, p.full_name
      from public.escalation_contact_attempts a
      left join public.profiles p on p.id = a.attempted_by
     where a.escalation_id = p_escalation_id
     order by a.attempted_at desc;
end;
$function$;

revoke all on function public.log_escalation_contact_attempt(uuid, text, text) from public, anon;
revoke all on function public.escalation_contact_attempts_for(uuid) from public, anon;
grant execute on function public.log_escalation_contact_attempt(uuid, text, text) to authenticated;
grant execute on function public.escalation_contact_attempts_for(uuid) to authenticated;

-- 4b. Registries every patient table and column must be in (CI's s39d and OQ-39 proofs) ---------------------------------------
-- No staff_read_scope row: the table has no read policy at all; reads go only through escalation_contact_attempts_for.
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, reviewed, notes)
values ('escalation_contact_attempts', 'patient_id', 'clinical_record', 'review', true, false,
        'DW-13: each attempt to reach the patient on an escalation (outcome, optional note, who and when). Same class as escalations. Class assigned by the migration author, not yet reviewed by the CMO and DPO.')
on conflict (table_name) do nothing;

-- The four new escalations columns must appear in analytics_clean.escalations (test-account-free reporting view).
select private.rebuild_analytics_clean_views();

-- 5. Open work means not resolved and not referred --------------------------------------------------------------------------
-- private.auto_assign_escalation: only change is `e.status in ('open', 'under_review')` -> `e.status not in ('resolved', 'referred')`
create or replace function private.auto_assign_escalation()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_alert_owner_profile uuid;
  v_alert_owner_tier public.doctor_tier;
  v_needs_emergency_authority boolean;
  v_candidate_profile uuid;
begin
  -- An explicit assignment (e.g. a future admin/API path) is never overridden.
  if new.assigned_doctor_id is not null then
    return new;
  end if;

  -- A test account's escalation is the Chief Medical Officer's oversight, never a working doctor's case (2026-11-03).
  -- Checked before continuity on purpose: the linked alert of a test patient is already the cover's, and if it was
  -- raised before this rule it belongs to a working doctor who must not inherit the escalation either.
  if coalesce((select pr.is_test from public.profiles pr where pr.id = new.patient_id), false) then
    select cs.profile_id into v_candidate_profile
    from public.clinical_staff cs
    where cs.id = private.test_patient_cover(new.organisation_id)
      and cs.profile_id is not null;
    if v_candidate_profile is not null then
      new.assigned_doctor_id := v_candidate_profile;
      return new;
    end if;
  end if;

  -- Continuity first: if this escalation was raised from a clinician_alert
  -- that already has an auto-assigned owner (private.classify_and_assign_
  -- clinician_alert), keep the same doctor on it rather than re-routing --
  -- unless that owner has since gone on leave, or their tier can't clear
  -- this case's emergency bar, in which case fall through to picking a
  -- fresh doctor instead. Dropping continuity for a now-on-leave owner (not
  -- just re-checking tier) is the whole point of this migration: an
  -- already-owned alert must not keep silently routing new escalations to a
  -- doctor who is out.
  if new.clinician_alert_id is not null then
    select (ca.level = 'emergency') or (ca.override_level = 'emergency'),
           cs.profile_id, cs.doctor_tier
      into v_needs_emergency_authority, v_alert_owner_profile, v_alert_owner_tier
    from public.clinician_alerts ca
    left join public.clinical_staff cs
      on cs.id = ca.responsible_clinician_id and cs.active
    where ca.id = new.clinician_alert_id;
  end if;

  if v_alert_owner_profile is not null
     and not private.clinician_on_leave(v_alert_owner_profile)
     and (
       not coalesce(v_needs_emergency_authority, false)
       or v_alert_owner_tier in ('senior_medical_officer', 'chief_medical_officer')
     )
  then
    new.assigned_doctor_id := v_alert_owner_profile;
    return new;
  end if;

  -- Otherwise: the least-loaded active doctor at a tier that can handle
  -- this case (Senior Medical Officer+ if it needs emergency authority, any
  -- clinical tier otherwise) -- excluding anyone on leave outright, and now
  -- ranking anyone currently blocked or outside their declared hours behind
  -- anyone clearly free. Load = currently open/under_review escalations
  -- already assigned to them -- same shape of measure as
  -- lib/staffing/caseload.ts, just scoped to this one signal since that's
  -- all a placement decision needs.
  select cs.profile_id into v_candidate_profile
  from public.clinical_staff cs
  where cs.organisation_id = new.organisation_id
    and cs.active
    and cs.profile_id is not null
    and not private.clinician_on_leave(cs.profile_id)
    and (
      (coalesce(v_needs_emergency_authority, false)
        and cs.doctor_tier in ('senior_medical_officer', 'chief_medical_officer'))
      or
      (not coalesce(v_needs_emergency_authority, false)
        and cs.doctor_tier in ('senior_medical_officer', 'chief_medical_officer'))
    )
  order by
    private.clinician_deprioritised_now(cs.profile_id)::int asc,
    (
      select count(*) from public.escalations e
      where e.assigned_doctor_id = cs.profile_id and e.status not in ('resolved', 'referred')
    ) asc,
    cs.created_at asc
  limit 1;

  -- Stays null if nobody currently qualifies (e.g. a brand-new org with no
  -- staff yet, everyone inactive, or everyone qualifying is on leave) --
  -- fails open to the CMO's manual assignment, or any qualifying doctor's
  -- self-claim once someone qualifies, rather than raising.
  new.assigned_doctor_id := v_candidate_profile;
  return new;
end;
$function$;

-- public.ops_today_summary: only change is `escalations where status in ('open', 'under_review')` -> `escalations where status not in ('resolved', 'referred')`
create or replace function public.ops_today_summary()
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_today_start timestamptz := date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos';
  v_today_end   timestamptz := v_today_start + interval '1 day';
begin
  if not private.can_view_ops_console() then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'generated_at', now(),

    -- Scale (real people only: analytics_clean excludes test accounts, and the canary organisation's people are all test accounts)
    'patients', (select count(*) from analytics_clean.profiles where role = 'patient' and is_active),
    'active_care_programmes', (
      select count(*) from public.chronic_programme_enrolments e
       where e.status = 'enrolled' and e.patient_id in (select patient_id from analytics_clean.real_patient_ids)
    ) + (
      select count(*) from analytics_clean.preventive_programme_enrolments where status = 'enrolled'
    ),
    'active_paid_services', (
      select count(*) from analytics_clean.service_purchases
      where status = 'active' and (expires_at is null or expires_at > now())
    ) + (
      select count(*) from analytics_clean.programme_purchases
      where status = 'active' and ends_at >= current_date
    ),

    -- Today
    'appointments_today', (
      select count(*) from analytics_clean.appointments
      where scheduled_for >= v_today_start and scheduled_for < v_today_end
        and status = 'scheduled'
    ),
    'consults_today', (
      select count(*) from public.video_consultations vc
      where vc.scheduled_at >= v_today_start and vc.scheduled_at < v_today_end
        and vc.status = 'scheduled'
        and vc.patient_id in (select patient_id from analytics_clean.real_patient_ids)
    ),

    -- Clinical work in hand
    'pending_clinical_reviews', (
      select count(*) from analytics_clean.clinician_alerts where status = 'open'
    ),
    'critical_alerts', (
      select count(*) from analytics_clean.clinician_alerts
      where status = 'open' and level = 'emergency'
    ),
    'alerts_past_sla', (
      select count(*) from analytics_clean.clinician_alerts
      where status = 'open' and sla_due_at is not null and sla_due_at < now()
    ),
    'open_escalations', (
      select count(*) from analytics_clean.escalations where status not in ('resolved', 'referred')
    ),

    -- Coordination
    'unresolved_referrals', (
      select count(*) from analytics_clean.specialist_referrals
      where status in ('pending', 'waitlisted', 'booked')
    ),
    -- A self-arranged order is in the patient's hands (they take the request to any laboratory); only a partner-fulfilled
    -- order can be late on Tarragon's side.
    'laboratory_delays', (
      select count(*) from analytics_clean.lab_orders
      where status in ('ordered', 'sample_collected', 'processing')
        and fulfilment is distinct from 'self_arranged'
        and ordered_at < now() - interval '3 days'
    ),
    'pharmacy_issues', (
      select count(*) from analytics_clean.pharmacy_orders
      where status in ('requested', 'confirmed', 'dispensed')
        and requested_at < now() - interval '2 days'
    ),
    'pending_bookings', (
      select count(*) from analytics_clean.booking_requests where status = 'requested'
    ),

    -- Money
    'failed_payments', (
      select count(*) from analytics_clean.payment_transactions
      where error is not null and created_at > now() - interval '30 days'
    ),
    'reconciliation_exceptions', (
      select count(*) from public.payment_reconciliation_flags where status = 'open'
    ),

    -- Governance: an incident is open while someone still has to act on it
    'open_incidents', (
      select count(*) from public.ops_incidents where status in ('open', 'investigating')
    ),
    'incidents_past_sla', (
      select count(*) from public.ops_incidents
      where status in ('open', 'investigating')
        and (
          (acknowledged_at is null and ack_due_at < now())
          or (resolved_at is null and resolve_due_at < now())
        )
    ),
    'clinician_verifications_pending', (
      select count(*) from analytics_clean.clinical_staff where license_verified_at is null
    )
  );
end;
$function$;

-- private.clinician_has_patient_access: only change is `           and e.status in ('open', 'under_review')` -> `           and e.status not in ('resolved', 'referred')`
create or replace function private.clinician_has_patient_access(p_patient uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select
    (select auth.uid()) is not null
    and p_patient is not null
    and private.is_org_staff((select pr.organisation_id from public.profiles pr where pr.id = p_patient))
    and (
      -- today's care-team assignment (clinician, clinical director, care coordinator)
      exists (
        select 1 from public.care_team_assignment cta
         where cta.patient_id = p_patient
           and (select auth.uid()) in (cta.clinician_id, cta.clinical_director_id, cta.care_coordinator_id)
      )
      -- an open escalation routed to me
      or exists (
        select 1 from public.escalations e
         where e.patient_id = p_patient
           and e.assigned_doctor_id = (select auth.uid())
           and e.status not in ('resolved', 'referred')
      )
      -- an unresolved alert I am responsible for (or the backup)
      or exists (
        select 1 from public.clinician_alerts a
          join public.clinical_staff cs on cs.id in (a.responsible_clinician_id, a.backup_clinician_id)
         where a.patient_id = p_patient
           and cs.profile_id = (select auth.uid())
           and a.status in ('open', 'acknowledged', 'snoozed')
      )
      -- a consultation in progress, or an upcoming one that has not ended (a stale booked row never ties a clinician)
      or exists (
        select 1 from public.appointments ap
         where ap.patient_id = p_patient
           and ap.clinician_id = (select auth.uid())
           and (
                ap.status = 'in_progress'
             or (ap.status in ('scheduled', 'booked', 'confirmed', 'checked_in') and ap.ends_at >= now())
           )
      )
      -- S21 (OQ-159, INV-12): a consultation I finished with this patient, until a signed note exists for it, for at most the policy cap
      or exists (
        select 1 from public.encounters en
         where en.patient_id = p_patient
           and en.clinician_id = (select auth.uid())
           and en.status = 'completed'
           and en.ended_at >= now() - make_interval(hours => coalesce((private.consult_policy() ->> 'chartAccessAfterFinishMaxHours')::integer, 0))
           -- an encounter with no link to a note (neither a video consultation nor an async consult) gets no access here: nothing could end it
           and (en.video_consultation_id is not null or en.async_consult_id is not null)
           and not exists (
                 select 1 from public.clinical_encounter_notes n
                  where n.patient_id = en.patient_id
                    and n.status = 'finalized'
                    and ((n.video_consultation_id is not null and n.video_consultation_id = en.video_consultation_id)
                      or (n.async_consult_id is not null and n.async_consult_id = en.async_consult_id))
               )
      )
      -- a video consultation I started or am due to host that has not ended
      or exists (
        select 1 from public.video_consultations vc
         where vc.patient_id = p_patient
           and vc.initiated_by = (select auth.uid())
           and vc.status in ('scheduled', 'started')
           and vc.ended_at is null
      )
      -- an active clinical task pushed to me, claimed by me, or offered to me as the named clinician (S16, INV-12)
      or exists (
        select 1 from public.clinical_tasks ct
         where ct.patient_id = p_patient
           and (
                (ct.state = 'offered_to_lead' and (select auth.uid()) in (ct.pushed_to, ct.lead_clinician_id))
             or (ct.state in ('claimed', 'escalated') and ct.claimed_by = (select auth.uid()))
           )
      )
      -- an open red event page I have ACKNOWLEDGED (S19, INV-12): being paged is not enough, taking responsibility is; closed
      -- pages and pages past the access window do not count. S19c (P4, P7): never for a conflicted clinician, never for the patient, and not for a
      -- clinician who is no longer eligible (suspended, licence or indemnity lapsed) even if they acknowledged earlier.
      or (
        exists (
          select 1 from public.pages pg
           where pg.patient_id = p_patient and pg.closed_at is null
             and pg.acknowledged_by = (select auth.uid())
        )
        and (select auth.uid()) <> p_patient
        and not private.has_conflict((select auth.uid()), p_patient)
        and private.clinician_is_eligible((select auth.uid()))
      )
      -- S27h (INV-12): an open critical lab value call I have ACKNOWLEDGED; it closes with the result
      or (
        exists (
          select 1 from public.lab_critical_calls lc
           where lc.patient_id = p_patient and lc.closed_at is null and lc.acknowledged_by = (select auth.uid())
             -- bounded like an acknowledged page: the S19 access window (paging_rule page_access_hours); a missing rule means no access
             and lc.acknowledged_at > now() - make_interval(hours => (private.paging_rule('page_access_hours') #>> '{}')::integer)
        )
        and (select auth.uid()) <> p_patient
        and not private.has_conflict((select auth.uid()), p_patient)
        and private.clinician_is_eligible((select auth.uid()))
      )
      -- an open specialist referral assigned to me
      or exists (
        select 1 from public.specialist_referrals sr
          join public.clinical_staff cs on cs.id = sr.assigned_specialist_id
         where sr.patient_id = p_patient
           and cs.profile_id = (select auth.uid())
           and sr.status not in ('closed', 'declined', 'completed', 'draft')
      )
    );
$function$;

-- private.allergy_request_recipients: only change is `e.status in ('open', 'under_review')` -> `e.status not in ('resolved', 'referred')`
create or replace function private.allergy_request_recipients(p_patient uuid)
 returns table(profile_id uuid)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select distinct cs.profile_id
    from public.clinical_staff cs
   where cs.active and cs.doctor_tier is not null and cs.doctor_tier <> 'care_coordinator'
     and (
       exists (select 1 from public.care_team_assignment cta
                where cta.patient_id = p_patient and cs.profile_id in (cta.clinician_id, cta.clinical_director_id))
       or exists (select 1 from public.escalations e
                   where e.patient_id = p_patient and e.assigned_doctor_id = cs.profile_id and e.status not in ('resolved', 'referred'))
       or exists (select 1 from public.clinician_alerts a
                   where a.patient_id = p_patient and cs.id in (a.responsible_clinician_id, a.backup_clinician_id)
                     and a.status in ('open', 'acknowledged', 'snoozed'))
     )
$function$;

-- 5b. A refused working-state move is audited like a refused claim (useMoveEscalationState logs 'escalations.state_move_denied').
-- public.log_denied_action redefined from its live body (md5 942260bd1675618e4ad415ce7f9b2b70); only the allowlist gains one entry.
create or replace function public.log_denied_action(p_action text, p_entity_type text, p_entity_id uuid, p_organisation_id uuid, p_reason text default null::text)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_reason text;
begin
  if p_organisation_id is null or not private.is_org_staff(p_organisation_id) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  -- Deliberately not open-ended -- see this migration's header, finding 3.
  -- Extend this list explicitly (with a matching app-layer call site) rather
  -- than inferring one from a new action string.
  if p_action not in (
    'escalations.reassignment_denied',
    'escalations.claim_denied',
    'escalations.state_move_denied',
    'medications.amendment_denied'
  ) then
    raise exception 'log_denied_action: unrecognised action %', p_action using errcode = '22023';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is not null and length(v_reason) > 300 then
    raise exception 'Reason must be 300 characters or fewer' using errcode = '22001';
  end if;

  return private.audit_log_denied_action(
    p_action, p_entity_type, p_entity_id, p_organisation_id, v_reason, 'denied'
  );
end;
$function$;

-- 6. Self-check ------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'private.clinician_has_patient_access(uuid)', 'private.allergy_request_recipients(uuid)',
    'private.auto_assign_escalation()', 'public.ops_today_summary()'
  ] loop
    if pg_get_functiondef(v_fn::regprocedure) ~ 'status in \(''open'', ''under_review''\)' then
      raise exception 'DW-03 self-check: % still treats only open/under_review as open work', v_fn;
    end if;
  end loop;

  if has_function_privilege('anon', 'public.log_escalation_contact_attempt(uuid, text, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.escalation_contact_attempts_for(uuid)', 'EXECUTE') then
    raise exception 'DW-03 self-check: anon can execute a contact-attempt RPC';
  end if;
  if has_function_privilege('authenticated', 'private.return_due_escalation_monitoring()', 'EXECUTE') then
    raise exception 'DW-03 self-check: authenticated can force the monitoring return';
  end if;
  if has_table_privilege('authenticated', 'public.escalation_contact_attempts', 'SELECT')
     or has_table_privilege('authenticated', 'public.escalation_contact_attempts', 'INSERT')
     or has_table_privilege('anon', 'public.escalation_contact_attempts', 'SELECT') then
    raise exception 'DW-03 self-check: escalation_contact_attempts is directly reachable';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'escalations_enforce_state_rules' and tgrelid = 'public.escalations'::regclass) then
    raise exception 'DW-03 self-check: state-rules trigger missing';
  end if;
  if not exists (select 1 from cron.job where jobname = 'escalation-monitoring-return') then
    raise exception 'DW-03 self-check: monitoring return job not scheduled';
  end if;
end;
$$;
