-- Tarragon Health — Employer Health Platform, part 2b/6: employee eligibility
-- data, invitations, joining, and departure (Module 26 §26.4, §26.5, §26.17).
--
-- Where this starts from: `employer_roster_members` (20260715162958) is
-- (org, phone, full_name, status, claimed_profile_id). That supports exactly
-- one enrolment route — an admin types a phone number and waits for that
-- person to sign up with the same one — and carries nothing to segment the
-- workforce by. §26.4 names six join routes (email, SMS, organisation code,
-- HR integration, bulk upload, API) and §26.5 names five eligibility
-- dimensions (all employees, departments, locations, job categories,
-- employment status, plus an eligibility window). This part builds the roster
-- to carry all of that, plus the two things §26.17 needs: a departure that
-- ends the employer relationship, and a patient account that survives it.
--
-- ── The one structural decision worth reading before changing anything ─────
-- `profiles.organisation_id` is now DERIVED from the roster, by trigger, not
-- written by any of the join paths directly.
--
-- The reason is `private.guard_profiles_self_update()`, which blocks a person
-- from changing their own `organisation_id` — correctly, since that column is
-- the tenant boundary. An employee accepting an invitation is doing exactly
-- that, from their own session. The wrong fixes are (a) weakening that guard,
-- the single highest-leverage trigger in this schema, or (b) giving each join
-- path its own escape hatch. The right one is the escape hatch the guard
-- already has: it returns early at `pg_trigger_depth() > 1`, i.e. when the
-- write is the platform's own machinery rather than a person editing
-- themselves. So the roster row is the source of truth for "who does this
-- person work for", and one AFTER trigger keeps the profile in step with it.
-- Every join route — phone match at signup, email match at signup, staff
-- "attach now", invitation token, organisation code — therefore re-homes
-- identically, and so does departure, in reverse.
--
-- ── §26.17, and what "the record belongs to the patient" means here ────────
-- On departure the profile goes back to the default consumer organisation.
-- The patient keeps every row of their record: patient-scoped policies read
-- `patient_id = auth.uid()` (see vitals_readings_select and its ~110 peers),
-- not the profile's current org, so nothing they can see today becomes
-- invisible tomorrow. Their historical rows keep the EMPLOYER's
-- organisation_id, which is correct provenance — that care really was
-- delivered under the employer's programme — and the employer still cannot
-- read a row of it, because I9 excludes corporate_admin from
-- private.is_org_staff() entirely. What does change is the employer's
-- denominator: an ex-employee stops counting toward the workforce cohort,
-- which is the point.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- §26.5 "employment status". NYSC and industrial-training placements are
-- listed because they are ordinary categories of Nigerian workforce that an
-- employer will need to include or exclude, not exotica.
create type public.employer_employment_status as enum (
  'full_time', 'part_time', 'contract', 'nysc', 'intern'
);

-- §26.4's six routes. Recorded per roster row so "how did this person get
-- here" survives, which is what makes an activation funnel (§26.8) able to
-- say which route actually works.
create type public.employer_invite_channel as enum (
  'email', 'sms', 'org_code', 'bulk_upload', 'hr_integration', 'api'
);

-- ---------------------------------------------------------------------------
-- The roster, widened
-- ---------------------------------------------------------------------------

alter table public.employer_roster_members
  add column employee_reference text,
  add column email              text,
  add column department_id      uuid references public.employer_departments (id) on delete set null,
  add column location_id        uuid references public.employer_locations (id) on delete set null,
  add column job_category       text,
  add column employment_status  public.employer_employment_status,
  add column eligible_from      date,
  add column eligible_until     date,
  add column invited_at         timestamptz,
  add column invite_channel     public.employer_invite_channel,
  add column departed_at        timestamptz,
  add column departure_reason   text,
  add column updated_at         timestamptz not null default now();

-- §26.4 allows an email-only invitation, so a phone is no longer the only way
-- to identify someone. One of the two is still required — a roster row with
-- neither is a person nobody can ever reach.
alter table public.employer_roster_members alter column phone drop not null;

alter table public.employer_roster_members
  add constraint employer_roster_members_has_a_contact_route
    check (phone is not null or email is not null),
  add constraint employer_roster_members_email_shape
    check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  add constraint employer_roster_members_eligibility_window
    check (eligible_until is null or eligible_from is null or eligible_until >= eligible_from),
  -- 'departed' and departed_at are the same fact; neither may exist alone.
  add constraint employer_roster_members_departed_attribution
    check ((status = 'departed') = (departed_at is not null));

