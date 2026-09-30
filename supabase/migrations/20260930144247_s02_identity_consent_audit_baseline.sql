-- S02 (v5 identity, access and consent baseline), part 2 of 2. Decisions applied: OQ-03, OQ-04, OQ-09, OQ-18, OQ-25.
-- Design and reconciliation map: docs/design/S02.md.
--
-- Counted first (live, 2026-09-30): 2 auth users with an @tarragon.test address, 6 patients, 15 patient_consents rows,
-- 0 emergency_record_access_grants, audit_log append-only by row triggers only (TRUNCATE still granted to
-- service_role and postgres), no is_test column anywhere, no proxy_setups table.
--
-- What this adds (only the gaps; everything else v5 4.1/4.2 asks for already exists under a live name):
--   1. is_test on profiles and clinical_staff (INV-13), self-edit proof, backfill by @tarragon.test.
--   2. profiles.discreet_mode, profiles.low_data_mode (v5 patients fields).
--   3. consent_versions.text_key (i18n key) and the v5-shaped read view patient_consent_state.
--   4. proxy_setups (v5 4.1, section 8.2).
--   5. audit_log: subject_patient_id, ip, TRUNCATE closed (OQ-25).
--   6. The audited-read pattern (INV-10): private.audit_patient_read plus three public audited RPCs
--      (search_patients_audited, open_patient_identity_audited, read_patient_consents_audited), and patient_consents
--      direct SELECT narrowed to the patient herself.
--
-- Deliberately NOT here: no app_config (OQ-18: platform_modules and per-domain versioned tables), no change to
-- private.is_org_staff or any role, no scribe_consents (no source-of-truth encounters table until S21), no partners /
-- partner_users / dependants tables (live equivalents are sufficient, see the design note).

-- ---------------------------------------------------------------------------
-- 1. is_test (INV-13)
-- ---------------------------------------------------------------------------
alter table public.profiles       add column if not exists is_test boolean not null default false;
alter table public.clinical_staff add column if not exists is_test boolean not null default false;

comment on column public.profiles.is_test is
  'INV-13: true for test accounts. Excluded from every metric and payout. Set only by an admin or a service/migration '
  'context (guard_is_test_flag); never self-editable. Convention for metric/payout views: join public.profiles and filter `not p.is_test`.';
comment on column public.clinical_staff.is_test is
  'INV-13: true for test clinicians. Excluded from every metric and payout. Same write guard as profiles.is_test.';

create or replace function private.guard_is_test_flag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- auth.uid() is null for service_role, the migration connection and pg_cron: those may set the flag.
  if (select auth.uid()) is null or private.is_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.is_test then
      raise exception '%.is_test can only be set by an admin or a service context', tg_table_name using errcode = '42501';
    end if;
  elsif new.is_test is distinct from old.is_test then
    raise exception '%.is_test can only be changed by an admin or a service context', tg_table_name using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_is_test_flag() from public;

drop trigger if exists profiles_guard_is_test on public.profiles;
create trigger profiles_guard_is_test
  before insert or update of is_test on public.profiles
  for each row execute function private.guard_is_test_flag();

drop trigger if exists clinical_staff_guard_is_test on public.clinical_staff;
create trigger clinical_staff_guard_is_test
  before insert or update of is_test on public.clinical_staff
  for each row execute function private.guard_is_test_flag();

update public.profiles p set is_test = true
  where p.id in (select u.id from auth.users u where u.email ilike '%@tarragon.test') and not p.is_test;
update public.clinical_staff cs set is_test = true
  where cs.profile_id in (select p.id from public.profiles p where p.is_test) and not cs.is_test;

-- ---------------------------------------------------------------------------
-- 2. Patient preference flags (v5 patients.discreet_mode, patients.low_data_mode)
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists discreet_mode  boolean not null default false;
alter table public.profiles add column if not exists low_data_mode  boolean not null default false;
comment on column public.profiles.discreet_mode is 'v5 4.1: hide sensitive content in previews and on shared screens. Owner-editable.';
comment on column public.profiles.low_data_mode is 'v5 4.1: reduce media and sync payloads on poor connections. Owner-editable.';

