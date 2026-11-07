-- HR and Workforce dashboard, Phase C: leave requests with approval (docs/design/HR-WORKFORCE.md; decisions HR-03, HR-04).
--
-- HR-03: a staff member's current line manager approves their leave; when none is set, an admin does. An admin may also
-- decide any request (HR-02: admins run HR). Nobody ever decides their own request.
-- HR-04: the reason for sick leave is stored, in its own table, readable only by admins and the person (never the manager).
--
-- ONE SYSTEM FOR ROUTING: approving a clinician's leave writes the existing public.provider_time_off row (kind 'leave') in the
-- same transaction, so case routing (private.clinician_on_leave), the rota checks and appointment booking all see it exactly
-- as before. That insert fires private.cascade_provider_time_off, which CANCELS the clinician's booked appointments in the
-- period (refunds, patient notices, waiting list). So:
--   * the approver is shown the number of appointments that will be cancelled (leave_request_impact) and must confirm that
--     same number when approving; if bookings changed in between, approval is refused and they look again;
--   * the time-off row's reason is left NULL, so a patient's cancellation notice reads the platform's neutral default ("Your
--     provider is on leave for this time") and never the leave type or anything the clinician wrote.
-- Cancelling approved leave before it starts removes that time-off row (appointments already cancelled stay cancelled).
-- The existing direct "time off" entry for clinicians (availability manager) is untouched in this phase.
--
-- Days are counted Monday to Friday; there is no public-holiday calendar yet. No balances or entitlements (no data exists
-- to base them on). Notifications are in-app and additive: a request is visible on the pages whether or not one is read.

-- ---------------------------------------------------------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------------------------------------------------------
-- Is the caller the person's current line manager (an active, internal staff record that has not left)?
create function private.is_current_line_manager_of(p_profile uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select e.line_manager_id = auth.uid() and e.employment_status <> 'left'
                     from private.staff_current_employment_of(p_profile) e), false)
$$;

-- Working days (Monday to Friday) from p_from to p_to inclusive.
create function private.leave_working_days(p_from date, p_to date) returns integer
language sql immutable set search_path = ''
as $$
  select count(*)::integer from generate_series(p_from, p_to, interval '1 day') d where extract(isodow from d) < 6
$$;

-- The time-off window for whole days in Lagos: from the start of the first day to the start of the day after the last.
create function private.leave_window(p_from date, p_to date, out starts_at timestamptz, out ends_at timestamptz)
language sql stable set search_path = ''
as $$
  select (p_from::timestamp at time zone 'Africa/Lagos'), ((p_to + 1)::timestamp at time zone 'Africa/Lagos')
$$;

-- The part of the leave that is still to come: from now (or the first day, if later) to the end. Back-dated sick leave never
-- reaches past appointments: a past booking that was never closed out must not be retro-cancelled, refunded and re-noticed.
-- Returns no row when the whole leave is already over.
create function private.leave_future_window(p_from date, p_to date, out starts_at timestamptz, out ends_at timestamptz)
returns setof record
language sql stable set search_path = ''
as $$
  select greatest(w.starts_at, now()), w.ends_at from private.leave_window(p_from, p_to) w where w.ends_at > now()
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------------------------------------------------------
create table public.staff_leave_requests (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  profile_id           uuid not null references public.profiles (id) on delete restrict,
  leave_type           text not null check (leave_type in ('annual', 'sick', 'study', 'maternity', 'paternity', 'compassionate', 'unpaid', 'other')),
  starts_on            date not null,
  ends_on              date not null,
  working_days         integer not null check (working_days >= 0),
  note                 text check (note is null or length(note) <= 500),
  status               text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_at         timestamptz not null default now(),
  decided_by           uuid references public.profiles (id) on delete restrict,
  decided_at           timestamptz,
  decision_note        text check (decision_note is null or length(decision_note) <= 500),
  cancelled_by         uuid references public.profiles (id) on delete restrict,
  cancelled_at         timestamptz,
  provider_time_off_id uuid,
  constraint staff_leave_requests_dates check (ends_on >= starts_on and ends_on - starts_on <= 366),
  constraint staff_leave_requests_decided check ((status in ('approved', 'rejected')) = (decided_at is not null) or status = 'cancelled'),
  constraint staff_leave_requests_not_self_decided check (decided_by is distinct from profile_id),
  constraint staff_leave_requests_reject_note check (status <> 'rejected' or length(trim(coalesce(decision_note, ''))) >= 5)
);
create index staff_leave_requests_person on public.staff_leave_requests (profile_id, starts_on desc);
create index staff_leave_requests_pending on public.staff_leave_requests (organisation_id, status) where status = 'pending';

