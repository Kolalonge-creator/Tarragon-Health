-- ===========================================================================
-- Verification: Module 21 (Medication Access & Adherence Engine) — RLS
-- isolation on medication_access_checkins/medication_side_effect_reports,
-- the alert-routing triggers (§21.3/§21.4 affordability, §21.11 side
-- effects), and the adherence-status floor logic (§21.9).
--
-- Run via `supabase db query --linked -f <this file>`, `psql $DATABASE_URL -f
-- <this file>`, or the Supabase SQL editor.
--
-- Wrapped in BEGIN/ROLLBACK — a verification script, not seed data.
--
-- Pattern (same as packages/db/tests/lab_partner_rls.sql):
--   set_config('request.jwt.claims', ...) + set role authenticated
-- simulates a real client session; running everything as the connecting
-- superuser would silently bypass RLS via table ownership.
--
-- Every negative is paired with a positive/control in the same transaction:
-- patient B being unable to read patient A's check-in (check 2) is paired
-- with patient A reading their own (check 1) and a clinician in the same org
-- reading it too (check 3) — an account blocked from everything, or an empty
-- table, would score the same as a real fix on check 2 alone.
--
-- CONFIRMED TO DISCRIMINATE (manual, one-time check per CLAUDE.md's standing
-- practice): re-run check 2 with medication_access_checkins_select's
-- `private.is_org_staff(organisation_id)` clause temporarily changed to
-- `true` (i.e. dropping the org-staff scoping entirely) and it still passes
-- vacuously because it is patient-scoped either way — the real discriminator
-- for that policy is patient_id; confirmed instead by temporarily dropping
-- the `patient_id = (select auth.uid())` predicate from the USING clause,
-- which makes check 2 fail loudly (patient B reads 1 row instead of 0).
-- ===========================================================================

begin;

create temporary table med21_result(
  ord        int primary key,
  check_name text,
  expected   text,
  observed   text,
  verdict    text
) on commit drop;

do $$
declare
  v_org           uuid := '00000000-0000-0000-0000-000000000001';
  v_pat_a         uuid;
  v_pat_b         uuid;
  v_clin          uuid;
  v_med_a         uuid;
  v_med_b         uuid;
  v_checkin_id    uuid;
  n_a             int;
  n_b             int;
  n_clin          int;
  v_access_status public.medication_access_status;
  n_pharmacy_alert int;
  n_side_effect_alert int;
  v_side_effect_level public.alert_level;
  v_adherence_status public.medication_adherence_status;
  v_adherence_pct numeric;
