-- ===========================================================================
-- Patient Support, Navigation & Advocacy (module 75).
--
-- A bounded, non-clinical support channel for patients who need help
-- navigating the system rather than clinical care: appointment/pharmacy/lab
-- access, insurance or payment questions, a referral status check, or a
-- formal complaint. "Smart routing" (private.classify_navigation_request) is
-- a deterministic keyword scan on the free-text description, not an LLM
-- call -- every category a patient can pick is itself administrative, so
-- this exists only to catch clinical content hiding in the free text (a
-- symptom described under "other") and flag it so a non-clinical navigator
-- hands it off rather than answers it. It never auto-escalates or
-- auto-resolves anything, and staff can correct it
-- (classification_overridden_by/_at) -- deterministic classification with a
-- human override, the same shape used elsewhere on the platform.
--
-- Deliberately reuses existing machinery rather than building new clinical
-- infrastructure: referral navigation (75.6) links to the existing
-- specialist_referrals row instead of adding any new referral-status logic
-- (CLAUDE.md guardrails a full referral-matching/8-stage pipeline as a
-- later-phase item); a clinical hand-off (75.5) links to an existing
-- care_message_threads row created through the existing start_care_thread()
-- RPC, not a new escalation type. Care Coordinator write access on this
-- table is unrestricted -- none of its actions are the three the founder
-- rule reserves for clinical tiers (medications, escalation resolution,
-- protocol signing).

do $$ begin
  if not exists (select 1 from pg_type where typname = 'navigation_request_category') then
    create type public.navigation_request_category as enum (
      'appointment', 'pharmacy', 'laboratory', 'insurance', 'referral', 'payment', 'technical', 'other'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'navigation_request_status') then
    create type public.navigation_request_status as enum (
      'open', 'waiting_on_provider', 'waiting_on_patient', 'resolved'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'navigation_request_classification') then
    create type public.navigation_request_classification as enum ('non_clinical', 'clinical');
  end if;
end $$;

create table if not exists public.navigation_requests (
  id                            uuid primary key default gen_random_uuid(),
  organisation_id               uuid not null references public.organisations (id) on delete restrict,
  patient_id                    uuid not null references public.profiles (id) on delete cascade,

  category                      public.navigation_request_category not null,
  description                   text not null,
  classification                public.navigation_request_classification not null default 'non_clinical',
  classification_overridden_by  uuid references public.clinical_staff (id) on delete set null,
  classification_overridden_at  timestamptz,

  is_urgent                     boolean not null default false,
  is_complaint                  boolean not null default false,
  status                        public.navigation_request_status not null default 'open',

  specialist_referral_id        uuid references public.specialist_referrals (id) on delete set null,
  care_message_thread_id        uuid references public.care_message_threads (id) on delete set null,

  assigned_to                   uuid references public.profiles (id) on delete set null,
  created_by                    uuid references public.profiles (id) on delete set null,

  acknowledged_at               timestamptz,
  resolution_note               text,
  resolved_by                   uuid references public.profiles (id) on delete set null,
  resolved_at                   timestamptz,

  satisfaction_rating           smallint check (satisfaction_rating between 1 and 5),
  satisfaction_comment          text,

  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),

  constraint navigation_requests_resolution_consistency
    check ((status = 'resolved') = (resolved_at is not null))
);

comment on table public.navigation_requests is
  'Module 75 -- patient support/navigation/advocacy requests: non-clinical help with appointments, pharmacy, lab access, insurance, referrals, payments, or a formal complaint. See file header for the smart-routing and reuse rationale.';

create index navigation_requests_org_status_idx
  on public.navigation_requests (organisation_id, status, created_at desc);
create index navigation_requests_patient_idx
  on public.navigation_requests (patient_id, created_at desc);
create index navigation_requests_assigned_idx
  on public.navigation_requests (assigned_to) where assigned_to is not null;
create index navigation_requests_specialist_referral_idx
  on public.navigation_requests (specialist_referral_id) where specialist_referral_id is not null;

drop trigger if exists navigation_requests_set_updated_at on public.navigation_requests;
create trigger navigation_requests_set_updated_at
  before update on public.navigation_requests
  for each row execute function private.set_updated_at();

create or replace function private.classify_navigation_request(
  p_category public.navigation_request_category,
  p_description text
) returns public.navigation_request_classification
language sql
immutable
set search_path = ''
as $$
  select case
    when lower(coalesce(p_description, '')) ~ (
      'chest pain|can''t breathe|cannot breathe|difficulty breathing|unconscious|' ||
      'unresponsive|severe bleeding|heavy bleeding|suicid|self.?harm|overdose|' ||
      'seizure|fainted|fainting|stroke|numbness on one side|slurred speech|' ||
      'severe pain|blue lips|not breathing'
    ) then 'clinical'::public.navigation_request_classification
    else 'non_clinical'::public.navigation_request_classification
  end;
$$;

comment on function private.classify_navigation_request(public.navigation_request_category, text) is
  'Deterministic keyword scan used to auto-route a navigation request -- flags likely-clinical free text so a non-clinical navigator hands it to care_messages instead of answering it. Never auto-escalates by itself.';

