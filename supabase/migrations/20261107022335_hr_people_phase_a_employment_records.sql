-- HR and Workforce dashboard, Phase A (docs/design/HR-WORKFORCE.md; founder decisions HR-01 to HR-04, 2026-11-07).
--
-- What this adds, and what it deliberately does not touch:
-- 1. staff_departments: Tarragon's own departments (not the employer_* or provider_org_* tables, which belong to customers
--    and partners). Admin only.
-- 2. staff_employment_records: one append-only row per employment event (appointment, transfer, change of manager, leaving,
--    and so on). Each row is a full snapshot, so the current position is simply the latest row in force; history is never
--    overwritten and nothing is ever deleted. Written only by public.record_staff_employment_change (admin, HR-02), which
--    writes audit_log in the same transaction. Readable by admins and by the person themself only. A line manager does
--    not read the rows, because a suspension or leaving row carries a note that may be disciplinary; Phase C gives a
--    manager a narrow function for leave approval (HR-03) instead of table access.
-- 3. staff_sensitive_details: emergency contact, home address and national ID number (HR-04). No table access at all for
--    any client role; read through public.staff_personal_details (admin or the person, and an admin's read is written to
--    audit_log) and written through public.set_staff_personal_details (the person may change their contact and address,
--    only an admin may change the ID number). Audit rows name the fields that changed, never the values. An admin's
--    repeated reads of the same person within 10 minutes are logged once, so the access log counts deliberate looks.
-- 4. public.people_directory() and public.people_recent_activity(): admin-only reads for /admin/people.
--
-- Not touched: platform access (profiles.role / is_active stay with set_member_role / set_member_active), the clinician
-- record (clinical_staff stays authoritative for licence, indemnity, tier and employed/contracted; this module reads it,
-- refuses to store a second employed/contracted value for a clinician, and asks credentialing's own functions
-- (psv_satisfied, indemnity_required, clinician_is_eligible) whether someone is verified and cleared rather than
-- re-deriving it), the rota and provider_time_off, payroll (none; no
-- salary or bank data here). No go-live guard: staff-only and admin-gated (GATE-MODEL rule 1).
--
-- "Staff" means Tarragon's own internal roles: clinician, admin, care_coordinator, analyst, finance, lab_liaison. Partner
-- and customer accounts (hmo_admin, corporate_admin, pharmacist, lab_partner, payer_admin, provider_org_staff, ngo_admin)
-- are not Tarragon employees and are out of scope.

