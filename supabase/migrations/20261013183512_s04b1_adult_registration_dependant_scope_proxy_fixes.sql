-- ===========================================================================
-- S04b-1: adult-only registration, under-18 dependants limited to immunisation and preventive tracking,
-- and the proxy fixes OQ-47, OQ-51 and the proxy view log / narrow / revoke controls.
-- Founder decisions 2026-10-13 (docs/research/S01-S05-competitor-gap-and-build-plan.md section 10, R1 to R3).
--
-- Counted first (live koiplnmbgnqnbywhpjlf, 2026-10-13):
--   profiles total 12; profiles with date_of_birth under 18 = 0; date_of_birth null = 6; under-18 profiles with a login = 0;
--   profile_access = 0 rows; proxy_setups = 0 rows; minor_child / elder_proxy dependants = 0.
--   Nothing is deleted or converted by this migration: with zero under-18 rows the age rule and the scope guard are pure
--   structure. The 6 profiles with no date of birth are untouched (onboarding collects it and the new rule applies there).
--
-- Parts
--   A. Adult-only registration: private.enforce_adult_registration() on profiles, and handle_new_user() refuses an
--      under-18 date_of_birth carried in sign-up metadata (and stores a valid one).
--   B. A dependant under 18 can only hold immunisation and preventive-tracking rows. Deny by default: every public table
--      keyed by patient_id (plus four profile_id tables) gets a BEFORE INSERT/UPDATE guard, except the allowed tables
--      (vaccination_*, child_growth_measurements, developmental_screenings, screening_schedules, screening_completions)
--      and the system, rights and safety tables listed below. Protected categories (reproductive, mental health, HIV/STI)
--      are covered because every table that holds them is guarded.
--   C. OQ-47: the blanket dependant read bypass in both private.can_read_clinical overloads now applies to a minor_child
--      only, never to an elder_proxy; and a manage grant over an elder_proxy who has not verified their own phone is
--      limited to payments and alerts (no clinical permission), enforced by trigger.
--   D. OQ-51: one mapping from care category to caregiver permission, written at confirmation, and read by the permission
--      overload, so "share Medicines" really lets the proxy see medicines. Reproductive health maps to nothing.
--   E. Proxy controls: log_proxy_view, my_proxy_view_log (patient scoped, over care_access_events; audit_log_select is not
--      touched), narrow_proxy_access (optional notice to the proxy, off by default), revoke_proxy_access.
--      (set_care_access_categories now keeps permissions in step too, so the two editors agree.)
--   F. Age-18 hand-over with the young person's agreement: dependant_handovers, start/accept/decline/cancel functions,
--      and the dependant.handover_due event 30 days before the 18th birthday (it did not exist).
--
-- Verified live before extending: pg_get_functiondef of private.handle_new_user, both private.can_read_clinical overloads,
-- private.log_care_access and the profile_access lifecycle triggers (2026-10-13). No new overload of a function that is
-- called with an untyped literal is added; the two can_read_clinical bodies are replaced in place with the same signatures.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- A. Adult-only registration
-- ---------------------------------------------------------------------------
create or replace function private.is_minor_dependant(p_profile uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select p.is_dependent_account
       and p.dependent_kind = 'minor_child'
       and (p.date_of_birth is null or p.date_of_birth > (current_date - interval '18 years')::date)
      from public.profiles p
     where p.id = p_profile), false);
$$;
revoke all on function private.is_minor_dependant(uuid) from public, anon, authenticated;

create or replace function private.enforce_adult_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.date_of_birth is not null
     and new.date_of_birth > (current_date - interval '18 years')::date
     and not (coalesce(new.is_dependent_account, false) and new.dependent_kind = 'minor_child') then
    raise exception 'adult_only_registration: registration is for adults aged 18 and over'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_adult_registration() from public, anon;

drop trigger if exists profiles_01_enforce_adult_registration on public.profiles;
create trigger profiles_01_enforce_adult_registration
  before insert or update of date_of_birth, is_dependent_account, dependent_kind on public.profiles
  for each row execute function private.enforce_adult_registration();

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
  v_dob_text text;
  v_dob date;
