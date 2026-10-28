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
-- Why reproductive_health and not medical_history, and what "tied" means for these nine (corrected after a strict review, 2026-10-27).
-- A staff member may read one of these rows only when ALL of the following hold, and for no other reason:
--   * the tied-reads kill switch is on (platform module tied_staff_reads; off = the old private.is_org_staff(org) read, the documented rollback);
--   * the caller is not a care coordinator (logistics only, never clinical);
--   * the caller has a care relationship: private.clinician_has_patient_access(patient) (care-team assignment, an open escalation or alert routed to
--     the caller, a consultation, a task, an acknowledged page, an assigned referral), or an audited opening for this category (private.staff_has_open).
-- It is deliberately NOT private.staff_may_read(patient, org, 'reproductive_health') any more, because that function also admits
--   (a) break-glass, which private.has_emergency_access refuses for reproductive_health, and
--   (b) an active support view-as session, private.can_support_view(patient), which takes NO category and so is not category scoped.
-- The first draft of this migration said view-as was category scoped; it is not. Founder default (no other decision taken): support view-as is refused
-- for these nine tables exactly as break-glass is. private.maternal_staff_may_read therefore carries its own body (kill switch, coordinator refusal,
-- clinician_has_patient_access, staff_has_open for reproductive_health) instead of calling staff_may_read. private.staff_has_open refuses
-- reproductive_health too, so today the tie is the only way in. No other table's behaviour changes: staff_may_read, can_staff_read_clinical and
-- can_support_view are NOT edited, so every S39b table still admits view-as exactly as before. This matches menstrual_cycles and patient_pregnancy
-- (reproductive_health, tied by S39b) in spirit; it is stricter than they are on view-as, on purpose, for pregnancy and loss data.
--
-- What it does
--   1. private.maternal_staff_may_read(patient, org): the tied body above. It is the one helper the S68 policies already call, so retargeting it ties
--      the five S68 tables with no policy edit.
--   2. The four S67 SELECT policies called private.pregnancy_staff_may_read(organisation_id), a helper that takes no patient, so it cannot be tied in
--      place. They are repointed (ALTER POLICY, roles kept) to private.maternal_staff_may_read(patient_id, organisation_id). The one-argument helper
--      is NEUTRALISED (returns false, fail closed) so nobody can copy it back into a policy and silently reopen the tables; no policy calls it.
--   3. WRITES, so the S39g structural rule holds ("no tied table keeps the plain staff arm on a write policy", proof s39g S1). postnatal_baby_checks and
--      breastfeeding_feed_log wrote with a literal private.is_org_staff(organisation_id); those arms become
--      private.staff_may_write(patient_id, organisation_id, 'reproductive_health'). private.pregnancy_may_write (used by the S67 insert/update
--      policies) keeps its patient arm and its staff arm becomes the same staff_may_write call. staff_may_write needs an ACTIVE CLINICIAN with a care
--      tie (kill switch tied_staff_writes) and has no view-as arm. The patient arms, the caregiver arms (pregnancy_caregiver_may_read,
--      maternal_caregiver_may_read), the sponsor/employer refusals and anon refusals are untouched.
--   4. SECURITY DEFINER functions that read or write these tables on behalf of staff (a strict review found the first draft missed them; the live
--      pg_proc was searched for every function whose body names any of the nine tables, in every schema):
--        public.record_lifecycle_event (S68f)           staff arm was `private.is_org_staff(org)`: any coordinator or untied clinician could record a
--                                                       pregnancy, delivery or LOSS for any woman of the organisation (it writes lifecycle_states,
--                                                       lifecycle_events, pregnancy_loss_records, patient_pregnancy, postnatal_profiles). Now
--                                                       private.staff_may_write(patient, org, 'reproductive_health') in the caller's own organisation.
--        public.antenatal_schedule_review_prompt (S67)  gated on `private.is_org_staff(org)` and returned risk_flag / amber_blood_pressure for any
--                                                       pregnancy of the organisation to any staff member. Now private.maternal_staff_may_read.
--      Checked and deliberately left: private.pregnancies_before_write, private.pregnancy_tool_before_insert and private.patient_pregnancy_sync_history
--      only use is_org_staff to LABEL who wrote a row (source) or to decide whether the writer may set risk flags; they are reached only after the RLS
--      write policy above has already admitted the writer, so they cannot open a new route. private.lifecycle_apply and private.execute_tracker_deletion
--      are not executable by authenticated or anon (verified live). my_lifecycle is scoped to auth.uid(). generate_antenatal_schedule is SECURITY
--      INVOKER (row security applies). The remaining trigger functions (pregnancies_sync_projection, pregnancy_tool_raise_alert,
--      schedule_postnatal_checks) never read for a caller. No view or materialised view and no policy on another table names any of the nine.
--   5. The nine tables are registered in staff_read_scope as tied (reproductive_health), so every S39b/S39g proof sweep covers them and a later
--      table cannot silently stay organisation-wide.
--
-- What does NOT change
--   * private.is_org_staff is not edited (about 110 surfaces). No new overload of any function (so no bare-literal call site can become ambiguous);
--     every changed function keeps its exact signature.
--   * Patient own-row reads, caregiver proxy reads (category-granted), org-admin aggregate paths (none read these tables) and the other SECURITY
--     DEFINER functions and triggers that write these tables (the S68 growth/EPDS rules, the deletion executor) are not touched.
--   * The two vitals_reminder_rules/patient_reminder_group_members policies found in the same sweep are NOT changed here: they are reminder
--     configuration (frequency per condition, group membership), not a clinical record; recorded in docs/OPEN-QUESTIONS.md (OQ-S88-1).
--
-- Availability consequence, a founder decision (OQ-S88-3): the Chief Medical Officer and an on-call doctor WITHOUT a care tie cannot read these records
-- by any audited route (break-glass and the S39c opening both refuse reproductive_health, and view-as is now refused too). That is the point of the
-- tie, and it is also a gap for an emergency: the options are in docs/OPEN-QUESTIONS.md. Nothing was invented here.
--
-- Cost note. The tie is evaluated per candidate row, as it is on the 128 S39b tables (the patient's own-row arm is tested first, so a patient's own
-- reads never reach it). A cheaper form (a set-returning "my tied patients" helper used as `patient_id in (select ...)`, evaluated once per
-- statement) would change the policy shape of all 128 tables and every proof that matches the current text, so it is NOT done here; docs/design/S39b.md
-- section 7 already records it as the follow-up if these tables grow large. The nine are small, per-patient tables read by patient_id.
--
-- Rollback. PRIMARY: set_platform_module('tied_staff_reads', false, ...) and ('tied_staff_writes', false, ...) restore the old organisation-wide
-- read and write at once for these tables (the helpers and both SECURITY DEFINER functions fall back to private.is_org_staff when the switch is off),
-- with no schema change. COMPLETE restore of the old objects: the original policy text is saved in staff_read_policy_backup and the ORIGINAL BODIES of
-- every function this migration replaces are saved, as full CREATE OR REPLACE statements, in staff_read_function_backup (written before any
-- change, from pg_get_functiondef). Restoring = `select definition from public.staff_read_function_backup` and run each statement, then re-create the
-- policies from staff_read_policy_backup. The old bodies for reference:
--   private.maternal_staff_may_read(uuid, uuid):  select private.is_org_staff(p_org)
--   private.pregnancy_staff_may_read(uuid):       select private.is_org_staff(p_org)
--   private.pregnancy_may_write(uuid, uuid):      select (p_patient = (select auth.uid()) and p_org = private.current_org_id()) or private.pregnancy_staff_may_read(p_org)
--   public.record_lifecycle_event / public.antenatal_schedule_review_prompt: S68f / S67 bodies, staff arm `private.is_org_staff(...)`.
--
-- Rollout caution. Staff screens that list or open these tables for an UNTIED clinician or any coordinator now come back empty (as intended). The
-- clinician women's-health panel reads patient_pregnancy/antenatal_visits/postnatal_profiles, already tied by S39b, so it is unaffected.
-- Declares no transaction (the apply workflow wraps it). Nothing is deleted or rewritten in the data.

