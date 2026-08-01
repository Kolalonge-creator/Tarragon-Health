-- Proves 20260801100000_supporter_and_patient_are_independent.sql.
--
-- Supporting somebody and being a patient are independent facts, so all four
-- combinations have to work — including BOTH, which the enum this replaced
-- could not represent at all. And relaxing onboarding for a payer is only
-- defensible if joining as a patient later re-imposes everything; otherwise it
-- is not a shorter path, it is a way around consent. Those are the checks that
-- matter here.
--
--   npx supabase db query --linked -f packages/db/tests/supporter_accounts.sql

begin;

create temp table results(check_name text, expected text, actual text) on commit drop;

do $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_supporter uuid;   -- funds someone, receives no care
  v_both uuid;        -- funds someone AND is a patient
  v_mum uuid;         -- the person being supported
  v_tos uuid;
  v_tos_version text;
begin
  select id into v_supporter from public.profiles
   where id in (select id from auth.users where email = 'patient.diaspora.test@tarragon.test');
  select id into v_both from public.profiles
   where id in (select id from auth.users where email = 'patient.free.test@tarragon.test');
  select id into v_mum from public.profiles
   where id in (select id from auth.users where email = 'patient.complete.test@tarragon.test');

  select id, version into v_tos, v_tos_version
    from public.consent_versions where consent_type = 'terms_of_service' and is_current limit 1;

  update public.profiles set onboarding_completed_at = null, receives_care = true
   where id in (v_supporter, v_both);
  delete from public.patient_consents where patient_id = v_supporter;

  ------------------------------------------------------------------
  -- 1. A supporter with no consent at all is still refused.
  ------------------------------------------------------------------
  update public.profiles set receives_care = false where id = v_supporter;
  begin
    update public.profiles set onboarding_completed_at = now() where id = v_supporter;
    insert into results values ('supporter with no terms accepted is refused', 'blocked', 'allowed');
  exception when check_violation then
    insert into results values ('supporter with no terms accepted is refused', 'blocked', 'blocked');
  end;

  ------------------------------------------------------------------
  -- 2. Terms alone is enough — no DOB, no sex, no telehealth or
  --    data-processing consent, because none of it is true of somebody
  --    who will never receive care here.
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
  -- 3. Supporting is a profile_access grant, not a column — so it is
  --    orthogonal to receiving care, and a supporter-only account holds
  --    a real grant while receiving none.
  ------------------------------------------------------------------
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_mum, v_supporter, 'manage', v_mum);

  insert into results
  select 'a supporter-only account: supports, receives no care', 'supports=true care=false',
         format('supports=%s care=%s',
                exists(select 1 from public.profile_access
                        where grantee_user_id = v_supporter)::text,
                (select receives_care from public.profiles where id = v_supporter)::text);

  ------------------------------------------------------------------
  -- 4. THE CHECK THAT MATTERS: an onboarded supporter cannot simply
  --    become a patient. Without this the shorter path is a consent
  --    bypass rather than a correct scoping of what we ask.
  ------------------------------------------------------------------
  begin
    update public.profiles set receives_care = true where id = v_supporter;
    insert into results values ('an onboarded supporter cannot just flip to patient', 'blocked', 'allowed');
  exception when check_violation then
    insert into results values ('an onboarded supporter cannot just flip to patient', 'blocked', 'blocked');
  end;

  -- The supported route: clear onboarding in the same statement, which sends
  -- them back through the whole patient flow rather than around it.
  update public.profiles
     set receives_care = true, onboarding_completed_at = null
   where id = v_supporter;

  -- ...and that full flow still demands everything it always did.
  begin
    update public.profiles set onboarding_completed_at = now() where id = v_supporter;
    insert into results values ('joining as a patient demands the full set', 'blocked', 'allowed');
  exception when check_violation then
    insert into results values ('joining as a patient demands the full set', 'blocked', 'blocked');
  end;

  -- Joining does not drop who they support.
  insert into results
  select 'joining as a patient keeps their support grant', 'true',
         exists(select 1 from public.profile_access where grantee_user_id = v_supporter)::text;

  ------------------------------------------------------------------
  -- 5. BOTH AT ONCE — the case the previous enum could not express.
  ------------------------------------------------------------------
  update public.profiles
     set date_of_birth = '1980-01-01', sex = 'female', receives_care = true
   where id = v_both;
  -- Clear first: has_required_consents matches the CURRENT version, so an
  -- account holding an older accepted version would otherwise be skipped by a
  -- not-exists guard and left stale.
  delete from public.patient_consents where patient_id = v_both;
  insert into public.patient_consents
    (organisation_id, patient_id, consent_type, consent_version_id, version)
  select v_org, v_both, cv.consent_type, cv.id, cv.version
    from public.consent_versions cv where cv.is_current;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_mum, v_both, 'manage', v_mum);

  update public.profiles set onboarding_completed_at = now() where id = v_both;

  insert into results
  select 'someone can be a patient AND a supporter at once', 'care=true supports=true',
         format('care=%s supports=%s',
                (select receives_care from public.profiles where id = v_both)::text,
                exists(select 1 from public.profile_access
                        where grantee_user_id = v_both)::text);

  ------------------------------------------------------------------
  -- 6. Control: a normal patient is completely unaffected.
  ------------------------------------------------------------------
  update public.profiles set onboarding_completed_at = null where id = v_both;
  delete from public.patient_consents where patient_id = v_both;
  begin
    update public.profiles set onboarding_completed_at = now() where id = v_both;
    insert into results values ('a patient with no consents is still refused', 'blocked', 'allowed');
  exception when check_violation then
    insert into results values ('a patient with no consents is still refused', 'blocked', 'blocked');
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