create table public.staff_leave_sickness_reasons (
  request_id uuid primary key references public.staff_leave_requests (id) on delete restrict,
  reason     text not null check (length(trim(reason)) between 2 and 500),
  created_at timestamptz not null default now()
);

-- Only the decision functions change a request; nothing is ever deleted.
create function private.staff_leave_requests_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'Leave requests are never deleted; cancel instead.' using errcode = '42501'; end if;
  if coalesce(current_setting('tarragon.leave_write', true), '') <> 'on' then
    raise exception 'Leave requests change only through the leave functions.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger staff_leave_requests_guard before update or delete on public.staff_leave_requests
  for each row execute function private.staff_leave_requests_guard();

-- ---------------------------------------------------------------------------------------------------------------------------
-- 3. Row-level security: the person, their current line manager, and admins read requests. Sickness reasons: no table access.
-- ---------------------------------------------------------------------------------------------------------------------------
alter table public.staff_leave_requests enable row level security;
alter table public.staff_leave_sickness_reasons enable row level security;
create policy staff_leave_requests_read on public.staff_leave_requests for select to authenticated
  using (organisation_id = (select private.current_org_id())
         and ((select private.is_admin()) or profile_id = (select auth.uid()) or private.is_current_line_manager_of(profile_id)));
revoke all on public.staff_leave_requests, public.staff_leave_sickness_reasons from anon, authenticated;
grant select on public.staff_leave_requests to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 4. Who decides, and telling them
-- ---------------------------------------------------------------------------------------------------------------------------
-- The people who may decide a request: the current line manager if there is an active one, else every active admin. (An admin
-- may always decide; this list is who is TOLD.) Never the requester.
create function private.leave_approvers(p_profile uuid) returns setof uuid
language sql stable security definer set search_path = ''
as $$
  with mgr as (
    select e.line_manager_id as id from private.staff_current_employment_of(p_profile) e
      join public.profiles m on m.id = e.line_manager_id and m.is_active
     where e.employment_status <> 'left' and e.line_manager_id is distinct from p_profile
       and coalesce((private.staff_current_employment_of(e.line_manager_id)).employment_status, 'active') <> 'left'
  )
  select id from mgr
  union all
  select a.id from public.profiles a
   where not exists (select 1 from mgr) and a.role = 'admin' and a.is_active and a.id <> p_profile
     and a.organisation_id = (select organisation_id from public.profiles where id = p_profile)
$$;

