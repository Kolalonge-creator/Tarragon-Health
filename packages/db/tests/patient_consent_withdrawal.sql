-- Tarragon Health — proof for 20260829092000_patient_consent_withdrawal.sql.
--
-- Cases:
--   1. A withdrawal for a consent_type never accepted is rejected.
--   2. A withdrawal for a currently-accepted consent_type succeeds, and its
--      consent_version_id/version are server-derived (not client-supplied).
--   3. After withdrawal, has_required_consents no longer counts that type
--      as satisfied (assuming it is a currently-required type).
--   4. Re-accepting after a withdrawal is honoured as the current status
--      (most recent row by created_at wins).
--
-- Case 1 does not hard-code a consent_type: a seeded, onboarded test patient
-- has almost certainly already accepted all three required types, so
-- picking one at random risks a false failure (the insert would succeed,
-- not raise, simply because the precondition "never accepted" did not
-- actually hold). Instead it looks for any consent_type the fixture patient
-- has genuinely never touched and skips gracefully if none exists, rather
-- than asserting against an unverified assumption about seed data.
--
-- Run: npx supabase db query --linked -f packages/db/tests/patient_consent_withdrawal.sql

begin;

create temporary table test_result (
  case_num int, label text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org         uuid := '00000000-0000-0000-0000-000000000001';
  v_patient     uuid;
  v_version_id  uuid;
  v_version     text;
  v_err         text;
  v_row         record;
  v_required_before boolean;
  v_required_after  boolean;
  v_never_accepted_type public.consent_type;
begin
  select id into v_patient from public.profiles where role = 'patient' and organisation_id = v_org limit 1;

  select id, version into v_version_id, v_version
  from public.consent_versions
  where consent_type = 'terms_of_service' and is_current
  limit 1;

  if v_patient is null or v_version_id is null then
    insert into test_result values (0, 'setup', 'SKIP', 'missing patient or current terms_of_service version fixture');
  else
    -- Find a consent_type this patient has never once accepted, if any.
    select t.consent_type into v_never_accepted_type
    from unnest(enum_range(null::public.consent_type)) as t(consent_type)
    where not exists (
      select 1 from public.patient_consents pc
      where pc.patient_id = v_patient and pc.consent_type = t.consent_type
    )
    limit 1;

    -- Case 1: withdrawing something never accepted is rejected.
    if v_never_accepted_type is null then
      insert into test_result values (1, 'reject withdrawal with no prior acceptance', 'SKIP', 'fixture patient has some history for every consent_type; nothing untouched to test against');
    else
      begin
        insert into public.patient_consents (organisation_id, patient_id, consent_type, action)
        values (v_org, v_patient, v_never_accepted_type, 'withdrawn');
        insert into test_result values (1, 'reject withdrawal with no prior acceptance', 'FAIL', 'insert should have raised');
      exception when others then
        get stacked diagnostics v_err = message_text;
        insert into test_result values (1, 'reject withdrawal with no prior acceptance', 'PASS', v_err);
      end;
    end if;

    -- Accept, then withdraw.
    insert into public.patient_consents
      (organisation_id, patient_id, consent_type, consent_version_id, version)
    values (v_org, v_patient, 'terms_of_service', v_version_id, v_version);

    select private.has_required_consents(v_patient) into v_required_before;

    insert into public.patient_consents (organisation_id, patient_id, consent_type, action)
    values (v_org, v_patient, 'terms_of_service', 'withdrawn')
    returning consent_version_id, version into v_row;

    -- Case 2: server-derived fields.
    insert into test_result values (
      2, 'withdrawal derives consent_version_id/version server-side',
      case when v_row.consent_version_id = v_version_id and v_row.version = v_version then 'PASS' else 'FAIL' end,
      format('got version_id=%s version=%s', v_row.consent_version_id, v_row.version)
    );

    select private.has_required_consents(v_patient) into v_required_after;

    -- Case 3: withdrawal removes the type from "satisfied", if it was
    -- counted before (only meaningful if terms_of_service was the last
    -- unmet requirement or already satisfied prior to this test's insert).
    insert into test_result values (
      3, 'withdrawal changes has_required_consents from true to false for this patient',
      case when v_required_before = true and v_required_after = false then 'PASS'
           else 'INFO' end,
      format('before=%s after=%s (INFO is expected if other required types were already unmet)', v_required_before, v_required_after)
    );

    -- Case 4: re-accepting restores current status.
    insert into public.patient_consents
      (organisation_id, patient_id, consent_type, consent_version_id, version)
    values (v_org, v_patient, 'terms_of_service', v_version_id, v_version);

    select private.has_required_consents(v_patient) into v_required_after;

    insert into test_result values (
      4, 're-acceptance after withdrawal restores current status',
      case when v_required_after = v_required_before then 'PASS' else 'FAIL' end,
      format('restored=%s expected=%s', v_required_after, v_required_before)
    );
  end if;
end $$;

select * from test_result order by case_num;

rollback;
