-- Chronic-care conversion offer (revenue-architecture spec §10/Line 6).
--
-- The gap this closes: care_plan_recommendations (20260716181000) is a
-- CLINICAL action only — accept promotes it into a care_plans row, dismiss
-- clears it, neither touches billing. There was no path anywhere in the
-- clinician console from "I've just told this patient they have
-- hypertension" to "here's a paid programme that gets you monthly doctor
-- review" — the single highest-conversion moment on the platform per the
-- spec ("a cold consumer will not subscribe to chronic care. A person who
-- has just seen their own numbers, in a consultation with a doctor who
-- explained what it means, will") had no commercial follow-through at all.
--
-- This is deliberately a separate, optional object rather than a new
-- care_plan_recommendations column: a recommendation can be accepted into a
-- care plan with or without ever generating a paid-plan offer (Tarragon
-- Free already gets the clinical recommendation engine — see the
-- 2026-08-10 vitals-escalation gating precedent for "doctor time is a
-- paid-plan feature, clinical safety never is"), and one recommendation
-- could in principle prompt more than one offer over time (e.g. re-offered
-- after the first lapses). Never gates what a clinician can SEE — matches
-- the standing rule "Clinician view is never gated by the patient's own
-- subscription tier" (apps/web/src/app/(dashboard)/clinician/patients/
-- [patientId]/page.tsx) — this only adds an action a clinician can take,
-- it changes no read path.
--
-- Checkout is NOT reimplemented here: accepting an offer sends the patient
-- to the existing self-serve subscription checkout
-- (patient/subscription/actions.ts) or the existing sponsored-subscription
-- checkout (sponsored-subscription-checkout.ts, for a diaspora sponsor
-- paying for a parent's programme) with the recommended plan pre-selected —
-- both already move real money through Paystack/Stripe. This table only
-- records that the offer was made, to whom, why, and what happened to it.

create type public.chronic_offer_status as enum ('offered', 'accepted', 'declined', 'expired');

create table public.chronic_programme_offers (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  recommendation_id     uuid references public.care_plan_recommendations (id) on delete set null,
  condition             public.care_plan_condition not null,
  recommended_plan_code text not null,
  message               text not null,
  generated_by          uuid not null references public.profiles (id) on delete restrict,
  generated_at          timestamptz not null default now(),
  status                public.chronic_offer_status not null default 'offered',
  responded_at          timestamptz,
  subscription_id       uuid references public.subscriptions (id) on delete set null,
  created_at            timestamptz not null default now()
);

create index chronic_programme_offers_patient_idx
  on public.chronic_programme_offers (patient_id, status);
create index chronic_programme_offers_org_idx
  on public.chronic_programme_offers (organisation_id);

-- At most one open (offered) offer per patient — a clinician re-offering
-- should expire the old one first, not pile up duplicates the patient sees
-- as spam.
create unique index chronic_programme_offers_one_open
  on public.chronic_programme_offers (patient_id)
  where status = 'offered';

alter table public.chronic_programme_offers enable row level security;

create policy chronic_programme_offers_select on public.chronic_programme_offers
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
  );

grant select on public.chronic_programme_offers to authenticated;

-- Clinician-only generation. Deliberately role = 'clinician' specifically
-- (not the broader is_org_staff set) — this is a personalised clinical
-- recommendation dressed as a commercial offer ("Dr Adetunbi recommends the
-- Essential Check"), not logistics, so it gets the same authority floor as
-- the recommendation it is usually generated from, and stays outside what a
-- Care Coordinator may do (see the Clinical Tier Ladder's "must never gain
-- write access to..." boundary — this isn't in that forbidden list, but a
-- personalised-numbers-based plan pitch is clinical judgment, not
-- logistics, so it stays with clinician).
create or replace function public.generate_chronic_programme_offer(
  p_patient_id uuid,
  p_recommendation_id uuid,
  p_recommended_plan_code text,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_caller_role public.user_role;
  v_org uuid;
  v_patient_org uuid;
  v_condition public.care_plan_condition;
  v_offer_id uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  select role, organisation_id into v_caller_role, v_org from public.profiles where id = v_caller;
  if v_caller_role <> 'clinician' then
    raise exception 'only a clinician can generate a programme offer' using errcode = '42501';
  end if;

  select organisation_id into v_patient_org from public.profiles where id = p_patient_id;
  if v_patient_org is null or v_patient_org <> v_org then
    raise exception 'patient not found in this organisation';
  end if;

  if not exists (
    select 1 from public.subscription_plans
    where code = p_recommended_plan_code and is_active
  ) then
    raise exception 'unknown or inactive plan code %', p_recommended_plan_code;
  end if;

  if p_recommendation_id is not null then
    select condition into v_condition
    from public.care_plan_recommendations
    where id = p_recommendation_id and patient_id = p_patient_id;
    if v_condition is null then
      raise exception 'recommendation not found for this patient';
    end if;
  else
    v_condition := 'other';
  end if;

  -- Superseding: an existing open offer is expired before the new one is
  -- made, so the unique partial index never blocks a re-offer.
  update public.chronic_programme_offers
     set status = 'expired', responded_at = now()
   where patient_id = p_patient_id and status = 'offered';

  insert into public.chronic_programme_offers
    (organisation_id, patient_id, recommendation_id, condition, recommended_plan_code, message, generated_by)
  values
    (v_org, p_patient_id, p_recommendation_id, v_condition, p_recommended_plan_code, p_message, v_caller)
  returning id into v_offer_id;

  return jsonb_build_object('ok', true, 'offer_id', v_offer_id);
end;
$$;

revoke all on function public.generate_chronic_programme_offer(uuid, uuid, text, text) from public, anon;
grant execute on function public.generate_chronic_programme_offer(uuid, uuid, text, text) to authenticated;

-- Patient-side dismissal — declining costs nothing and must stay genuinely
-- easy (§10: "making cancellation hard destroys word of mouth"; the same
-- posture applies to declining an offer in the first place).
create or replace function public.decline_chronic_programme_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  update public.chronic_programme_offers
     set status = 'declined', responded_at = now()
   where id = p_offer_id and patient_id = v_caller and status = 'offered';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Offer not found or already responded to.');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.decline_chronic_programme_offer(uuid) from public, anon;
grant execute on function public.decline_chronic_programme_offer(uuid) to authenticated;

-- Marks an offer accepted once the patient's subscription actually goes
-- active — mirrors private.maybe_reward_referral's own subscriptions
-- trigger rather than trusting the client to call a separate "I accepted"
-- action that might race the real payment.
create or replace function private.chronic_offer_on_subscription_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' and old.status is distinct from new.status then
    update public.chronic_programme_offers
       set status = 'accepted', responded_at = now(), subscription_id = new.id
     where patient_id = new.subscriber_id and status = 'offered';
  end if;
  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists subscriptions_chronic_offer_accepted on public.subscriptions;
create trigger subscriptions_chronic_offer_accepted
  after update on public.subscriptions
  for each row execute function private.chronic_offer_on_subscription_active();

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'chronic_programme_offers' and cmd <> 'SELECT'
  ) then
    raise exception 'chronic_programme_offers must have no direct write policy: writes go through definer RPCs/triggers only';
  end if;
end $$;;