create function private.may_decide_leave(p_request public.staff_leave_requests) returns boolean
language sql stable security definer set search_path = ''
as $$
  select auth.uid() <> p_request.profile_id
     and p_request.organisation_id = (select organisation_id from public.profiles where id = auth.uid())
     and (private.is_admin() or auth.uid() in (select private.leave_approvers(p_request.profile_id)))
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 5. Requesting and cancelling (the person)
-- ---------------------------------------------------------------------------------------------------------------------------
create function public.request_leave(
  p_leave_type text, p_starts_on date, p_ends_on date, p_note text default null, p_sickness_reason text default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_me public.profiles; v_id uuid; v_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if not found or not private.is_internal_staff_role(v_me.role) or not v_me.is_active then
    raise exception 'Leave requests are for Tarragon staff.' using errcode = '42501';
  end if;
  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on then raise exception 'The last day cannot be before the first.'; end if;
  if p_ends_on - p_starts_on > 366 then raise exception 'A single request can cover at most a year.'; end if;
  -- Sick leave may be recorded after the event (up to 30 days back); anything else is asked for in advance.
  if p_leave_type = 'sick' and p_starts_on < v_today - 30 then raise exception 'Sick leave can be recorded up to 30 days afterwards.'; end if;
  if p_leave_type <> 'sick' and p_starts_on < v_today then raise exception 'Ask for this leave before it starts.'; end if;
  if p_sickness_reason is not null and p_leave_type <> 'sick' then raise exception 'A sickness reason belongs only on sick leave.'; end if;
  if not exists (select 1 from private.leave_approvers(v_me.id)) then
    raise exception 'Nobody can approve your leave yet: you have no line manager and there is no other active admin. Ask for a line manager to be recorded.';
  end if;
  -- one request at a time per person, so two submissions at once cannot both pass the overlap check
  perform pg_advisory_xact_lock(hashtextextended('staff_leave:' || v_me.id::text, 0));
  if exists (select 1 from public.staff_leave_requests r
              where r.profile_id = v_me.id and r.status in ('pending', 'approved')
                and daterange(r.starts_on, r.ends_on, '[]') && daterange(p_starts_on, p_ends_on, '[]')) then
    raise exception 'You already have leave asked for or approved on some of these days.';
  end if;
  insert into public.staff_leave_requests (organisation_id, profile_id, leave_type, starts_on, ends_on, working_days, note)
  values (v_me.organisation_id, v_me.id, p_leave_type, p_starts_on, p_ends_on, private.leave_working_days(p_starts_on, p_ends_on),
          nullif(trim(coalesce(p_note, '')), ''))
  returning id into v_id;
  if nullif(trim(coalesce(p_sickness_reason, '')), '') is not null then
    insert into public.staff_leave_sickness_reasons (request_id, reason) values (v_id, trim(p_sickness_reason));
  end if;
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
  select v_me.organisation_id, a, 'in_app', 'pending', 'staff_leave_requested', jsonb_build_object('request_id', v_id), 'non_clinical'
    from private.leave_approvers(v_me.id) a;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result)
  values (v_me.organisation_id, v_me.id, 'staff_leave.requested', 'staff_leave_request', v_id,
          jsonb_build_object('profile_id', v_me.id, 'starts_on', p_starts_on, 'ends_on', p_ends_on), 'success');
  return v_id;
end;
$$;

-- The person cancels their own pending request, or approved leave that has not started. An admin may cancel any request.
create function public.cancel_leave(p_request uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_r public.staff_leave_requests; v_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  select * into v_r from public.staff_leave_requests where id = p_request for update;
  if not found or v_r.organisation_id is distinct from (select organisation_id from public.profiles where id = auth.uid()) then
    raise exception 'That request is not one you can see.';
  end if;
  if not (v_r.profile_id = auth.uid() or private.is_admin()) then raise exception 'Only the person or an admin can cancel leave.' using errcode = '42501'; end if;
  if v_r.status not in ('pending', 'approved') then raise exception 'This request is already closed.'; end if;
  if v_r.status = 'approved' and v_r.starts_on <= v_today and not private.is_admin() then
    raise exception 'This leave has already started; ask an admin to change it.';
  end if;
  perform set_config('tarragon.leave_write', 'on', true);
  update public.staff_leave_requests set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now() where id = p_request;
  perform set_config('tarragon.leave_write', '', true);
  if v_r.provider_time_off_id is not null then
    delete from public.provider_time_off where id = v_r.provider_time_off_id;
  end if;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result)
  values (v_r.organisation_id, auth.uid(), 'staff_leave.cancelled', 'staff_leave_request', p_request,
          jsonb_build_object('profile_id', v_r.profile_id, 'was', v_r.status), 'success');
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 6. Deciding (the line manager, or an admin)
-- ---------------------------------------------------------------------------------------------------------------------------
-- How many of the person's booked appointments approving this leave would cancel (0 for anyone who is not a clinician).
create function public.leave_request_impact(p_request uuid) returns integer
language plpgsql stable security definer set search_path = ''
as $$
declare v_r public.staff_leave_requests; w record;
begin
  select * into v_r from public.staff_leave_requests where id = p_request;
  if not found or not private.may_decide_leave(v_r) then raise exception 'That request is not one you can decide.' using errcode = '42501'; end if;
  select * into w from private.leave_future_window(v_r.starts_on, v_r.ends_on);
  if not found then return 0; end if;
  return (select count(*) from public.appointments a
           where a.clinician_id = v_r.profile_id and a.status in ('held', 'booked', 'confirmed')
             and tstzrange(a.scheduled_for, a.ends_at, '[)') && tstzrange(w.starts_at, w.ends_at, '[)'));
