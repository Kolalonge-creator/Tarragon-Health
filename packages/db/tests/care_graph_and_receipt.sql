-- Proves the consent-scoped family care graph:
--   20260807010452_care_access_events.sql
--   20260807010837_care_graph_unification.sql
--   20260807012000_care_receipt.sql
--
-- The migrations assert their own STRUCTURE (policy shapes, grants, the
-- disclosure guards in the function body). This file asserts the BEHAVIOUR that
-- structure is supposed to produce, under real simulated sessions, because the
-- only question that matters is what an actual signed-in supporter can read.
--
-- The scenario throughout is the one the feature exists for: a mother in Lagos
-- (mum), a daughter abroad who pays for her care (sponsor), a brother in Abuja
-- named as next of kin (kin), and an unrelated patient (stranger).
--
-- Note on shape: roles are switched with top-level `set local role` rather than
-- inside a DO block. Inside plpgsql the first statement after the switch is
-- planned before the new role takes effect and fails spuriously — the same
-- footnote every other RLS test in this directory carries.
--
--   npx supabase db query --linked -f packages/db/tests/care_graph_and_receipt.sql

begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
create temp table ids(k text primary key, v uuid) on commit drop;
grant all on results to authenticated;
grant all on ids to authenticated;

insert into ids select 'mum',      id from public.profiles
 where id in (select id from auth.users where email = 'patient.complete.test@tarragon.test');
insert into ids select 'sponsor',  id from public.profiles
 where id in (select id from auth.users where email = 'patient.diaspora.test@tarragon.test');
insert into ids select 'kin',      id from public.profiles
 where id in (select id from auth.users where email = 'patient.free.test@tarragon.test');
insert into ids select 'stranger', id from public.profiles
 where id in (select id from auth.users where email = 'patient.essential.test@tarragon.test');
insert into ids select 'org', organisation_id from public.profiles
 where id = (select v from ids where k='mum');

-- Every care_access_events count below is scoped to events written by THIS
-- transaction. Counting all-time made the test order-dependent: a browser
-- verification session that left real audit rows behind broke three assertions
-- that had nothing wrong with them. now() is fixed for the whole transaction
-- and occurred_at defaults to it, so this selects exactly our own rows.
create temp table t0 as select now() as at;
grant all on t0 to authenticated;

-- Fail loudly rather than passing vacuously if the QA fixtures are missing.
do $$
begin
  if (select count(*) from ids where v is not null) < 5 then
    raise exception 'QA test accounts missing — recreate them before running this test (see project_qa_test_accounts_20260727)';
  end if;
end $$;

-- Two care events on mum's record inside the receipt window: one ordinary
-- (disclosable at the activity tier) and one heavier (withheld until consent).
-- Both carry clinical free text in `summary`, which is the thing the activity
-- tier must never emit.
insert into public.patient_timeline
  (organisation_id, patient_id, event_type, source_table, title, summary, occurred_at)
values
  ((select v from ids where k='org'), (select v from ids where k='mum'),
   'medication_dispensed', 'pharmacy_orders',
   'Medication dispensed', 'Amlodipine 10mg — dose increased after review', now() - interval '2 days'),
  ((select v from ids where k='org'), (select v from ids where k='mum'),
   'escalation_raised', 'escalations',
   'Escalation raised', 'Blood pressure above target — review adherence and titration', now() - interval '3 days');

insert into public.vitals_readings
  (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
values
  ((select v from ids where k='org'), (select v from ids where k='mum'),
   'blood_pressure', 156, 96, 'manual', now() - interval '2 days');

-- A prepaid voucher must name a real panel bundle (care_vouchers_kind_shape),
-- so the bundle is looked up rather than invented.
insert into ids select 'bundle', id from public.panel_bundles limit 1;

insert into public.care_vouchers
  (organisation_id, voucher_number, kind, beneficiary_profile_id, purchaser_profile_id,
   panel_bundle_id, sku_code, sku_name, face_value_kobo, amount_paid_kobo, status)
values
  ((select v from ids where k='org'), 'TEST-CG-0001', 'prepaid_service',
   (select v from ids where k='mum'), (select v from ids where k='sponsor'),
   (select v from ids where k='bundle'),
   'cervical-screen', 'Cervical Cancer Screening', 2500000, 2500000, 'active');

-- The two grants. Both start with clinical_access false — the consent trigger
-- forces that on insert however the grant was created, which is itself the
-- first thing worth checking.
insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
values ((select v from ids where k='mum'), (select v from ids where k='sponsor'), 'manage',
        (select v from ids where k='mum')),
       ((select v from ids where k='mum'), (select v from ids where k='kin'), 'view',
        (select v from ids where k='mum'))
on conflict (profile_id, grantee_user_id) do update
  set permission_level = excluded.permission_level;

-- Grant ids resolved once, as postgres. The revocation checks below run under
-- sessions that deliberately cannot see the row they are trying to revoke (a
-- stranger), so reading the id inside those sessions would make the test pass
-- by handing the function a null rather than by being refused.
insert into ids select 'sponsor_grant', id from public.profile_access
 where profile_id = (select v from ids where k='mum')
   and grantee_user_id = (select v from ids where k='sponsor');
insert into ids select 'kin_grant', id from public.profile_access
 where profile_id = (select v from ids where k='mum')
   and grantee_user_id = (select v from ids where k='kin');

insert into results select 'a new grant never carries clinical access', 'false',
  bool_or(clinical_access)::text from public.profile_access
 where profile_id = (select v from ids where k='mum');

insert into results select 'granting is written to the access log', '2',
  count(*)::text from public.care_access_events
 where patient_id = (select v from ids where k='mum') and kind = 'granted'
   and occurred_at >= (select at from t0);

------------------------------------------------------------------
-- The sponsor, holding 'manage' but NO clinical consent: activity tier
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='sponsor'), 'role','authenticated')::text, true);
set local role authenticated;

