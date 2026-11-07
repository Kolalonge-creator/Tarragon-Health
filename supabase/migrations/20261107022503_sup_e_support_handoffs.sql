-- Customer Support Dashboard, phase E: hand-offs from the support desk to the team that owns the decision (SUP-2,
-- docs/design/SUPPORT-DASHBOARD.md section 5).
--
-- Support finds the problem; another team decides. A hand-off records who was asked, why, who took ownership, what they
-- decided and the wording support may give the customer. Support never makes the receiving team's decision itself:
--   finance            refunds, duplicate or failed payments, reconciliation. Finance decides in its own console
--                      (decide_order_refund and friends, finance.gl.post); the hand-off can point at the refund row.
--   technical_ops      bugs, outages, integration failures. Can point at an ops_incidents row.
--   provider_ops       laboratory / imaging / partner listing, onboarding and verification questions.
--   membership_ops     entitlement or activation questions that need someone who can change a subscription.
--   senior_management  a serious complaint, reputational or operational matter.
-- There is deliberately no clinical or patient-safety destination: those already have their own pathway that never waits
-- on a coordinator (escalate_support_ticket_to_clinical, the red-flag scan, flag_care_thread_for_doctor, the help-request
-- hand-off to the care team, complaints -> clinical incidents). A second, slower route would be a way to lose one.
--
-- Data minimisation: the receiving team sees the reason support wrote and the source reference, not the customer
-- conversation or anything clinical.

create table public.support_handoffs (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations(id) on delete restrict,
  source                 text not null check (source in ('support_ticket', 'help_request', 'care_thread', 'complaint')),
  source_id              uuid not null,
  patient_id             uuid references public.profiles(id) on delete restrict,
  destination            text not null check (destination in ('finance', 'technical_ops', 'provider_ops', 'membership_ops', 'senior_management')),
  reason                 text not null check (length(btrim(reason)) >= 10),
  status                 text not null default 'open' check (status in ('open', 'acknowledged', 'outcome_recorded', 'withdrawn')),
  raised_by              uuid not null references public.profiles(id) on delete restrict,
  raised_at              timestamptz not null default now(),
  owner_id               uuid references public.profiles(id) on delete restrict,
  acknowledged_at        timestamptz,
  outcome                text,
  customer_message       text,
  outcome_by             uuid references public.profiles(id) on delete restrict,
  outcome_at             timestamptz,
  refund_id              uuid references public.refunds(id) on delete restrict,
  ops_incident_id        uuid references public.ops_incidents(id) on delete restrict,
  withdrawn_by           uuid references public.profiles(id) on delete restrict,
  withdrawn_reason       text,
  updated_at             timestamptz not null default now(),
  check (status <> 'acknowledged' or (owner_id is not null and acknowledged_at is not null)),
  check (status <> 'outcome_recorded' or (outcome is not null and length(btrim(outcome)) >= 10 and outcome_by is not null and outcome_at is not null)),
  check (status <> 'withdrawn' or (withdrawn_by is not null and length(btrim(coalesce(withdrawn_reason, ''))) >= 10)),
  check (refund_id is null or destination = 'finance'),
  check (ops_incident_id is null or destination = 'technical_ops')
);

create index support_handoffs_source_idx on public.support_handoffs (source, source_id);
create index support_handoffs_open_idx on public.support_handoffs (destination, status) where status in ('open', 'acknowledged');

comment on table public.support_handoffs is
  'Support desk hand-offs to the team that owns the decision (finance, technical_ops, provider_ops, membership_ops, senior_management). No clinical destination by design: clinical concerns use the existing clinical escalation pathway.';

-- Who receives each destination. Read from the existing permission catalogue; no new key.
create or replace function private.can_receive_support_handoff(p_destination text)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select case p_destination
    when 'finance'           then private.is_finance() or private.has_permission('finance.view')
    when 'technical_ops'     then private.has_permission('incidents.manage')
    when 'provider_ops'      then private.has_permission('partners.labs.manage')
                                  or private.has_permission('partners.facilities.manage')
                                  or private.has_permission('orgs.manage')
    when 'membership_ops'    then private.has_permission('subscriptions.manage')
    when 'senior_management' then private.is_admin()
    else false
  end;
$$;

revoke all on function private.can_receive_support_handoff(text) from public, anon;
grant execute on function private.can_receive_support_handoff(text) to authenticated;

-- A staff operational record about a support item, written only by staff RPCs; a guardian or dependant never writes it.
select private.classify_minor_dependant_table('support_handoffs', 'exempt',
  'support desk hand-off: staff operational record, written only by staff RPCs, never by a patient or guardian');

alter table public.support_handoffs enable row level security;

