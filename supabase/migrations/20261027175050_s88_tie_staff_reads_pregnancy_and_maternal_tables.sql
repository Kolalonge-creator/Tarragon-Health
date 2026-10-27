-- S88: tie staff reads (and writes) on the nine pregnancy and maternal tables that S39b never reached (INV-10, INV-12, OQ-260, OQ-362, OQ-588).
--
-- Why these nine. S39b (20261007133517) tied 128 tables and kept 103 on purpose organisation-wide (work queues, logistics, billing, self-tracking).
-- A live sweep on 2026-10-27 (pg_policies on koiplnmbgnqnbywhpjlf, SELECT only) looked for every patient table that is neither in staff_read_scope nor
-- gated by the caregiver/category model, and found exactly these nine, all created AFTER S39b was written (S67 and S68, merged later than the S39b
-- branch point), so S39b's registry never saw them:
--   S67  pregnancies, kick_counts, contractions, birth_plans      SELECT arm = private.pregnancy_staff_may_read(organisation_id)
--   S68  postnatal_baby_checks, breastfeeding_feed_log,           SELECT arm = private.maternal_staff_may_read(patient_id, organisation_id)
--        lifecycle_states, lifecycle_events, pregnancy_loss_records
-- Both helpers were still, in the live definition, nothing but `select private.is_org_staff(p_org)`. So any active staff member of the organisation,
-- including a care coordinator, could read every woman's pregnancy history, loss records, baby checks and lifecycle stage with no care relationship.
-- (The S39b-era plan counted "8 remaining clinical tables"; the live count is 9. The ninth is pregnancy_loss_records, the most sensitive of them.)
--
-- Reasoning per table (category is reproductive_health for all nine, deliberately, see below)
--   pregnancies               a woman's full pregnancy history (LMP, EDD, risk flags, outcome). Clinical. Tied.
--   kick_counts, contractions fetal-movement and labour timer sessions. Clinical, time-critical only for the tied care team. Tied.
--   birth_plans               place of birth, money plan, wishes. Personal and clinical. Tied.
--   postnatal_baby_checks     baby weight, feeding, concerns for a postnatal mother's profile. Clinical. Tied.
--   breastfeeding_feed_log    patient-entered feed log. Self-tracking by itself, but it is a maternal health record for a named patient and the S68
--                             design (OQ-362) listed it with the others; tied for the same reason S39b tied the cycle logs.
--   lifecycle_states/_events  the stage of a person's reproductive life (pregnant, postnatal, loss). Reveals pregnancy and loss on its own. Tied.
--   pregnancy_loss_records    a pregnancy loss and the note. The most sensitive row in the group. Tied.
--
-- Why reproductive_health and not medical_history. private.can_staff_read_clinical(patient, category) lets a break-glass grant through for every
-- category except reproductive_health (private.has_emergency_access refuses it, verified live), and private.staff_has_open (the S39c audited opening)
-- also refuses it. That is the behaviour wanted for a woman's pregnancy and loss data and matches menstrual_cycles and patient_pregnancy, which S39b
-- already tied as reproductive_health. This is the category-scoped check, written fresh; no older sibling's policy text is copied.
--
-- What it does
--   1. private.maternal_staff_may_read(patient, org) becomes private.staff_may_read(patient, org, 'reproductive_health'). It is the one helper S68
--      policies already call, so retargeting it ties the five S68 tables with no policy edit. staff_may_read keeps its kill switch
--      (platform module tied_staff_reads: off = the old private.is_org_staff(org) read), refuses a care coordinator, and admits only a care-team tie,
--      an open escalation/alert/consult/task/referral tie, or an active support view-as session for this category.
--   2. The four S67 SELECT policies called private.pregnancy_staff_may_read(organisation_id), a helper that takes no patient, so it cannot be tied in
--      place. They are repointed (ALTER POLICY, roles kept) to private.maternal_staff_may_read(patient_id, organisation_id). The one-argument helper is
--      left defined (a function in use by older proofs) but no policy calls it any more.
--   3. WRITES, so the S39g structural rule holds ("no tied table keeps the plain staff arm on a write policy", proof s39g S1). postnatal_baby_checks and
--      breastfeeding_feed_log wrote with a literal private.is_org_staff(organisation_id); those arms become
--      private.staff_may_write(patient_id, organisation_id, 'reproductive_health'). private.pregnancy_may_write (used by the S67 insert/update
--      policies) keeps its patient arm and its staff arm becomes the same staff_may_write call. staff_may_write needs an ACTIVE CLINICIAN with a care
--      tie (kill switch tied_staff_writes). The patient arms, the caregiver arms (pregnancy_caregiver_may_read, maternal_caregiver_may_read), the
--      sponsor/employer refusals and anon refusals are untouched.
--   4. The nine tables are registered in staff_read_scope as tied (reproductive_health), so every S39b/S39g proof sweep covers them and a later
--      table cannot silently stay organisation-wide.
--
-- What does NOT change
--   * private.is_org_staff is not edited (about 110 surfaces). No new overload of any function (so no bare-literal call site can become ambiguous).
--   * Patient own-row reads, caregiver proxy reads (category-granted), org-admin aggregate paths (none read these tables) and the SECURITY DEFINER
--     functions and triggers that write these tables (record_lifecycle_event, the S68 growth/EPDS rules, the deletion executor) are not touched.
--   * The two vitals_reminder_rules/patient_reminder_group_members policies found in the same sweep are NOT changed here: they are reminder
--     configuration (frequency per condition, group membership), not a clinical record; recorded in docs/OPEN-QUESTIONS.md for a decision.
--
-- Rollback. set_platform_module('tied_staff_reads', false, ...) and ('tied_staff_writes', false, ...) restore the old organisation-wide read and write
-- at once for these tables too (staff_may_read/staff_may_write fall back to is_org_staff). The original policy text is saved in
-- staff_read_policy_backup, and the old function bodies were:
--   private.maternal_staff_may_read(uuid, uuid):  select private.is_org_staff(p_org)
--   private.pregnancy_may_write(uuid, uuid):      select (p_patient = (select auth.uid()) and p_org = private.current_org_id()) or private.pregnancy_staff_may_read(p_org)
--
-- Rollout caution. Staff screens that list or open these tables for an UNTIED clinician or any coordinator now come back empty (as intended). The
-- clinician women's-health panel reads patient_pregnancy/antenatal_visits/postnatal_profiles, already tied by S39b, so it is unaffected.
-- Declares no transaction (the apply workflow wraps it). Nothing is deleted or rewritten in the data.

