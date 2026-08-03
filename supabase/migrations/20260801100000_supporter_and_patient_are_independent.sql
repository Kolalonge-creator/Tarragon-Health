-- Supporting someone and being a patient are independent, not alternatives.
--
-- `account_purpose` ('care' | 'support'), added earlier today in
-- 20260801093000, encoded a false exclusivity: it could not represent the
-- ordinary case of a daughter who funds her mother's care AND uses Tarragon
-- for her own. Founder decision, 2026-08-01:
--
--   1. A supporter may also join as a patient, on any plan including Free,
--      if they choose to — and must then answer everything, because the
--      screening calendar and risk scoring are built from those answers.
--      A half-answered patient is worse than no patient: the engine silently
--      produces a thinner schedule rather than an obviously empty one.
--   2. A supporter who has NOT chosen that must not reach the patient
--      surfaces at all — not merely have them hidden from the menu.
--   3. Both at once must work.
--
-- So the state that matters is one question — does this person receive care
-- here? — and it is now its own flag. Being a supporter needs no column at
-- all: it is already fully expressed by holding a `profile_access` grant,
-- which is the thing that actually confers the ability, and which the person
-- being supported can revoke. Two independent facts, so all four combinations
-- exist, including neither (a new account that has done nothing yet).

alter table public.profiles
  add column if not exists receives_care boolean not null default true;

comment on column public.profiles.receives_care is
  'Does this person receive care here. TRUE = a patient: the full consent set, date of birth and sex are required, and the clinical surfaces are theirs. FALSE = they only fund and follow somebody else''s care, so we ask nothing about their health and the patient surfaces are refused (see proxy.ts). Being a SUPPORTER is deliberately not a column: it is holding a profile_access grant, which is revocable by the person supported. The two are independent, so somebody can be both.';

-- Carry over the enum this replaces, then remove it so there is one answer to
-- the question rather than two that can disagree. The old trigger reads the
-- column, so it has to go first — dropping with CASCADE instead would remove
-- the guard silently, which is exactly the sort of quiet loss of an
-- enforcement point this file is trying to avoid.
update public.profiles set receives_care = (account_purpose <> 'support');
drop trigger if exists enforce_care_purpose_switch on public.profiles;
drop function if exists private.enforce_care_purpose_switch();
alter table public.profiles drop column if exists account_purpose;
drop type if exists public.account_purpose;

-- Onboarding: everything, or the terms alone.
--
-- The strict branch is keyed on the NEW value, so switching receives_care on
-- must satisfy every original prerequisite at that moment. There is no path
-- to receiving care without the consents; the requirement moved, it did not
-- weaken.
create or replace function private.enforce_onboarding_prereqs()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.onboarding_completed_at is not null
     and old.onboarding_completed_at is null
     and new.role = 'patient' then

    if not new.receives_care then
      -- A supporter is a customer, not a patient. They still have to accept
      -- the terms they are transacting under, and nothing beyond that: a
      -- person who will never be treated here has no telehealth relationship
      -- to consent to and no health data we have a basis to hold.
      if not exists (
        select 1
          from public.patient_consents pc
         where pc.patient_id = new.id
           and pc.consent_type = 'terms_of_service'
      ) then
        raise exception 'Please accept the terms of service to continue'
          using errcode = 'check_violation';
      end if;
      return new;
    end if;

    if new.date_of_birth is null or new.sex is null then
      raise exception 'Onboarding cannot complete without date of birth and sex on file'
        using errcode = 'check_violation';
    end if;
    if not private.has_required_consents(new.id) then
      raise exception 'Onboarding cannot complete without accepting the required consents'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- Deciding to become a patient later must re-impose the full set. Without
-- this, an account could complete onboarding cheaply as a supporter and then
-- quietly flip, which would be a worse hole than the friction this removed.
--
-- The supported route is to clear onboarding_completed_at in the same
-- statement, which sends them back through the whole patient flow — including
-- the intake questions the screening and risk engines are built from — rather
-- than around it.
drop trigger if exists enforce_care_purpose_switch on public.profiles;
drop function if exists private.enforce_care_purpose_switch();

create or replace function private.enforce_receives_care_switch()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.receives_care
     and not old.receives_care
     and new.onboarding_completed_at is not null then
    if new.date_of_birth is null or new.sex is null
       or not private.has_required_consents(new.id) then
      raise exception 'Joining as a patient needs your date of birth and the care consents'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_receives_care_switch
  before update of receives_care on public.profiles
  for each row execute function private.enforce_receives_care_switch();

do $$
begin
  if exists (select 1 from pg_type where typname = 'account_purpose') then
    raise exception 'account_purpose must be gone: it encoded an exclusivity that is not real';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'enforce_receives_care_switch') then
    raise exception 'the join-as-a-patient guard is missing';
  end if;
  -- Nobody is silently reclassified: every account that existed receives care.
  if exists (select 1 from public.profiles where not receives_care) then
    raise exception 'no existing account should have been turned into a supporter-only account';
  end if;
end $$;