-- 0. save everything that is about to change: policies first, then the full old function bodies
insert into public.staff_read_policy_backup (table_name, policy_name, cmd, roles, qual, with_check)
select p.tablename, p.policyname, p.cmd, array_to_string(p.roles, ','), p.qual, p.with_check
  from pg_policies p
 where p.schemaname = 'public'
   and ((p.tablename in ('pregnancies', 'kick_counts', 'contractions', 'birth_plans') and p.cmd in ('SELECT', 'INSERT', 'UPDATE'))
     or (p.tablename in ('postnatal_baby_checks', 'breastfeeding_feed_log') and p.cmd in ('INSERT', 'UPDATE')))
on conflict (table_name, policy_name) do nothing;

create table if not exists public.staff_read_function_backup (
  fn_signature text primary key,
  definition text not null,
  saved_at timestamptz not null default now()
);
alter table public.staff_read_function_backup enable row level security;
revoke all on public.staff_read_function_backup from public, anon, authenticated;
comment on table public.staff_read_function_backup is 'S88: the full pre-change CREATE OR REPLACE FUNCTION text of every function S88 replaced, for a complete rollback. Restore by running each definition. Never read by the app.';

insert into public.staff_read_function_backup (fn_signature, definition)
select p.oid::regprocedure::text, pg_get_functiondef(p.oid)
  from pg_proc p
 where p.oid in (
   'private.maternal_staff_may_read(uuid,uuid)'::regprocedure,
   'private.pregnancy_staff_may_read(uuid)'::regprocedure,
   'private.pregnancy_may_write(uuid,uuid)'::regprocedure,
   'public.record_lifecycle_event(text,date,uuid,integer,text,text)'::regprocedure,
   'public.antenatal_schedule_review_prompt(uuid)'::regprocedure)