begin
  v_phone := case
    when new.phone is null or new.phone = '' then null
    when new.phone ~ '^\+' then new.phone
    else '+' || new.phone
  end;
  v_email := nullif(lower(trim(coalesce(new.email, ''))), '');

  -- S04b-1: registration is for adults. A date of birth carried in the sign-up metadata must be a real date and 18 or
  -- more years ago; the same rule is enforced on profiles by private.enforce_adult_registration. A sign-up that carries no
  -- date of birth is still accepted here (staff and dependant records are provisioned without one and the seed and
  -- existing flows depend on that); onboarding then requires it and the profiles trigger applies the rule.
  v_dob_text := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'date_of_birth', '')), '');
  if v_dob_text is not null then
    begin
      v_dob := v_dob_text::date;
    exception when others then
      raise exception 'adult_only_registration: invalid date of birth' using errcode = 'P0001';
    end;
    if v_dob > (current_date - interval '18 years')::date then
      raise exception 'adult_only_registration: registration is for adults aged 18 and over' using errcode = 'P0001';
    end if;
  end if;

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

  insert into public.profiles (id, role, organisation_id, full_name, phone, date_of_birth)
  values (
    new.id,
    coalesce((new.raw_app_meta_data ->> 'role')::public.user_role, 'patient'),
    coalesce(v_org_id, '00000000-0000-0000-0000-000000000001'),
    new.raw_user_meta_data ->> 'full_name',
    v_phone,
    v_dob
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
-- B. Under-18 dependants: immunisation and preventive tracking only (deny by default)
-- ---------------------------------------------------------------------------
create or replace function private.guard_minor_dependant_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject uuid := nullif(to_jsonb(new) ->> tg_argv[0], '')::uuid;
begin
  if v_subject is not null and private.is_minor_dependant(v_subject) then
    raise exception 'minor_dependant_scope: a dependant under 18 can only hold immunisation and preventive tracking records (%)', tg_table_name
      using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_minor_dependant_scope() from public, anon, authenticated;

comment on function private.guard_minor_dependant_scope() is
  'S04b-1: refuses a row about an under-18 dependant in any table that is not on the allowed or exempt list. Installed by the migration on every public table keyed by patient_id (and four profile_id tables).';

-- The registry is a table so the proof (and a reviewer) can read exactly what is allowed and what is exempt.
create table if not exists public.minor_dependant_table_policy (
  table_name text primary key,
  policy     text not null check (policy in ('allowed', 'exempt')),
  reason     text not null
);
alter table public.minor_dependant_table_policy enable row level security;
revoke all on public.minor_dependant_table_policy from anon, authenticated;
grant select on public.minor_dependant_table_policy to authenticated;
create policy minor_dependant_table_policy_select on public.minor_dependant_table_policy
  for select to authenticated using (true);
comment on table public.minor_dependant_table_policy is
  'S04b-1: tables a dependant under 18 may hold rows in (allowed), and system, rights and safety tables the scope guard skips (exempt). Every other table keyed by patient_id is guarded.';

insert into public.minor_dependant_table_policy (table_name, policy, reason) values
  ('vaccination_adverse_events', 'allowed', 'immunisation'),
  ('vaccination_card_extractions', 'allowed', 'immunisation'),
  ('vaccination_schedules', 'allowed', 'immunisation'),
  ('child_growth_measurements', 'allowed', 'preventive tracking: growth'),
  ('developmental_screenings', 'allowed', 'preventive tracking: development'),
  ('screening_schedules', 'allowed', 'preventive tracking: screening reminders'),
  ('screening_completions', 'allowed', 'preventive tracking: screening reminders'),
  ('patient_consents', 'exempt', 'the guardian records consent for the child'),
  ('patient_timeline', 'exempt', 'written by the immunisation and screening triggers'),
  ('patient_feature_views', 'exempt', 'interface bookkeeping'),
  ('patient_notification_preferences', 'exempt', 'settings row'),
  ('dependent_transition_status', 'exempt', 'age 18 transition bookkeeping'),
  ('data_correction_requests', 'exempt', 'data rights: the guardian may ask for a correction'),
  ('data_deletion_requests', 'exempt', 'data rights: the guardian may ask for deletion'),
  ('data_export_requests', 'exempt', 'data rights: the guardian may ask for an export'),
  ('device_data_deletion_requests', 'exempt', 'data rights'),
  ('record_corrections', 'exempt', 'written by the correction capture trigger'),
  ('record_conflicts', 'exempt', 'record integrity'),
  ('superseded_source_values', 'exempt', 'record integrity'),
  ('data_quality_findings', 'exempt', 'record integrity'),
  ('domain_events', 'exempt', 'event bus'),
  ('care_access_events', 'exempt', 'the guardian access log'),
  ('staff_record_opens', 'exempt', 'audit of staff reads'),
  ('safeguarding_concerns', 'exempt', 'safety: a concern about a child must always be recordable'),
  ('clinical_incident_reports', 'exempt', 'safety'),
  ('complaints', 'exempt', 'a guardian may complain'),
  ('provider_complaints', 'exempt', 'a guardian may complain'),
  ('support_tickets', 'exempt', 'a guardian may ask for help'),
  ('emergency_events', 'exempt', 'safety: an emergency must always be recordable'),
  ('clinician_alerts', 'exempt', 'raised by the growth, development and adverse-event triggers for allowed rows'),
  ('wellness_points_ledger', 'exempt', 'written by the immunisation and screening reward triggers'),
  ('wellness_points_balances', 'exempt', 'written by the immunisation and screening reward triggers'),
  ('patient_milestones', 'exempt', 'written by the immunisation and screening reward triggers'),
  ('patient_wellness_badges', 'exempt', 'written by the immunisation and screening reward triggers'),
  ('profile_cohorts', 'exempt', 'cohort bookkeeping'),
  ('cohort_join_attempts', 'exempt', 'cohort bookkeeping'),
  ('lead_assignments', 'exempt', 'marketing bookkeeping')
on conflict (table_name) do nothing;

do $$
declare
  r record;
  v_n integer := 0;
begin
  for r in
    select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t
        on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public'
       and (c.column_name = 'patient_id'
            or (c.column_name = 'profile_id'
                and c.table_name in ('booking_requests', 'risk_assessment_responses', 'prevention_risk_scores', 'ai_conversations')))
       and not exists (select 1 from public.minor_dependant_table_policy p where p.table_name = c.table_name)
  loop
    execute format('drop trigger if exists "00_minor_dependant_scope" on public.%I', r.table_name);
    execute format(
      'create trigger "00_minor_dependant_scope" before insert or update of %I on public.%I
         for each row execute function private.guard_minor_dependant_scope(%L)',
      r.column_name, r.table_name, r.column_name);
    v_n := v_n + 1;
  end loop;
  raise notice 'S04b-1: minor dependant scope guard installed on % tables', v_n;
end $$;

-- ---------------------------------------------------------------------------
-- D. One mapping from care category to caregiver permission (OQ-51)
-- ---------------------------------------------------------------------------
create or replace function private.category_permissions(p_category public.care_access_category)
returns public.caregiver_permission[]
language sql
immutable
set search_path = ''
as $$
  select case p_category
    when 'appointments_care_plan' then array['view_appointments', 'view_care_plan']::public.caregiver_permission[]
    when 'medications'            then array['view_medication']::public.caregiver_permission[]
    when 'labs_results'           then array['view_results']::public.caregiver_permission[]
    when 'messaging'              then array['communicate_with_care_team']::public.caregiver_permission[]
    else array[]::public.caregiver_permission[]  -- vitals, vaccinations, medical history: no permission-gated table;
                                                  -- reproductive_health: never maps to anything
  end;
$$;

create or replace function private.permissions_for_categories(p_categories public.care_access_category[])
returns public.caregiver_permission[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct perm order by perm), array[]::public.caregiver_permission[])
    from unnest(coalesce(p_categories, array[]::public.care_access_category[])) c,
         lateral unnest(private.category_permissions(c)) perm;