-- 0. save the policy text that is about to change
insert into public.staff_read_policy_backup (table_name, policy_name, cmd, roles, qual, with_check)
select p.tablename, p.policyname, p.cmd, array_to_string(p.roles, ','), p.qual, p.with_check
  from pg_policies p
 where p.schemaname = 'public'
   and ((p.tablename in ('pregnancies', 'kick_counts', 'contractions', 'birth_plans') and p.cmd in ('SELECT', 'INSERT', 'UPDATE'))
     or (p.tablename in ('postnatal_baby_checks', 'breastfeeding_feed_log') and p.cmd in ('INSERT', 'UPDATE')))
on conflict (table_name, policy_name) do nothing;

-- 1. the one helper the S68 tables call
create or replace function private.maternal_staff_may_read(p_patient uuid, p_org uuid)
returns boolean language sql stable security definer set search_path = '' as
$$ select private.staff_may_read(p_patient, p_org, 'reproductive_health'::public.care_access_category) $$;
revoke all on function private.maternal_staff_may_read(uuid, uuid) from public, anon;
grant execute on function private.maternal_staff_may_read(uuid, uuid) to authenticated;

-- 3 (first, because the S67 policies below depend on it). the staff arm of the S67 write helper
create or replace function private.pregnancy_may_write(p_patient uuid, p_org uuid)
returns boolean language sql stable security definer set search_path = '' as
$$ select (p_patient = (select auth.uid()) and p_org = private.current_org_id())
       or private.staff_may_write(p_patient, p_org, 'reproductive_health'::public.care_access_category) $$;
revoke all on function private.pregnancy_may_write(uuid, uuid) from public, anon;
grant execute on function private.pregnancy_may_write(uuid, uuid) to authenticated;

-- 2. the four S67 SELECT policies (roles are kept by ALTER POLICY)
alter policy pregnancies_select on public.pregnancies
  using ((patient_id = (select auth.uid())) or private.maternal_staff_may_read(patient_id, organisation_id) or private.pregnancy_caregiver_may_read(patient_id));
alter policy kick_counts_select on public.kick_counts
  using ((patient_id = (select auth.uid())) or private.maternal_staff_may_read(patient_id, organisation_id) or private.pregnancy_caregiver_may_read(patient_id));