-- ---------------------------------------------------------------------------
-- 3. Consent: i18n key + v5-shaped read view over the append-only live table
-- ---------------------------------------------------------------------------
alter table public.consent_versions add column if not exists text_key text;
comment on column public.consent_versions.text_key is
  'v5 4.2: key into @tarragon/i18n for the consent text. `body` stays the legally binding text of record for this version.';

create or replace view public.patient_consent_state
with (security_invoker = true) as
with latest as (
  select distinct on (pc.patient_id, pc.consent_type)
         pc.patient_id, pc.organisation_id, pc.consent_type, pc.version, pc.action, pc.created_at
    from public.patient_consents pc
   order by pc.patient_id, pc.consent_type, pc.created_at desc, pc.id desc
), last_grant as (
  select pc.patient_id, pc.consent_type, max(pc.created_at) as granted_at
    from public.patient_consents pc
   where pc.action = 'accepted'
   group by pc.patient_id, pc.consent_type
)
select l.patient_id,
       l.organisation_id,
       l.consent_type as consent_type_code,
       l.version,
       (l.action = 'accepted') as granted,
       g.granted_at,
       case when l.action = 'withdrawn' then l.created_at end as withdrawn_at
  from latest l
  left join last_grant g on g.patient_id = l.patient_id and g.consent_type = l.consent_type;

revoke all on public.patient_consent_state from public, anon;
grant select on public.patient_consent_state to authenticated;

