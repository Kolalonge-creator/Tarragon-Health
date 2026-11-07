-- HR and Workforce dashboard, Phase B: mandatory training (docs/design/HR-WORKFORCE.md section 5; decisions HR-01, HR-02).
--
-- 1. staff_training_courses: the catalogue (mandatory or professional development), with an optional renewal period.
-- 2. staff_training_requirements: who must do a course: everyone, an account role, or a department; due a set number of days
--    after the later of the person's start date and the day the rule was added. Removing a rule keeps its row (removed_at).
-- 3. staff_training_completions: one row per completion. Never deleted or edited; a mistake is VOIDED with a reason. A
--    completion counts only once it is verified by an admin who is not the person themself (opening a course or a staff
--    member's say-so is never "completed"). Its expiry is derived from the course's renewal period at the time it was recorded.
-- 4. people_training_records(): admin-only read of every current staff member's required courses with their latest
--    non-voided completion; the page derives Compliant / Due soon / Overdue / Pending verification from it (warning window in
--    the registry, hr.attention_windows). There is deliberately no blended compliance score.
--
-- Admin only for every write (HR-02); the person may read their own completions. Every write is audited in the same
-- transaction. No certificate upload yet: an admin verifies having seen the evidence and may note a reference (a file upload
-- would be a new storage path, which must go through the malware scan; it is a later step). No go-live guard: staff-only and
-- admin-gated (GATE-MODEL rule 1). Nothing is seeded: which courses are mandatory, and for whom, is entered on the page.

-- ---------------------------------------------------------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------------------------------------------------------
create table public.staff_training_courses (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  name            text not null check (length(trim(name)) between 2 and 120),
  category        text not null check (category in ('mandatory', 'professional')),
  provider        text check (provider is null or length(provider) <= 120),
  description     text check (description is null or length(description) <= 500),
  renewal_months  smallint check (renewal_months is null or renewal_months between 1 and 120),
  is_active       boolean not null default true,
  created_by      uuid not null references public.profiles (id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index staff_training_courses_name_per_org on public.staff_training_courses (organisation_id, lower(trim(name)));

create table public.staff_training_requirements (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  course_id       uuid not null references public.staff_training_courses (id) on delete restrict,
  applies_to      text not null check (applies_to in ('everyone', 'role', 'department')),
  role            public.user_role,
  department_id   uuid references public.staff_departments (id) on delete restrict,
  due_within_days smallint not null default 30 check (due_within_days between 0 and 365),
  created_by      uuid not null references public.profiles (id) on delete restrict,
  created_at      timestamptz not null default now(),
  removed_by      uuid references public.profiles (id) on delete restrict,
  removed_at      timestamptz,
  constraint staff_training_requirements_target check (
    (applies_to = 'role') = (role is not null) and (applies_to = 'department') = (department_id is not null)),
  constraint staff_training_requirements_removed_pair check ((removed_at is null) = (removed_by is null))
);
create unique index staff_training_requirements_one_active on public.staff_training_requirements
  (course_id, applies_to, role, department_id) nulls not distinct
  where removed_at is null;

create table public.staff_training_completions (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  profile_id         uuid not null references public.profiles (id) on delete restrict,
  course_id          uuid not null references public.staff_training_courses (id) on delete restrict,
  completed_on       date not null,
  expires_on         date,
  evidence_reference text check (evidence_reference is null or length(evidence_reference) <= 200),
  note               text check (note is null or length(note) <= 500),
  recorded_by        uuid not null references public.profiles (id) on delete restrict,
  recorded_at        timestamptz not null default now(),
  verified_by        uuid references public.profiles (id) on delete restrict,
  verified_at        timestamptz,
  voided_by          uuid references public.profiles (id) on delete restrict,
  voided_at          timestamptz,
  void_reason        text,
  constraint staff_training_completions_verified_pair check ((verified_at is null) = (verified_by is null)),
  constraint staff_training_completions_no_self_verification check (verified_by is distinct from profile_id),
  constraint staff_training_completions_voided check (
    (voided_at is null) = (voided_by is null) and (voided_at is null or length(trim(coalesce(void_reason, ''))) >= 10)),
  constraint staff_training_completions_expiry_after check (expires_on is null or expires_on > completed_on)
);
create index staff_training_completions_person on public.staff_training_completions (profile_id, course_id, completed_on desc);

-- Completions are history: only verification and voiding may change a row, once each, and nothing is deleted.
create function private.staff_training_completions_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Training records are never deleted; void the record instead.' using errcode = '42501';
  end if;
  if (new.organisation_id, new.profile_id, new.course_id, new.completed_on, new.expires_on, new.evidence_reference, new.note,
      new.recorded_by, new.recorded_at)
     is distinct from
     (old.organisation_id, old.profile_id, old.course_id, old.completed_on, old.expires_on, old.evidence_reference, old.note,
      old.recorded_by, old.recorded_at) then
    raise exception 'A training record cannot be edited; void it and record it again.' using errcode = '42501';
  end if;
  if old.verified_at is not null and (new.verified_at, new.verified_by) is distinct from (old.verified_at, old.verified_by) then
    raise exception 'This record is already verified.' using errcode = '42501';
  end if;
  if old.voided_at is not null then
    raise exception 'This record has been voided.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger staff_training_completions_guard before update or delete on public.staff_training_completions
  for each row execute function private.staff_training_completions_guard();

-- ---------------------------------------------------------------------------------------------------------------------------
-- 2. Row-level security and grants
-- ---------------------------------------------------------------------------------------------------------------------------
alter table public.staff_training_courses enable row level security;
alter table public.staff_training_requirements enable row level security;
alter table public.staff_training_completions enable row level security;

create policy staff_training_courses_read on public.staff_training_courses for select to authenticated
  using (organisation_id = (select private.current_org_id()) and (select private.is_admin()));
create policy staff_training_requirements_read on public.staff_training_requirements for select to authenticated
  using (organisation_id = (select private.current_org_id()) and (select private.is_admin()));
create policy staff_training_completions_read on public.staff_training_completions for select to authenticated
  using (organisation_id = (select private.current_org_id())
         and ((select private.is_admin()) or profile_id = (select auth.uid())));

revoke all on public.staff_training_courses, public.staff_training_requirements, public.staff_training_completions from anon, authenticated;
grant select on public.staff_training_courses, public.staff_training_requirements, public.staff_training_completions to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 3. Writes (admin only, audited)
-- ---------------------------------------------------------------------------------------------------------------------------
create function private.hr_admin_org() returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid;
begin
  if not private.is_admin() then raise exception 'Only an admin can change training records.' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = auth.uid();
  return v_org;
end;
$$;

create function public.save_training_course(
  p_id uuid, p_name text, p_category text, p_provider text default null, p_description text default null,
  p_renewal_months smallint default null, p_active boolean default true
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := private.hr_admin_org(); v_id uuid; v_old public.staff_training_courses;
begin
  if p_id is null then
    insert into public.staff_training_courses (organisation_id, name, category, provider, description, renewal_months, is_active, created_by)
    values (v_org, trim(p_name), p_category, nullif(trim(coalesce(p_provider, '')), ''), nullif(trim(coalesce(p_description, '')), ''),
            p_renewal_months, coalesce(p_active, true), auth.uid())
    returning id into v_id;
  else
    select * into v_old from public.staff_training_courses where id = p_id;
    if not found or v_old.organisation_id is distinct from v_org then raise exception 'That course is not one you can see.'; end if;
    update public.staff_training_courses
       set name = trim(p_name), category = p_category, provider = nullif(trim(coalesce(p_provider, '')), ''),
           description = nullif(trim(coalesce(p_description, '')), ''), renewal_months = p_renewal_months,
           is_active = coalesce(p_active, true), updated_at = now()
     where id = p_id;
    v_id := p_id;
  end if;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result)
  values (v_org, auth.uid(), case when p_id is null then 'staff_training_course.created' else 'staff_training_course.updated' end,
          'staff_training_course', v_id,
          jsonb_build_object('name', trim(p_name), 'category', p_category, 'renewal_months', p_renewal_months, 'is_active', coalesce(p_active, true)),
          'success');
  return v_id;
end;
$$;

create function public.add_training_requirement(
  p_course uuid, p_applies_to text, p_role text default null, p_department uuid default null, p_due_within_days smallint default 30
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := private.hr_admin_org(); v_id uuid; v_role public.user_role;
begin
  if not exists (select 1 from public.staff_training_courses c where c.id = p_course and c.organisation_id = v_org and c.is_active) then
    raise exception 'Choose an active course.';
  end if;
  if p_applies_to = 'role' then
    if p_role is null or not private.is_internal_staff_role(p_role::public.user_role) then
      raise exception 'Choose a Tarragon staff role.';
    end if;
    v_role := p_role::public.user_role;
  end if;
  if p_applies_to = 'department' and not exists (
       select 1 from public.staff_departments d where d.id = p_department and d.organisation_id = v_org and d.is_active) then
    raise exception 'Choose an active department.';
  end if;
  if exists (select 1 from public.staff_training_requirements r
              where r.course_id = p_course and r.applies_to = p_applies_to and r.removed_at is null
                and r.role is not distinct from v_role
                and r.department_id is not distinct from (case when p_applies_to = 'department' then p_department end)) then
    raise exception 'That requirement already exists.';
  end if;
  insert into public.staff_training_requirements (organisation_id, course_id, applies_to, role, department_id, due_within_days, created_by)
  values (v_org, p_course, p_applies_to, v_role, case when p_applies_to = 'department' then p_department end,
          coalesce(p_due_within_days, 30), auth.uid())
  returning id into v_id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result)
  values (v_org, auth.uid(), 'staff_training_requirement.added', 'staff_training_requirement', v_id,
          jsonb_build_object('course_id', p_course, 'applies_to', p_applies_to, 'role', p_role, 'department_id', p_department), 'success');
  return v_id;
end;
$$;

-- Change how long people have, in place. Removing and re-adding a rule would restart everyone's clock from the new rule's date.
create function public.set_training_requirement_due(p_requirement uuid, p_due_within_days smallint) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := private.hr_admin_org(); v_req public.staff_training_requirements;
begin
  select * into v_req from public.staff_training_requirements where id = p_requirement;
  if not found or v_req.organisation_id is distinct from v_org or v_req.removed_at is not null then
    raise exception 'That requirement is not one you can see.';
  end if;
  if p_due_within_days is null or p_due_within_days not between 0 and 365 then raise exception 'Give 0 to 365 days.'; end if;
  update public.staff_training_requirements set due_within_days = p_due_within_days where id = p_requirement;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result)
  values (v_org, auth.uid(), 'staff_training_requirement.due_changed', 'staff_training_requirement', p_requirement,
          jsonb_build_object('course_id', v_req.course_id, 'from', v_req.due_within_days, 'to', p_due_within_days), 'success');
end;
$$;

create function public.remove_training_requirement(p_requirement uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := private.hr_admin_org(); v_req public.staff_training_requirements;
begin
  select * into v_req from public.staff_training_requirements where id = p_requirement;
  if not found or v_req.organisation_id is distinct from v_org then raise exception 'That requirement is not one you can see.'; end if;
  if v_req.removed_at is not null then return; end if;
  update public.staff_training_requirements set removed_at = now(), removed_by = auth.uid() where id = p_requirement;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result)
  values (v_org, auth.uid(), 'staff_training_requirement.removed', 'staff_training_requirement', p_requirement,
          jsonb_build_object('course_id', v_req.course_id), 'success');
end;
$$;

-- An admin records a completion. p_verified = true when they have seen the evidence themselves (never for their own record).
create function public.record_training_completion(
  p_profile uuid, p_course uuid, p_completed_on date, p_verified boolean default false,
  p_evidence_reference text default null, p_note text default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := private.hr_admin_org(); v_course public.staff_training_courses; v_id uuid;
begin
  if not exists (select 1 from public.profiles p where p.id = p_profile and p.organisation_id = v_org and private.is_internal_staff_role(p.role)) then
    raise exception 'That person is not a member of staff in your organisation.';
  end if;
  select * into v_course from public.staff_training_courses where id = p_course and organisation_id = v_org;
  if not found then raise exception 'That course is not one you can see.'; end if;
  if p_completed_on is null or p_completed_on > (now() at time zone 'Africa/Lagos')::date then
    raise exception 'The completion date cannot be in the future.';
  end if;
  if p_verified and p_profile = auth.uid() then
    raise exception 'Another admin must verify your own training record.' using errcode = '42501';
  end if;
  insert into public.staff_training_completions (organisation_id, profile_id, course_id, completed_on, expires_on, evidence_reference,
                                                 note, recorded_by, verified_by, verified_at)
  values (v_org, p_profile, p_course, p_completed_on,
          case when v_course.renewal_months is not null then (p_completed_on + make_interval(months => v_course.renewal_months))::date end,
          nullif(trim(coalesce(p_evidence_reference, '')), ''), nullif(trim(coalesce(p_note, '')), ''), auth.uid(),
          case when p_verified then auth.uid() end, case when p_verified then now() end)
  returning id into v_id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result)
  values (v_org, auth.uid(), 'staff_training_completion.recorded', 'staff_training_completion', v_id,
          jsonb_build_object('profile_id', p_profile, 'course_id', p_course, 'completed_on', p_completed_on, 'verified', coalesce(p_verified, false)),
          'success');
  return v_id;
end;
$$;

create function public.verify_training_completion(p_completion uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := private.hr_admin_org(); v_c public.staff_training_completions;
begin
  select * into v_c from public.staff_training_completions where id = p_completion;
  if not found or v_c.organisation_id is distinct from v_org then raise exception 'That record is not one you can see.'; end if;
  if v_c.profile_id = auth.uid() then raise exception 'Another admin must verify your own training record.' using errcode = '42501'; end if;
  if v_c.voided_at is not null then raise exception 'This record has been voided.'; end if;
  if v_c.verified_at is not null then return; end if;
  update public.staff_training_completions set verified_by = auth.uid(), verified_at = now() where id = p_completion;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result)
  values (v_org, auth.uid(), 'staff_training_completion.verified', 'staff_training_completion', p_completion,
          jsonb_build_object('profile_id', v_c.profile_id, 'course_id', v_c.course_id), 'success');
end;
$$;

create function public.void_training_completion(p_completion uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := private.hr_admin_org(); v_c public.staff_training_completions;
begin
  if length(trim(coalesce(p_reason, ''))) < 10 then raise exception 'Say in a sentence why this record is wrong.'; end if;
  select * into v_c from public.staff_training_completions where id = p_completion;
  if not found or v_c.organisation_id is distinct from v_org then raise exception 'That record is not one you can see.'; end if;
  if v_c.voided_at is not null then return; end if;
  update public.staff_training_completions set voided_by = auth.uid(), voided_at = now(), void_reason = trim(p_reason) where id = p_completion;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result)
  values (v_org, auth.uid(), 'staff_training_completion.voided', 'staff_training_completion', p_completion,
          jsonb_build_object('profile_id', v_c.profile_id, 'course_id', v_c.course_id), 'success');
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 4. The read: every current staff member's required courses and the completion that decides their status: an in-date
--    verified one if there is one, otherwise the most recent non-voided one (so a renewal awaiting verification is shown as
--    such, not hidden behind the expired record it replaces). p_profile narrows it to one person (the profile page).
-- ---------------------------------------------------------------------------------------------------------------------------
create function public.people_training_records(p_profile uuid default null)
returns table (
  profile_id uuid, course_id uuid, course_name text, category text, renewal_months smallint, due_on date,
  completion_id uuid, completed_on date, expires_on date, verified boolean
)
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid := private.hr_admin_org();
begin
  return query
  with staff as (
    select p.id, p.role, e.department_id,
           coalesce(e.start_date, (p.created_at at time zone 'Africa/Lagos')::date) as start_on
      from public.profiles p
      left join lateral private.staff_current_employment_of(p.id) e on true
     where p.organisation_id = v_org and private.is_internal_staff_role(p.role) and not p.is_test
       and (p_profile is null or p.id = p_profile)
       and coalesce(e.employment_status, 'active') <> 'left'
       and (p.is_active or e.id is not null)
  ), required as (
    -- one row per person and course; with several matching rules the earliest due date wins
    select s.id as pid, r.course_id as cid,
           min(greatest(s.start_on, (r.created_at at time zone 'Africa/Lagos')::date) + r.due_within_days) as due
      from staff s
      join public.staff_training_requirements r on r.organisation_id = v_org and r.removed_at is null
       and (r.applies_to = 'everyone'
            or (r.applies_to = 'role' and r.role = s.role)
            or (r.applies_to = 'department' and r.department_id = s.department_id))
      join public.staff_training_courses c on c.id = r.course_id and c.is_active
     group by s.id, r.course_id
  )
  select q.pid, c.id, c.name, c.category, c.renewal_months, q.due,
         lc.id, lc.completed_on, lc.expires_on, lc.verified_at is not null
    from required q
    join public.staff_training_courses c on c.id = q.cid
    left join lateral (
      select tc.* from public.staff_training_completions tc
       where tc.profile_id = q.pid and tc.course_id = q.cid and tc.voided_at is null
       order by (tc.verified_at is not null and (tc.expires_on is null or tc.expires_on >= (now() at time zone 'Africa/Lagos')::date)) desc,
                tc.completed_on desc, tc.recorded_at desc
       limit 1) lc on true
   order by q.pid, c.name;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 4b. Recent HR activity includes training events (people_recent_activity from Phase A, same body plus the training actions;
--     the subject of a completion is its profile_id). Values are never shown, only who did what to whom and when.
-- ---------------------------------------------------------------------------------------------------------------------------
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
      when a.entity_type in ('staff_employment_record', 'staff_training_completion') then (a.event ->> 'profile_id')::uuid
      when a.entity_type = 'staff_sensitive_details' then a.entity_id
      else null end
   where a.organisation_id = v_org
     and (a.action like 'staff_employment.%' or a.action like 'staff_department.%' or a.action = 'staff_personal_details.updated'
          or a.action like 'staff_training_%')
   order by a.created_at desc
   limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------------------
-- 5. Grants. The revoke is from PUBLIC (anon inherits through it).
-- ---------------------------------------------------------------------------------------------------------------------------
revoke all on function private.staff_training_completions_guard() from public, anon, authenticated;
revoke all on function private.hr_admin_org() from public, anon, authenticated;
revoke all on function public.save_training_course(uuid, text, text, text, text, smallint, boolean) from public, anon;
revoke all on function public.add_training_requirement(uuid, text, text, uuid, smallint) from public, anon;
revoke all on function public.remove_training_requirement(uuid) from public, anon;
revoke all on function public.set_training_requirement_due(uuid, smallint) from public, anon;
revoke all on function public.record_training_completion(uuid, uuid, date, boolean, text, text) from public, anon;
revoke all on function public.verify_training_completion(uuid) from public, anon;
revoke all on function public.void_training_completion(uuid, text) from public, anon;
revoke all on function public.people_training_records(uuid) from public, anon;
grant execute on function public.save_training_course(uuid, text, text, text, text, smallint, boolean) to authenticated;
grant execute on function public.add_training_requirement(uuid, text, text, uuid, smallint) to authenticated;
grant execute on function public.remove_training_requirement(uuid) to authenticated;
grant execute on function public.set_training_requirement_due(uuid, smallint) to authenticated;
grant execute on function public.record_training_completion(uuid, uuid, date, boolean, text, text) to authenticated;
grant execute on function public.verify_training_completion(uuid) to authenticated;
grant execute on function public.void_training_completion(uuid, text) to authenticated;
grant execute on function public.people_training_records(uuid) to authenticated;

do $$
begin
  if has_table_privilege('anon', 'public.staff_training_completions', 'SELECT')
     or has_table_privilege('authenticated', 'public.staff_training_completions', 'INSERT')
     or has_table_privilege('authenticated', 'public.staff_training_completions', 'UPDATE')
     or has_function_privilege('anon', 'public.people_training_records(uuid)', 'EXECUTE') then
    raise exception 'HR Phase B grants are wider than intended.';
  end if;
end $$;
