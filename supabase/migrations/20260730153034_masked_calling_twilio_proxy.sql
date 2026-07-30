-- Tarragon Health
-- Masked/proxy calling between a patient and their assigned clinician or
-- care coordinator, so neither party ever sees the other's real phone
-- number (M8 gap, per docs/source/build-spec-v3 -- founder-approved
-- target vendor: Twilio Proxy, 2026-07-30).
--
-- Design, matching this codebase's own "vendor-optional, dormant until
-- configured" convention (Zoom/Stripe/Resend/wearables): the DB layer is
-- fully real and usable today; NO real phone number is ever stored in any
-- column here -- the Next.js server action reads profiles.phone live (via
-- a service-role client, only after this migration's RPC has already
-- verified the caller is a legitimate participant) at the moment it talks
-- to Twilio, and writes back only what Twilio returns: a proxy_session_sid
-- and, per participant, a masked twilio_proxy_identifier number (safe to
-- store -- it is the masked number itself, the whole point of the
-- feature, not anything private). Until TWILIO_* env vars exist, sessions
-- sit in 'requested' status and the UI shows "coming soon", exactly like
-- the wearables Connect card before real provider credentials existed.
--
-- Direct authenticated INSERT/UPDATE is deliberately ungranted on both
-- tables -- every write goes through request_masked_call/close_masked_call
-- (SECURITY DEFINER, this migration) or the server action's service-role
-- client (after Twilio responds), matching the wallet_ledger/commissions
-- system-write-only posture. A participant can only ever SELECT their own
-- session/participant rows (or org staff, broadly, same as every other
-- patient-linked table).

create type public.masked_call_context as enum ('care_coordination', 'clinical_follow_up', 'escalation_contact');
create type public.masked_call_session_status as enum ('requested', 'active', 'closed', 'expired', 'failed');
create type public.masked_call_participant_role as enum ('patient', 'staff');

create table public.masked_call_sessions (
  id                        uuid primary key default gen_random_uuid(),
  organisation_id           uuid not null references public.organisations (id) on delete restrict,
  patient_id                uuid not null references public.profiles (id) on delete cascade,
  staff_profile_id          uuid not null references public.profiles (id) on delete restrict,
  context                   public.masked_call_context not null,
  escalation_id             uuid references public.escalations (id) on delete set null,
  initiated_by              uuid not null references public.profiles (id) on delete restrict,
  status                    public.masked_call_session_status not null default 'requested',
  twilio_proxy_service_sid  text,
  twilio_proxy_session_sid  text,
  vendor_error              text,
  expires_at                timestamptz not null default (now() + interval '4 hours'),
  closed_at                 timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint masked_call_sessions_context_link check (
    context <> 'escalation_contact' or escalation_id is not null
  ),
  constraint masked_call_sessions_distinct_parties check (patient_id <> staff_profile_id)
);

create index masked_call_sessions_patient_idx on public.masked_call_sessions (patient_id);
create index masked_call_sessions_staff_idx on public.masked_call_sessions (staff_profile_id);
create index masked_call_sessions_escalation_idx on public.masked_call_sessions (escalation_id);
create index masked_call_sessions_status_expiry_idx on public.masked_call_sessions (status, expires_at);

create trigger masked_call_sessions_set_updated_at
  before update on public.masked_call_sessions
  for each row execute function private.set_updated_at();

alter table public.masked_call_sessions enable row level security;

create policy masked_call_sessions_select on public.masked_call_sessions
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or staff_profile_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

grant select on public.masked_call_sessions to authenticated;
-- Deliberately no insert/update/delete grant -- see header comment.

create table public.masked_call_participants (
  id                      uuid primary key default gen_random_uuid(),
  session_id              uuid not null references public.masked_call_sessions (id) on delete cascade,
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  profile_id              uuid not null references public.profiles (id) on delete cascade,
  role                    public.masked_call_participant_role not null,
  twilio_participant_sid  text,
  twilio_proxy_identifier text,
  added_at                timestamptz not null default now(),

  constraint masked_call_participants_session_role_unique unique (session_id, role)
);

create index masked_call_participants_profile_idx on public.masked_call_participants (profile_id);

alter table public.masked_call_participants enable row level security;

create policy masked_call_participants_select on public.masked_call_participants
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

grant select on public.masked_call_participants to authenticated;
-- Deliberately no insert/update/delete grant -- see header comment.