-- ---------------------------------------------------------------------------
-- 4. proxy_setups (v5 4.1, section 8.2): "set up for my parent"
-- ---------------------------------------------------------------------------
create table if not exists public.proxy_setups (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations(id) on delete restrict,
  created_by_profile_id uuid not null references public.profiles(id) on delete cascade,
  target_full_name      text not null check (char_length(btrim(target_full_name)) between 1 and 200),
  target_phone_e164     text not null check (target_phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  state                 text not null default 'pending_confirmation'
                        check (state in ('pending_confirmation', 'confirmed', 'expired', 'declined')),
  -- Supplied by the creating flow (S04 reads the window from versioned config); deliberately no column default.
  expires_at            timestamptz not null,
  confirmed_at          timestamptz,
  confirmed_profile_id  uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz,
  check (expires_at > created_at),
  check (state <> 'confirmed' or confirmed_at is not null)
);
create index if not exists proxy_setups_creator_idx on public.proxy_setups (created_by_profile_id, state);
create unique index if not exists proxy_setups_one_pending_per_target_idx
  on public.proxy_setups (created_by_profile_id, target_phone_e164) where state = 'pending_confirmation';
create index if not exists proxy_setups_pending_expiry_idx on public.proxy_setups (expires_at) where state = 'pending_confirmation';

comment on table public.proxy_setups is
  'v5 8.2: a proxy starts an account for a parent. Only the state machine below moves it; the proxy never sees the '
  'parent record before confirmation (this table holds no clinical data).';

create or replace function private.enforce_proxy_setup_state_machine()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organisation_id is distinct from old.organisation_id
     or new.created_by_profile_id is distinct from old.created_by_profile_id
     or new.target_phone_e164 is distinct from old.target_phone_e164
     or new.expires_at is distinct from old.expires_at
     or new.created_at is distinct from old.created_at then
    raise exception 'proxy_setups: identity, target and expiry are immutable' using errcode = '23514';
  end if;
  if new.state is distinct from old.state then
    if old.state <> 'pending_confirmation' then
      raise exception 'proxy_setups: % is a terminal state', old.state using errcode = '23514';
    end if;
    if new.state = 'confirmed' and old.expires_at <= now() then
      raise exception 'proxy_setups: an expired setup cannot be confirmed' using errcode = '23514';
    end if;
  elsif old.state <> 'pending_confirmation' then
    raise exception 'proxy_setups: % is a terminal state', old.state using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.enforce_proxy_setup_state_machine() from public;

drop trigger if exists proxy_setups_state_machine on public.proxy_setups;
create trigger proxy_setups_state_machine
  before update on public.proxy_setups
  for each row execute function private.enforce_proxy_setup_state_machine();

alter table public.proxy_setups enable row level security;

create policy proxy_setups_select on public.proxy_setups
  for select to authenticated
  using (created_by_profile_id = (select auth.uid()) or private.is_admin());

create policy proxy_setups_insert on public.proxy_setups
  for insert to authenticated
  with check (
    created_by_profile_id = (select auth.uid())
    and state = 'pending_confirmation'
    and confirmed_at is null
    and confirmed_profile_id is null
    and organisation_id = private.current_org_id()
  );

-- Table access is explicit (a table added by a plain migration gets no authenticated grant). No UPDATE or DELETE:
-- confirmation, decline and expiry go through S04's SECURITY DEFINER functions.
grant select, insert on public.proxy_setups to authenticated;

-- ---------------------------------------------------------------------------
-- 5. audit_log (OQ-25): subject + ip, TRUNCATE closed
-- ---------------------------------------------------------------------------
alter table public.audit_log add column if not exists subject_patient_id uuid;  -- no FK: the trail must outlive the patient
alter table public.audit_log add column if not exists ip inet;
create index if not exists audit_log_subject_patient_idx on public.audit_log (subject_patient_id, created_at desc)
  where subject_patient_id is not null;
comment on column public.audit_log.subject_patient_id is 'INV-10: the patient whose record was read or acted on. Null for events with no patient subject.';
comment on column public.audit_log.ip is 'Client address from the request headers when the write came through PostgREST; best effort, null otherwise.';

-- Row triggers already reject UPDATE and DELETE (audit_log_no_update / audit_log_no_delete). TRUNCATE bypasses row
-- triggers, so close it with a statement trigger AND remove the grants (belt and braces; the trigger holds even for a
-- superuser session that regrants).
drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function private.reject_mutation();

revoke truncate on public.audit_log from service_role, postgres;
revoke update, delete on public.audit_log from service_role, postgres;
-- The hosted project only ever granted authenticated INSERT and SELECT here, but a fresh replay (local stack, CI)
-- starts from the platform's default table ACL, which also gives authenticated and anon UPDATE, DELETE and TRUNCATE.
-- RLS has no policy for those and the triggers above refuse them, but the privilege itself should not exist. No-op live.
revoke all on public.audit_log from anon;
revoke update, delete, truncate, references, trigger on public.audit_log from authenticated;

-- ---------------------------------------------------------------------------
-- 6. Audited-read pattern (INV-10, OQ-03, OQ-04)
-- ---------------------------------------------------------------------------
create or replace function private.request_ip()
returns inet
language plpgsql
stable
set search_path = ''
as $$
declare
  h    json;
  raw  text;
begin
  begin
    h := current_setting('request.headers', true)::json;
  exception when others then
    return null;
  end;
  if h is null then return null; end if;
  -- X-Forwarded-For's first hop is client-supplied and spoofable. Prefer the headers the edge sets itself, and only
  -- then the RIGHTMOST forwarded hop (the one the platform appended).
  raw := coalesce(nullif(btrim(h ->> 'cf-connecting-ip'), ''),
                  nullif(btrim(h ->> 'x-real-ip'), ''),
                  nullif(btrim((regexp_split_to_array(coalesce(h ->> 'x-forwarded-for', ''), '\s*,\s*'))[
                        array_length(regexp_split_to_array(coalesce(h ->> 'x-forwarded-for', ''), '\s*,\s*'), 1)]), ''));
  return raw::inet;
exception when others then
  return null;   -- ip is best effort; a malformed header must never block the audited read itself
end;
$$;
revoke all on function private.request_ip() from public, anon, authenticated;

-- The one place an audited clinical/identity read is recorded. Raises rather than returning silently: a read
-- whose audit row could not be written must not happen.
create or replace function private.audit_patient_read(
  p_patient uuid, p_object_type text, p_object_id uuid, p_reason text,
  p_action text default 'patient_record.read')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event, reason, result, subject_patient_id, ip)
  select pr.organisation_id, (select auth.uid()), p_action, p_object_type, p_object_id,
         jsonb_build_object('reason', btrim(p_reason)), btrim(p_reason), 'success', pr.id, private.request_ip()
    from public.profiles pr
   where pr.id = p_patient
  returning id into v_id;
  if v_id is null then
    raise exception 'unknown patient' using errcode = '22023';
  end if;
  return v_id;