$$;

-- Keeps the permissions array in step with the categories without touching permissions no category maps to
-- (manage_payments, receive_alerts, book_appointments...): drops the mapped ones and adds exactly what the categories
-- give. NULL (unrestricted) stays NULL.
create or replace function private.sync_permissions_with_categories(
  p_old public.caregiver_permission[],
  p_categories public.care_access_category[])
returns public.caregiver_permission[]
language sql
stable
set search_path = ''
as $$
  select case when p_old is null then null else (
    select coalesce(array_agg(distinct x order by x), array[]::public.caregiver_permission[])
      from (
        select unnest(p_old) as x
        except
        select unnest(private.permissions_for_categories(enum_range(null::public.care_access_category)))
        union
        select unnest(private.permissions_for_categories(p_categories))
      ) u
  ) end;
$$;

-- ---------------------------------------------------------------------------
-- C. OQ-47 and OQ-51: the two can_read_clinical bodies, replaced in place (same signatures)
-- ---------------------------------------------------------------------------
create or replace function private.can_read_clinical(p_patient uuid, p_category public.care_access_category)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profile_access pa join public.profiles p on p.id = pa.profile_id
    where pa.profile_id = p_patient
      and pa.grantee_user_id = (select auth.uid())
      and (pa.expires_at is null or pa.expires_at > now())
      and (
        -- The blanket bypass stands in for a child who cannot be asked. It never applies to an adult (elder_proxy):
        -- an adult's proxy sees only the categories that adult chose (S04b-1, OQ-47).
        (pa.permission_level = 'manage' and p.is_dependent_account and p.dependent_kind = 'minor_child'
         -- Under 18 every category stands in for a child who cannot be asked. From 18, before the hand-over is accepted,
         -- only the immunisation and growth categories do: nothing an adult later records is readable by the guardian.
         and (private.is_minor_dependant(p.id) or p_category in ('vaccinations', 'medical_history')))
        or exists (
          select 1 from public.profile_access_categories pac
          where pac.profile_access_id = pa.id and pac.category = p_category
        )
      )
  );
$$;

create or replace function private.can_read_clinical(p_patient uuid, p_permission public.caregiver_permission)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profile_access pa
    join public.profiles p on p.id = pa.profile_id
    where pa.profile_id = p_patient
      and pa.grantee_user_id = (select auth.uid())
      and (pa.expires_at is null or pa.expires_at > now())
      and (pa.permissions is null or p_permission = any(pa.permissions))
      and (
        pa.clinical_access
        or (pa.permission_level = 'manage' and p.is_dependent_account and p.dependent_kind = 'minor_child'
            and private.is_minor_dependant(p.id))
        -- S04b-1 (OQ-51): a category the person chose carries the permissions that category maps to. The permissions
        -- array above still has to include the permission, so this can only ever grant what both models agree on.
        or exists (
          select 1 from public.profile_access_categories pac
          where pac.profile_access_id = pa.id
            and p_permission = any(private.category_permissions(pac.category))
        )
      )
  );
