-- Tarragon Health — verification for
-- 20260905011852_symptom_red_flag_handler_pages_a_clinician.sql
--
-- The defect: private.handle_symptom_red_flag raised its clinician_alerts row
-- and stopped. It had no recipient loop and no call to
-- private.enqueue_critical_notification anywhere in its body — the sixth
-- instance of the paging gap already fixed in the abnormal-result Edge
-- Function and in the five DB red-flag handlers
-- (20260905005842_red_flag_handlers_page_clinicians_who_have_no_phone.sql),
-- reached by a different route. Measured live before the fix: a 2-year-old's
-- severity-5 'poor_feeding' produced is_red_flag = true, one open
-- clinician_alerts row, and ZERO notifications, with 7 clinicians in the
-- organisation.
--
-- Proves, in one rolled-back transaction:
--   1. Structural — the handler enqueues at all, still selects clinician
--      recipients, and does not filter them on a phone number (0 of 38
--      profiles on this platform carry one).
--   2. Structural — nothing clinical was traded away for the notification:
--      the paediatric branch, the plan gate, the Free-tier self-care path,
--      all four severity thresholds and the new.is_red_flag assignment are
--      all still there.
--   3. Functional, red-flag tier — a 2-year-old's severity-5 'poor_feeding'
--      raises its alert AND enqueues exactly one notification per clinician
--      in the organisation, first hop 'push' (which needs no phone), pathway
--      'symptom_red_flag', tier 'urgent_escalation'. Counted before and after
--      the same INSERT so the number is attributable to it.
--   4. Functional, review tier — a severity-5 non-red-flag symptom does the
--      same at tier 'clinician_review', because that tier is registered with
--      its own channel_sequence and the sibling handlers page on their AMBER
--      branch too.
--   5. The plan gate is intact — an unentitled (Free) patient logging a
--      severity-9 symptom still gets zero clinician alerts, zero clinician
--      notifications, and exactly one in_app self-care suggestion.
--   6. The INSERT never aborts — every symptoms row above is still readable
--      after its trigger ran, including a below-threshold one that should
--      produce nothing at all. This is the failure mode 20260905005842 had to
--      design around for the unregistered pulse pathway; symptom_red_flag is
--      registered for BOTH tiers in the active config, which 7 asserts.
--   7. The active escalation_slas config registers symptom_red_flag on both
--      tiers with a first hop of push. Nothing in this pathway was drafted,
--      activated or signed by the migration — it was already there.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — a verification script, not seed data.

begin;

do $$
declare
  v_src     text;
  v_org     uuid;
  v_docs    integer;
  v_product uuid;
  v_price   bigint;
  v_child   uuid := gen_random_uuid();
  v_doc_a  uuid := gen_random_uuid();
  v_doc_b  uuid := gen_random_uuid();
  v_adult   uuid := gen_random_uuid();
  v_free    uuid := gen_random_uuid();
  v_n0      integer;
  v_n1      integer;
  v_alerts  integer;
  v_channel text;
  v_tier    text;
  v_flag    boolean;