alter policy contractions_select on public.contractions
  using ((patient_id = (select auth.uid())) or private.maternal_staff_may_read(patient_id, organisation_id) or private.pregnancy_caregiver_may_read(patient_id));
alter policy birth_plans_select on public.birth_plans
  using ((patient_id = (select auth.uid())) or private.maternal_staff_may_read(patient_id, organisation_id) or private.pregnancy_caregiver_may_read(patient_id));

-- 3. the S68 write policies that carried a literal plain staff arm
alter policy postnatal_baby_checks_insert on public.postnatal_baby_checks
  with check ((((patient_id = (select auth.uid())) and (organisation_id = private.current_org_id()))
               or private.staff_may_write(patient_id, organisation_id, 'reproductive_health'::public.care_access_category)));
alter policy postnatal_baby_checks_update on public.postnatal_baby_checks
  using ((patient_id = (select auth.uid())) or private.staff_may_write(patient_id, organisation_id, 'reproductive_health'::public.care_access_category))
  with check ((((patient_id = (select auth.uid())) and (organisation_id = private.current_org_id()))
               or private.staff_may_write(patient_id, organisation_id, 'reproductive_health'::public.care_access_category)));
alter policy breastfeeding_feed_log_insert on public.breastfeeding_feed_log
  with check ((((patient_id = (select auth.uid())) and (organisation_id = private.current_org_id()))
               or private.staff_may_write(patient_id, organisation_id, 'reproductive_health'::public.care_access_category)));

-- 4. register them
insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason) values
  ('pregnancies', 'tied', 'patient_id', 'reproductive_health', null),
  ('kick_counts', 'tied', 'patient_id', 'reproductive_health', null),
  ('contractions', 'tied', 'patient_id', 'reproductive_health', null),
  ('birth_plans', 'tied', 'patient_id', 'reproductive_health', null),
  ('postnatal_baby_checks', 'tied', 'patient_id', 'reproductive_health', null),
  ('breastfeeding_feed_log', 'tied', 'patient_id', 'reproductive_health', null),
  ('lifecycle_states', 'tied', 'patient_id', 'reproductive_health', null),
  ('lifecycle_events', 'tied', 'patient_id', 'reproductive_health', null),
  ('pregnancy_loss_records', 'tied', 'patient_id', 'reproductive_health', null)
on conflict (table_name) do update set mode = 'tied', patient_expr = 'patient_id', category = 'reproductive_health', reason = null;

-- self-checks: the nine are tied, nothing is plain, anon is closed
do $$
declare v_t text; v_bad text;
begin
  foreach v_t in array array['pregnancies', 'kick_counts', 'contractions', 'birth_plans', 'postnatal_baby_checks', 'breastfeeding_feed_log',
                             'lifecycle_states', 'lifecycle_events', 'pregnancy_loss_records'] loop
    select string_agg(p.policyname, ', ') into v_bad from pg_policies p
     where p.schemaname = 'public' and p.tablename = v_t
       and (coalesce(p.qual, '') || coalesce(p.with_check, '')) ~ '(is_org_staff\(|pregnancy_staff_may_read\()';
    if v_bad is not null then raise exception 'S88: % still has a plain staff arm in %', v_t, v_bad; end if;
    if not exists (select 1 from public.staff_read_scope where table_name = v_t and mode = 'tied' and category = 'reproductive_health') then
      raise exception 'S88: % is not registered as tied', v_t;
    end if;
    if not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = v_t and p.cmd = 'SELECT'
                      and (p.qual like '%maternal_staff_may_read%' or p.qual like '%staff_may_read%')) then
      raise exception 'S88: the SELECT policy on % is not tied', v_t;
    end if;
    if has_table_privilege('anon', 'public.' || v_t, 'SELECT') then raise exception 'S88: anon can read %', v_t; end if;
  end loop;
  if has_function_privilege('anon', 'private.maternal_staff_may_read(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'private.pregnancy_may_write(uuid,uuid)', 'EXECUTE') then
    raise exception 'S88: anon can execute a maternal RLS helper';
  end if;
  if pg_get_functiondef('private.maternal_staff_may_read(uuid,uuid)'::regprocedure) not like '%staff_may_read(p_patient, p_org%reproductive_health%' then
    raise exception 'S88: maternal_staff_may_read is not the tied check';
  end if;
  if pg_get_functiondef('private.pregnancy_may_write(uuid,uuid)'::regprocedure) not like '%staff_may_write%' then
    raise exception 'S88: pregnancy_may_write staff arm is not tied';
  end if;
end $$;