$$;

-- OQ-47: a manage grant over an elder_proxy who has not verified their own phone cannot carry clinical permissions.
create or replace function private.guard_elder_proxy_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind public.dependent_kind;
  v_dep boolean;
  v_verified boolean;
begin
  select p.dependent_kind, p.is_dependent_account into v_kind, v_dep
    from public.profiles p where p.id = new.profile_id;
  if v_dep and v_kind = 'elder_proxy' then
    select (u.phone_confirmed_at is not null) into v_verified from auth.users u where u.id = new.profile_id;
    if not coalesce(v_verified, false) then
      if new.permissions is null
         or not (new.permissions <@ array['manage_payments', 'receive_alerts']::public.caregiver_permission[]) then
        raise exception 'elder_agreement_required: an adult must agree before anyone manages their care; only payments and alerts can be granted until they do'
          using errcode = '42501';
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_elder_proxy_grant() from public, anon;

drop trigger if exists profile_access_guard_elder_proxy on public.profile_access;
create trigger profile_access_guard_elder_proxy
  before insert or update of permission_level, permissions on public.profile_access
  for each row execute function private.guard_elder_proxy_grant();

-- OQ-51: confirm_proxy_setup now writes the permissions the chosen categories map to (the p_permissions argument is kept
-- for callers but no longer trusted: permissions come only from the categories the parent ticked).
create or replace function public.confirm_proxy_setup(
  p_setup_id uuid,
  p_categories public.care_access_category[],
  p_permissions public.caregiver_permission[] default '{}')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_setup public.proxy_setups;
  v_phone text;
  v_confirmed timestamptz;
  v_grant uuid;
  v_perms public.caregiver_permission[] := private.permissions_for_categories(p_categories);
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  select * into v_setup from public.proxy_setups where id = p_setup_id for update;
  select phone, phone_confirmed_at into v_phone, v_confirmed from auth.users where id = v_uid;

  -- One answer for every reason this cannot proceed (no such setup, someone else's number, unverified phone,
  -- already answered, expired): the caller learns nothing about which.
  if v_setup.id is null
     or v_confirmed is null
     or regexp_replace(coalesce(v_phone, ''), '\D', '', 'g') <> regexp_replace(v_setup.target_phone_e164, '\D', '', 'g')
     or v_setup.state <> 'pending_confirmation'
     or v_setup.expires_at <= now()
     or v_setup.created_by_profile_id = v_uid then
    raise exception 'this setup cannot be confirmed' using errcode = '42501';
  end if;

  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, permissions)
  values (v_uid, v_setup.created_by_profile_id, 'view', v_uid, v_perms)
  on conflict (profile_id, grantee_user_id)
  do update set permissions = private.sync_permissions_with_categories(
                  coalesce(public.profile_access.permissions, enum_range(null::public.caregiver_permission)), p_categories),
                updated_at = now()
  returning id into v_grant;

  delete from public.profile_access_categories
   where profile_access_id = v_grant
     and category <> all (coalesce(p_categories, array[]::public.care_access_category[]));
  insert into public.profile_access_categories (profile_access_id, category)
  select v_grant, c from unnest(coalesce(p_categories, array[]::public.care_access_category[])) as c
  on conflict (profile_access_id, category) do nothing;

  update public.proxy_setups
     set state = 'confirmed', confirmed_at = now(), confirmed_profile_id = v_uid
   where id = v_setup.id;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result, subject_patient_id)
  values (v_setup.organisation_id, v_uid, 'proxy_setup.confirmed', 'proxy_setup', v_setup.id,
          jsonb_build_object('category_count', cardinality(coalesce(p_categories, array[]::public.care_access_category[]))),
          'success', v_uid);
  return v_grant;
end;
$$;
revoke all on function public.confirm_proxy_setup(uuid, public.care_access_category[], public.caregiver_permission[]) from public, anon;
grant execute on function public.confirm_proxy_setup(uuid, public.care_access_category[], public.caregiver_permission[]) to authenticated;

