-- A payer is not a patient, and should not have to become one to pay.
--
-- Walking the sponsor journey, the very first wall was this: before reaching
-- anything at all, someone whose only intention was to fund their mother's
-- care in Lagos had to complete full PATIENT onboarding — consent to how
-- *their own* health information is used, consent to receive *remote care
-- themselves*, plus their own date of birth and sex. The database enforced it,
-- so it was not a UI oversight.
--
-- That is a hard stop at the single highest-intent moment the product has:
-- somebody with their card out, trying to give you money for someone else.
-- It also asks for consents that are not true. A person who will never receive
-- care through Tarragon has no telehealth relationship to consent to, and
-- collecting their date of birth to process it is data we have no basis to
-- hold.
--
-- So an account now says what it is for. A supporter accepts the terms of
-- service — that is a real contract, they are paying us — and nothing else.
-- The full patient consent set is still required in exactly the case it was
-- always about: someone receiving care. It is simply collected when they
-- decide to receive care, rather than as a toll gate on paying for someone
-- else's.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'account_purpose') then
    create type public.account_purpose as enum ('care', 'support');
  end if;
end $$;

alter table public.profiles
  add column if not exists account_purpose public.account_purpose not null default 'care';

comment on column public.profiles.account_purpose is
  '''care'' = this person receives care here and needs the full patient consent set. ''support'' = this person only funds and follows someone else''s care; they accept the terms of service and nothing more, because there is no telehealth relationship to consent to and no lawful basis to collect their health data. Switching to ''care'' re-imposes every patient prerequisite, so this can never be used to skip consent for someone actually being treated.';

-- The gate, relaxed for supporters and UNCHANGED for anyone receiving care.
--
-- Note the shape carefully: the strict branch is keyed on the NEW value of
-- account_purpose, so an account that later switches to 'care' must satisfy
-- every original prerequisite at that moment. There is no path where somebody
-- receives care without the consents; the requirement moved, it did not
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

    if new.account_purpose = 'support' then
      -- A supporter is a customer, not a patient. They still have to accept
      -- the terms they are transacting under.
      -- patient_consents keys on patient_id, not profile_id. A plpgsql body is
      -- not resolved until it runs, so getting this wrong created a function
      -- that built cleanly and then threw on the first real supporter — caught
      -- only by walking the signup in a browser.
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

-- Becoming a patient later must re-impose the full set. Without this, an
-- account could complete onboarding cheaply as 'support' and then quietly flip
-- to 'care' with no consent on file — which would be a worse hole than the one
-- this migration opened the door to closing.
create or replace function private.enforce_care_purpose_switch()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.account_purpose = 'care'
     and old.account_purpose = 'support'
     and new.onboarding_completed_at is not null then
    if new.date_of_birth is null or new.sex is null
       or not private.has_required_consents(new.id) then
      raise exception 'Setting up your own care needs your date of birth and the care consents'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_care_purpose_switch on public.profiles;
create trigger enforce_care_purpose_switch
  before update of account_purpose on public.profiles
  for each row execute function private.enforce_care_purpose_switch();

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'enforce_care_purpose_switch') then
    raise exception 'the care-purpose switch guard is missing';
  end if;
  -- Everyone who already exists receives care; nobody is silently reclassified.
  if exists (select 1 from public.profiles where account_purpose <> 'care') then
    raise exception 'existing accounts must all remain purpose=care';
  end if;
end $$;