-- ---------------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------------
create function private.is_internal_staff_role(p_role public.user_role) returns boolean
language sql immutable set search_path = ''
as $$ select p_role::text in ('clinician', 'admin', 'care_coordinator', 'analyst', 'finance', 'lab_liaison') $$;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table public.staff_departments (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  name            text not null check (length(trim(name)) between 2 and 80),
  description     text check (description is null or length(description) <= 500),
  head_profile_id uuid references public.profiles (id) on delete restrict,
  is_active       boolean not null default true,
  created_by      uuid not null references public.profiles (id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index staff_departments_name_per_org on public.staff_departments (organisation_id, lower(trim(name)));

create table public.staff_employment_records (
  id                        uuid primary key default gen_random_uuid(),
  organisation_id           uuid not null references public.organisations (id) on delete restrict,
  profile_id                uuid not null references public.profiles (id) on delete restrict,
  change_kind               text not null check (change_kind in (
                              'appointment', 'promotion', 'transfer', 'manager_change', 'hours_change', 'contract_renewal',
                              'contract_amendment', 'suspension', 'return_to_work', 'termination', 'resignation', 'retirement',
                              'correction')),
  effective_from            date not null,
  job_title                 text not null check (length(trim(job_title)) between 2 and 120),
  department_id             uuid references public.staff_departments (id) on delete restrict,
  line_manager_id           uuid references public.profiles (id) on delete restrict,
  -- employed / contracted for non-clinicians only; a clinician's comes from clinical_staff.employment_type (see trigger).
  engagement                text check (engagement in ('employed', 'contracted')),
  work_pattern              text not null check (work_pattern in ('full_time', 'part_time', 'sessional')),
  employment_status         text not null check (employment_status in ('onboarding', 'active', 'suspended', 'left')),
  start_date                date not null,
  contract_end_date         date,
  contracted_hours_per_week numeric(4, 1) check (contracted_hours_per_week is null or contracted_hours_per_week between 0 and 80),
  work_location             text check (work_location is null or length(work_location) <= 120),
  note                      text check (note is null or length(note) <= 1000),
  recorded_by               uuid not null references public.profiles (id) on delete restrict,
  recorded_at               timestamptz not null default now(),
  constraint staff_employment_not_own_manager check (line_manager_id is distinct from profile_id),
  constraint staff_employment_contract_after_start check (contract_end_date is null or contract_end_date >= start_date),
  constraint staff_employment_leaving_kinds check (
    (employment_status = 'left') = (change_kind in ('termination', 'resignation', 'retirement'))
    or change_kind = 'correction'),
  constraint staff_employment_leaving_note check (
    change_kind not in ('suspension', 'termination', 'resignation', 'retirement')
    or length(trim(coalesce(note, ''))) >= 10)
);
create index staff_employment_records_profile on public.staff_employment_records (profile_id, effective_from desc, recorded_at desc);
create index staff_employment_records_manager on public.staff_employment_records (line_manager_id) where line_manager_id is not null;

create table public.staff_sensitive_details (
  profile_id                     uuid primary key references public.profiles (id) on delete restrict,
  organisation_id                uuid not null references public.organisations (id) on delete restrict,
  emergency_contact_name         text check (emergency_contact_name is null or length(trim(emergency_contact_name)) between 2 and 120),
  emergency_contact_relationship text check (emergency_contact_relationship is null or length(emergency_contact_relationship) <= 60),
  emergency_contact_phone        text check (emergency_contact_phone is null or emergency_contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  home_address                   text check (home_address is null or length(trim(home_address)) between 5 and 400),
  national_id_number             text check (national_id_number is null or national_id_number ~ '^[0-9]{11}$'),
  updated_by                     uuid not null references public.profiles (id) on delete restrict,
  updated_at                     timestamptz not null default now()
);

-- Employment rows are history: never updated or deleted, by anyone (a mistake is fixed with a 'correction' row).
create function private.staff_employment_records_append_only() returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'Employment history is never changed or deleted; record a correction instead.' using errcode = '42501';
end;
$$;
create trigger staff_employment_records_append_only before update or delete on public.staff_employment_records
  for each row execute function private.staff_employment_records_append_only();

-- One employed/contracted value per person: a clinician's lives on clinical_staff (it drives the indemnity rule).
create function private.staff_employment_engagement_source() returns trigger
language plpgsql set search_path = ''
as $$
declare v_is_clinician boolean;
begin
  select exists (select 1 from public.clinical_staff c where c.profile_id = new.profile_id) into v_is_clinician;
  if v_is_clinician and new.engagement is not null then
    raise exception 'A clinician''s employed or contracted status is set on their clinical staff record, not here.';
  end if;
  if not v_is_clinician and new.engagement is null then
    raise exception 'Say whether this person is employed or contracted.';
  end if;
  return new;
end;
$$;
create trigger staff_employment_engagement_source before insert on public.staff_employment_records
  for each row execute function private.staff_employment_engagement_source();

-- The record in force for each person: the latest row whose effective date has arrived (Lagos time); for someone whose
-- first row is still in the future (a starter), their earliest row.
create function private.staff_current_employment()
returns setof public.staff_employment_records
language sql stable security definer set search_path = ''
as $$
  select distinct on (r.profile_id) r.*
    from public.staff_employment_records r
   order by r.profile_id,
            (r.effective_from <= (now() at time zone 'Africa/Lagos')::date) desc,
            case when r.effective_from <= (now() at time zone 'Africa/Lagos')::date then r.effective_from end desc nulls last,
            r.effective_from asc,
            r.recorded_at desc
$$;

-- The same rule for one person, by index rather than over the whole table.
create function private.staff_current_employment_of(p_profile uuid)
returns public.staff_employment_records
language sql stable security definer set search_path = ''
as $$
  select r.*
    from public.staff_employment_records r
   where r.profile_id = p_profile
   order by (r.effective_from <= (now() at time zone 'Africa/Lagos')::date) desc,
            case when r.effective_from <= (now() at time zone 'Africa/Lagos')::date then r.effective_from end desc nulls last,
            r.effective_from asc,
            r.recorded_at desc
   limit 1
$$;

-- ---------------------------------------------------------------------------
-- 2. Row-level security and grants
-- ---------------------------------------------------------------------------
alter table public.staff_departments enable row level security;
alter table public.staff_employment_records enable row level security;
alter table public.staff_sensitive_details enable row level security;

create policy staff_departments_admin_read on public.staff_departments for select to authenticated
  using ((select private.is_admin()) and organisation_id = (select private.current_org_id()));

create policy staff_employment_records_read on public.staff_employment_records for select to authenticated
  using (organisation_id = (select private.current_org_id())
         and ((select private.is_admin()) or profile_id = (select auth.uid())));

-- staff_sensitive_details has no policy: no client role reads or writes it directly.

revoke all on public.staff_departments, public.staff_employment_records, public.staff_sensitive_details from anon, authenticated;
grant select on public.staff_departments, public.staff_employment_records to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Writes
-- ---------------------------------------------------------------------------
create function public.save_staff_department(
  p_id uuid, p_name text, p_description text default null, p_head uuid default null, p_active boolean default true
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_me uuid := auth.uid(); v_org uuid; v_id uuid; v_existing public.staff_departments;
begin
  if not private.is_admin() then raise exception 'Only an admin can change departments.' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = v_me;
  if p_head is not null and not exists (
       select 1 from public.profiles p where p.id = p_head and p.organisation_id = v_org and private.is_internal_staff_role(p.role)) then
    raise exception 'The department head must be a member of staff in your organisation.';
  end if;
  if p_id is null then
    insert into public.staff_departments (organisation_id, name, description, head_profile_id, is_active, created_by)
    values (v_org, trim(p_name), nullif(trim(coalesce(p_description, '')), ''), p_head, coalesce(p_active, true), v_me)
    returning id into v_id;
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result)
    values (v_org, v_me, 'staff_department.created', 'staff_department', v_id, jsonb_build_object('name', trim(p_name)), 'success');
  else
    select * into v_existing from public.staff_departments where id = p_id;
    if not found or v_existing.organisation_id is distinct from v_org then raise exception 'That department is not one you can see.'; end if;
    if coalesce(p_active, true) = false and exists (
         select 1 from private.staff_current_employment() c where c.department_id = p_id and c.employment_status <> 'left') then
      raise exception 'Move the people in this department first; it still has current staff.';
    end if;
    update public.staff_departments
       set name = trim(p_name), description = nullif(trim(coalesce(p_description, '')), ''), head_profile_id = p_head,
           is_active = coalesce(p_active, true), updated_at = now()
     where id = p_id;
    v_id := p_id;
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result)
    values (v_org, v_me, 'staff_department.updated', 'staff_department', v_id,
            jsonb_build_object('name', trim(p_name), 'is_active', coalesce(p_active, true)), 'success');
  end if;
  return v_id;
end;
$$;

create function public.record_staff_employment_change(
  p_profile uuid,
  p_change_kind text,
  p_effective_from date,
  p_job_title text,
  p_work_pattern text,
  p_employment_status text,
  p_start_date date,
  p_department uuid default null,
  p_line_manager uuid default null,
  p_engagement text default null,
  p_contract_end_date date default null,
  p_contracted_hours numeric default null,
  p_work_location text default null,
  p_note text default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := auth.uid(); v_org uuid; v_person public.profiles; v_current public.staff_employment_records;
  v_has_any boolean; v_step uuid; v_hops integer := 0; v_id uuid;
begin
  if not private.is_admin() then raise exception 'Only an admin can record an employment change.' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = v_me;
  select * into v_person from public.profiles where id = p_profile;
  if not found or v_person.organisation_id is distinct from v_org then raise exception 'That person is not in your organisation.'; end if;
  if not private.is_internal_staff_role(v_person.role) then
    raise exception 'Employment records are for Tarragon staff accounts only.';
  end if;
  if p_effective_from is null or p_effective_from > (now() at time zone 'Africa/Lagos')::date + 180 then
    raise exception 'Give an effective date no more than 180 days ahead.';
  end if;

  select exists (select 1 from public.staff_employment_records where profile_id = p_profile) into v_has_any;
  v_current := private.staff_current_employment_of(p_profile);
  if not v_has_any and p_change_kind not in ('appointment') then
    raise exception 'The first employment record for a person is their appointment.';
  end if;
  if v_has_any and v_current.employment_status = 'left' and p_change_kind not in ('appointment', 'correction') then
    raise exception 'This person has left; record a new appointment to bring them back.';
  end if;
  if v_has_any and v_current.employment_status <> 'left' and p_change_kind = 'appointment' then
    raise exception 'This person already has a current appointment; record a change instead.';
  end if;
  if p_change_kind = 'appointment' and p_employment_status not in ('onboarding', 'active') then
    raise exception 'A new appointment starts as onboarding or active.';
  end if;
  if p_change_kind = 'correction' and (v_current.employment_status = 'left') is distinct from (p_employment_status = 'left') then
    raise exception 'A correction cannot change whether someone has left; record a leaving change or a new appointment.';
  end if;
  if p_change_kind = 'return_to_work' and v_current.employment_status is distinct from 'suspended' then
    raise exception 'Return to work is for someone who is currently suspended.';
  end if;

  if p_department is not null and not exists (
       select 1 from public.staff_departments d where d.id = p_department and d.organisation_id = v_org and d.is_active) then
    raise exception 'Choose an active department in your organisation.';
  end if;
  if p_line_manager is not null then
    if not exists (select 1 from public.profiles m where m.id = p_line_manager and m.organisation_id = v_org
                    and private.is_internal_staff_role(m.role) and m.is_active) then
      raise exception 'The line manager must be an active member of staff in your organisation.';
    end if;
    -- No reporting loops: walk up from the proposed manager.
    v_step := p_line_manager;
    while v_step is not null and v_hops < 50 loop
      if v_step = p_profile then raise exception 'That would make a reporting loop.'; end if;
      v_step := (private.staff_current_employment_of(v_step)).line_manager_id;
      v_hops := v_hops + 1;
    end loop;
  end if;

  insert into public.staff_employment_records (
    organisation_id, profile_id, change_kind, effective_from, job_title, department_id, line_manager_id, engagement,
    work_pattern, employment_status, start_date, contract_end_date, contracted_hours_per_week, work_location, note, recorded_by)
  values (
    v_org, p_profile, p_change_kind, p_effective_from, trim(p_job_title), p_department, p_line_manager, p_engagement,
    p_work_pattern, p_employment_status, p_start_date, p_contract_end_date, p_contracted_hours,
    nullif(trim(coalesce(p_work_location, '')), ''), nullif(trim(coalesce(p_note, '')), ''), v_me)
  returning id into v_id;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result)
  values (v_org, v_me, 'staff_employment.' || p_change_kind, 'staff_employment_record', v_id,
          jsonb_build_object('profile_id', p_profile, 'effective_from', p_effective_from, 'employment_status', p_employment_status,
                             'department_id', p_department, 'line_manager_id', p_line_manager), 'success');
  return v_id;
end;
$$;

create function public.set_staff_personal_details(
  p_profile uuid,
  p_emergency_contact_name text default null,
  p_emergency_contact_relationship text default null,
  p_emergency_contact_phone text default null,
  p_home_address text default null,
  p_national_id_number text default null
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := auth.uid(); v_admin boolean := private.is_admin(); v_person public.profiles; v_old public.staff_sensitive_details;
  v_new_nin text := nullif(regexp_replace(coalesce(p_national_id_number, ''), '\s', '', 'g'), '');
  v_changed text[] := '{}';
begin
  select * into v_person from public.profiles where id = p_profile;
  if not found then raise exception 'That person is not one you can see.'; end if;
  if not (p_profile = v_me or (v_admin and v_person.organisation_id = (select organisation_id from public.profiles where id = v_me))) then
    raise exception 'Only the person or an admin can change these details.' using errcode = '42501';
  end if;
  if not private.is_internal_staff_role(v_person.role) then raise exception 'Personal details here are for Tarragon staff only.'; end if;

  select * into v_old from public.staff_sensitive_details where profile_id = p_profile;
  if not v_admin and v_new_nin is distinct from v_old.national_id_number then
    raise exception 'Only an admin can change the national ID number.' using errcode = '42501';
  end if;

  if nullif(trim(coalesce(p_emergency_contact_name, '')), '') is distinct from v_old.emergency_contact_name then v_changed := array_append(v_changed, 'emergency_contact_name'); end if;
  if nullif(trim(coalesce(p_emergency_contact_relationship, '')), '') is distinct from v_old.emergency_contact_relationship then v_changed := array_append(v_changed, 'emergency_contact_relationship'); end if;
  if nullif(trim(coalesce(p_emergency_contact_phone, '')), '') is distinct from v_old.emergency_contact_phone then v_changed := array_append(v_changed, 'emergency_contact_phone'); end if;
  if nullif(trim(coalesce(p_home_address, '')), '') is distinct from v_old.home_address then v_changed := array_append(v_changed, 'home_address'); end if;
  if v_new_nin is distinct from v_old.national_id_number then v_changed := array_append(v_changed, 'national_id_number'); end if;
  if cardinality(v_changed) = 0 then return; end if;

  insert into public.staff_sensitive_details as s (
    profile_id, organisation_id, emergency_contact_name, emergency_contact_relationship, emergency_contact_phone, home_address,
    national_id_number, updated_by, updated_at)
  values (
    p_profile, v_person.organisation_id, nullif(trim(coalesce(p_emergency_contact_name, '')), ''),
    nullif(trim(coalesce(p_emergency_contact_relationship, '')), ''), nullif(trim(coalesce(p_emergency_contact_phone, '')), ''),
    nullif(trim(coalesce(p_home_address, '')), ''), v_new_nin, v_me, now())
  on conflict (profile_id) do update set
    emergency_contact_name = excluded.emergency_contact_name,
    emergency_contact_relationship = excluded.emergency_contact_relationship,
    emergency_contact_phone = excluded.emergency_contact_phone,
    home_address = excluded.home_address,
    national_id_number = excluded.national_id_number,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result)
  values (v_person.organisation_id, v_me, 'staff_personal_details.updated', 'staff_sensitive_details', p_profile,
          jsonb_build_object('fields', to_jsonb(v_changed), 'by_self', p_profile = v_me), 'success');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Reads
-- ---------------------------------------------------------------------------
-- The person themself, or an admin of their organisation. An admin's read of someone else's details is written to
-- audit_log (NHS-style audited access). Returns null when nothing has been recorded yet.
create function public.staff_personal_details(p_profile uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_me uuid := auth.uid(); v_person public.profiles; v_row public.staff_sensitive_details;
begin
  select * into v_person from public.profiles where id = p_profile;
  if not found then raise exception 'That person is not one you can see.'; end if;
  if not (p_profile = v_me or (private.is_admin() and v_person.organisation_id = (select organisation_id from public.profiles where id = v_me))) then
    raise exception 'Only the person or an admin can see these details.' using errcode = '42501';
  end if;
  select * into v_row from public.staff_sensitive_details where profile_id = p_profile;
  if p_profile <> v_me and not exists (
       select 1 from public.audit_log a
        where a.action = 'staff_personal_details.viewed' and a.entity_id = p_profile and a.actor_id = v_me
          and a.created_at > now() - interval '10 minutes') then
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result)
    values (v_person.organisation_id, v_me, 'staff_personal_details.viewed', 'staff_sensitive_details', p_profile, '{}'::jsonb, 'success');
  end if;
  if v_row.profile_id is null then return null; end if;
  return jsonb_build_object(
    'emergency_contact_name', v_row.emergency_contact_name,
    'emergency_contact_relationship', v_row.emergency_contact_relationship,
    'emergency_contact_phone', v_row.emergency_contact_phone,
    'home_address', v_row.home_address,
    'national_id_number', v_row.national_id_number,
    'updated_at', v_row.updated_at);
end;
$$;

-- One row per internal staff account in the admin's organisation: account, current employment and, for a clinician, the
-- credential dates on clinical_staff plus credentialing's own verdicts (primary-source verification satisfied, indemnity
-- required, cleared for clinical work). Read only; credentialing stays authoritative. A clinician's employed/contracted
-- always comes from clinical_staff, even if an HR row from before they joined clinical_staff carries one.
create function public.people_directory()
returns table (
  profile_id uuid, full_name text, staff_number text, role text, account_active boolean, is_test boolean,
  is_clinician boolean, doctor_tier text, clinician_status text, clinician_employment_type text,
  licence_expires_at timestamptz, verification_satisfied boolean, cleared_to_practise boolean, indemnity_required boolean,
  indemnity_expires_at timestamptz, indemnity_exempt boolean,
  has_employment_record boolean, job_title text, department_id uuid, department_name text, line_manager_id uuid,
  line_manager_name text, engagement text, work_pattern text, employment_status text, start_date date, contract_end_date date,
  contracted_hours_per_week numeric, work_location text, has_emergency_contact boolean
)
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid;
begin
  if not private.is_admin() then raise exception 'Only an admin can see the staff directory.' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = auth.uid();
  return query
  select p.id, p.full_name, coalesce(cs.staff_number, p.staff_number), p.role::text, p.is_active, p.is_test,
         cs.profile_id is not null, cs.doctor_tier::text, cs.status::text, cs.employment_type::text,
         cs.license_expires_at,
         case when cs.id is null then null else private.psv_satisfied(cs.id, now()) end,
         case when cs.id is null then null else private.clinician_is_eligible(p.id, now()) end,
         case when cs.id is null then null else coalesce(private.indemnity_required(cs.id), false) end,
         cs.indemnity_expires_at, coalesce(cs.indemnity_exempt, false),
         e.id is not null, e.job_title, e.department_id, d.name, e.line_manager_id, m.full_name,
         case when cs.profile_id is not null then cs.employment_type::text else e.engagement end, e.work_pattern, e.employment_status, e.start_date, e.contract_end_date,
         e.contracted_hours_per_week, e.work_location,
         exists (select 1 from public.staff_sensitive_details s where s.profile_id = p.id and s.emergency_contact_phone is not null)
    from public.profiles p
    left join public.clinical_staff cs on cs.profile_id = p.id
    left join private.staff_current_employment() e on e.profile_id = p.id
    left join public.staff_departments d on d.id = e.department_id
    left join public.profiles m on m.id = e.line_manager_id
   where p.organisation_id = v_org and private.is_internal_staff_role(p.role)
   order by p.full_name;
end;
$$;

-- Recent HR events for the overview: who did what, when. Never the values of personal details.
create function public.people_recent_activity(p_limit integer default 20)
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
      when a.entity_type = 'staff_employment_record' then (a.event ->> 'profile_id')::uuid
      when a.entity_type = 'staff_sensitive_details' then a.entity_id
      else null end
   where a.organisation_id = v_org
     and (a.action like 'staff_employment.%' or a.action like 'staff_department.%' or a.action = 'staff_personal_details.updated')
   order by a.created_at desc
   limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Function grants. The revoke is from PUBLIC (anon inherits through it).
-- ---------------------------------------------------------------------------
revoke all on function private.is_internal_staff_role(public.user_role) from public, anon;
revoke all on function private.staff_current_employment() from public, anon, authenticated;
revoke all on function private.staff_current_employment_of(uuid) from public, anon, authenticated;
revoke all on function private.staff_employment_records_append_only() from public, anon, authenticated;
revoke all on function private.staff_employment_engagement_source() from public, anon, authenticated;
revoke all on function public.save_staff_department(uuid, text, text, uuid, boolean) from public, anon;
revoke all on function public.record_staff_employment_change(uuid, text, date, text, text, text, date, uuid, uuid, text, date, numeric, text, text) from public, anon;
revoke all on function public.set_staff_personal_details(uuid, text, text, text, text, text) from public, anon;
revoke all on function public.staff_personal_details(uuid) from public, anon;
revoke all on function public.people_directory() from public, anon;
revoke all on function public.people_recent_activity(integer) from public, anon;

grant execute on function public.save_staff_department(uuid, text, text, uuid, boolean) to authenticated;
grant execute on function public.record_staff_employment_change(uuid, text, date, text, text, text, date, uuid, uuid, text, date, numeric, text, text) to authenticated;
grant execute on function public.set_staff_personal_details(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.staff_personal_details(uuid) to authenticated;
grant execute on function public.people_directory() to authenticated;
grant execute on function public.people_recent_activity(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('anon', 'public.staff_employment_records', 'SELECT')
     or has_table_privilege('authenticated', 'public.staff_sensitive_details', 'SELECT')
     or has_table_privilege('authenticated', 'public.staff_employment_records', 'INSERT')
     or has_function_privilege('anon', 'public.people_directory()', 'EXECUTE')
     or has_function_privilege('anon', 'public.staff_personal_details(uuid)', 'EXECUTE') then
    raise exception 'HR Phase A grants are wider than intended.';
  end if;
end $$;