create policy support_handoffs_read on public.support_handoffs
  for select to authenticated
  using ((select private.is_support_staff()) or private.can_receive_support_handoff(destination));
-- Every write goes through the RPCs below.

grant select on public.support_handoffs to authenticated;
revoke all on public.support_handoffs from anon;

do $$
begin
  if to_regproc('private.audit_row_change') is not null then
    execute 'create trigger support_handoffs_audit after insert or update or delete on public.support_handoffs for each row execute function private.audit_row_change()';
  end if;
end $$;

-- The organisation and patient of a source item, read with the caller's own RLS (security invoker): a caller who
-- cannot see the source item cannot hand it off.
create or replace function private.support_source_owner(p_source text, p_source_id uuid, out organisation_id uuid, out patient_id uuid)
language plpgsql
stable
security invoker
set search_path to ''
as $$
begin
  if p_source = 'support_ticket' then
    select t.organisation_id, t.patient_id into organisation_id, patient_id from public.support_tickets t where t.id = p_source_id;
  elsif p_source = 'help_request' then
    select n.organisation_id, n.patient_id into organisation_id, patient_id from public.navigation_requests n where n.id = p_source_id;
  elsif p_source = 'care_thread' then
    select c.organisation_id, c.patient_id into organisation_id, patient_id from public.care_message_threads c where c.id = p_source_id and c.queue = 'support';
  elsif p_source = 'complaint' then
    select c.organisation_id, c.patient_id into organisation_id, patient_id from public.complaints c where c.id = p_source_id;
  end if;
end;
$$;

revoke all on function private.support_source_owner(text, uuid) from public, anon;
grant execute on function private.support_source_owner(text, uuid) to authenticated;

create or replace function public.raise_support_handoff(p_source text, p_source_id uuid, p_destination text, p_reason text)
returns uuid
language plpgsql
security invoker
set search_path to ''
as $$
declare
  v_org uuid;
  v_patient uuid;
  v_id uuid;
begin
  if not private.is_support_staff() then
    raise exception 'Only support staff can hand work to another team' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'Say what you need from the other team (at least 10 characters)' using errcode = '22023';
  end if;

  select o.organisation_id, o.patient_id into v_org, v_patient from private.support_source_owner(p_source, p_source_id) o;
  if v_org is null then
    raise exception 'That support item was not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1 from public.support_handoffs h
     where h.source = p_source and h.source_id = p_source_id and h.destination = p_destination
       and h.status in ('open', 'acknowledged')
  ) then
    raise exception 'This item is already with that team' using errcode = '23505';
  end if;

  select private.support_handoff_insert(v_org, p_source, p_source_id, v_patient, p_destination, btrim(p_reason)) into v_id;
  return v_id;
end;
$$;