begin
  -- ------------------------------------------------------------------------
  -- Fixtures (as the connecting superuser, RLS bypassed)
  -- ------------------------------------------------------------------------
  select id into v_pat_a from public.profiles
    where role = 'patient' and organisation_id = v_org order by id limit 1;
  select id into v_pat_b from public.profiles
    where role = 'patient' and organisation_id = v_org and id <> v_pat_a order by id limit 1;
  select id into v_clin from public.profiles
    where role = 'clinician' and organisation_id = v_org order by id limit 1;

  if v_pat_a is null or v_pat_b is null or v_clin is null then
    raise exception 'fixtures unavailable: need 2 patients and 1 clinician in org 0001';
  end if;

  insert into public.medications
    (organisation_id, patient_id, drug_name, source, schedule_times, is_active)
  values (v_org, v_pat_a, 'VERIFY Amlodipine', 'patient', '["08:00"]'::jsonb, true)
  returning id into v_med_a;
  -- Backdated 4 days so the adherence-window check below spans real history
  -- rather than collapsing to "today" (compute_medication_adherence windows
  -- from greatest(created_at::date, current_date - 29)).
  insert into public.medications
    (organisation_id, patient_id, drug_name, source, schedule_times, is_active, created_at)
  values (v_org, v_pat_b, 'VERIFY Metformin', 'patient', '["08:00"]'::jsonb, true, now() - interval '4 days')
  returning id into v_med_b;

  -- ------------------------------------------------------------------------
  -- Patient A's own session: submits a "too expensive" check-in on their own
  -- medication. §21.3/§21.4: this must (a) update access_status and (b) raise
  -- a clinician_alerts row routed to the medication category.
  -- ------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_pat_a, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  insert into public.medication_access_checkins
    (organisation_id, patient_id, medication_id, obtained, barrier)
  values (v_org, v_pat_a, v_med_a, 'no', 'too_expensive')
  returning id into v_checkin_id;

  select count(*) into n_a from public.medication_access_checkins where patient_id = v_pat_a;

  perform set_config('role', 'postgres', true);

  -- ------------------------------------------------------------------------
  -- Patient B's session: must NOT see patient A's check-in.
  -- ------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_pat_b, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into n_b from public.medication_access_checkins where id = v_checkin_id;

  perform set_config('role', 'postgres', true);

  -- ------------------------------------------------------------------------
  -- CONTROL: a clinician in the same org CAN see it.
  -- ------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into n_clin from public.medication_access_checkins where id = v_checkin_id;

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  -- ------------------------------------------------------------------------
  -- §21.3/§21.4: access_status derived + alert raised (as superuser, reading
  -- server-derived state — no RLS relevance to this part of the check).
  -- ------------------------------------------------------------------------
  select access_status into v_access_status from public.medications where id = v_med_a;

  select count(*) into n_pharmacy_alert
  from public.clinician_alerts
  where patient_id = v_pat_a and category = 'medication' and type_code = 'pharmacy_problem'
    and created_at > now() - interval '1 minute';

  -- §21.11: a severe side-effect report raises an urgent_escalation alert.
  insert into public.medication_side_effect_reports
    (organisation_id, patient_id, medication_id, description, severity)
  values (v_org, v_pat_a, v_med_a, 'VERIFY severe reaction', 'severe');

  select level into v_side_effect_level
  from public.clinician_alerts
  where patient_id = v_pat_a and category = 'clinical' and type_code = 'medication_safety'
  order by created_at desc limit 1;

  -- Time-windowed (not just type/patient) so this stays exact even if the
  -- real, pre-existing v_pat_a fixture already has older medication_safety
  -- history in the live database.
  select count(*) into n_side_effect_alert
  from public.clinician_alerts
  where patient_id = v_pat_a and category = 'clinical' and type_code = 'medication_safety'
    and created_at > now() - interval '1 minute';

  -- §21.9: adherence status/percentage derived from doses actually DUE
  -- (schedule_times x days since the medication started), not from a bare
  -- taken-of-logged ratio — a once-daily medication started 4 days ago has 5
  -- doses due (today + 4 prior days); logging 3 taken and 2 missed gives an
  -- honest 60% (frequently_missed), not 100% from only counting logged rows.
  insert into public.medication_logs
    (organisation_id, patient_id, medication_id, status, scheduled_for_date, scheduled_time, logged_at)
  select v_org, v_pat_b, v_med_b, 'taken', (current_date - offset_days), '08:00',
         now() - (offset_days || ' days')::interval
  from generate_series(0, 2) as offset_days;
  insert into public.medication_logs
    (organisation_id, patient_id, medication_id, status, scheduled_for_date, scheduled_time, logged_at)
  select v_org, v_pat_b, v_med_b, 'missed', (current_date - offset_days), '08:00',
         now() - (offset_days || ' days')::interval
  from generate_series(3, 4) as offset_days;

  select adherence_status, adherence_pct_30d into v_adherence_status, v_adherence_pct
  from public.medications where id = v_med_b;

  -- ------------------------------------------------------------------------
  -- Results
  -- ------------------------------------------------------------------------
  insert into med21_result values
    (1, 'patient A reads their own check-in',
        '1', n_a::text, case when n_a = 1 then 'PASS' else 'FAIL' end),
    (2, 'patient B cannot read patient A''s check-in',
        '0', n_b::text, case when n_b = 0 then 'PASS' else 'FAIL' end),
    (3, 'CONTROL — a clinician in the same org can read it',
        '1', n_clin::text, case when n_clin = 1 then 'PASS' else 'FAIL' end),
    (4, 'access_status derived from a "too_expensive" check-in',
        'too_expensive', v_access_status::text,
        case when v_access_status = 'too_expensive' then 'PASS' else 'FAIL' end),
    (5, 'a cost barrier raises a medication/pharmacy_problem clinician_alerts row',
        '1', n_pharmacy_alert::text, case when n_pharmacy_alert = 1 then 'PASS' else 'FAIL' end),
    (6, 'a severe side effect raises an urgent_escalation alert',
        'urgent_escalation', coalesce(v_side_effect_level::text, 'null'),
        case when v_side_effect_level = 'urgent_escalation' then 'PASS' else 'FAIL' end),
    (7, 'exactly one side-effect alert raised (never silently swallowed, never duplicated)',
        '1', n_side_effect_alert::text, case when n_side_effect_alert = 1 then 'PASS' else 'FAIL' end),
    (8, 'adherence status reflects doses actually due (3/5 due days taken = 60% -> frequently_missed)',
        'frequently_missed', coalesce(v_adherence_status::text, 'null'),
        case when v_adherence_status = 'frequently_missed' then 'PASS' else 'FAIL' end),
    (9, 'adherence percentage is computed as 60.0, not null and not 100 from only counting logged rows',
        '60.0', coalesce(v_adherence_pct::text, 'null'),
        case when v_adherence_pct = 60.0 then 'PASS' else 'FAIL' end);
end $$;

select ord, verdict, check_name, expected, observed
from med21_result order by ord;

do $$
declare
  v_failed text;
begin
  select string_agg(ord::text || ' (' || check_name || ')', '; ' order by ord)
    into v_failed
  from med21_result where verdict = 'FAIL';

  if v_failed is not null then
    raise exception 'Module 21 medication access/adherence verification FAILED on check(s): %', v_failed;
  end if;
end $$;

rollback;