on conflict (fn_signature) do nothing;

-- 1. the one helper the S68 tables call (and, below, the S67 tables and the review prompt): kill switch, no coordinator, care tie or audited opening.
-- Not staff_may_read: that one also admits view-as (no category). A caller with no care relationship gets false.
create or replace function private.maternal_staff_may_read(p_patient uuid, p_org uuid)
returns boolean language sql stable security definer set search_path = '' as
$$ select case
     when not private.tied_staff_reads_on() then private.is_org_staff(p_org)
     when exists (select 1 from public.profiles pr where pr.id = (select auth.uid()) and pr.role = 'care_coordinator') then false
     else private.clinician_has_patient_access(p_patient)
          or private.staff_has_open(p_patient, 'reproductive_health'::public.care_access_category)
   end $$;
revoke all on function private.maternal_staff_may_read(uuid, uuid) from public, anon;
grant execute on function private.maternal_staff_may_read(uuid, uuid) to authenticated;

-- 2. the staff arm of the S67 write helper (first, because the S67 policies below depend on it)
create or replace function private.pregnancy_may_write(p_patient uuid, p_org uuid)
returns boolean language sql stable security definer set search_path = '' as
$$ select (p_patient = (select auth.uid()) and p_org = private.current_org_id())
       or private.staff_may_write(p_patient, p_org, 'reproductive_health'::public.care_access_category) $$;
revoke all on function private.pregnancy_may_write(uuid, uuid) from public, anon;
grant execute on function private.pregnancy_may_write(uuid, uuid) to authenticated;

-- 3. the one-argument helper cannot be tied (it has no patient), so it is neutralised: fail closed, never a plain staff check again
create or replace function private.pregnancy_staff_may_read(p_org uuid)
returns boolean language sql stable security definer set search_path = '' as
$$ select false $$;
comment on function private.pregnancy_staff_may_read(uuid) is 'S88: NEUTRALISED (always false). It took no patient so it could not be tied. Use private.maternal_staff_may_read(patient, org). Do not copy the old body (private.is_org_staff) back into a policy.';
revoke all on function private.pregnancy_staff_may_read(uuid) from public, anon;
grant execute on function private.pregnancy_staff_may_read(uuid) to authenticated;

-- 4. the four S67 SELECT policies (roles are kept by ALTER POLICY)
alter policy pregnancies_select on public.pregnancies
  using ((patient_id = (select auth.uid())) or private.maternal_staff_may_read(patient_id, organisation_id) or private.pregnancy_caregiver_may_read(patient_id));
alter policy kick_counts_select on public.kick_counts
  using ((patient_id = (select auth.uid())) or private.maternal_staff_may_read(patient_id, organisation_id) or private.pregnancy_caregiver_may_read(patient_id));
alter policy contractions_select on public.contractions
  using ((patient_id = (select auth.uid())) or private.maternal_staff_may_read(patient_id, organisation_id) or private.pregnancy_caregiver_may_read(patient_id));
alter policy birth_plans_select on public.birth_plans
  using ((patient_id = (select auth.uid())) or private.maternal_staff_may_read(patient_id, organisation_id) or private.pregnancy_caregiver_may_read(patient_id));

-- 5. the S68 write policies that carried a literal plain staff arm
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

-- 6. the two SECURITY DEFINER functions with an organisation-wide staff arm. Bodies are the live ones with the staff gate replaced, nothing else.
create or replace function public.record_lifecycle_event(p_kind text, p_occurred_on date default current_date, p_patient uuid default null::uuid,
                                                         p_gestation_weeks integer default null::integer, p_note text default null::text,
                                                         p_delivery_mode text default 'unknown'::text)