-- The existing (organisation_id, phone) unique index still holds: Postgres
-- treats NULLs as distinct, so email-only rows do not collide with each other.
create unique index employer_roster_members_org_email_idx
  on public.employer_roster_members (organisation_id, lower(trim(email)))
  where email is not null;

create unique index employer_roster_members_org_reference_idx
  on public.employer_roster_members (organisation_id, lower(trim(employee_reference)))
  where employee_reference is not null;

create index employer_roster_members_department_idx on public.employer_roster_members (department_id);
create index employer_roster_members_location_idx   on public.employer_roster_members (location_id);
create index employer_roster_members_claimed_idx    on public.employer_roster_members (claimed_profile_id)
  where claimed_profile_id is not null;

create trigger employer_roster_members_set_updated_at
  before update on public.employer_roster_members
  for each row execute function private.set_updated_at();

comment on column public.employer_roster_members.eligible_until is
  'End of employer-funded eligibility (Module 26 §26.5). Set to the departure date by employer_mark_departed; a null means open-ended, not unknown.';

-- A roster row pointing at another employer's department or site would put one
-- employer's structure into another's dashboard.
create function private.assert_roster_segments_same_org()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if new.department_id is not null then
    select organisation_id into v_org from public.employer_departments where id = new.department_id;
    if v_org is distinct from new.organisation_id then
      raise exception 'employer_roster_members.department_id must belong to the same organisation';
    end if;
  end if;
  if new.location_id is not null then
    select organisation_id into v_org from public.employer_locations where id = new.location_id;
    if v_org is distinct from new.organisation_id then
      raise exception 'employer_roster_members.location_id must belong to the same organisation';
    end if;
  end if;
  return new;
end;
$$;

create trigger employer_roster_members_segments_same_org
  before insert or update of department_id, location_id, organisation_id
  on public.employer_roster_members
  for each row execute function private.assert_roster_segments_same_org();

-- ---------------------------------------------------------------------------
-- The one place profiles.organisation_id follows the roster (see header)
-- ---------------------------------------------------------------------------

create function private.sync_profile_org_from_roster()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_consumer_org constant uuid := '00000000-0000-0000-0000-000000000001';
begin
  if new.claimed_profile_id is null then
    return null;
  end if;

  -- OLD is unassigned in an INSERT trigger, so the two operations are split
  -- rather than guarded by an `or` (SQL boolean operators are not guaranteed
  -- to short-circuit, so `tg_op = 'INSERT' or old.status ...` could still
  -- evaluate the OLD reference and raise).
  if tg_op = 'INSERT' then
    if new.status = 'claimed' then
      -- Never pull someone out of a different real employer/clinic/HMO: only a
      -- person still sitting on the default consumer org is unattached. This
      -- mirrors claim_employer_roster_member's own guard, which exists so a
      -- roster cannot be used to capture someone else's patient.
      update public.profiles
         set organisation_id = new.organisation_id
       where id = new.claimed_profile_id
         and organisation_id = v_consumer_org;
    end if;
    return null;
  end if;

  if new.status = 'claimed'
     and (old.status is distinct from 'claimed'
          or old.claimed_profile_id is distinct from new.claimed_profile_id) then
    update public.profiles
       set organisation_id = new.organisation_id
     where id = new.claimed_profile_id
       and organisation_id = v_consumer_org;

  elsif new.status in ('departed', 'removed') and old.status = 'claimed' then
    -- §26.17. The account and the record stay; only the employer link ends.
    update public.profiles
       set organisation_id = v_consumer_org
     where id = new.claimed_profile_id
       and organisation_id = new.organisation_id;
  end if;

  return null;
end;
$$;

create trigger employer_roster_members_sync_profile_org
  after insert or update of status, claimed_profile_id on public.employer_roster_members
  for each row execute function private.sync_profile_org_from_roster();

-- ---------------------------------------------------------------------------
-- Organisation code (§26.4) — an employer-wide self-serve join key
-- ---------------------------------------------------------------------------

alter table public.employer_accounts
  add column join_code            text unique,
  add column join_code_rotated_at timestamptz,
  add constraint employer_accounts_join_code_shape
    check (join_code is null or join_code ~ '^[A-Z0-9]{8}$');

