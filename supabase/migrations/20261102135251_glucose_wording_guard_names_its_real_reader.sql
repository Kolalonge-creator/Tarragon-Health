-- The glucose_fast_sugar_wording go-live guard's enforced_in named "glucose_fast_sugar_wording_in_force", a function that does not
-- exist in the database. What actually puts the signed wording in force is the build: packages/i18n/src/glucose-wording.json
-- `signed` (transcribed from this guard's own attestation on 2026-11-02) read by activeGlucoseWording(); the sign-off hub
-- (apps/web/src/lib/queries/cmo-signing-hub.ts) cross-checks the attestation against that build flag. Data-only: the hub text now
-- points a reader at the real mechanism.

update public.go_live_guards
   set enforced_in = array[
     'packages/i18n/src/glucose-wording.json `signed` (the build), read by activeGlucoseWording() for every triage.glu_* and triage.cuf_001 string',
     'apps/web/src/lib/queries/cmo-signing-hub.ts: shows "signed but not yet in the app" while the attestation is met and the build flag is null'
   ]
 where key = 'glucose_fast_sugar_wording'
   and enforced_in @> array['glucose_fast_sugar_wording_in_force'];

do $$
begin
  if (select enforced_in from public.go_live_guards where key = 'glucose_fast_sugar_wording') @> array['glucose_fast_sugar_wording_in_force'] then
    raise exception 'FAIL: the guard still names a function that does not exist';
  end if;
end $$;