returns jsonb language plpgsql security definer set search_path = '' as
$function$
declare
  v_uid uuid := (select auth.uid());
  v_patient uuid := coalesce(p_patient, v_uid);
  v_org uuid; v_staff boolean := false; v_res jsonb; v_cause text; v_loss uuid; v_pp uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = v_patient;
  if v_org is null then raise exception 'unknown person' using errcode = '22023'; end if;
  if v_patient <> v_uid then
    -- S88: recording a pregnancy, delivery or loss for someone else needs an active clinician with a care tie to her (reproductive_health), not just staff
    -- status in the organisation. Kill switch tied_staff_writes off = the old organisation-wide rule (staff_may_write falls back to it).
    v_staff := v_org = (select organisation_id from public.profiles where id = v_uid)
               and private.staff_may_write(v_patient, v_org, 'reproductive_health'::public.care_access_category);
    if not v_staff then raise exception 'you can only confirm this for yourself' using errcode = '42501'; end if;
  end if;
  if not private.go_live_open_patient('maternal_enabled', v_patient) then
    raise exception 'This is not open yet' using errcode = '55000', hint = 'maternal_enabled';
  end if;
  if p_delivery_mode not in ('vaginal', 'assisted', 'caesarean', 'unknown') then raise exception 'unknown delivery mode' using errcode = '22023'; end if;
  v_cause := case when v_staff then 'clinician_recorded' else 'self_confirmed' end;

  perform set_config('tarragon.lifecycle_internal', '1', true);
  v_res := private.lifecycle_apply(v_patient, p_kind, p_occurred_on, v_cause, v_uid, true);

  if p_kind = 'pregnancy_confirmed' then
    insert into public.patient_pregnancy (organisation_id, patient_id, is_pregnant) values (v_org, v_patient, true)
      on conflict (patient_id) do update set is_pregnant = true;
  elsif p_kind = 'delivery_recorded' then
    insert into public.postnatal_profiles (organisation_id, patient_id, delivery_date, delivery_mode)
    values (v_org, v_patient, p_occurred_on, p_delivery_mode) returning id into v_pp;
    update public.patient_pregnancy set is_pregnant = false where patient_id = v_patient;
    perform private.emit_domain_event('delivery.recorded', v_org, jsonb_build_object('postnatal_profile_id', v_pp),
      'delivery.recorded:' || v_pp, v_patient, 'postnatal_profiles', v_pp);
  elsif p_kind = 'pregnancy_loss_recorded' then
    insert into public.pregnancy_loss_records (organisation_id, patient_id, occurred_on, gestation_weeks, note, source, recorded_by)
    values (v_org, v_patient, p_occurred_on, p_gestation_weeks, p_note, case when v_staff then 'clinician_recorded' else 'patient_entered' end, v_uid)
    returning id into v_loss;
    update public.patient_pregnancy set is_pregnant = false where patient_id = v_patient;
    perform private.emit_domain_event('pregnancy.loss_recorded', v_org, jsonb_build_object('loss_id', v_loss),
      'pregnancy.loss_recorded:' || v_loss, v_patient, 'pregnancy_loss_records', v_loss);
  end if;
  perform set_config('tarragon.lifecycle_internal', '', true);
  return v_res;
end $function$;