-- The insert itself runs as definer (the table has no insert policy); only raise_support_handoff calls it, after the
-- caller's own RLS has proved they can see the source item.
create or replace function private.support_handoff_insert(
  p_org uuid, p_source text, p_source_id uuid, p_patient uuid, p_destination text, p_reason text
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_id uuid;
  v_org uuid;
  v_patient uuid;
begin
  if not private.is_support_staff() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  -- Never trust the caller's ids: read the source as definer and require the caller to be staff of its organisation.
  if p_source = 'support_ticket' then
    select organisation_id, patient_id into v_org, v_patient from public.support_tickets where id = p_source_id;
  elsif p_source = 'help_request' then
    select organisation_id, patient_id into v_org, v_patient from public.navigation_requests where id = p_source_id;
  elsif p_source = 'care_thread' then
    select organisation_id, patient_id into v_org, v_patient from public.care_message_threads where id = p_source_id and queue = 'support';
  elsif p_source = 'complaint' then
    select organisation_id, patient_id into v_org, v_patient from public.complaints where id = p_source_id;
  end if;
  if v_org is null or v_org is distinct from p_org or v_patient is distinct from p_patient or not private.is_org_staff(v_org) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  insert into public.support_handoffs (organisation_id, source, source_id, patient_id, destination, reason, raised_by)
  values (v_org, p_source, p_source_id, v_patient, p_destination, p_reason, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.acknowledge_support_handoff(p_handoff_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v public.support_handoffs;
begin
  select * into v from public.support_handoffs where id = p_handoff_id for update;
  if v.id is null then
    raise exception 'Hand-off not found' using errcode = 'P0002';
  end if;
  if not private.can_receive_support_handoff(v.destination) then
    raise exception 'Only the receiving team can take ownership' using errcode = '42501';
  end if;
  if v.status <> 'open' then
    raise exception 'This hand-off is already %', replace(v.status, '_', ' ') using errcode = '22023';
  end if;
  update public.support_handoffs
     set status = 'acknowledged', owner_id = (select auth.uid()), acknowledged_at = now(), updated_at = now()
   where id = p_handoff_id;
end;
$$;

create or replace function public.record_support_handoff_outcome(
  p_handoff_id uuid,
  p_outcome text,
  p_customer_message text,
  p_refund_id uuid default null,
  p_ops_incident_id uuid default null
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v public.support_handoffs;
begin
  select * into v from public.support_handoffs where id = p_handoff_id for update;
  if v.id is null then
    raise exception 'Hand-off not found' using errcode = 'P0002';
  end if;
  if not private.can_receive_support_handoff(v.destination) then
    raise exception 'Only the receiving team can record the outcome' using errcode = '42501';
  end if;
  if v.status not in ('open', 'acknowledged') then
    raise exception 'This hand-off is already %', replace(v.status, '_', ' ') using errcode = '22023';
  end if;
  if p_outcome is null or length(btrim(p_outcome)) < 10 then
    raise exception 'Record what was decided (at least 10 characters)' using errcode = '22023';
  end if;
  if p_refund_id is not null and not exists (select 1 from public.refunds r where r.id = p_refund_id and r.organisation_id = v.organisation_id) then
    raise exception 'That refund was not found for this organisation' using errcode = 'P0002';
  end if;
  if p_ops_incident_id is not null and not exists (select 1 from public.ops_incidents i where i.id = p_ops_incident_id) then
    raise exception 'That incident was not found' using errcode = 'P0002';
  end if;

  update public.support_handoffs
     set status = 'outcome_recorded',
         owner_id = coalesce(owner_id, (select auth.uid())),
         acknowledged_at = coalesce(acknowledged_at, now()),
         outcome = btrim(p_outcome),
         customer_message = nullif(btrim(coalesce(p_customer_message, '')), ''),
         outcome_by = (select auth.uid()),
         outcome_at = now(),
         refund_id = p_refund_id,
         ops_incident_id = p_ops_incident_id,
         updated_at = now()
   where id = p_handoff_id;
end;
$$;

create or replace function public.withdraw_support_handoff(p_handoff_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v public.support_handoffs;
begin
  select * into v from public.support_handoffs where id = p_handoff_id for update;
  if v.id is null then
    raise exception 'Hand-off not found' using errcode = 'P0002';
  end if;
  if not (private.is_support_lead() or (v.raised_by = (select auth.uid()) and private.is_support_staff())) then
    raise exception 'Only the person who raised it or a support lead can withdraw a hand-off' using errcode = '42501';
  end if;
  if v.status <> 'open' then
    raise exception 'Only a hand-off nobody has taken yet can be withdrawn' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 10 then
    raise exception 'Say why it is being withdrawn (at least 10 characters)' using errcode = '22023';
  end if;
  update public.support_handoffs
     set status = 'withdrawn', withdrawn_by = (select auth.uid()), withdrawn_reason = btrim(p_reason), updated_at = now()
   where id = p_handoff_id;
end;
$$;

revoke all on function private.support_handoff_insert(uuid, text, uuid, uuid, text, text) from public, anon;
grant execute on function private.support_handoff_insert(uuid, text, uuid, uuid, text, text) to authenticated;
revoke all on function public.raise_support_handoff(text, uuid, text, text) from public, anon;
revoke all on function public.acknowledge_support_handoff(uuid) from public, anon;
revoke all on function public.record_support_handoff_outcome(uuid, text, text, uuid, uuid) from public, anon;
revoke all on function public.withdraw_support_handoff(uuid, text) from public, anon;
grant execute on function public.raise_support_handoff(text, uuid, text, text) to authenticated;
grant execute on function public.acknowledge_support_handoff(uuid) to authenticated;
grant execute on function public.record_support_handoff_outcome(uuid, text, text, uuid, uuid) to authenticated;
grant execute on function public.withdraw_support_handoff(uuid, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.raise_support_handoff(text,uuid,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_support_handoff_outcome(uuid,text,text,uuid,uuid)', 'EXECUTE') then
    raise exception 'support hand-off RPCs must not be executable by anon';
  end if;
  if has_table_privilege('anon', 'public.support_handoffs', 'SELECT') then
    raise exception 'anon must not read support_handoffs';
  end if;
  begin
    insert into public.support_handoffs (organisation_id, source, source_id, destination, reason, raised_by)
    values (gen_random_uuid(), 'support_ticket', gen_random_uuid(), 'clinical', 'a clinical destination must be refused', gen_random_uuid());
    raise exception 'FAIL: a clinical destination was accepted';
  exception when check_violation then
    null;
  end;
end $$;