-- request_masked_call: the only way a session gets created. Verifies the
-- caller is either the patient themselves or org staff, that the staff
-- side resolves to a real clinician/doctor/care_coordinator in the same
-- org (Care Coordinators are explicitly allowed -- calling one is
-- logistics, not the medication/escalation/protocol write access the
-- Clinical Tier Ladder rule forbids them), and (for escalation_contact)
-- that the escalation is real and belongs to this patient.
create or replace function public.request_masked_call(
  p_patient_id uuid,
  p_staff_profile_id uuid,
  p_context public.masked_call_context,
  p_escalation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_org uuid;
  v_caller uuid := auth.uid();
  v_session_id uuid;
begin
  if v_caller is null then
    raise exception 'Not signed in';
  end if;

  select organisation_id into v_org from public.profiles where id = p_patient_id;
  if v_org is null then
    raise exception 'Patient not found';
  end if;

  if v_caller <> p_patient_id and not private.is_org_staff(v_org) then
    raise exception 'Not authorised to request this call' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_staff_profile_id
      and organisation_id = v_org
      and role in ('clinician', 'doctor', 'care_coordinator')
  ) then
    raise exception 'Staff member not found in the patient organisation';
  end if;

  if p_context = 'escalation_contact' then
    if p_escalation_id is null then
      raise exception 'escalation_contact requires an escalation';
    end if;
    if not exists (
      select 1 from public.escalations
      where id = p_escalation_id and patient_id = p_patient_id and organisation_id = v_org
    ) then
      raise exception 'Escalation not found for this patient';
    end if;
  end if;

  insert into public.masked_call_sessions (organisation_id, patient_id, staff_profile_id, context, escalation_id, initiated_by)
  values (v_org, p_patient_id, p_staff_profile_id, p_context, p_escalation_id, v_caller)
  returning id into v_session_id;

  insert into public.masked_call_participants (session_id, organisation_id, profile_id, role)
  values
    (v_session_id, v_org, p_patient_id, 'patient'),
    (v_session_id, v_org, p_staff_profile_id, 'staff');

  perform private.log_audit('masked_call.requested', 'masked_call_sessions', v_session_id,
    jsonb_build_object('context', p_context, 'escalation_id', p_escalation_id));

  return v_session_id;
end;
$$;

revoke all on function public.request_masked_call(uuid, uuid, public.masked_call_context, uuid) from public;
revoke all on function public.request_masked_call(uuid, uuid, public.masked_call_context, uuid) from anon;
grant execute on function public.request_masked_call(uuid, uuid, public.masked_call_context, uuid) to authenticated;

-- close_masked_call: either party on the call, or org staff, can end a
-- session early (before its expires_at sweep). Idempotent -- closing an
-- already-closed/expired session is a silent no-op, not an error.
create or replace function public.close_masked_call(p_session_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_session public.masked_call_sessions;
begin
  select * into v_session from public.masked_call_sessions where id = p_session_id;
  if v_session.id is null then
    raise exception 'Session not found';
  end if;

  if v_caller <> v_session.patient_id
     and v_caller <> v_session.staff_profile_id
     and not private.is_org_staff(v_session.organisation_id) then
    raise exception 'Not authorised to close this call' using errcode = '42501';
  end if;

  update public.masked_call_sessions
  set status = 'closed', closed_at = now(), vendor_error = coalesce(p_reason, vendor_error)
  where id = p_session_id and status not in ('closed', 'expired');

  perform private.log_audit('masked_call.closed', 'masked_call_sessions', p_session_id, jsonb_build_object('reason', p_reason));
end;
$$;

revoke all on function public.close_masked_call(uuid, text) from public;
revoke all on function public.close_masked_call(uuid, text) from anon;
grant execute on function public.close_masked_call(uuid, text) to authenticated;

-- Nightly-ish sweep (every 15 minutes, given the short 4h TTL) for
-- sessions nobody explicitly closed -- a masked number should not sit
-- assignable forever. Never touches a session Twilio already marked
-- 'closed'/'expired'.
create or replace function private.expire_masked_call_sessions()
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  update public.masked_call_sessions
  set status = 'expired'
  where status in ('requested', 'active') and expires_at < now();
end;
$$;

revoke all on function private.expire_masked_call_sessions() from public;
revoke all on function private.expire_masked_call_sessions() from anon;

select cron.schedule('expire-masked-call-sessions', '*/15 * * * *', $$select private.expire_masked_call_sessions();$$);

do $$
begin
  if (select count(*) from information_schema.tables where table_schema='public' and table_name in ('masked_call_sessions','masked_call_participants')) <> 2 then
    raise exception 'masked calling tables missing';
  end if;
  if has_function_privilege('anon', 'public.request_masked_call(uuid, uuid, public.masked_call_context, uuid)', 'EXECUTE') then
    raise exception 'anon must not be able to execute request_masked_call';
  end if;
  if has_function_privilege('anon', 'public.close_masked_call(uuid, text)', 'EXECUTE') then
    raise exception 'anon must not be able to execute close_masked_call';
  end if;
end $$;