create or replace function private.enforce_navigation_request_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_target_patient uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if length(trim(coalesce(new.description, ''))) = 0 then
    raise exception 'description required';
  end if;

  select organisation_id into v_org from public.profiles where id = v_uid;
  if v_org is null then
    raise exception 'caller has no organisation';
  end if;

  if new.patient_id is not null and new.patient_id != v_uid and private.is_org_staff(v_org) then
    if not exists (
      select 1 from public.profiles where id = new.patient_id and organisation_id = v_org
    ) then
      raise exception 'patient not found in your organisation';
    end if;
    v_target_patient := new.patient_id;
  else
    v_target_patient := v_uid;
  end if;

  new.patient_id := v_target_patient;
  new.organisation_id := v_org;
  new.created_by := v_uid;
  new.classification := private.classify_navigation_request(new.category, new.description);
  new.classification_overridden_by := null;
  new.classification_overridden_at := null;
  new.is_urgent := false;
  new.status := 'open';
  new.acknowledged_at := null;
  new.resolution_note := null;
  new.resolved_by := null;
  new.resolved_at := null;
  new.care_message_thread_id := null;
  return new;
end;
$$;

drop trigger if exists navigation_requests_enforce_insert on public.navigation_requests;
create trigger navigation_requests_enforce_insert
  before insert on public.navigation_requests
  for each row execute function private.enforce_navigation_request_insert();

revoke all on function private.enforce_navigation_request_insert() from public;

create or replace function private.enforce_navigation_request_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  new.organisation_id := old.organisation_id;
  new.patient_id := old.patient_id;
  new.created_by := old.created_by;

  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    if length(trim(coalesce(new.resolution_note, ''))) = 0 then
      raise exception 'a resolution note is required to resolve a request';
    end if;
    new.resolved_at := now();
    new.resolved_by := v_uid;
  elsif new.status != 'resolved' then
    new.resolved_at := null;
    new.resolved_by := null;
  end if;

  if new.acknowledged_at is null and private.is_org_staff(old.organisation_id) then
    new.acknowledged_at := now();
  end if;

  if new.classification is distinct from old.classification then
    new.classification_overridden_by := private.timeline_staff_from_profile(v_uid, old.organisation_id);
    new.classification_overridden_at := now();
  end if;

  if new.specialist_referral_id is not null
     and new.specialist_referral_id is distinct from old.specialist_referral_id then
    if not exists (
      select 1 from public.specialist_referrals
      where id = new.specialist_referral_id
        and patient_id = new.patient_id
        and organisation_id = new.organisation_id
    ) then
      raise exception 'referral does not belong to this patient';
    end if;
  end if;

  if new.care_message_thread_id is not null
     and new.care_message_thread_id is distinct from old.care_message_thread_id then
    if not exists (
      select 1 from public.care_message_threads
      where id = new.care_message_thread_id
        and patient_id = new.patient_id
        and organisation_id = new.organisation_id
    ) then
      raise exception 'care message thread does not belong to this patient';
    end if;
  end if;

  if new.satisfaction_rating is distinct from old.satisfaction_rating
     or new.satisfaction_comment is distinct from old.satisfaction_comment then
    if v_uid is distinct from old.patient_id or old.status != 'resolved' then
      raise exception 'feedback can only be left by the patient once the request is resolved';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists navigation_requests_enforce_update on public.navigation_requests;
create trigger navigation_requests_enforce_update
  before update on public.navigation_requests
  for each row execute function private.enforce_navigation_request_update();

revoke all on function private.enforce_navigation_request_update() from public;

create or replace function private.after_navigation_request_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, content_class, payload)
    values (
      new.organisation_id, new.patient_id, 'in_app', 'pending', 'navigation_request_resolved',
      case when new.classification = 'clinical'
        then 'clinical'::public.notification_content_class
        else 'non_clinical'::public.notification_content_class end,
      jsonb_build_object('navigation_request_id', new.id::text, 'category', new.category)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists navigation_requests_after_update on public.navigation_requests;
create trigger navigation_requests_after_update
  after update on public.navigation_requests
  for each row execute function private.after_navigation_request_update();

revoke all on function private.after_navigation_request_update() from public;

alter table public.navigation_requests enable row level security;

create policy navigation_requests_select on public.navigation_requests
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy navigation_requests_insert on public.navigation_requests
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy navigation_requests_update on public.navigation_requests
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.navigation_requests to authenticated;
revoke delete on public.navigation_requests from authenticated;

create or replace function public.submit_navigation_request_feedback(
  p_request_id uuid,
  p_rating smallint,
  p_comment text default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'rating must be between 1 and 5';
  end if;
  update public.navigation_requests
    set satisfaction_rating = p_rating, satisfaction_comment = p_comment
    where id = p_request_id;
  if not found then
    raise exception 'request not found';
  end if;
end;
$$;

revoke execute on function public.submit_navigation_request_feedback(uuid, smallint, text) from public, anon;
grant execute on function public.submit_navigation_request_feedback(uuid, smallint, text) to authenticated;

do $$
declare
  v_classified public.navigation_request_classification;
begin
  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'navigation_requests'
  ) then
    raise exception 'navigation_requests missing after migration';
  end if;

  select private.classify_navigation_request('other', 'I have chest pain and cannot breathe')
    into v_classified;
  if v_classified != 'clinical' then
    raise exception 'classifier failed to flag an obvious clinical description';
  end if;

  select private.classify_navigation_request('pharmacy', 'My pharmacy does not have my metformin in stock')
    into v_classified;
  if v_classified != 'non_clinical' then
    raise exception 'classifier over-flagged a routine pharmacy-access request';
  end if;

  if (
    select qual from pg_policies
    where schemaname = 'public' and tablename = 'navigation_requests' and policyname = 'navigation_requests_update'
  ) not like '%is_org_staff%' then
    raise exception 'navigation_requests_update must be gated through is_org_staff';
  end if;

  raise notice 'PASS: navigation_requests table + RLS + classifier present';
end $$;