insert into results select 'an unconsented supporter still gets a receipt', 'activity',
  public.care_receipt((select v from ids where k='mum'))->>'tier';

-- The whole disclosure line, in one assertion: the receipt is rendered from the
-- fixed label vocabulary, so the clinician's own words are nowhere in it.
insert into results select 'the activity tier emits no clinical free text', 'false',
  (public.care_receipt((select v from ids where k='mum'))->'events')::text
    ilike '%titration%' or
  (public.care_receipt((select v from ids where k='mum'))->'events')::text
    ilike '%Amlodipine%';

insert into results select 'the activity tier uses the fixed label', 'true',
  (public.care_receipt((select v from ids where k='mum'))->'events')::text
    like '%Medication was dispensed%';

insert into results select 'the escalation is withheld without consent', '1',
  jsonb_array_length(public.care_receipt((select v from ids where k='mum'))->'events')::text;

-- jsonb_build_object turns a SQL NULL into JSON null rather than dropping the
-- key, so `-> 'care_status' is null` is false even when there is no content.
-- jsonb_typeof is the check that actually distinguishes "no case data" from
-- "case data present".
insert into results select 'care status is withheld without consent', 'null',
  jsonb_typeof(public.care_receipt((select v from ids where k='mum'))->'care_status');

-- Proof of care without disclosure of care: the reading is counted, never valued.
insert into results select 'the reading is counted', '1',
  public.care_receipt((select v from ids where k='mum'))->'summary'->>'readings_recorded';

insert into results select 'the reading value never appears', 'false',
  public.care_receipt((select v from ids where k='mum'))::text like '%156%';

-- The sponsor sees the voucher they themselves bought, consent or not.
insert into results select 'a purchaser always sees their own voucher', '1',
  count(*)::text from public.care_vouchers
 where beneficiary_profile_id = (select v from ids where k='mum');

-- One row, not one per call. Every assertion above pulled the receipt again —
-- eight calls in this block alone — and an access log that records each of them
-- separately is unreadable by the person it exists for. 20260807014200 folds
-- repeat use of the same surface by the same person into one row per hour.
insert into results select 'repeat views collapse to one log row', '1',
  count(*)::text from public.care_access_events
 where patient_id = (select v from ids where k='mum') and kind = 'receipt_generated'
   and occurred_at >= (select at from t0);

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- The next of kin, 'view' and no consent: must not read the voucher
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='kin'), 'role','authenticated')::text, true);
set local role authenticated;

-- The hole this build closed. Before 20260807010837 a bare grantee read every
-- voucher on the record, and sku_name says what care someone is receiving.
insert into results select 'an unconsented next of kin cannot read the voucher', '0',
  count(*)::text from public.care_vouchers
 where beneficiary_profile_id = (select v from ids where k='mum');

-- The access log is the patient's oversight of their supporters, not the
-- supporters' oversight of each other.
insert into results select 'a grantee cannot see another grantee''s activity', '0',
  count(*)::text from public.care_access_events
 where patient_id = (select v from ids where k='mum')
   and actor_profile_id = (select v from ids where k='sponsor')
   and occurred_at >= (select at from t0);

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- A stranger holds nothing
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='stranger'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
begin
  perform public.care_receipt((select v from ids where k='mum'));
  insert into results values ('a stranger cannot pull a receipt', 'blocked', 'allowed');
exception when others then
  insert into results values ('a stranger cannot pull a receipt', 'blocked', 'blocked');
end $$;

do $$
begin
  perform public.revoke_care_access((select v from ids where k='kin_grant'));
  insert into results values ('a stranger cannot revoke someone else''s grant', 'blocked', 'allowed');
