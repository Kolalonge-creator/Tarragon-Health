-- Tarragon Health
-- pgAudit object-level READ (SELECT) logging on the clinical core
--
-- 20260812030853_row_change_audit_triggers.sql built row-level WRITE auditing (INSERT/UPDATE/
-- DELETE) into public.audit_log via a generic trigger, and explicitly deferred READ auditing to
-- pgaudit as a follow-up: a trigger cannot fire on SELECT, and "who read this patient's record"
-- (what an NDPR/NDPC access request usually actually asks) is a different question from "who
-- changed this record." This migration closes that gap.
--
-- Mechanism: pgAudit's object-level audit logging is independent of the session-level pgaudit.log
-- GUC. You grant SELECT on the tables you care about to a role named by pgaudit.role, and pgAudit
-- logs any statement that references one of those tables to the Postgres server log -- regardless
-- of which role actually executes the query. pgaudit_patient_read is NOLOGIN: nothing ever
-- authenticates as it, it exists purely as a permissions anchor for this mechanism, so granting it
-- SELECT on PHI tables creates no new access path (RLS is moot for a role that can never open a
-- session). Session-level pgaudit.log stays 'none' so unrelated tables/statements are not logged.
--
-- pgaudit.* GUCs are superuser-only settable (42501 permission denied under any non-superuser
-- session, including the roles this migration runner and the Supabase SQL/MCP tooling connect as)
-- -- ALTER DATABASE ... SET fails outright. Supabase's supported path is role-level config instead
-- (`alter role "<role>" set pgaudit.role = ...`), confirmed against their own pgaudit docs
-- (supabase.com/docs/guides/database/extensions/pgaudit). This must be set on BOTH "postgres" (SQL
-- editor / migrations / MCP tooling) AND "authenticator" (the role PostgREST actually connects as
-- for all real app/API traffic, before it SET ROLEs per-request to anon/authenticated/
-- service_role) -- role-level GUC defaults apply per connecting role, and SET ROLE does not reset
-- them, but a role that never established the session gets none of it. Missing "authenticator"
-- here would silently audit nothing but SQL-editor/migration activity, i.e. almost no real patient
-- record access. Already-pooled PostgREST connections established before this migration ran keep
-- their pre-change session defaults until they naturally cycle or the project is restarted; new
-- connections pick up the new default immediately.
--
-- Where the logs land: the Postgres server log (Supabase dashboard's Postgres Logs / log
-- explorer), not a queryable table. Unlike public.audit_log these entries are subject to this
-- project's log retention window, not retained indefinitely -- piping them to durable storage (a
-- log drain) is a deliberately separate, unbuilt follow-up if long-term retention is required for
-- compliance evidence.
--
-- Same 21-table scope as the write-trigger migration, for symmetry between the read and write
-- halves of the audit story: vitals_readings, medications, medication_logs, medication_reviews,
-- screening_results, lab_result_documents, lab_analyte_readings, clinician_alerts, escalations,
-- care_plans, profiles, emergency_events, patient_risk_scores, referrals, vaccination_records,
-- clinical_staff, care_messages, case_briefs, wearable_readings, patient_hospital_admissions,
-- symptoms. Extending both migrations' table lists together, if the org-staff surface grows past
-- this clinical core, is a mechanical follow-up (this DO block's array, plus the trigger
-- migration's two arrays).

create extension if not exists pgaudit;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'pgaudit_patient_read') then
    create role pgaudit_patient_read nologin;
  end if;
end $$;

comment on role pgaudit_patient_read is
  'Permissions anchor for pgAudit object-level READ logging on patient/health-record tables. '
  'NOLOGIN -- nothing ever authenticates as this role. See '
  '20260812034312_pgaudit_patient_read_logging.sql.';

do $$
declare
  t text;
  tables text[] := array[
    'vitals_readings', 'medications', 'medication_logs', 'medication_reviews',
    'screening_results', 'lab_result_documents', 'lab_analyte_readings', 'clinician_alerts',
    'escalations', 'care_plans', 'profiles', 'emergency_events', 'patient_risk_scores',
    'referrals', 'vaccination_records', 'clinical_staff', 'care_messages', 'case_briefs',
    'wearable_readings', 'patient_hospital_admissions', 'symptoms'
  ];
begin
  foreach t in array tables loop
    execute format('grant select on public.%I to pgaudit_patient_read', t);
  end loop;
end $$;

alter role "postgres" set pgaudit.role to 'pgaudit_patient_read';
alter role "postgres" set pgaudit.log to 'none';
alter role "authenticator" set pgaudit.role to 'pgaudit_patient_read';
alter role "authenticator" set pgaudit.log to 'none';
-- pgaudit.log_relation / pgaudit.log_catalog / pgaudit.log_parameter left at their Postgres
-- defaults deliberately: Supabase does not support configuring pgaudit.log_parameter at all (risk
-- of logging secrets out of pgsodium/Vault-backed encrypted columns), and the other two are
-- session-class (pgaudit.log) modifiers that are moot here since pgaudit.log stays 'none' -- all
-- logging in this migration comes from the object-level pgaudit.role mechanism instead.

-- Proof, not hope: assert the role actually has SELECT on every table in the list, and that both
-- "postgres" and "authenticator" actually carry the role-level pgaudit.role setting (a role-level
-- setting shows in pg_db_role_setting with setdatabase = 0, applying across every database that
-- role connects to).
do $$
declare
  t text;
  tables text[] := array[
    'vitals_readings', 'medications', 'medication_logs', 'medication_reviews',
    'screening_results', 'lab_result_documents', 'lab_analyte_readings', 'clinician_alerts',
    'escalations', 'care_plans', 'profiles', 'emergency_events', 'patient_risk_scores',
    'referrals', 'vaccination_records', 'clinical_staff', 'care_messages', 'case_briefs',
    'wearable_readings', 'patient_hospital_admissions', 'symptoms'
  ];
  target_role text;
  target_roles text[] := array['postgres', 'authenticator'];
  v_role_setting text;
begin
  foreach t in array tables loop
    if not has_table_privilege('pgaudit_patient_read', 'public.' || quote_ident(t), 'SELECT') then
      raise exception 'pgaudit_patient_read missing SELECT on public.%', t;
    end if;
  end loop;

  foreach target_role in array target_roles loop
    select s.setconfig::text into v_role_setting
      from pg_db_role_setting s
      join pg_roles r on r.oid = s.setrole
      where r.rolname = target_role and s.setdatabase = 0;
    if v_role_setting is null or v_role_setting !~ 'pgaudit\.role=pgaudit_patient_read' then
      raise exception 'pgaudit.role setting did not take for role %: %', target_role, v_role_setting;
    end if;
  end loop;
end $$;