end;
$$;

-- On-call shifts the person is rostered for during the leave (primary or backup). Approval does not change the rota; the
-- approver is told so they can rearrange cover on the rota page before or after approving.
create function public.leave_request_rota_shifts(p_request uuid) returns integer
language plpgsql stable security definer set search_path = ''
as $$
declare v_r public.staff_leave_requests; w record;
begin
  select * into v_r from public.staff_leave_requests where id = p_request;
  if not found or not private.may_decide_leave(v_r) then raise exception 'That request is not one you can decide.' using errcode = '42501'; end if;
  select * into w from private.leave_future_window(v_r.starts_on, v_r.ends_on);
  if not found then return 0; end if;
  return (select count(*) from public.on_call_rota o
           where o.cancelled_at is null and v_r.profile_id in (o.primary_clinician_id, o.backup_clinician_id)
             and tstzrange(o.starts_at, o.ends_at, '[)') && tstzrange(w.starts_at, w.ends_at, '[)'));
end;
$$;

create function public.decide_leave(
  p_request uuid, p_decision text, p_note text default null, p_expected_cancellations integer default 0
) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_r public.staff_leave_requests; v_impact integer; v_cancelled integer; v_toff uuid; w record; v_is_clinician boolean;
begin
  if p_decision not in ('approved', 'rejected') then raise exception 'Choose approve or reject.'; end if;
  select * into v_r from public.staff_leave_requests where id = p_request for update;
  if not found or not private.may_decide_leave(v_r) then raise exception 'That request is not one you can decide.' using errcode = '42501'; end if;
  if v_r.status <> 'pending' then raise exception 'This request has already been decided or cancelled.'; end if;
  if p_decision = 'rejected' and length(trim(coalesce(p_note, ''))) < 5 then raise exception 'Say briefly why the leave cannot be approved.'; end if;

  if p_decision = 'approved' then
    select exists (select 1 from public.clinical_staff c where c.profile_id = v_r.profile_id) into v_is_clinician;
    if v_is_clinician then
      v_impact := public.leave_request_impact(p_request);
      if v_impact is distinct from coalesce(p_expected_cancellations, 0) then
        raise exception 'Bookings have changed: % appointment(s) now fall in this leave. Look again before approving.', v_impact;
      end if;
      select * into w from private.leave_future_window(v_r.starts_on, v_r.ends_on);
      if found then
        -- reason NULL on purpose: the patient notice must not carry the leave type or anything personal
        insert into public.provider_time_off (organisation_id, clinician_id, kind, starts_at, ends_at, reason, created_by)
        values (v_r.organisation_id, v_r.profile_id, 'leave', w.starts_at, w.ends_at, null, auth.uid())
        returning id into v_toff;
        -- What the cascade actually cancelled must be what the approver confirmed; a booking made in the meantime makes it
        -- differ, and raising here rolls back the whole approval, cascade included.
        select count(*) into v_cancelled from public.appointments a
         where a.clinician_id = v_r.profile_id and a.status = 'provider_cancelled' and a.cancelled_at = now()
           and tstzrange(a.scheduled_for, a.ends_at, '[)') && tstzrange(w.starts_at, w.ends_at, '[)');
        if v_cancelled <> v_impact then
          raise exception 'Bookings have changed: % appointment(s) now fall in this leave. Look again before approving.', v_cancelled;
        end if;
      end if;
    end if;
  end if;

  perform set_config('tarragon.leave_write', 'on', true);
  update public.staff_leave_requests
     set status = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), ''),
         provider_time_off_id = v_toff
   where id = p_request;
  perform set_config('tarragon.leave_write', '', true);

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
  values (v_r.organisation_id, v_r.profile_id, 'in_app', 'pending', 'staff_leave_decided',
          jsonb_build_object('request_id', p_request, 'decision', p_decision), 'non_clinical');
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result)
  values (v_r.organisation_id, auth.uid(), 'staff_leave.' || p_decision, 'staff_leave_request', p_request,
          jsonb_build_object('profile_id', v_r.profile_id, 'appointments_cancelled', coalesce(v_impact, 0)), 'success');
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 7. Reads
-- ---------------------------------------------------------------------------------------------------------------------------
-- Requests the caller may decide now (their reports', or as admin anyone's), with names; never the sickness reason.
create function public.leave_requests_to_decide()
returns table (request_id uuid, profile_id uuid, full_name text, leave_type text, starts_on date, ends_on date, working_days integer,
               note text, requested_at timestamptz, is_clinician boolean)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.profile_id, p.full_name, r.leave_type, r.starts_on, r.ends_on, r.working_days, r.note, r.requested_at,
         exists (select 1 from public.clinical_staff c where c.profile_id = r.profile_id)
    from public.staff_leave_requests r
    join public.profiles p on p.id = r.profile_id
   where r.status = 'pending'
     and r.organisation_id = (select organisation_id from public.profiles where id = auth.uid())
     and private.may_decide_leave(r)
   order by r.starts_on