create function private.generate_employer_join_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- No I/O/O0/1/L: a code gets read off a slide and typed by hand.
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_rand bytea;
  v_code text;
  v_try int := 0;
begin
  loop
    -- gen_random_bytes, not random(): a guessed code attaches a stranger to a
    -- live employer's cohort and (part 3/6) to its funded benefit, so the code
    -- is a credential even though it is short and shared. 31^8 ~ 8.5e11 with a
    -- CSPRNG behind it; the residual modulo bias over 31 symbols is immaterial
    -- at that size.
    v_rand := extensions.gen_random_bytes(8);
    v_code := '';
    for i in 0..7 loop
      v_code := v_code || substr(v_alphabet, 1 + (get_byte(v_rand, i) % length(v_alphabet)), 1);
    end loop;
    exit when not exists (select 1 from public.employer_accounts where join_code = v_code);
    v_try := v_try + 1;
    if v_try > 50 then
      raise exception 'could not allocate a unique join code';
    end if;
  end loop;
  return v_code;
end;
$$;

-- ---------------------------------------------------------------------------
-- employer_invitations (§26.4 email / SMS routes)
--
-- Token handling follows emergency_cards (20260803145146): the raw token is
-- stored, the table is unreachable by anon, and the only way to redeem one is
-- a SECURITY DEFINER function that takes the token as its credential.
-- ---------------------------------------------------------------------------

create table public.employer_invitations (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete cascade,
  roster_member_id    uuid not null references public.employer_roster_members (id) on delete cascade,
  channel             public.employer_invite_channel not null,
  token               text not null unique check (length(token) between 32 and 128),
  -- The address it actually went to, kept so a re-send can be compared
  -- against a since-corrected roster row.
  sent_to             text not null,
  expires_at          timestamptz not null,
  accepted_at         timestamptz,
  accepted_profile_id uuid references public.profiles (id) on delete set null,
  revoked_at          timestamptz,
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  constraint employer_invitations_accept_attribution
    check ((accepted_at is null) = (accepted_profile_id is null)),
  constraint employer_invitations_not_both_accepted_and_revoked
    check (accepted_at is null or revoked_at is null)
);

-- At most one redeemable invitation per person at a time, so a re-send
-- invalidates the old link instead of leaving two live doors open.
create unique index employer_invitations_one_live_per_member
  on public.employer_invitations (roster_member_id)
  where accepted_at is null and revoked_at is null;

create index employer_invitations_org_idx on public.employer_invitations (organisation_id, created_at desc);

comment on table public.employer_invitations is
  'Employer invitation tokens (Module 26 §26.4). Redeemed only through public.employer_accept_invitation(); never readable by anon.';

alter table public.employer_invitations enable row level security;

-- RLS restricts rows; it does not grant table access. A new table needs its
-- own grant (the failure mode is an empty result, not an error).
grant select, insert, update, delete on public.employer_invitations to authenticated;

create policy employer_invitations_select on public.employer_invitations
  for select to authenticated
  using (private.is_org_staff(organisation_id)
         or (private.is_institution_admin() and organisation_id = private.current_org_id()));
create policy employer_invitations_insert on public.employer_invitations
  for insert to authenticated
  with check (private.is_org_staff(organisation_id)
              or (private.is_institution_admin() and organisation_id = private.current_org_id()));
create policy employer_invitations_update on public.employer_invitations
  for update to authenticated
  using (private.is_org_staff(organisation_id)
         or (private.is_institution_admin() and organisation_id = private.current_org_id()))
  with check (private.is_org_staff(organisation_id)
              or (private.is_institution_admin() and organisation_id = private.current_org_id()));
create policy employer_invitations_delete on public.employer_invitations
  for delete to authenticated
  using (private.is_admin());

-- ---------------------------------------------------------------------------
-- Shared authorisation predicate for the employer-side RPCs below
-- ---------------------------------------------------------------------------