-- The existing category editor (CareVisibilityList) must agree with the proxy flow: when the person adds or removes a
-- category the permissions that category maps to follow it (OQ-51). Body verified live 2026-10-13.
create or replace function public.set_care_access_categories(p_grant_id uuid, p_categories public.care_access_category[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  select profile_id into v_owner from public.profile_access where id = p_grant_id;
  if v_owner is null then
    raise exception 'grant not found';
  end if;
  if v_owner <> (select auth.uid()) then
    raise exception
      'only the person whose record it is may change who can see their health information'
      using errcode = '42501';
  end if;

  delete from public.profile_access_categories
    where profile_access_id = p_grant_id
      and category <> all (coalesce(p_categories, array[]::public.care_access_category[]));

  insert into public.profile_access_categories (profile_access_id, category)
  select p_grant_id, c
  from unnest(coalesce(p_categories, array[]::public.care_access_category[])) as c
  on conflict (profile_access_id, category) do nothing;

  update public.profile_access
     set permissions = private.sync_permissions_with_categories(permissions, coalesce(p_categories, array[]::public.care_access_category[]))
   where id = p_grant_id
     and permissions is distinct from private.sync_permissions_with_categories(permissions, coalesce(p_categories, array[]::public.care_access_category[]));
end;
$$;

-- ---------------------------------------------------------------------------
-- E. Proxy controls: view log, narrow (silent by default), revoke
-- ---------------------------------------------------------------------------
alter table public.care_access_events drop constraint care_access_events_scope_known;
alter table public.care_access_events
  add constraint care_access_events_scope_known check (
    scope is null or scope in (
      'care_receipt', 'health_summary', 'care_status', 'billing', 'refill_request', 'booking', 'messaging',
      'data_shared_lab', 'data_shared_hmo', 'data_shared_ai_vendor', 'data_shared_pharmacy', 'data_export_dsar',
      'care_circle',
      'proxy_record'   -- S04b-1: a proxy opened the person's record
    )
  );

-- A proxy opening the record is logged for the person it is about. Only someone who holds a grant can write the row,
-- and the same person opening it again within ten minutes is one line, not a flood.
create or replace function public.log_proxy_view(p_patient uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or p_patient is null or v_uid = p_patient then
    return;
  end if;
  if not exists (
    select 1 from public.profile_access pa
     where pa.profile_id = p_patient and pa.grantee_user_id = v_uid
       and (pa.expires_at is null or pa.expires_at > now())
  ) then
    return;
  end if;
  if exists (
    select 1 from public.care_access_events e
     where e.patient_id = p_patient and e.actor_profile_id = v_uid
       and e.kind = 'record_viewed' and e.scope = 'proxy_record'
       and e.occurred_at > now() - interval '10 minutes'
  ) then
    return;
  end if;
  perform private.log_care_access(p_patient, 'record_viewed', 'proxy_record', '{}'::jsonb, v_uid);
end;
$$;

-- What the person sees: who opened or acted on their record and when. Patient scoped by construction (the caller's own
-- id); it reads care_access_events, the append-only delegated-access log, and never audit_log.
create or replace function public.my_proxy_view_log(p_limit integer default 50)
returns table (id uuid, occurred_at timestamptz, actor_first_name text, kind text, scope text)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.occurred_at, nullif(split_part(btrim(coalesce(a.full_name, '')), ' ', 1), ''), e.kind::text, e.scope
    from public.care_access_events e
    left join public.profiles a on a.id = e.actor_profile_id
   where e.patient_id = (select auth.uid())
     and e.actor_profile_id is not null
     and e.actor_profile_id <> e.patient_id
     and e.kind in ('record_viewed', 'acted_for', 'receipt_generated', 'data_exported')
   order by e.occurred_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

-- Narrow only: keeps the intersection of what the proxy has and what is passed, and the permissions those categories map
-- to. It can never add access. The proxy is told only when p_notify is true (default false).
create or replace function public.narrow_proxy_access(
  p_grantee uuid,
  p_categories public.care_access_category[],
  p_notify boolean default false)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_grant public.profile_access;
  v_left  public.care_access_category[];
  v_org   uuid;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  select * into v_grant from public.profile_access
   where profile_id = v_uid and grantee_user_id = p_grantee for update;
  if v_grant.id is null then
    raise exception 'no such access' using errcode = '42501';
  end if;

  delete from public.profile_access_categories
   where profile_access_id = v_grant.id
     and category <> all (coalesce(p_categories, array[]::public.care_access_category[]));

  select coalesce(array_agg(category), array[]::public.care_access_category[]) into v_left
    from public.profile_access_categories where profile_access_id = v_grant.id;

  -- Only ever fewer permissions: the mapped ones follow the categories that are left, everything else (payments, alerts)
  -- is untouched, and nothing is added that the proxy did not already hold.
  update public.profile_access
     set permissions = (
           select coalesce(array_agg(x), array[]::public.caregiver_permission[])
             from unnest(private.sync_permissions_with_categories(
                    coalesce(v_grant.permissions, enum_range(null::public.caregiver_permission)), v_left)) x
            where v_grant.permissions is null or x = any(v_grant.permissions)),
         updated_at = now()
   where id = v_grant.id;

  if coalesce(p_notify, false) then
    select organisation_id into v_org from public.profiles where id = v_uid;
    insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class)
    values (p_grantee, v_org, 'in_app', 'proxy_access_changed',
            jsonb_build_object('message', 'What you can see for someone you help has changed. Open Your people to check.'),
            'pending', 'non_clinical');
  end if;
  return cardinality(v_left);
end;
$$;

-- Instant revoke: the person ends a proxy's access at once. Nothing is sent to the proxy.
create or replace function public.revoke_proxy_access(p_grantee uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  n integer;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  delete from public.profile_access where profile_id = v_uid and grantee_user_id = p_grantee;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- ---------------------------------------------------------------------------
-- F. Age-18 hand-over with the young person's agreement (R3)
-- ---------------------------------------------------------------------------
create table public.dependant_handovers (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  dependent_id    uuid not null references public.profiles (id) on delete cascade,
  started_by      uuid not null references public.profiles (id) on delete cascade,
  target_phone_e164 text not null check (target_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  state           text not null default 'pending' check (state in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  expires_at      timestamptz not null,
  decided_at      timestamptz,
  created_at      timestamptz not null default now()
);
create unique index dependant_handovers_one_pending on public.dependant_handovers (dependent_id) where state = 'pending';
alter table public.dependant_handovers enable row level security;
create policy dependant_handovers_select on public.dependant_handovers
  for select to authenticated using (started_by = (select auth.uid()) or dependent_id = (select auth.uid()));
revoke all on public.dependant_handovers from anon, authenticated;
grant select on public.dependant_handovers to authenticated;
comment on table public.dependant_handovers is
  'S04b-1: a guardian starts the hand-over of a record to the young person who has turned 18; nothing changes until that person, signed in on their own verified number, accepts. Writes only through the functions below.';

-- A number the guardian typed is attached to the record's login UNCONFIRMED so the person can sign in with a code. If the
-- hand-over ends without that number ever being verified (cancelled, declined, expired, replaced) it is removed again, so a
-- mistyped number cannot be used to sign in later. A number that WAS verified belongs to someone who proved they hold it
-- and is left alone.
create or replace function private.close_pending_handovers(p_dependent uuid, p_state text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    update public.dependant_handovers
       set state = case when expires_at <= now() then 'expired' else p_state end, decided_at = now()
     where dependent_id = p_dependent and state = 'pending'
    returning target_phone_e164
  loop
    update auth.users
       set phone = null
     where id = p_dependent and phone_confirmed_at is null
       and regexp_replace(coalesce(phone, ''), '\D', '', 'g') = regexp_replace(r.target_phone_e164, '\D', '', 'g');
  end loop;
end;
$$;
revoke all on function private.close_pending_handovers(uuid, text) from public, anon, authenticated;

create or replace function public.start_dependant_handover(p_dependent uuid, p_phone text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_p   public.profiles;
  v_id  uuid;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'phone must be E.164' using errcode = '22023';
  end if;
  select * into v_p from public.profiles where id = p_dependent;
  if v_p.id is null
     or not v_p.is_dependent_account or v_p.dependent_kind is null
     or v_p.date_of_birth is null or v_p.date_of_birth > (current_date - interval '18 years')::date
     -- Only the person who created the record (the guardian or sponsor who granted themselves access) can start the
     -- hand-over: a payments-only or view-only grantee cannot, and the level may already have stepped down at 18.
     or not exists (select 1 from public.profile_access pa
                     where pa.profile_id = p_dependent and pa.grantee_user_id = v_uid and pa.granted_by = v_uid) then
    raise exception 'this record cannot be handed over' using errcode = '42501';
  end if;

  perform private.close_pending_handovers(p_dependent, 'cancelled');

  insert into public.dependant_handovers (organisation_id, dependent_id, started_by, target_phone_e164, expires_at)
  values (v_p.organisation_id, p_dependent, v_uid, p_phone, now() + interval '30 days')
  returning id into v_id;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result, subject_patient_id)
  values (v_p.organisation_id, v_uid, 'dependant_handover.started', 'dependant_handover', v_id, '{}'::jsonb, 'success', p_dependent);
  return v_id;
end;
$$;

create or replace function public.cancel_dependant_handover(p_dependent uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.dependant_handovers
              where dependent_id = p_dependent and state = 'pending' and started_by = (select auth.uid())) then
    perform private.close_pending_handovers(p_dependent, 'cancelled');
  end if;
end;
$$;

-- What the young person sees once signed in on their own number: the guardian's first name and the date.
create or replace function public.my_pending_handover()
returns table (id uuid, guardian_first_name text, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select h.id, nullif(split_part(btrim(coalesce(g.full_name, '')), ' ', 1), ''), h.expires_at
    from public.dependant_handovers h
    join public.profiles g on g.id = h.started_by
    join public.profiles me on me.id = h.dependent_id
    join auth.users u on u.id = h.dependent_id
   where h.dependent_id = (select auth.uid())
     and h.state = 'pending' and h.expires_at > now()
     and u.phone_confirmed_at is not null
     and regexp_replace(coalesce(u.phone, ''), '\D', '', 'g') = regexp_replace(h.target_phone_e164, '\D', '', 'g')
     and me.date_of_birth <= (current_date - interval '18 years')::date;
$$;

-- The young person agrees. Only now does the record stop being a dependant record.
create or replace function public.accept_dependant_handover(p_handover uuid, p_date_of_birth date)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_h   public.dependant_handovers;
  v_phone text;
  v_confirmed timestamptz;
begin
  if v_uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  select * into v_h from public.dependant_handovers where id = p_handover for update;
  select phone, phone_confirmed_at into v_phone, v_confirmed from auth.users where id = v_uid;
  if v_h.id is null
     or v_h.dependent_id <> v_uid
     or v_h.state <> 'pending' or v_h.expires_at <= now()
     or v_confirmed is null
     or regexp_replace(coalesce(v_phone, ''), '\D', '', 'g') <> regexp_replace(v_h.target_phone_e164, '\D', '', 'g')
     or not exists (select 1 from public.profiles p where p.id = v_uid and p.is_dependent_account and p.dependent_kind is not null
                    and p.date_of_birth <= (current_date - interval '18 years')::date) then
    raise exception 'this hand-over cannot be accepted' using errcode = '42501';
  end if;

  -- A second factor only the real person (or their guardian) knows: the number alone is whatever the guardian typed, so a
  -- wrong number must not be enough to take over a record. Five wrong answers close the hand-over.
  -- Counted per person over 24 hours (not per hand-over), so a guardian restarting the hand-over does not hand out five
  -- more guesses.
  if (select count(*) from public.audit_log
       where action = 'dependant_handover.wrong_dob' and subject_patient_id = v_uid
         and created_at > now() - interval '24 hours') >= 5 then
    perform private.close_pending_handovers(v_uid, 'cancelled');
    return false;
  end if;
  if p_date_of_birth is distinct from (select date_of_birth from public.profiles where id = v_uid) then
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result, subject_patient_id)
    values (v_h.organisation_id, v_uid, 'dependant_handover.wrong_dob', 'dependant_handover', v_h.id, '{}'::jsonb, 'denied', v_uid);
    if (select count(*) from public.audit_log
         where action = 'dependant_handover.wrong_dob' and subject_patient_id = v_uid
           and created_at > now() - interval '24 hours') >= 5 then
      perform private.close_pending_handovers(v_uid, 'cancelled');
    end if;
    return false;
  end if;

  -- The state change fires private.apply_dependant_handover (below), which does the profile change at trigger depth 2 so
  -- that private.guard_profiles_self_update, which stops an owner editing is_dependent_account directly, lets exactly this
  -- one sanctioned path through.
  update public.dependant_handovers set state = 'accepted', decided_at = now() where id = v_h.id;
  return true;
end;
$$;

create or replace function private.apply_dependant_handover()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
begin
  select phone into v_phone from auth.users where id = new.dependent_id;
  update public.profiles
     set phone = '+' || regexp_replace(coalesce(v_phone, ''), '\D', '', 'g'), is_dependent_account = false, dependent_kind = null
   where id = new.dependent_id;
  insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class)
  values (new.started_by, new.organisation_id, 'in_app', 'dependant_handover_accepted',
          jsonb_build_object('message', 'The record you kept is now their own. They agreed to take it over.', 'dependent_id', new.dependent_id),
          'pending', 'non_clinical');
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result, subject_patient_id)
  values (new.organisation_id, new.dependent_id, 'dependant_handover.accepted', 'dependant_handover', new.id, '{}'::jsonb, 'success', new.dependent_id);
  return null;
end;
$$;
revoke all on function private.apply_dependant_handover() from public, anon;
create trigger dependant_handovers_apply_accept
  after update of state on public.dependant_handovers
  for each row when (old.state = 'pending' and new.state = 'accepted')
  execute function private.apply_dependant_handover();

create or replace function public.decline_dependant_handover(p_handover uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.dependant_handovers
              where id = p_handover and dependent_id = (select auth.uid()) and state = 'pending') then
    perform private.close_pending_handovers((select auth.uid()), 'declined');
  end if;
end;
$$;

-- Daily: a hand-over nobody answered in 30 days closes and its unverified number is removed.
create or replace function private.expire_dependant_handovers()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in select distinct dependent_id from public.dependant_handovers where state = 'pending' and expires_at <= now() loop
    perform private.close_pending_handovers(r.dependent_id, 'expired');
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function private.expire_dependant_handovers() from public, anon, authenticated;
select cron.schedule('dependant-handover-expiry-daily', '40 3 * * *', $$ select private.expire_dependant_handovers(); $$);

-- dependant.handover_due: 30 days before the 18th birthday, once per birthday.
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('dependant.handover_due', 'A dependant turns 18 within 30 days; the guardian is asked to start the hand-over', 'S04b', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys) values
  ('dependant.handover_due', 1, array['dependent_id', 'turns_18_on'])
on conflict do nothing;

create or replace function private.sweep_dependant_handover_due()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  g record;
  n integer := 0;
  v_message text;
begin
  for r in
    select p.id, p.full_name, p.organisation_id, (p.date_of_birth + interval '18 years')::date as turns_18_on
      from public.profiles p
     where p.is_dependent_account and p.dependent_kind = 'minor_child'
       and p.date_of_birth is not null
       and (p.date_of_birth + interval '18 years')::date between current_date and current_date + 30
  loop
    if exists (select 1 from public.domain_events e
                where e.event_type = 'dependant.handover_due' and e.idempotency_key = 'handover_due:' || r.id || ':' || r.turns_18_on) then
      continue;
    end if;
    perform private.emit_domain_event(
      'dependant.handover_due', r.organisation_id,
      jsonb_build_object('dependent_id', r.id, 'turns_18_on', r.turns_18_on),
      'handover_due:' || r.id || ':' || r.turns_18_on, r.id, 'profile', r.id);
    v_message := format(
      '%s turns 18 on %s. At 18 they sign up with their own number and agree before their record is handed over. Until then it stays with you.',
      coalesce(nullif(split_part(btrim(coalesce(r.full_name, '')), ' ', 1), ''), 'The child you added'),
      to_char(r.turns_18_on, 'DD Mon YYYY'));
    for g in select pa.grantee_user_id from public.profile_access pa
              where pa.profile_id = r.id and pa.granted_by = pa.grantee_user_id loop
      insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class)
      values (g.grantee_user_id, r.organisation_id, 'in_app', 'dependant_handover_due',
              jsonb_build_object('message', v_message, 'dependent_id', r.id), 'pending', 'non_clinical');
    end loop;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function private.sweep_dependant_handover_due() from public, anon, authenticated;

select cron.schedule('dependant-handover-due-daily', '20 7 * * *', $$ select private.sweep_dependant_handover_due(); $$);

-- ---------------------------------------------------------------------------
-- Grants: explicit, because both default ACLs hand EXECUTE out (PUBLIC on public.*).
-- ---------------------------------------------------------------------------
revoke all on function public.log_proxy_view(uuid) from public, anon;
revoke all on function public.my_proxy_view_log(integer) from public, anon;
revoke all on function public.narrow_proxy_access(uuid, public.care_access_category[], boolean) from public, anon;
revoke all on function public.revoke_proxy_access(uuid) from public, anon;
revoke all on function public.start_dependant_handover(uuid, text) from public, anon;
revoke all on function public.cancel_dependant_handover(uuid) from public, anon;
revoke all on function public.my_pending_handover() from public, anon;
revoke all on function public.accept_dependant_handover(uuid, date) from public, anon;
revoke all on function public.decline_dependant_handover(uuid) from public, anon;
grant execute on function public.log_proxy_view(uuid) to authenticated;
grant execute on function public.my_proxy_view_log(integer) to authenticated;
grant execute on function public.narrow_proxy_access(uuid, public.care_access_category[], boolean) to authenticated;
grant execute on function public.revoke_proxy_access(uuid) to authenticated;
grant execute on function public.start_dependant_handover(uuid, text) to authenticated;
grant execute on function public.cancel_dependant_handover(uuid) to authenticated;
grant execute on function public.my_pending_handover() to authenticated;
grant execute on function public.accept_dependant_handover(uuid, date) to authenticated;
grant execute on function public.decline_dependant_handover(uuid) to authenticated;

-- Proof, not hope.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.log_proxy_view(uuid)', 'public.my_proxy_view_log(integer)',
    'public.narrow_proxy_access(uuid, public.care_access_category[], boolean)', 'public.revoke_proxy_access(uuid)',
    'public.start_dependant_handover(uuid, text)', 'public.cancel_dependant_handover(uuid)', 'public.my_pending_handover()',
    'public.accept_dependant_handover(uuid, date)', 'public.decline_dependant_handover(uuid)',
    'public.confirm_proxy_setup(uuid, public.care_access_category[], public.caregiver_permission[])'] loop
    if has_function_privilege('anon', f, 'EXECUTE') then
      raise exception 'S04b-1: anon can execute %', f;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'private.expire_dependant_handovers()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.close_pending_handovers(uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.sweep_dependant_handover_due()', 'EXECUTE')
     or has_function_privilege('anon', 'private.sweep_dependant_handover_due()', 'EXECUTE') then
    raise exception 'S04b-1: the hand-over sweep is callable by an API role';
  end if;
  if has_table_privilege('anon', 'public.dependant_handovers', 'SELECT') then
    raise exception 'S04b-1: anon can read dependant_handovers';
  end if;
  if exists (select 1 from public.profiles where date_of_birth > (current_date - interval '18 years')::date
              and not (is_dependent_account and dependent_kind = 'minor_child')) then
    raise exception 'S04b-1: an under-18 non-dependant profile exists';
  end if;
end $$;