end;
$$;
-- The private schema's default privileges hand EXECUTE to authenticated, so PUBLIC alone is not enough: an
-- authenticated caller could otherwise write audit rows directly. Only the SECURITY DEFINER RPCs below call this.
revoke all on function private.audit_patient_read(uuid, text, uuid, text, text) from public, anon, authenticated;

-- Who may read a patient's identity/consent through the audited functions. Today: an ACTIVE support-view session for
-- that patient (private.can_support_view: it requires support.view_as and is the mechanism that notifies the patient
-- when a session starts, so a bare permission holder cannot read identities silently) or an active break-glass grant. The tied-patient rule of INV-12 (active task / lead assignment / on-call
-- page) is added here by S16-S19 when those tables exist; it is one function so there is one place to extend.
-- Reproductive-health data is not reachable through any function below (identity and consent rows only), and
-- has_emergency_access still excludes that category.
create or replace function private.can_staff_read_patient_identity(p_patient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_support_view(p_patient) or private.has_emergency_access(p_patient);
$$;
revoke all on function private.can_staff_read_patient_identity(uuid) from public, anon, authenticated;

-- Denied attempts: recorded with the targeted patient (INV-10 queries by subject must see refusals too). A plain
-- patient caller is told so with an error and writes nothing, so the audit trail cannot be flooded by patients.
create or replace function private.audit_denied_read(p_action text, p_object_type text, p_patient uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'patient') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, reason, result, subject_patient_id, ip)
  values (private.current_org_id(), (select auth.uid()), p_action, p_object_type, p_patient, btrim(p_reason), 'denied', p_patient, private.request_ip());
end;
$$;
revoke all on function private.audit_denied_read(text, text, uuid, text) from public, anon, authenticated;