$$;

-- The sickness reason: the person or an admin; an admin's read of someone else's is audited.
create function public.leave_sickness_reason(p_request uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare v_r public.staff_leave_requests; v_reason text;
begin
  select * into v_r from public.staff_leave_requests where id = p_request;
  if not found or not (v_r.profile_id = auth.uid()
                       or (private.is_admin() and v_r.organisation_id = (select organisation_id from public.profiles where id = auth.uid()))) then
    raise exception 'Only the person or an admin can see this.' using errcode = '42501';
  end if;
  select reason into v_reason from public.staff_leave_sickness_reasons where request_id = p_request;
  if v_reason is not null and v_r.profile_id <> auth.uid() then
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result)
    values (v_r.organisation_id, auth.uid(), 'staff_leave.sickness_reason_viewed', 'staff_leave_request', p_request, '{}'::jsonb, 'success');
  end if;
  return v_reason;
end;
$$;

-- Admin overview: every request with names (no sickness reason).
create function public.people_leave_requests(p_from date default null)
returns table (request_id uuid, profile_id uuid, full_name text, leave_type text, starts_on date, ends_on date, working_days integer,
               status text, requested_at timestamptz, decided_by_name text, decided_at timestamptz, is_clinician boolean, has_sickness_reason boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid;
begin
  if not private.is_admin() then raise exception 'Only an admin can see all leave.' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = auth.uid();
  return query
  select r.id, r.profile_id, p.full_name, r.leave_type, r.starts_on, r.ends_on, r.working_days, r.status, r.requested_at,
         d.full_name, r.decided_at, exists (select 1 from public.clinical_staff c where c.profile_id = r.profile_id),
         exists (select 1 from public.staff_leave_sickness_reasons s where s.request_id = r.id)
    from public.staff_leave_requests r
    join public.profiles p on p.id = r.profile_id
    left join public.profiles d on d.id = r.decided_by
   where r.organisation_id = v_org and (p_from is null or r.ends_on >= p_from)
   order by r.starts_on desc;
end;
$$;

-- Recent HR activity includes leave (people_recent_activity, Phase B body plus staff_leave.*; the subject is profile_id).
create or replace function public.people_recent_activity(p_limit integer default 20)
returns table (at timestamptz, action text, actor_name text, subject_profile_id uuid, subject_name text)
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid;
begin
  if not private.is_admin() then raise exception 'Only an admin can see HR activity.' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = auth.uid();
  return query
  select a.created_at, a.action, coalesce(actor.full_name, 'System'), subj.id, subj.full_name
    from public.audit_log a
    left join public.profiles actor on actor.id = a.actor_id
    left join public.profiles subj on subj.id = case
      when a.entity_type in ('staff_employment_record', 'staff_training_completion', 'staff_leave_request') then (a.event ->> 'profile_id')::uuid
      when a.entity_type = 'staff_sensitive_details' then a.entity_id
      else null end
   where a.organisation_id = v_org
     and (a.action like 'staff_employment.%' or a.action like 'staff_department.%' or a.action = 'staff_personal_details.updated'
          or a.action like 'staff_training_%' or (a.action like 'staff_leave.%' and a.action <> 'staff_leave.sickness_reason_viewed'))
   order by a.created_at desc
   limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 8. Grants. The revoke is from PUBLIC (anon inherits through it).
-- ---------------------------------------------------------------------------------------------------------------------------
revoke all on function private.is_current_line_manager_of(uuid) from public, anon;
grant execute on function private.is_current_line_manager_of(uuid) to authenticated;
revoke all on function private.leave_working_days(date, date) from public, anon;
revoke all on function private.leave_window(date, date) from public, anon;
revoke all on function private.leave_future_window(date, date) from public, anon;
revoke all on function public.leave_request_rota_shifts(uuid) from public, anon;
grant execute on function public.leave_request_rota_shifts(uuid) to authenticated;
revoke all on function private.leave_approvers(uuid) from public, anon, authenticated;
revoke all on function private.may_decide_leave(public.staff_leave_requests) from public, anon, authenticated;
revoke all on function private.staff_leave_requests_guard() from public, anon, authenticated;
revoke all on function public.request_leave(text, date, date, text, text) from public, anon;
revoke all on function public.cancel_leave(uuid) from public, anon;
revoke all on function public.leave_request_impact(uuid) from public, anon;
revoke all on function public.decide_leave(uuid, text, text, integer) from public, anon;
revoke all on function public.leave_requests_to_decide() from public, anon;
revoke all on function public.leave_sickness_reason(uuid) from public, anon;
revoke all on function public.people_leave_requests(date) from public, anon;
grant execute on function public.request_leave(text, date, date, text, text) to authenticated;
grant execute on function public.cancel_leave(uuid) to authenticated;
grant execute on function public.leave_request_impact(uuid) to authenticated;
grant execute on function public.decide_leave(uuid, text, text, integer) to authenticated;
grant execute on function public.leave_requests_to_decide() to authenticated;
grant execute on function public.leave_sickness_reason(uuid) to authenticated;
grant execute on function public.people_leave_requests(date) to authenticated;

do $$
begin
  if has_table_privilege('authenticated', 'public.staff_leave_sickness_reasons', 'SELECT')
     or has_table_privilege('authenticated', 'public.staff_leave_requests', 'INSERT')
     or has_table_privilege('authenticated', 'public.staff_leave_requests', 'UPDATE')
     or has_function_privilege('anon', 'public.request_leave(text,date,date,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.people_leave_requests(date)', 'EXECUTE') then
    raise exception 'HR Phase C grants are wider than intended.';
  end if;
end $$;
