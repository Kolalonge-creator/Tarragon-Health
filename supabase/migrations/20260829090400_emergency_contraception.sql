-- Sexual & Reproductive Health platform, 5/8: emergency contraception fast
-- track (spec §47.8 — "timing can be clinically important, this pathway
-- needs clear prioritisation").
--
-- Deliberately its own small table and its own alert path, not folded into
-- contraception_plans: the clinical question is completely different (is it
-- still within the window, what method fits how much time has passed) and
-- the whole point is a short, dedicated SLA. Not routed through
-- emergency_events — a request for emergency contraception is time-
-- sensitive but the patient is not in physical danger, so none of that
-- pathway's collapse-specific machinery (acknowledge-gated "go to hospital
-- now" guidance, emergency-contact auto-notify) applies, and — critically —
-- emergency_events' contact-notify sweep would otherwise message a family
-- member about something the patient never consented to share, exactly the
-- confidentiality failure 20260802212440's exposure-report work went out of
-- its way to prevent. Using a separate table sidesteps that risk by
-- construction rather than needing another suppress_contact_notify carve-out.
--
-- hours_since_intercourse is nullable on purpose (mirrors patient_exposure_
-- reports.occurred_on) — "I'm not sure exactly" is a real, common answer and
-- must not block the request.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'ec_request_status') then
    create type public.ec_request_status as enum ('pending', 'reviewed', 'dispensed', 'declined', 'expired');
  end if;
end $$;

create table if not exists public.emergency_contraception_requests (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  requested_at          timestamptz not null default now(),
  hours_since_intercourse integer check (hours_since_intercourse is null or hours_since_intercourse >= 0),
  status                public.ec_request_status not null default 'pending',
  guidance_shown        text not null,
  reviewed_by           uuid references public.clinical_staff (id) on delete restrict,
  reviewed_at           timestamptz,
  method_advised        text references public.contraception_methods (code) on delete set null,
  clinician_alert_id    uuid references public.clinician_alerts (id) on delete set null,
  created_at            timestamptz not null default now()
);

create index if not exists emergency_contraception_requests_pending_idx
  on public.emergency_contraception_requests (organisation_id, requested_at)
  where status = 'pending';

comment on table public.emergency_contraception_requests is
  'Fast-track emergency contraception request (spec §47.8). Every insert raises an urgent_escalation clinician_alerts row with a short (1-hour) SLA — see private.raise_ec_request_alert. Never routed through emergency_events (no collapse, no family auto-notify).';

alter table public.emergency_contraception_requests enable row level security;

drop policy if exists ec_requests_select on public.emergency_contraception_requests;
create policy ec_requests_select on public.emergency_contraception_requests
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

drop policy if exists ec_requests_insert on public.emergency_contraception_requests;
create policy ec_requests_insert on public.emergency_contraception_requests
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    and organisation_id = private.current_org_id()
    and status = 'pending'
    and reviewed_by is null
  );

drop policy if exists ec_requests_staff_update on public.emergency_contraception_requests;
create policy ec_requests_staff_update on public.emergency_contraception_requests
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.emergency_contraception_requests to authenticated;
revoke all on public.emergency_contraception_requests from anon;

-- Attribution + terminal-state discipline on the staff-side update, same
-- shape as every other null-gated review stamp on this platform.
create or replace function private.enforce_ec_request_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
begin
  new.organisation_id          := old.organisation_id;
  new.patient_id                := old.patient_id;
  new.requested_at              := old.requested_at;
  new.hours_since_intercourse   := old.hours_since_intercourse;
  new.guidance_shown            := old.guidance_shown;
  new.clinician_alert_id        := old.clinician_alert_id;
  new.created_at                := old.created_at;

  if old.status <> 'pending' then
    raise exception 'this request has already been actioned' using errcode = '22023';
  end if;

  if new.status = old.status then
    return new;
  end if;

  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.organisation_id = old.organisation_id
    and cs.active;

  if v_staff is null then
    raise exception 'only an active clinical staff member may action an emergency contraception request' using errcode = '42501';
  end if;

  new.reviewed_by := v_staff;
  new.reviewed_at := now();
  return new;
end;
$$;

drop trigger if exists ec_requests_enforce_update on public.emergency_contraception_requests;
create trigger ec_requests_enforce_update
  before update on public.emergency_contraception_requests
  for each row execute function private.enforce_ec_request_update();

-- ---------------------------------------------------------------------------
-- Raise the urgent, short-SLA alert on every request. A copper IUD is
-- effective as EC up to 5 days and the emergency pill up to 3-5 days
-- depending on the product, so this is not itself a life-threatening
-- emergency — but "clear prioritisation" (§47.8) means a real, short SLA
-- rather than the standard 24-hour abnormal-result window, hence a direct
-- sla_due_at rather than reusing the 'emergency' alert_level (which this
-- platform reserves for the danger-symptom/collapse safety net).
--
-- category/type_code are set explicitly ('medication'/'medication_safety')
-- rather than left to classify_and_assign_clinician_alert's fallback
-- heuristics (20260828014055) — medication_safety's own governance entry
-- (alert_rules) already notes it has "no automated generator yet"; this is
-- its first one, a better semantic fit than falling through to
-- abnormal_result.
-- ---------------------------------------------------------------------------
create or replace function private.raise_ec_request_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert_id uuid;
begin
  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, sla_due_at, category, type_code)
  values (
    new.organisation_id, new.patient_id, 'urgent_escalation', 'open',
    'Emergency contraception requested',
    format('Requested %s.%s', to_char(new.requested_at, 'YYYY-MM-DD HH24:MI'),
      case when new.hours_since_intercourse is not null
        then format(' Reported %s hours since intercourse.', new.hours_since_intercourse)
        else ' Time since intercourse not specified.' end),
    now() + interval '1 hour',
    'medication', 'medication_safety'
  )
  returning id into v_alert_id;

  update public.emergency_contraception_requests
    set clinician_alert_id = v_alert_id
    where id = new.id;

  return new;
end;
$$;

drop trigger if exists ec_requests_raise_alert on public.emergency_contraception_requests;
create trigger ec_requests_raise_alert
  after insert on public.emergency_contraception_requests
  for each row execute function private.raise_ec_request_alert();

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'emergency_contraception_requests') then
    raise exception 'FAIL: emergency_contraception_requests was not created';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'ec_requests_raise_alert' and tgrelid = 'public.emergency_contraception_requests'::regclass and not tgisinternal) then
    raise exception 'FAIL: ec_requests_raise_alert trigger was not created';
  end if;
  raise notice 'PASS: emergency contraception fast-track installed';
end $$;