create or replace function public.antenatal_schedule_review_prompt(p_pregnancy_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as
$function$
declare
  v_preg public.pregnancies%rowtype;
  v_reasons text[] := '{}';
begin
  select * into v_preg from public.pregnancies where id = p_pregnancy_id;
  -- S88: the prompt reveals risk flags and an amber pregnancy blood pressure, so it needs the same care tie as reading the pregnancy row
  if not found or not private.maternal_staff_may_read(v_preg.patient_id, v_preg.organisation_id) then raise exception 'not allowed' using errcode = '42501'; end if;
  perform private.log_audit('read', 'antenatal_schedule_review_prompt', v_preg.id, jsonb_build_object('patient_id', v_preg.patient_id));
  if cardinality(v_preg.risk_flags) > 0 then v_reasons := array_append(v_reasons, 'risk_flag'); end if;
  -- An amber pregnancy reading in the last 14 days: a BP-P1 referral task opened for this patient.
  if exists (select 1 from public.triage_events e
              where e.patient_id = v_preg.patient_id and not e.shadow and e.grade = 'amber' and e.rule_id = 'BP-P1'
                and e.created_at > now() - interval '14 days') then
    v_reasons := array_append(v_reasons, 'amber_blood_pressure');
  end if;
  return jsonb_build_object('pregnancy_id', v_preg.id, 'reasons', to_jsonb(v_reasons));
end $function$;

-- 7. register the nine
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

-- self-checks. For each of the nine tables, EVERY policy (select, insert, update, delete) may call only the approved helpers, must call at least one of
-- them or auth.uid() (so no `using (true)`), and must not name is_org_staff or either dead helper. The helper bodies are then checked to be the tied
-- ones and to carry the reproductive_health category; anon is closed everywhere; the backups exist.
do $$
declare
  v_t text; v_pol record; v_call text; v_bad text;
  v_whitelist text[] := array['maternal_staff_may_read', 'staff_may_write', 'pregnancy_may_write', 'pregnancy_caregiver_may_read',
                              'maternal_caregiver_may_read', 'current_org_id'];
  v_expr text;
begin
  foreach v_t in array array['pregnancies', 'kick_counts', 'contractions', 'birth_plans', 'postnatal_baby_checks', 'breastfeeding_feed_log',
                             'lifecycle_states', 'lifecycle_events', 'pregnancy_loss_records'] loop
    if not exists (select 1 from public.staff_read_scope where table_name = v_t and mode = 'tied' and category = 'reproductive_health') then
      raise exception 'S88: % is not registered as tied', v_t;
    end if;
    if not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = v_t and p.cmd = 'SELECT'
                      and p.qual like '%maternal_staff_may_read%') then
      raise exception 'S88: the SELECT policy on % is not tied through maternal_staff_may_read', v_t;
    end if;
    for v_pol in select p.policyname, p.cmd, coalesce(p.qual, '') as q, coalesce(p.with_check, '') as w from pg_policies p
                  where p.schemaname = 'public' and p.tablename = v_t loop
      v_expr := v_pol.q || ' ' || v_pol.w;
      if v_expr ~ 'is_org_staff\(' or v_expr ~ 'pregnancy_staff_may_read' or v_expr ~ 'can_support_view' then
        raise exception 'S88: % policy % still names a plain staff or view-as arm', v_t, v_pol.policyname;
      end if;
      for v_call in select m[1] from regexp_matches(v_expr, 'private\.([a-z_0-9]+)\(', 'g') as m loop
        if not (v_call = any (v_whitelist)) then
          raise exception 'S88: % policy % calls private.% which is not an approved tied helper', v_t, v_pol.policyname, v_call;
        end if;
      end loop;
      if v_expr !~ 'auth\.uid\(\)' and not exists (select 1 from unnest(v_whitelist) w where w <> 'current_org_id' and v_expr like '%private.' || w || '(%') then
        raise exception 'S88: % policy % has no patient arm and no approved helper (open policy?)', v_t, v_pol.policyname;
      end if;
    end loop;
    if has_table_privilege('anon', 'public.' || v_t, 'SELECT') then raise exception 'S88: anon can read %', v_t; end if;
  end loop;

  if has_function_privilege('anon', 'private.maternal_staff_may_read(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'private.pregnancy_may_write(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'private.pregnancy_staff_may_read(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_lifecycle_event(text,date,uuid,integer,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.antenatal_schedule_review_prompt(uuid)', 'EXECUTE') then
    raise exception 'S88: anon can execute a function this migration replaced';
  end if;
  if has_table_privilege('authenticated', 'public.staff_read_function_backup', 'SELECT') or has_table_privilege('anon', 'public.staff_read_function_backup', 'SELECT') then
    raise exception 'S88: the function backup table is readable by a client role';
  end if;

  -- helper bodies: the tied ones, naming reproductive_health, with no plain staff arm left
  select string_agg(f, ', ') into v_bad from (values
    ('private.maternal_staff_may_read(uuid,uuid)', 'clinician_has_patient_access', true, false),
    ('private.pregnancy_may_write(uuid,uuid)', 'staff_may_write', true, true),
    ('public.record_lifecycle_event(text,date,uuid,integer,text,text)', 'staff_may_write', true, true),
    ('public.antenatal_schedule_review_prompt(uuid)', 'maternal_staff_may_read', false, true)) as t(f, needle, needs_cat, forbid_org_staff)
   where pg_get_functiondef(f::regprocedure) !~ needle
      or (needs_cat and pg_get_functiondef(f::regprocedure) !~ 'reproductive_health')
      or (forbid_org_staff and pg_get_functiondef(f::regprocedure) ~ 'is_org_staff')
      or (f like '%maternal_staff_may_read%' and pg_get_functiondef(f::regprocedure) ~ 'can_support_view|private\.staff_may_read\(');
  if v_bad is not null then raise exception 'S88: helper body is not the tied one: %', v_bad; end if;
  if pg_get_functiondef('private.pregnancy_staff_may_read(uuid)'::regprocedure) !~ 'select false' then
    raise exception 'S88: the one-argument helper is not neutralised';
  end if;
  if (select count(*) from public.staff_read_function_backup) < 5 then raise exception 'S88: function bodies were not backed up'; end if;
end $$;