exception when others then
  insert into results values ('a stranger cannot revoke someone else''s grant', 'blocked', 'blocked');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- The patient consents. The same call, the same supporter, more of the record.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='mum'), 'role','authenticated')::text, true);
set local role authenticated;

update public.profile_access set clinical_access = true
 where profile_id = (select v from ids where k='mum')
   and grantee_user_id = (select v from ids where k='sponsor');

insert into results select 'consent is written to the access log', '1',
  count(*)::text from public.care_access_events
 where patient_id = (select v from ids where k='mum') and kind = 'clinical_access_granted'
   and occurred_at >= (select at from t0);

-- The graph, from the record owner's side.
insert into results select 'the graph lists both people with access', '2',
  jsonb_array_length(public.my_care_graph()->'people_with_access')::text;

insert into results select 'the graph knows who is paying', '1',
  jsonb_array_length(public.my_care_graph()->'people_funding_me')::text;

insert into results select 'the graph flags a funder who also holds access', 'true',
  (public.my_care_graph()->'people_funding_me'->0)->>'holds_access';

reset role;
select set_config('request.jwt.claims', null, true);

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='sponsor'), 'role','authenticated')::text, true);
set local role authenticated;

insert into results select 'consent moves the same supporter to the clinical tier', 'clinical',
  public.care_receipt((select v from ids where k='mum'))->>'tier';

insert into results select 'the withheld escalation now appears', '2',
  jsonb_array_length(public.care_receipt((select v from ids where k='mum'))->'events')::text;

insert into results select 'the clinical tier does carry the clinician''s words', 'true',
  (public.care_receipt((select v from ids where k='mum'))->'events')::text ilike '%titration%';

-- Even consented, the receipt is proof of care and not a chart. The numbers
-- live on the health summary, which is a different surface.
insert into results select 'even consented, the receipt carries no vital value', 'false',
  public.care_receipt((select v from ids where k='mum'))::text like '%156%';

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- Revocation, from both ends
------------------------------------------------------------------
-- The grantee walks away. Impossible before this build: profile_access_delete
-- only ever admitted the record owner.
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='kin'), 'role','authenticated')::text, true);
set local role authenticated;

insert into results select 'a grantee may remove their own access', 'true',
  public.revoke_care_access((select v from ids where k='kin_grant'))->>'revoked';

reset role;
select set_config('request.jwt.claims', null, true);

-- The owner removes the manage grant — the one that had no UI take-back at all.
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='mum'), 'role','authenticated')::text, true);
set local role authenticated;

insert into results select 'the owner may remove a manage grant', 'true',
  public.revoke_care_access((select v from ids where k='sponsor_grant'))->>'revoked';

insert into results select 'revoking twice is not an error', 'false',
  public.revoke_care_access((select v from ids where k='sponsor_grant'))->>'revoked';

-- The audit outlives the grant it describes. This is the point of a separate
-- append-only log rather than a status column on profile_access.
insert into results select 'both revocations survive in the log', '2',
  count(*)::text from public.care_access_events
 where patient_id = (select v from ids where k='mum') and kind = 'revoked'
   and occurred_at >= (select at from t0);

reset role;
select set_config('request.jwt.claims', null, true);

-- Not even the patient may edit their own audit trail. An access log the
-- subject can rewrite is not an audit trail, and the check has to be made
-- against a real DELETE rather than against the absence of a policy.
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='mum'), 'role','authenticated')::text, true);
set local role authenticated;

-- Asserted as a refusal, not as "nothing happened". Before 20260807014200 this
-- DELETE returned success having removed nothing (RLS gave it no rows), so a
-- test that only counted rows afterwards would have passed while the table
-- still carried a DELETE grant. The privilege is the thing being checked.
insert into results select 'the subject holds no write privilege on their own log', 'false',
  (has_table_privilege('public.care_access_events', 'DELETE')
   or has_table_privilege('public.care_access_events', 'UPDATE')
   or has_table_privilege('public.care_access_events', 'INSERT'))::text;

do $$
begin
  delete from public.care_access_events where patient_id = (select v from ids where k='mum');
  insert into results values ('deleting from the access log is refused', 'blocked', 'allowed');
exception when others then
  insert into results values ('deleting from the access log is refused', 'blocked', 'blocked');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- Revocation ends reading immediately, with no session to expire
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='sponsor'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
begin
  perform public.care_receipt((select v from ids where k='mum'));
  insert into results values ('a revoked supporter cannot pull a receipt', 'blocked', 'allowed');
exception when others then
  insert into results values ('a revoked supporter cannot pull a receipt', 'blocked', 'blocked');
end $$;

insert into results select 'a revoked supporter keeps only their own purchase', '1',
  count(*)::text from public.care_vouchers
 where beneficiary_profile_id = (select v from ids where k='mum');

reset role;
select set_config('request.jwt.claims', null, true);

select check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results;

rollback;