begin
  ------------------------------------------------------------------ 1. structural: it pages
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'handle_symptom_red_flag';
  if v_src is null then
    raise exception 'FAIL 1: private.handle_symptom_red_flag does not exist';
  end if;
  if v_src !~ 'enqueue_critical_notification' then
    raise exception 'FAIL 1: handle_symptom_red_flag never enqueues a notification — it raises an alert and pages nobody';
  end if;
  if v_src !~ 'role\s*=\s*''clinician''' then
    raise exception 'FAIL 1: handle_symptom_red_flag has no clinician recipient loop';
  end if;
  -- Deliberately the same specific regex 20260905005842's own test uses: it
  -- matches the recipient query, not prose. prosrc contains the function's
  -- comments too, and a looser pattern matches the comment that explains why
  -- there is no phone predicate — passing or failing for the wrong reason.
  if v_src ~ 'role\s*=\s*''clinician''\s*and\s*phone\s+is\s+not\s+null' then
    raise exception 'FAIL 1: handle_symptom_red_flag filters its recipients on a phone number; no clinician profile on this platform has one';
  end if;

  ------------------------------------------------------------------ 2. structural: nothing clinical traded away
  if v_src !~ 'v_paediatric_types' then
    raise exception 'FAIL 2: the paediatric red-flag branch was lost';
  end if;
  if v_src !~ 'patient_has_feature_access' then
    raise exception 'FAIL 2: the plan gate on raising a clinician alert was lost';
  end if;
  if v_src !~ 'raise_dangerous_reading_ai_suggestion' then
    raise exception 'FAIL 2: the Free-tier self-care path was lost';
  end if;
  if v_src !~ 'new\.severity\s*>=\s*8' or v_src !~ 'new\.severity\s*>=\s*6'
     or v_src !~ 'new\.severity\s*>=\s*4' or v_src !~ 'new\.severity\s*>=\s*5' then
    raise exception 'FAIL 2: a severity threshold changed';
  end if;
  if v_src !~ 'new\.is_red_flag\s*:=\s*v_is_red_flag' then
    raise exception 'FAIL 2: new.is_red_flag is no longer set from the threshold test';
  end if;

  ------------------------------------------------------------------ fixtures
  -- Build the whole world rather than borrowing it. The first version of this
  -- script resolved the organisation from an existing patient profile and then
  -- required pre-existing clinicians, which is fine against the live project
  -- and aborts on a fresh `supabase db reset` with "no clinician profiles in
  -- this organisation" — a missing fixture, not a regression, and exactly the
  -- failure mode packages/db/tests/ci.excluded exists to describe. Since this
  -- script is in ci.manifest it has to stand on its own, so it now takes the
  -- organisation the migrations create and mints its own clinicians.
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then
    raise exception 'no organisation exists at all — the core migrations did not run';
  end if;

  -- Two of them, so "one notification per clinician" is a real count rather
  -- than something a single row could satisfy by accident.
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_doc_a, 'srf-doc-a@example.invalid', 'x', now(), '{}', '{}'),
    (v_doc_b, 'srf-doc-b@example.invalid', 'x', now(), '{}', '{}')
  on conflict (id) do nothing;

  insert into public.profiles (id, organisation_id, role, full_name)
  values
    (v_doc_a, v_org, 'clinician', 'SRF Test Clinician A'),
    (v_doc_b, v_org, 'clinician', 'SRF Test Clinician B')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id,
        role = excluded.role,
        full_name = excluded.full_name;

  -- Counted AFTER minting, so the expected notification count matches whatever
  -- this organisation actually holds: 2 on a fresh database, 2 + whoever
  -- already existed when run against a populated one.
  select count(*) into v_docs
    from public.profiles where organisation_id = v_org and role = 'clinician';
  if v_docs = 0 then
    raise exception 'clinician fixtures were not created — cannot run this test';
  end if;

  -- Resolved by FEATURE rather than by a hardcoded product code. Note there is
  -- deliberately NO `is_active` filter: the packs were retired on 2026-09-02
  -- when subscriptions were replaced by pay-per-service, so none is on sale —
  -- but private.patient_has_feature_access honours an active service_purchases
  -- row regardless of whether its product is still purchasable, which is the
  -- state a real patient mid-term is in. The entitlement is asserted below
  -- rather than assumed, so this fixture cannot silently stop granting.
  select id, price_kobo into v_product, v_price
    from public.service_products
   where 'vitals_red_flag_doctor_escalation' = any(features)
   order by code limit 1;
  if v_product is null then
    raise exception 'no service_products row grants vitals_red_flag_doctor_escalation — no patient can reach the paging path at all';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_child, 'srf-child@example.invalid', 'x', now(), '{}', '{}'),
    (v_adult, 'srf-adult@example.invalid', 'x', now(), '{}', '{}'),
    (v_free,  'srf-free@example.invalid',  'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth)
  values
    (v_child, v_org, 'patient', 'SRF Test Child', (current_date - interval '2 years')::date),
    (v_adult, v_org, 'patient', 'SRF Test Adult', (current_date - interval '40 years')::date),
    (v_free,  v_org, 'patient', 'SRF Test Free',  (current_date - interval '40 years')::date)
  on conflict (id) do update
    set organisation_id = excluded.organisation_id,
        role = excluded.role,
        full_name = excluded.full_name,
        date_of_birth = excluded.date_of_birth;

  -- v_free deliberately gets nothing at all — the state a real Tarragon Free
  -- patient is in.
  insert into public.service_purchases
    (organisation_id, patient_id, purchaser_profile_id, service_product_id,
     status, amount_kobo, currency, purchased_at, expires_at)
  values
    (v_org, v_child, v_child, v_product, 'active', v_price, 'NGN', now(), now() + interval '84 days'),
    (v_org, v_adult, v_adult, v_product, 'active', v_price, 'NGN', now(), now() + interval '84 days');

  if not private.patient_has_feature_access(v_child, 'vitals_red_flag_doctor_escalation')
     or not private.patient_has_feature_access(v_adult, 'vitals_red_flag_doctor_escalation') then
    raise exception 'fixture is not entitled to vitals_red_flag_doctor_escalation — the paging path would not be exercised at all';
  end if;
  if private.patient_has_feature_access(v_free, 'vitals_red_flag_doctor_escalation') then
    raise exception 'the Free fixture is entitled — the plan-gate half of this test would pass vacuously';
  end if;

  ------------------------------------------------------------------ 3. red-flag tier pages every clinician
  select count(*) into v_n0
    from public.notifications
   where organisation_id = v_org and template = 'vitals_red_flag_clinician_alert';

  -- severity 5 'poor_feeding' in a 2-year-old: red flag only via the
  -- paediatric branch (>= 4 for a paediatric type under 5). Below both the
  -- >= 8 and the low-threshold >= 6 rules, so this is the branch the
  -- migration header calls out as the worst case.
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, description)
  values (v_org, v_child, 'poor_feeding', 5, 'SRF paediatric red flag')
  returning is_red_flag into v_flag;
  if not v_flag then
    raise exception 'FAIL 3: a severity-5 poor_feeding in a 2-year-old was not classified as a red flag';
  end if;

  select count(*) into v_alerts
    from public.clinician_alerts where patient_id = v_child and status = 'open';
  if v_alerts <> 1 then
    raise exception 'FAIL 3: expected 1 open clinician_alerts row, got %', v_alerts;
  end if;

  select count(*) into v_n1
    from public.notifications
   where organisation_id = v_org and template = 'vitals_red_flag_clinician_alert';
  if v_n1 - v_n0 <> v_docs then
    raise exception
      'FAIL 3: expected one notification per clinician in the organisation (%), got % — the red-flag symptom raises an alert nobody is told to look at',
      v_docs, v_n1 - v_n0;
  end if;

  select distinct channel::text, escalation_alert_tier::text into v_channel, v_tier
    from public.notifications
   where escalation_pathway = 'symptom_red_flag'
     and escalation_hop = 1
     and source_table = 'clinician_alerts'
     and source_id in (select id from public.clinician_alerts where patient_id = v_child);
  if v_channel <> 'push' then
    raise exception 'FAIL 3: first hop is %, not push — the hop that needs no phone number is not the one being used', v_channel;
  end if;
  if v_tier <> 'urgent_escalation' then
    raise exception 'FAIL 3: notification tier is %, expected urgent_escalation', v_tier;
  end if;

  ------------------------------------------------------------------ 4. review tier pages too
  select count(*) into v_n0
    from public.notifications
   where organisation_id = v_org and template = 'vitals_red_flag_clinician_alert';

  -- 'nausea' is not a low-threshold type and this patient is an adult, so
  -- severity 5 lands in the moderate branch, not the red-flag one.
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, description)
  values (v_org, v_adult, 'nausea', 5, 'SRF moderate severity')
  returning is_red_flag into v_flag;
  if v_flag then
    raise exception 'FAIL 4: a severity-5 nausea in an adult was classified as a red flag — a threshold changed';
  end if;

  select count(*) into v_n1
    from public.notifications
   where organisation_id = v_org and template = 'vitals_red_flag_clinician_alert';
  if v_n1 - v_n0 <> v_docs then
    raise exception 'FAIL 4: the clinician_review-tier alert notified % clinicians, expected %', v_n1 - v_n0, v_docs;
  end if;

  select distinct escalation_alert_tier::text into v_tier
    from public.notifications
   where escalation_pathway = 'symptom_red_flag'
     and source_id in (select id from public.clinician_alerts where patient_id = v_adult);
  if v_tier <> 'clinician_review' then
    raise exception 'FAIL 4: notification tier is %, expected clinician_review', v_tier;
  end if;

  ------------------------------------------------------------------ 5. plan gate intact
  select count(*) into v_n0
    from public.notifications
   where organisation_id = v_org and template = 'vitals_red_flag_clinician_alert';

  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, description)
  values (v_org, v_free, 'chest_pain', 9, 'SRF free tier');

  select count(*) into v_alerts
    from public.clinician_alerts where patient_id = v_free;
  if v_alerts <> 0 then
    raise exception 'FAIL 5: an unentitled patient raised % clinician_alerts rows, expected 0 — the plan gate was weakened', v_alerts;
  end if;

  select count(*) into v_n1
    from public.notifications
   where organisation_id = v_org and template = 'vitals_red_flag_clinician_alert';
  if v_n1 - v_n0 <> 0 then
    raise exception 'FAIL 5: an unentitled patient paged % clinicians, expected 0', v_n1 - v_n0;
  end if;

  select count(*) into v_alerts
    from public.notifications
   where recipient_id = v_free and channel = 'in_app'
     and template = 'free_tier_reading_self_care_suggestion';
  if v_alerts <> 1 then
    raise exception 'FAIL 5: the Free-tier self-care suggestion fired % times, expected 1', v_alerts;
  end if;

  ------------------------------------------------------------------ 6. the INSERT never aborts
  select count(*) into v_n0
    from public.notifications
   where organisation_id = v_org and template = 'vitals_red_flag_clinician_alert';

  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, description)
  values (v_org, v_adult, 'fatigue', 3, 'SRF below every threshold')
  returning is_red_flag into v_flag;
  if v_flag then
    raise exception 'FAIL 6: a severity-3 fatigue was classified as a red flag';
  end if;

  select count(*) into v_n1
    from public.notifications
   where organisation_id = v_org and template = 'vitals_red_flag_clinician_alert';
  if v_n1 - v_n0 <> 0 then
    raise exception 'FAIL 6: a below-threshold symptom paged % clinicians, expected 0', v_n1 - v_n0;
  end if;

  -- Every symptom logged above survived its own trigger. This is the
  -- explicit anti-regression for the abort mode 20260905005842 documents:
  -- a notification path that raises inside a BEFORE INSERT trigger does not
  -- just fail to notify, it stops the patient logging a symptom at all.
  select count(*) into v_alerts
    from public.symptoms where patient_id in (v_child, v_adult, v_free);
  if v_alerts <> 4 then
    raise exception 'FAIL 6: expected 4 symptoms rows to have survived their triggers, found %', v_alerts;
  end if;

  ------------------------------------------------------------------ 7. the pathway is registered, and was not touched
  if not exists (
    select 1 from public.escalation_slas c, jsonb_array_elements(c.config) e
     where c.is_active and e->>'pathway' = 'symptom_red_flag' and e->>'tier' = 'urgent_escalation'
  ) then
    raise exception 'FAIL 7: symptom_red_flag/urgent_escalation is not in the active escalation_slas config';
  end if;
  if not exists (
    select 1 from public.escalation_slas c, jsonb_array_elements(c.config) e
     where c.is_active and e->>'pathway' = 'symptom_red_flag' and e->>'tier' = 'clinician_review'
  ) then
    raise exception 'FAIL 7: symptom_red_flag/clinician_review is not in the active escalation_slas config';
  end if;
  if (private.normalize_escalation_channels(
        private.escalation_channel_sequence_or_null('symptom_red_flag', 'urgent_escalation')))[1]::text
       is distinct from 'push' then
    raise exception 'FAIL 7: the first hop for symptom_red_flag/urgent_escalation is not push';
  end if;
  if (private.normalize_escalation_channels(
        private.escalation_channel_sequence_or_null('symptom_red_flag', 'clinician_review')))[1]::text
       is distinct from 'push' then
    raise exception 'FAIL 7: the first hop for symptom_red_flag/clinician_review is not push';
  end if;

  raise notice
    'PASS: a red-flag symptom now pages all % clinicians on push at urgent_escalation, a moderate one at clinician_review, an unentitled patient still gets only the self-care suggestion, and every symptoms INSERT still succeeds',
    v_docs;
end $$;

rollback;
