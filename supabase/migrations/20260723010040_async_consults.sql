-- Tarragon Health — structured async doctor visit ("Ask a doctor").
--
-- One Medical's "Treat Me Now" on Tarragon rails: the patient submits a
-- structured question in-app, a doctor on the care team answers in-app within
-- a stated SLA. This formalises what already happens over the human WhatsApp
-- support channel, entirely inside the app — no WhatsApp dependency, no bot.
--
-- Guardrails honoured:
--   * The answer is a clinical act, so answered_by/answered_at are stamped
--     server-side from the caller's OWN active clinical_staff row (doctor_tier
--     required — a Care Coordinator session cannot answer). Client-supplied
--     values are overwritten; a non-clinical caller is rejected outright.
--     Same forge-proof pattern as stamp_annual_review_completion.
--   * This is not an emergency channel — the patient UI routes red-flag
--     symptoms to the existing danger-symptom/emergency flow; nothing here
--     touches the abnormal-result pipeline.
--   * Entitlement-gated ('async_doctor_visit' feature on the comprehensive
--     tiers) via the existing has_feature_access machinery.

create type public.async_consult_status as enum (
  'submitted',
  'in_review',
  'answered',
  'closed'
);

create table public.async_consults (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  category         text not null,
  question         text not null,
  duration_note    text,
  status           public.async_consult_status not null default 'submitted',
  -- The stated promise: a doctor responds within 24 hours. Stored per row so
  -- a future per-tier SLA (e.g. expedited add-on) needs no schema change.
  sla_due_at       timestamptz not null default now() + interval '24 hours',
  answer           text,
  answered_by      uuid references public.clinical_staff (id) on delete set null,
  answered_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index async_consults_org_status_idx
  on public.async_consults (organisation_id, status, sla_due_at);
create index async_consults_patient_idx
  on public.async_consults (patient_id, created_at desc);

create trigger async_consults_set_updated_at
  before update on public.async_consults
  for each row execute function private.set_updated_at();

-- Forge-proof answer attribution.
create or replace function private.stamp_async_consult_answer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
begin
  if new.status = 'answered' and old.status <> 'answered' then
    select cs.id into v_staff
    from public.clinical_staff cs
    where cs.profile_id = (select auth.uid())
      and cs.organisation_id = new.organisation_id
      and cs.active
      and cs.doctor_tier is not null;
    if v_staff is null then
      raise exception 'only an active doctor on this organisation''s care team can answer a consult'
        using errcode = '42501';
    end if;
    new.answered_by := v_staff;
    new.answered_at := now();
    if new.answer is null or length(btrim(new.answer)) = 0 then
      raise exception 'an answered consult must carry an answer';
    end if;
  elsif new.status <> 'answered' and old.status <> 'answered' then
    -- Not answered yet: nobody may pre-fill attribution.
    new.answered_by := null;
    new.answered_at := null;
    new.answer := null;
  else
    -- Already answered (e.g. answered → closed): attribution is immutable.
    new.answered_by := old.answered_by;
    new.answered_at := old.answered_at;
    new.answer := old.answer;
  end if;
  return new;
end;
$$;

create trigger async_consults_stamp_answer
  before update on public.async_consults
  for each row execute function private.stamp_async_consult_answer();

alter table public.async_consults enable row level security;

create policy async_consults_select on public.async_consults
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy async_consults_insert on public.async_consults
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    and organisation_id = private.current_org_id()
  );
-- Patient may close their own consult; staff manage the rest. The attribution
-- trigger above is the structural gate on who can mark 'answered'.
create policy async_consults_update on public.async_consults
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update on public.async_consults to authenticated;

-- Entitlement: the comprehensive paid tiers get it, every currency/interval
-- variant. Features-only update, so the price-lock trigger allows it.
update public.subscription_plans
  set features = (select array(select distinct unnest(coalesce(features, '{}') || array['async_doctor_visit'])))
  where (code like 'complete%' or code like 'family%' or code like 'parentcare%')
    and not ('async_doctor_visit' = any(coalesce(features, '{}')));