create function private.can_manage_employer(p_organisation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_org_staff(p_organisation_id)
      or (private.is_institution_admin() and p_organisation_id = private.current_org_id());
$$;

comment on function private.can_manage_employer(uuid) is
  'HR-surface authorisation: Tarragon staff for the org, or that org''s own institution admin. NOT a PHI grant — I9 keeps corporate_admin out of private.is_org_staff, and nothing here reads a patient-scoped table.';

-- ---------------------------------------------------------------------------
-- §26.4 — issuing an invitation
-- ---------------------------------------------------------------------------

create function public.employer_invite_roster_member(
  p_roster_member_id uuid,
  p_channel text,
  p_expires_in_days integer default 30
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.employer_roster_members;
  v_token  text;
  v_sent_to text;
begin
  select * into v_member from public.employer_roster_members where id = p_roster_member_id;
  if v_member.id is null then
    raise exception 'Roster entry not found';
  end if;
  if not private.can_manage_employer(v_member.organisation_id) then
    raise exception 'Not authorised for this organisation';
  end if;
  if p_channel not in ('email', 'sms') then
    raise exception 'p_channel must be email or sms — the other join routes do not issue a token';
  end if;
  if v_member.status in ('claimed', 'departed', 'removed') then
    raise exception 'Roster entry is % — nothing to invite', v_member.status;
  end if;
  if p_expires_in_days is null or p_expires_in_days < 1 or p_expires_in_days > 90 then
    raise exception 'p_expires_in_days must be between 1 and 90';
  end if;

  v_sent_to := case p_channel when 'email' then v_member.email else v_member.phone end;
  if v_sent_to is null then
    raise exception 'Roster entry has no % address', p_channel;
  end if;

  -- A re-send closes the previous door rather than adding a second one.
  update public.employer_invitations
     set revoked_at = now()
   where roster_member_id = p_roster_member_id
     and accepted_at is null and revoked_at is null;

  v_token := replace(replace(encode(extensions.gen_random_bytes(32), 'base64'), '+', '-'), '/', '_');
  v_token := replace(v_token, '=', '');

  insert into public.employer_invitations
    (organisation_id, roster_member_id, channel, token, sent_to, expires_at, created_by)
  values
    (v_member.organisation_id, p_roster_member_id, p_channel::public.employer_invite_channel,
     v_token, v_sent_to, now() + make_interval(days => p_expires_in_days), (select auth.uid()));

  update public.employer_roster_members
     set status = case when status = 'pending' then 'invited'::public.employer_roster_status else status end,
         invited_at = now(),
         invite_channel = p_channel::public.employer_invite_channel
   where id = p_roster_member_id;

  perform private.log_audit('employer_invitation.issued', 'employer_roster_members', p_roster_member_id,
    jsonb_build_object('channel', p_channel));

  return v_token;
end;
$$;

revoke all on function public.employer_invite_roster_member(uuid, text, integer) from public;
grant execute on function public.employer_invite_roster_member(uuid, text, integer) to authenticated;
revoke execute on function public.employer_invite_roster_member(uuid, text, integer) from anon;

-- ---------------------------------------------------------------------------
-- §26.4 — redeeming one, as the employee
-- ---------------------------------------------------------------------------

create function public.employer_accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_consumer_org constant uuid := '00000000-0000-0000-0000-000000000001';
  v_inv     public.employer_invitations;
  v_actor   uuid := (select auth.uid());
  v_profile public.profiles;
begin
  if v_actor is null then
    raise exception 'Sign in first';
  end if;
  if p_token is null or length(p_token) < 32 then
    raise exception 'Invalid invitation';
  end if;

  select * into v_inv from public.employer_invitations
   where token = p_token and accepted_at is null and revoked_at is null and expires_at > now();
  if v_inv.id is null then
    -- One message for every failure mode: expired, revoked, already used and
    -- never existed must not be distinguishable to whoever is holding a token.
    raise exception 'This invitation is no longer valid';
  end if;

  select * into v_profile from public.profiles where id = v_actor;
  if v_profile.role <> 'patient' then
    raise exception 'Only a patient account can join an employer programme';
  end if;
  if v_profile.organisation_id is distinct from v_consumer_org then
    raise exception 'This account is already attached to an organisation';
  end if;

  -- The roster row is the source of truth; the profile follows by trigger.
  update public.employer_roster_members
     set status = 'claimed', claimed_profile_id = v_actor, claimed_at = now()
   where id = v_inv.roster_member_id;

  update public.employer_invitations
     set accepted_at = now(), accepted_profile_id = v_actor
   where id = v_inv.id;

  perform private.log_audit('employer_invitation.accepted', 'employer_roster_members',
    v_inv.roster_member_id, jsonb_build_object('channel', v_inv.channel));

  return v_inv.organisation_id;
end;
$$;

revoke all on function public.employer_accept_invitation(text) from public;
grant execute on function public.employer_accept_invitation(text) to authenticated;
revoke execute on function public.employer_accept_invitation(text) from anon;

-- ---------------------------------------------------------------------------
-- §26.4 — joining with the organisation code, as the employee
-- ---------------------------------------------------------------------------

create function public.employer_join_with_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_consumer_org constant uuid := '00000000-0000-0000-0000-000000000001';
  v_org     uuid;
  v_actor   uuid := (select auth.uid());
  v_profile public.profiles;
  v_member  uuid;
begin
  if v_actor is null then
    raise exception 'Sign in first';
  end if;

  -- A code only works for an employer that has actually gone live, so a
  -- half-configured account cannot start absorbing staff.
  select ea.organisation_id into v_org
    from public.employer_accounts ea
    join public.organisations o on o.id = ea.organisation_id
   where ea.join_code = upper(trim(coalesce(p_code, '')))
     and ea.went_live_at is not null
     and o.is_active;
  if v_org is null then
    raise exception 'That organisation code is not valid';
  end if;

  select * into v_profile from public.profiles where id = v_actor;
  if v_profile.role <> 'patient' then
    raise exception 'Only a patient account can join an employer programme';
  end if;
  if v_profile.organisation_id is distinct from v_consumer_org then
    raise exception 'This account is already attached to an organisation';
  end if;

  -- Someone the employer already listed keeps their row (and its department,
  -- location and eligibility window); anyone else gets a new one. The lookup
  -- deliberately ignores status: a rehire has a 'departed' row and a
  -- re-add-after-mistake has a 'removed' one, and both carry the same phone,
  -- so filtering to pending/invited here would fall through to the insert and
  -- hit the (organisation_id, phone) unique index instead of reactivating the
  -- row that already exists.
  select id into v_member from public.employer_roster_members
   where organisation_id = v_org
     and ((v_profile.phone is not null and phone = v_profile.phone)
          or lower(trim(email)) = (
                select lower(trim(u.email)) from auth.users u where u.id = v_actor))
   order by created_at
   limit 1;

  if v_member is null then
    insert into public.employer_roster_members
      (organisation_id, phone, email, full_name, status, claimed_profile_id, claimed_at, invite_channel)
    values
      (v_org, v_profile.phone,
       (select u.email from auth.users u where u.id = v_actor),
       v_profile.full_name, 'claimed', v_actor, now(), 'org_code')
    returning id into v_member;
  else
    -- departed_at must be cleared alongside the status, or
    -- employer_roster_members_departed_attribution rejects the rehire.
    update public.employer_roster_members
       set status = 'claimed', claimed_profile_id = v_actor, claimed_at = now(),
           departed_at = null, departure_reason = null,
           eligible_until = case when status = 'departed' then null else eligible_until end,
           invite_channel = coalesce(invite_channel, 'org_code')
     where id = v_member;
  end if;

  perform private.log_audit('employer_roster.joined_with_code', 'employer_roster_members', v_member,
    jsonb_build_object('organisation_id', v_org));

  return v_org;
end;
$$;

revoke all on function public.employer_join_with_code(text) from public;
grant execute on function public.employer_join_with_code(text) to authenticated;
revoke execute on function public.employer_join_with_code(text) from anon;

create function public.employer_rotate_join_code(p_organisation_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
begin
  if not private.can_manage_employer(p_organisation_id) then
    raise exception 'Not authorised for this organisation';
  end if;
  v_code := private.generate_employer_join_code();
  update public.employer_accounts
     set join_code = v_code, join_code_rotated_at = now()
   where organisation_id = p_organisation_id;
  if not found then
    raise exception 'no employer account for organisation %', p_organisation_id;
  end if;
  perform private.log_audit('employer_account.join_code_rotated', 'employer_accounts', p_organisation_id, '{}'::jsonb);
  return v_code;
end;
$$;

revoke all on function public.employer_rotate_join_code(uuid) from public;
grant execute on function public.employer_rotate_join_code(uuid) to authenticated;
revoke execute on function public.employer_rotate_join_code(uuid) from anon;

-- ---------------------------------------------------------------------------
-- §26.4 — bulk upload / HR integration / API, as one server-side upsert
--
-- One RPC rather than a loop of inserts from the app: a 900-row payroll export
-- should either land or not, and the per-row validation (E.164, department
-- names that exist, an eligibility window that makes sense) belongs next to
-- the constraints rather than in whichever caller happens to be sending it.
-- The three channels differ only in what they say they are.
-- ---------------------------------------------------------------------------

create function public.employer_bulk_upsert_roster(
  p_organisation_id uuid,
  p_rows jsonb,
  p_channel text default 'bulk_upload'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_phone text;
  v_email text;
  v_dept uuid;
  v_loc uuid;
  v_existing uuid;
  v_inserted int := 0;
  v_updated  int := 0;
  v_skipped  jsonb := '[]'::jsonb;
  v_i int := 0;
begin
  if not private.can_manage_employer(p_organisation_id) then
    raise exception 'Not authorised for this organisation';
  end if;
  if p_channel not in ('bulk_upload', 'hr_integration', 'api') then
    raise exception 'p_channel must be bulk_upload, hr_integration or api';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'p_rows is limited to 5000 entries per call';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_i := v_i + 1;
    v_phone := nullif(trim(coalesce(v_row ->> 'phone', '')), '');
    v_email := nullif(lower(trim(coalesce(v_row ->> 'email', ''))), '');

    if v_phone is null and v_email is null then
      v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', 'no phone or email');
      continue;
    end if;
    if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then
      v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason', 'phone is not E.164');
      continue;
    end if;

    -- Departments and locations arrive as names, because that is what an HR
    -- export contains. An unknown name is skipped rather than silently
    -- created: inventing an employer's org chart from a typo is worse than
    -- reporting the typo.
    v_dept := null;
    if nullif(trim(coalesce(v_row ->> 'department', '')), '') is not null then
      select id into v_dept from public.employer_departments
       where organisation_id = p_organisation_id
         and lower(trim(name)) = lower(trim(v_row ->> 'department'));
      if v_dept is null then
        v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason',
          'unknown department: ' || (v_row ->> 'department'));
        continue;
      end if;
    end if;

    v_loc := null;
    if nullif(trim(coalesce(v_row ->> 'location', '')), '') is not null then
      select id into v_loc from public.employer_locations
       where organisation_id = p_organisation_id
         and lower(trim(name)) = lower(trim(v_row ->> 'location'));
      if v_loc is null then
        v_skipped := v_skipped || jsonb_build_object('row', v_i, 'reason',
          'unknown location: ' || (v_row ->> 'location'));
        continue;
      end if;
    end if;

    select id into v_existing from public.employer_roster_members
     where organisation_id = p_organisation_id
       and ((v_phone is not null and phone = v_phone)
            or (v_email is not null and lower(trim(email)) = v_email))
     limit 1;

    if v_existing is null then
      insert into public.employer_roster_members
        (organisation_id, phone, email, full_name, employee_reference, department_id, location_id,
         job_category, employment_status, eligible_from, eligible_until, invite_channel, added_by)
      values
        (p_organisation_id, v_phone, v_email,
         nullif(trim(coalesce(v_row ->> 'full_name', '')), ''),
         nullif(trim(coalesce(v_row ->> 'employee_reference', '')), ''),
         v_dept, v_loc,
         nullif(trim(coalesce(v_row ->> 'job_category', '')), ''),
         (nullif(trim(coalesce(v_row ->> 'employment_status', '')), ''))::public.employer_employment_status,
         (nullif(trim(coalesce(v_row ->> 'eligible_from', '')), ''))::date,
         (nullif(trim(coalesce(v_row ->> 'eligible_until', '')), ''))::date,
         p_channel::public.employer_invite_channel,
         (select auth.uid()));
      v_inserted := v_inserted + 1;
    else
      -- A re-upload of the same payroll export is the normal case, so this is
      -- an update, never a duplicate row. Claim state is never touched: a
      -- re-upload must not un-enrol somebody.
      update public.employer_roster_members
         set phone              = coalesce(v_phone, phone),
             email              = coalesce(v_email, email),
             full_name          = coalesce(nullif(trim(coalesce(v_row ->> 'full_name', '')), ''), full_name),
             employee_reference = coalesce(nullif(trim(coalesce(v_row ->> 'employee_reference', '')), ''), employee_reference),
             department_id      = coalesce(v_dept, department_id),
             location_id        = coalesce(v_loc, location_id),
             job_category       = coalesce(nullif(trim(coalesce(v_row ->> 'job_category', '')), ''), job_category),
             employment_status  = coalesce((nullif(trim(coalesce(v_row ->> 'employment_status', '')), ''))::public.employer_employment_status, employment_status),
             eligible_from      = coalesce((nullif(trim(coalesce(v_row ->> 'eligible_from', '')), ''))::date, eligible_from),
             eligible_until     = coalesce((nullif(trim(coalesce(v_row ->> 'eligible_until', '')), ''))::date, eligible_until)
       where id = v_existing;
      v_updated := v_updated + 1;
    end if;
  end loop;

  perform private.log_audit('employer_roster.bulk_upsert', 'organisations', p_organisation_id,
    jsonb_build_object('channel', p_channel, 'inserted', v_inserted, 'updated', v_updated,
                       'skipped', jsonb_array_length(v_skipped)));

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'skipped', v_skipped);
end;
$$;

revoke all on function public.employer_bulk_upsert_roster(uuid, jsonb, text) from public;
grant execute on function public.employer_bulk_upsert_roster(uuid, jsonb, text) to authenticated;
revoke execute on function public.employer_bulk_upsert_roster(uuid, jsonb, text) from anon;

-- ---------------------------------------------------------------------------
-- §26.17 — departure
-- ---------------------------------------------------------------------------

create function public.employer_mark_departed(
  p_roster_member_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.employer_roster_members;
begin
  select * into v_member from public.employer_roster_members where id = p_roster_member_id;
  if v_member.id is null then
    raise exception 'Roster entry not found';
  end if;
  if not private.can_manage_employer(v_member.organisation_id) then
    raise exception 'Not authorised for this organisation';
  end if;
  if v_member.status = 'departed' then
    return;
  end if;

  -- Any unredeemed invitation dies with the employment.
  update public.employer_invitations
     set revoked_at = now()
   where roster_member_id = p_roster_member_id
     and accepted_at is null and revoked_at is null;

  -- The employer link ends here. The profile is returned to the default
  -- consumer organisation by the sync trigger; the person keeps their account
  -- and every row of their record (see the header note). Part 3/6 ends the
  -- employer-funded subscription off the same status change.
  update public.employer_roster_members
     set status = 'departed',
         departed_at = now(),
         departure_reason = p_reason,
         eligible_until = least(coalesce(eligible_until, current_date), current_date)
   where id = p_roster_member_id;

  perform private.log_audit('employer_roster.departed', 'employer_roster_members', p_roster_member_id,
    jsonb_build_object('organisation_id', v_member.organisation_id));
end;
$$;

revoke all on function public.employer_mark_departed(uuid, text) from public;
grant execute on function public.employer_mark_departed(uuid, text) to authenticated;
revoke execute on function public.employer_mark_departed(uuid, text) from anon;

-- ---------------------------------------------------------------------------
-- The two existing claim paths, taught about email and the 'invited' state
-- ---------------------------------------------------------------------------

-- Changes vs 20260805184628: matches on email as well as phone (§26.4's email
-- route), accepts an 'invited' row as claimable (it was only ever 'pending'
-- before this migration existed), and stops writing profiles.organisation_id
-- itself — the sync trigger above owns that now, so every join route re-homes
-- through one code path.
create or replace function public.claim_employer_roster_member(target_roster_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_consumer_org constant uuid := '00000000-0000-0000-0000-000000000001';
  v_roster public.employer_roster_members;
  v_profile_id uuid;
begin
  select * into v_roster from public.employer_roster_members where id = target_roster_id;
  if v_roster.id is null then
    raise exception 'Roster entry not found';
  end if;
  if not private.can_manage_employer(v_roster.organisation_id) then
    raise exception 'Not authorised for this organisation';
  end if;
  if v_roster.status not in ('pending', 'invited') then
    return false;
  end if;

  -- Cross-org lookup is normally blocked (find_profile_by_phone is same-org
  -- only, to keep it from being a phone-number oracle). This stays the one
  -- narrow exception: it matches only someone still on the default consumer
  -- org, so it can never pull a person out of another employer, clinic or HMO.
  select p.id into v_profile_id
    from public.profiles p
   where p.role = 'patient'
     and p.organisation_id = v_consumer_org
     and ((v_roster.phone is not null and p.phone = v_roster.phone)
          or (v_roster.email is not null
              and exists (select 1 from auth.users u
                           where u.id = p.id
                             and lower(trim(u.email)) = lower(trim(v_roster.email)))))
   limit 1;

  if v_profile_id is null then
    return false;
  end if;

  update public.employer_roster_members
     set status = 'claimed', claimed_profile_id = v_profile_id, claimed_at = now()
   where id = target_roster_id;

  return true;
end;
$$;

revoke all on function public.claim_employer_roster_member(uuid) from public;
grant execute on function public.claim_employer_roster_member(uuid) to authenticated;
revoke execute on function public.claim_employer_roster_member(uuid) from anon;

-- Signup-time claim, extended the same way. Ordering matters: a phone match is
-- tried first because it is the identifier the employer is most likely to have
-- typed deliberately; email is the fallback for the §26.4 email route.
-- Everything else about this function is unchanged — it still never overrides
-- an explicit app_metadata organisation_id, and it still writes the profile
-- row itself (there is no roster row to hang a trigger off at INSERT time,
-- and the profile does not exist yet).
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
  v_email text;
  v_org_id uuid;
  v_roster_id uuid;
  v_roster_org_id uuid;
begin
  v_phone := case
    when new.phone is null or new.phone = '' then null
    when new.phone ~ '^\+' then new.phone
    else '+' || new.phone
  end;
  v_email := nullif(lower(trim(coalesce(new.email, ''))), '');

  v_org_id := coalesce(
    (new.raw_app_meta_data ->> 'organisation_id')::uuid,
    '00000000-0000-0000-0000-000000000001'
  );

  -- Only consult the roster when no explicit org came through app_metadata
  -- (i.e. an ordinary self-serve signup, not an admin-provisioned staff or
  -- clinician account already targeted at a specific org).
  if (new.raw_app_meta_data ->> 'organisation_id') is null then
    if v_phone is not null then
      select id, organisation_id into v_roster_id, v_roster_org_id
        from public.employer_roster_members
       where phone = v_phone and status in ('pending', 'invited')
       order by created_at
       limit 1;
    end if;
    if v_roster_id is null and v_email is not null then
      select id, organisation_id into v_roster_id, v_roster_org_id
        from public.employer_roster_members
       where lower(trim(email)) = v_email and status in ('pending', 'invited')
       order by created_at
       limit 1;
    end if;
    if v_roster_id is not null then
      v_org_id := v_roster_org_id;
    end if;
  end if;

  insert into public.profiles (id, role, organisation_id, full_name, phone)
  values (
    new.id,
    coalesce((new.raw_app_meta_data ->> 'role')::public.user_role, 'patient'),
    coalesce(v_org_id, '00000000-0000-0000-0000-000000000001'),
    new.raw_user_meta_data ->> 'full_name',
    v_phone
  );

  if v_roster_id is not null then
    update public.employer_roster_members
       set status = 'claimed', claimed_profile_id = new.id, claimed_at = now()
     where id = v_roster_id;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_n int;
  v_fn text;
begin
  if to_regclass('public.employer_invitations') is null then
    raise exception 'FAIL: employer_invitations missing';
  end if;

  select count(*) into v_n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'employer_invitations' and c.relrowsecurity;
  if v_n <> 1 then raise exception 'FAIL: RLS not enabled on employer_invitations'; end if;

  select count(*) into v_n from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'employer_invitations'
     and grantee = 'authenticated' and privilege_type = 'SELECT';
  if v_n <> 1 then raise exception 'FAIL: employer_invitations has no authenticated SELECT grant'; end if;

  -- Every new employer RPC must be closed to anon. PUBLIC-inherited execute is
  -- the leak, not a direct anon grant.
  foreach v_fn in array array[
    'public.employer_invite_roster_member(uuid, text, integer)',
    'public.employer_accept_invitation(text)',
    'public.employer_join_with_code(text)',
    'public.employer_rotate_join_code(uuid)',
    'public.employer_bulk_upsert_roster(uuid, jsonb, text)',
    'public.employer_mark_departed(uuid, text)',
    'public.claim_employer_roster_member(uuid)'
  ] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then
      raise exception 'FAIL: anon can execute %', v_fn;
    end if;
  end loop;

  -- The roster is still the only thing that moves a profile between orgs.
  if pg_get_functiondef('public.claim_employer_roster_member(uuid)'::regprocedure)
       like '%update public.profiles%' then
    raise exception 'FAIL: claim_employer_roster_member still writes profiles.organisation_id directly';
  end if;

  raise notice 'PASS  roster widened, invitations + join code + bulk upsert + departure, all RPCs closed to anon';
end $$;
