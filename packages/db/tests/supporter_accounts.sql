-- Proves 20260801093000_supporter_accounts.sql.
--
-- The point of this file is the pair of checks at the end. Relaxing onboarding
-- for a payer is only defensible if becoming a patient later re-imposes
-- everything — otherwise it is not a shorter path, it is a way around consent.
--
--   npx supabase db query --linked -f packages/db/tests/supporter_accounts.sql

begin;

create temp table results(check_name text, expected text, actual text) on commit drop;

do $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_supporter uuid;
  v_patient uuid;
  v_tos uuid;
  v_tos_version text;
begin
  select id into v_supporter from public.profiles
   where id in (select id from auth.users where email = 'patient.diaspora.test@tarragon.test');
  select id into v_patient from public.profiles
   where id in (select id from auth.users where email = 'patient.free.test@tarragon.test');

  select id, version into v_tos, v_tos_version
    from public.consent_versions where consent_type = 'terms_of_service' and is_current limit 1;

  -- Reset both to a pre-onboarding state for the test.
  update public.profiles set onboarding_completed_at = null, account_purpose = 'care'
   where id in (v_supporter, v_patient);
  delete from public.patient_consents where patient_id = v_supporter;

  ------------------------------------------------------------------
  -- 1. A supporter with no consent at all is still refused.
  ------------------------------------------------------------------
  update public.profiles set account_purpose = 'support' where id = v_supporter;
  begin
    update public.profiles set onboarding_completed_at = now() where id = v_supporter;
    insert into results values ('supporter with no terms accepted is refused', 'blocked', 'allowed');
  exception when check_violation then
    insert into results values ('supporter with no terms accepted is refused', 'blocked', 'blocked');
  end;

  ------------------------------------------------------------------
  -- 2. Terms alone is enough for a supporter — no DOB, no sex, no
  --    telehealth or data-processing consent, because none of it is true
  --    of somebody who will never receive care here.
  ------------------------------------------------------------------
  insert into public.patient_consents
    (organisation_id, patient_id, consent_type, consent_version_id, version)
  values (v_org, v_supporter, 'terms_of_service', v_tos, v_tos_version);

  update public.profiles set onboarding_completed_at = now() where id = v_supporter;

  insert into results
  select 'supporter completes on terms alone', 'true',
         (onboarding_completed_at is not null)::text
    from public.profiles where id = v_supporter;

  insert into results
  select 'and was never asked for a date of birth', 'true',
         (date_of_birth is null)::text from public.profiles where id = v_supporter;

  ------------------------------------------------------------------
  -- 3. THE CHECK THAT MATTERS: an onboarded supporter cannot simply
  --    become a patient. Without this the shorter path would be a
  --    consent bypass rather than a correct scoping of what we ask.
  ------------------------------------------------------------------
  begin
    update public.profiles set account_purpose = 'care' where id = v_supporter;
    insert into results values ('an onboarded supporter cannot flip to care', 'blocked', 'allowed');
  exception when check_violation then
    insert into results values ('an onboarded supporter cannot flip to care', 'blocked', 'blocked');
  end;

  -- The supported route: clear onboarding in the same statement, which sends
  -- them back through the full patient flow rather than around it.
  update public.profiles
     set account_purpose = 'care', onboarding_completed_at = null
   where id = v_supporter;

  insert into results
  select 'they can restart as a patient instead', 'care',
         account_purpose::text from public.profiles where id = v_supporter;

  -- ...and that full flow still demands everything it always did.
  begin
    update public.profiles set onboarding_completed_at = now() where id = v_supporter;
    insert into results values ('the full patient prerequisites still apply', 'blocked', 'allowed');
  exception when check_violation then
    insert into results values ('the full patient prerequisites still apply', 'blocked', 'blocked');
  end;

  ------------------------------------------------------------------
  -- 4. Control: a normal patient is completely unaffected.
  ------------------------------------------------------------------
  begin
    update public.profiles set onboarding_completed_at = now() where id = v_patient;
    insert into results values ('a care patient with no consents is still refused', 'blocked', 'allowed');
  exception when check_violation then
    insert into results values ('a care patient with no consents is still refused', 'blocked', 'blocked');
  end;
end $$;

select check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results;

do $$
declare v_fail int;
begin
  select count(*) into v_fail from results where expected <> actual;
  if v_fail > 0 then
    raise exception '% supporter check(s) failed', v_fail;
  end if;
end $$;

rollback;