create or replace function public.search_patients_audited(p_query text, p_reason text)
returns table (id uuid, full_name text, patient_number text, phone_masked text, organisation_id uuid, is_test boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pattern text;
  v_count   integer;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if p_query is null or char_length(btrim(p_query)) < 2 then
    raise exception 'search text must be at least 2 characters' using errcode = '22023';
  end if;

  if not private.has_permission('support.view_as') then
    perform private.audit_denied_read('admin.patient_search', 'profile', null, p_reason);
    return;
  end if;

  v_pattern := '%' || replace(replace(replace(btrim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%';

  select count(*) into v_count from (
    select 1 from public.profiles p
     where p.role = 'patient'
       and (p.full_name ilike v_pattern or p.phone ilike v_pattern or p.patient_number ilike v_pattern)
     limit 20) m;

  -- The query text is PII (and a hash of a phone number is trivially reversible): keep only its length and the result
  -- count, never the text or a hash. The audit row is written before any result is returned.
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, event, reason, result, ip)
  values (private.current_org_id(), (select auth.uid()), 'admin.patient_search', 'profile',
          jsonb_build_object('query_length', char_length(btrim(p_query)), 'result_count', v_count),
          btrim(p_reason), 'success', private.request_ip());

  return query
    select p.id, p.full_name, p.patient_number, '****' || right(coalesce(p.phone, ''), 4), p.organisation_id, p.is_test
      from public.profiles p
     where p.role = 'patient'
       and (p.full_name ilike v_pattern or p.phone ilike v_pattern or p.patient_number ilike v_pattern)
     order by p.full_name
     limit 20;
end;
$$;

create or replace function public.open_patient_identity_audited(p_patient uuid, p_reason text)
returns table (id uuid, full_name text, patient_number text, phone text, city text, state text,
               organisation_id uuid, is_active boolean, is_test boolean, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if not private.can_staff_read_patient_identity(p_patient) then
    perform private.audit_denied_read('admin.patient_identity_open', 'profile', p_patient, p_reason);
    return;
  end if;
  perform private.audit_patient_read(p_patient, 'profile', p_patient, p_reason, 'admin.patient_identity_open');
  return query
    select p.id, p.full_name, p.patient_number, p.phone, p.city, p.state, p.organisation_id, p.is_active, p.is_test, p.created_at
      from public.profiles p
     where p.id = p_patient and p.role = 'patient';
end;
$$;

create or replace function public.read_patient_consents_audited(p_patient uuid, p_reason text)
returns table (consent_type_code public.consent_type, version text, granted boolean, granted_at timestamptz, withdrawn_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if not private.can_staff_read_patient_identity(p_patient) then
    perform private.audit_denied_read('staff.patient_consents_read', 'patient_consents', p_patient, p_reason);
    return;
  end if;
  perform private.audit_patient_read(p_patient, 'patient_consents', p_patient, p_reason, 'staff.patient_consents_read');
  return query
    select s.consent_type_code, s.version, s.granted, s.granted_at, s.withdrawn_at
      from public.patient_consent_state s
     where s.patient_id = p_patient
     order by s.consent_type_code;
end;
$$;

-- Function EXECUTE: revoke from PUBLIC (where anon inherits it), grant to authenticated only. The gate is inside.
revoke all on function public.search_patients_audited(text, text)        from public;
revoke all on function public.open_patient_identity_audited(uuid, text)  from public;
revoke all on function public.read_patient_consents_audited(uuid, text)  from public;
grant execute on function public.search_patients_audited(text, text)       to authenticated;
grant execute on function public.open_patient_identity_audited(uuid, text) to authenticated;
grant execute on function public.read_patient_consents_audited(uuid, text) to authenticated;

-- Staff no longer read patient_consents directly (INV-10): the patient reads her own rows; staff use
-- read_patient_consents_audited. Every other reader is a SECURITY DEFINER function (checked live:
-- has_required_consents, analytics_governance_summary, analytics_patient_activity, enforce_* triggers) and is unaffected.
drop policy if exists patient_consents_select on public.patient_consents;
create policy patient_consents_select on public.patient_consents
  for select to authenticated
  using (patient_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.search_patients_audited(text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.open_patient_identity_audited(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.read_patient_consents_audited(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'private.audit_patient_read(uuid,text,uuid,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.audit_patient_read(uuid,text,uuid,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.can_staff_read_patient_identity(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.audit_denied_read(text,text,uuid,text)', 'EXECUTE') then
    raise exception 'S02: an audited-read helper is directly executable';
  end if;
  if has_table_privilege('service_role', 'public.audit_log', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.audit_log', 'UPDATE')
     or has_table_privilege('service_role', 'public.audit_log', 'DELETE')
     or has_table_privilege('authenticated', 'public.audit_log', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.audit_log', 'UPDATE')
     or has_table_privilege('authenticated', 'public.audit_log', 'DELETE')
     or has_table_privilege('anon', 'public.audit_log', 'SELECT') then
    raise exception 'S02: an application role can still mutate or read audit_log';
  end if;
  if not exists (select 1 from pg_policies where tablename = 'proxy_setups' and policyname = 'proxy_setups_select') then
    raise exception 'S02: proxy_setups policies missing';
  end if;
end $$;
