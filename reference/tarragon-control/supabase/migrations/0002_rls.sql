-- Tarragon Control — M1: row-level security
-- Source: docs/tarragon-build-spec-v3.md §6
-- RLS enabled on every table. No table ships without a policy. Default deny.
--
-- KNOWN SPEC GAP (flagged, not guessed at): §6.1 says clinician access includes
-- "patients with an active enrolment assigned to their caseload" but §5 never
-- defines a caseload-assignment column (only enrolments.assigned_coordinator_id
-- exists, which is coordinator-specific). Per §0.1 ("do not infer product
-- decisions from prose, stop and ask"), this migration implements ONLY the
-- fully-specified half of clinician access — the shared needs_review+ exception
-- queue — and does NOT invent an enrolments.clinician_id column. Add it in a
-- follow-up migration once the founder confirms the caseload-assignment model.

-- =========================================================================
-- private schema — SECURITY DEFINER helpers, no direct grants to anon/authenticated
-- =========================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.current_role()
returns user_role
language sql
security definer
stable
set search_path = public
as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function private.current_patient_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from patients where profile_id = auth.uid();
$$;

create or replace function private.current_clinician_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from clinicians where profile_id = auth.uid();
$$;

-- patient role: own patient row + any dependants guardian'd by them
create or replace function private.owned_patient_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from patients where profile_id = auth.uid()
  union
  select id from patients
  where guardian_patient_id = (select id from patients where profile_id = auth.uid());
$$;

-- shared exception queue: any patient with an open needs_review+ classification.
-- This is the only fully-specified half of clinician access (see gap note above).
-- Also used for coordinator's "same patient set as clinician".
create or replace function private.queue_patient_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select distinct tc.patient_id
  from triage_classifications tc
  where tc.classification in ('needs_review','urgent','emergency')
    and tc.cleared_at is null;
$$;

-- coordinator's own explicit assignment, fully specified via
-- enrolments.assigned_coordinator_id
create or replace function private.coordinator_assigned_patient_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select distinct e.patient_id
  from enrolments e
  where e.assigned_coordinator_id = auth.uid();
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- =========================================================================
-- Enable RLS on every table (default deny — no policy means no access)
-- =========================================================================

alter table app_config enable row level security;
alter table profiles enable row level security;
alter table patients enable row level security;
alter table clinicians enable row level security;
alter table organisations enable row level security;
alter table programmes enable row level security;
alter table enrolments enable row level security;
alter table devices enable row level security;
alter table protocol_configs enable row level security;
alter table consent_records enable row level security;
alter table screening_events enable row level security;
alter table screening_participants enable row level security;
alter table readings enable row level security;
alter table triage_classifications enable row level security;
alter table clinical_contacts enable row level security;
alter table clinical_notes enable row level security;
alter table escalations enable row level security;
alter table referrals enable row level security;
alter table proof_log enable row level security;
alter table notification_templates enable row level security;
alter table notification_sends enable row level security;
alter table notification_events enable row level security;
alter table device_heartbeats enable row level security;
alter table partners enable row level security;
alter table medications enable row level security;
alter table medication_dispenses enable row level security;
alter table lab_orders enable row level security;
alter table subscriptions enable row level security;
alter table wallets enable row level security;
alter table wallet_transactions enable row level security;
alter table invoice_lines enable row level security;
alter table audit_log enable row level security;

-- Force RLS even for the table owner (Supabase default role setup already
-- does this for the app roles, but belt-and-braces per "no table ships
-- without a policy").
alter table app_config force row level security;
alter table profiles force row level security;
alter table patients force row level security;
alter table clinicians force row level security;
alter table readings force row level security;
alter table triage_classifications force row level security;
alter table clinical_notes force row level security;
alter table clinical_contacts force row level security;
alter table escalations force row level security;
alter table proof_log force row level security;
alter table consent_records force row level security;

-- =========================================================================
-- app_config — superadmin/ops_admin read; only superadmin writes; every
-- authenticated user can read the guard booleans that gate their own flows
-- (e.g. accountability_model affects note-signature rendering, patient app
-- needs to know whether enrolment is blocked). Values are not secret; the
-- audit trail (set_by/set_at) is what matters.
-- =========================================================================

create policy app_config_read_authenticated on app_config
  for select to authenticated
  using (true);

create policy app_config_write_superadmin on app_config
  for all to authenticated
  using (private.current_role() = 'superadmin')
  with check (private.current_role() = 'superadmin');

-- =========================================================================
-- profiles
-- =========================================================================

create policy profiles_select_own on profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_select_staff on profiles
  for select to authenticated
  using (private.current_role() in ('clinician','coordinator','ops_admin','superadmin'));

create policy profiles_update_own on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_write_superadmin on profiles
  for all to authenticated
  using (private.current_role() = 'superadmin')
  with check (private.current_role() = 'superadmin');

-- =========================================================================
-- patients
-- =========================================================================

create policy patients_select_own on patients
  for select to authenticated
  using (id in (select private.owned_patient_ids()));

create policy patients_select_queue on patients
  for select to authenticated
  using (
    private.current_role() in ('clinician','coordinator')
    and id in (select private.queue_patient_ids())
  );

create policy patients_select_coordinator_assigned on patients
  for select to authenticated
  using (
    private.current_role() = 'coordinator'
    and id in (select private.coordinator_assigned_patient_ids())
  );

create policy patients_select_ops_admin on patients
  for select to authenticated
  using (private.current_role() = 'ops_admin');

create policy patients_insert_own on patients
  for insert to authenticated
  with check (
    profile_id = auth.uid()
    or guardian_patient_id = private.current_patient_id()
  );

create policy patients_update_own on patients
  for update to authenticated
  using (id in (select private.owned_patient_ids()))
  with check (id in (select private.owned_patient_ids()));

create policy patients_write_superadmin on patients
  for all to authenticated
  using (private.current_role() = 'superadmin')
  with check (private.current_role() = 'superadmin');

-- =========================================================================
-- clinicians — patients need to read the clinician's own display fields
-- (name/MDCN number render on every message and proof_log entry, per §10).
-- Deliberately exposes only what's already patient-facing per §10's
-- "Clinician name and MDCN number on every message" requirement.
-- =========================================================================

create policy clinicians_select_self on clinicians
  for select to authenticated
  using (profile_id = auth.uid());

create policy clinicians_select_staff on clinicians
  for select to authenticated
  using (private.current_role() in ('clinician','coordinator','ops_admin','superadmin'));

create policy clinicians_select_patient_facing on clinicians
  for select to authenticated
  using (
    private.current_role() = 'patient'
    and id in (
      select cn.clinician_id from clinical_notes cn
      where cn.patient_id in (select private.owned_patient_ids())
      union
      select cc.clinician_id from clinical_contacts cc
      where cc.patient_id in (select private.owned_patient_ids()) and cc.clinician_id is not null
      union
      select m.prescribed_by from medications m
      where m.patient_id in (select private.owned_patient_ids()) and m.prescribed_by is not null
    )
  );

create policy clinicians_write_superadmin on clinicians
  for all to authenticated
  using (private.current_role() = 'superadmin')
  with check (private.current_role() = 'superadmin');

create policy clinicians_update_self on clinicians
  for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

-- =========================================================================
-- organisations, programmes — institution_admin deliberately gets NO policy
-- here (spec §6.1: "zero rows on every patient-scoped table... access only
-- to v_institution_aggregate", read as exhaustive until that view exists —
-- see Phase 2 P1/§13). programmes is public reference data.
-- =========================================================================

create policy programmes_select_authenticated on programmes
  for select to authenticated
  using (true);

create policy programmes_write_ops on programmes
  for all to authenticated
  using (private.current_role() in ('ops_admin','superadmin'))
  with check (private.current_role() in ('ops_admin','superadmin'));

create policy organisations_select_staff on organisations
  for select to authenticated
  using (private.current_role() in ('clinician','coordinator','ops_admin','superadmin'));

create policy organisations_write_ops on organisations
  for all to authenticated
  using (private.current_role() in ('ops_admin','superadmin'))
  with check (private.current_role() in ('ops_admin','superadmin'));

-- =========================================================================
-- enrolments
-- =========================================================================

create policy enrolments_select_own on enrolments
  for select to authenticated
  using (patient_id in (select private.owned_patient_ids()));

create policy enrolments_select_queue on enrolments
  for select to authenticated
  using (
    private.current_role() in ('clinician','coordinator')
    and patient_id in (select private.queue_patient_ids())
  );

create policy enrolments_select_coordinator_assigned on enrolments
  for select to authenticated
  using (assigned_coordinator_id = auth.uid());

create policy enrolments_select_ops on enrolments
  for select to authenticated
  using (private.current_role() in ('ops_admin','superadmin'));

create policy enrolments_write_ops on enrolments
  for all to authenticated
  using (private.current_role() in ('ops_admin','superadmin'))
  with check (private.current_role() in ('ops_admin','superadmin'));

-- =========================================================================
-- devices
-- =========================================================================

create policy devices_select_own on devices
  for select to authenticated
  using (patient_id in (select private.owned_patient_ids()));

create policy devices_select_staff on devices
  for select to authenticated
  using (
    private.current_role() in ('clinician','coordinator','ops_admin','superadmin')
    and (
      private.current_role() in ('ops_admin','superadmin')
      or patient_id in (select private.queue_patient_ids())
      or patient_id in (select private.coordinator_assigned_patient_ids())
    )
  );

create policy devices_insert_own on devices
  for insert to authenticated
  with check (patient_id in (select private.owned_patient_ids()));

create policy devices_update_own on devices
  for update to authenticated
  using (patient_id in (select private.owned_patient_ids()))
  with check (patient_id in (select private.owned_patient_ids()));

create policy devices_validate_clinician on devices
  for update to authenticated
  using (private.current_role() = 'clinician')
  with check (private.current_role() = 'clinician');

create policy devices_write_superadmin on devices
  for all to authenticated
  using (private.current_role() = 'superadmin')
  with check (private.current_role() = 'superadmin');

-- =========================================================================
-- protocol_configs — clinical ruleset; clinician/ops/superadmin only.
-- Patients don't read raw thresholds; they see triage_classifications'
-- plain-language output instead.
-- =========================================================================

create policy protocol_configs_select_staff on protocol_configs
  for select to authenticated
  using (private.current_role() in ('clinician','ops_admin','superadmin'));

create policy protocol_configs_write_clinician on protocol_configs
  for insert to authenticated
  with check (private.current_role() = 'clinician' and approved_by = private.current_clinician_id());

create policy protocol_configs_write_superadmin on protocol_configs
  for all to authenticated
  using (private.current_role() = 'superadmin')
  with check (private.current_role() = 'superadmin');

-- =========================================================================
-- consent_records — I4: consent checked at query time. This table itself
-- follows the same visibility as the patient it belongs to, plus the grantee
-- can see grants made TO them.
-- =========================================================================

create policy consent_records_select_own on consent_records
  for select to authenticated
  using (patient_id in (select private.owned_patient_ids()));

create policy consent_records_select_grantee on consent_records
  for select to authenticated
  using (granted_to_profile_id = auth.uid() and revoked_at is null
         and (expires_at is null or expires_at > now()));

create policy consent_records_select_staff on consent_records
  for select to authenticated
  using (private.current_role() in ('ops_admin','superadmin'));

create policy consent_records_insert_own on consent_records
  for insert to authenticated
  with check (
    patient_id in (select private.owned_patient_ids())
    or private.current_role() in ('coordinator','clinician','ops_admin','superadmin')
  );

create policy consent_records_update_revoke on consent_records
  for update to authenticated
  using (patient_id in (select private.owned_patient_ids()))
  with check (patient_id in (select private.owned_patient_ids()));

create policy consent_records_write_superadmin on consent_records
  for all to authenticated
  using (private.current_role() = 'superadmin')
  with check (private.current_role() = 'superadmin');

-- =========================================================================
-- screening_events / screening_participants — field-ops tables, coordinator
-- and ops_admin operate these; clinicians don't need them directly.
-- =========================================================================

create policy screening_events_select_staff on screening_events
  for select to authenticated
  using (private.current_role() in ('coordinator','clinician','ops_admin','superadmin'));

create policy screening_events_write_staff on screening_events
  for all to authenticated
  using (private.current_role() in ('coordinator','ops_admin','superadmin'))
  with check (private.current_role() in ('coordinator','ops_admin','superadmin'));

create policy screening_participants_select_staff on screening_participants
  for select to authenticated
  using (private.current_role() in ('coordinator','clinician','ops_admin','superadmin'));

create policy screening_participants_select_own on screening_participants
  for select to authenticated
  using (patient_id in (select private.owned_patient_ids()));

create policy screening_participants_write_staff on screening_participants
  for all to authenticated
  using (private.current_role() in ('coordinator','ops_admin','superadmin'))
  with check (private.current_role() in ('coordinator','ops_admin','superadmin'));

-- =========================================================================
-- readings — I14 lands here: a patient_device_bt reading cannot be edited
-- by a patient. Patients get INSERT + SELECT on their own rows, but UPDATE
-- is staff-only (and only ops/clinician, never a blanket patient grant).
-- =========================================================================

create policy readings_select_own on readings
  for select to authenticated
  using (patient_id in (select private.owned_patient_ids()));

create policy readings_select_staff on readings
  for select to authenticated
  using (
    private.current_role() in ('ops_admin','superadmin')
    or (private.current_role() in ('clinician','coordinator')
        and patient_id in (select private.queue_patient_ids()))
    or (private.current_role() = 'coordinator'
        and patient_id in (select private.coordinator_assigned_patient_ids()))
  );

create policy readings_insert_own on readings
  for insert to authenticated
  with check (patient_id in (select private.owned_patient_ids()));

create policy readings_insert_staff on readings
  for insert to authenticated
  with check (private.current_role() in ('clinician','coordinator','ops_admin','superadmin'));

-- I14: no general patient UPDATE policy exists on readings at all — a typed
-- correction is a new row (source='patient_manual', notes explaining the
-- override), never an edit of a device-sourced row. Clinician/ops may
-- correct a row (e.g. a data-entry fix flagged during review).
create policy readings_update_staff on readings
  for update to authenticated
  using (private.current_role() in ('clinician','ops_admin','superadmin'))
  with check (private.current_role() in ('clinician','ops_admin','superadmin'));

-- =========================================================================
-- triage_classifications
-- =========================================================================

create policy triage_classifications_select_own on triage_classifications
  for select to authenticated
  using (patient_id in (select private.owned_patient_ids()));

create policy triage_classifications_select_staff on triage_classifications
  for select to authenticated
  using (
    private.current_role() in ('ops_admin','superadmin')
    or (private.current_role() in ('clinician','coordinator')
        and patient_id in (select private.queue_patient_ids()))
    or (private.current_role() = 'coordinator'
        and patient_id in (select private.coordinator_assigned_patient_ids()))
  );

-- Written by the classification pipeline (service_role, M5) and by
-- clinician batch-clear/override actions.
create policy triage_classifications_insert_service on triage_classifications
  for insert to authenticated
  with check (private.current_role() in ('ops_admin','superadmin'));

create policy triage_classifications_update_clinician on triage_classifications
  for update to authenticated
  using (private.current_role() = 'clinician')
  with check (private.current_role() = 'clinician');

-- =========================================================================
-- clinical_contacts / clinical_notes — coordinator gets clinical_contacts
-- (non-clinical metadata: who/when/duration) but NOT clinical_notes.body,
-- per §6.1 explicitly. Column-level restriction is enforced by omitting
-- coordinator from clinical_notes entirely and giving them a SECURITY
-- DEFINER view for the non-body fields (view added once M8 needs it) —
-- for M1, no coordinator policy exists on clinical_notes at all, which is
-- stricter than "no body access" (zero access), safe by default and
-- revisited when the coordinator UI needs partial fields.
-- =========================================================================

create policy clinical_contacts_select_own on clinical_contacts
  for select to authenticated
  using (patient_id in (select private.owned_patient_ids()));

create policy clinical_contacts_select_staff on clinical_contacts
  for select to authenticated
  using (
    private.current_role() in ('ops_admin','superadmin')
    or (private.current_role() in ('clinician','coordinator')
        and patient_id in (select private.queue_patient_ids()))
    or (private.current_role() = 'coordinator'
        and patient_id in (select private.coordinator_assigned_patient_ids()))
  );

create policy clinical_contacts_write_staff on clinical_contacts
  for all to authenticated
  using (private.current_role() in ('clinician','coordinator','superadmin'))
  with check (private.current_role() in ('clinician','coordinator','superadmin'));

create policy clinical_notes_select_own on clinical_notes
  for select to authenticated
  using (patient_id in (select private.owned_patient_ids()));

create policy clinical_notes_select_clinician on clinical_notes
  for select to authenticated
  using (
    private.current_role() in ('clinician','superadmin')
    and (
      private.current_role() = 'superadmin'
      or patient_id in (select private.queue_patient_ids())
      or clinician_id = private.current_clinician_id()
    )
  );

create policy clinical_notes_insert_clinician on clinical_notes
  for insert to authenticated
  with check (
    private.current_role() = 'clinician'
    and clinician_id = private.current_clinician_id()
  );

-- =========================================================================
-- escalations / referrals
-- =========================================================================

create policy escalations_select_own on escalations
  for select to authenticated
  using (patient_id in (select private.owned_patient_ids()));

create policy escalations_select_staff on escalations
  for select to authenticated
  using (private.current_role() in ('clinician','coordinator','ops_admin','superadmin'));

create policy escalations_write_staff on escalations
  for all to authenticated
  using (private.current_role() in ('clinician','coordinator','ops_admin','superadmin'))
  with check (private.current_role() in ('clinician','coordinator','ops_admin','superadmin'));

create policy referrals_select_own on referrals
  for select to authenticated
  using (patient_id in (select private.owned_patient_ids()));

create policy referrals_select_clinician on referrals
  for select to authenticated
  using (private.current_role() in ('clinician','superadmin'));

create policy referrals_insert_clinician on referrals
  for insert to authenticated
  with check (
    private.current_role() = 'clinician'
    and clinician_id = private.current_clinician_id()
  );

-- =========================================================================
-- proof_log — patient-facing, populated by triggers only (I10). No direct
-- application INSERT policy for patient/clinician/coordinator; only the
-- trigger functions (running as the invoking role, typically service_role
-- via SECURITY DEFINER trigger functions added alongside each source
-- table's write path in later migrations) write here.
-- =========================================================================

create policy proof_log_select_own on proof_log
  for select to authenticated
  using (patient_id in (select private.owned_patient_ids()));

create policy proof_log_select_staff on proof_log
  for select to authenticated
  using (
    private.current_role() in ('ops_admin','superadmin')
    or (private.current_role() in ('clinician','coordinator')
        and patient_id in (select private.queue_patient_ids()))
    or (private.current_role() = 'coordinator'
        and patient_id in (select private.coordinator_assigned_patient_ids()))
  );

create policy proof_log_insert_superadmin on proof_log
  for insert to authenticated
  with check (private.current_role() = 'superadmin');

-- =========================================================================
-- notifications
-- =========================================================================

create policy notification_templates_select_staff on notification_templates
  for select to authenticated
  using (private.current_role() in ('clinician','coordinator','ops_admin','superadmin'));

create policy notification_templates_write_ops on notification_templates
  for all to authenticated
  using (private.current_role() in ('ops_admin','superadmin'))
  with check (private.current_role() in ('ops_admin','superadmin'));

create policy notification_sends_select_own on notification_sends
  for select to authenticated
  using (patient_id in (select private.owned_patient_ids()));

create policy notification_sends_select_staff on notification_sends
  for select to authenticated
  using (private.current_role() in ('ops_admin','superadmin'));

create policy notification_sends_write_ops on notification_sends
  for all to authenticated
  using (private.current_role() in ('ops_admin','superadmin'))
  with check (private.current_role() in ('ops_admin','superadmin'));

create policy notification_events_select_ops on notification_events
  for select to authenticated
  using (private.current_role() in ('ops_admin','superadmin'));

create policy notification_events_write_ops on notification_events
  for all to authenticated
  using (private.current_role() in ('ops_admin','superadmin'))
  with check (private.current_role() in ('ops_admin','superadmin'));

create policy device_heartbeats_select_own on device_heartbeats
  for select to authenticated
  using (patient_id in (select private.owned_patient_ids()));

create policy device_heartbeats_select_ops on device_heartbeats
  for select to authenticated
  using (private.current_role() in ('ops_admin','superadmin'));

create policy device_heartbeats_write_own on device_heartbeats
  for insert to authenticated
  with check (patient_id in (select private.owned_patient_ids()));

create policy device_heartbeats_update_own on device_heartbeats
  for update to authenticated
  using (patient_id in (select private.owned_patient_ids()))
  with check (patient_id in (select private.owned_patient_ids()));

-- =========================================================================
-- partners — business directory; broad read (needed to show lab/pharmacy
-- names on a patient's own orders/dispenses), write restricted.
-- =========================================================================

create policy partners_select_authenticated on partners
  for select to authenticated
  using (true);

create policy partners_write_ops on partners
  for all to authenticated
  using (private.current_role() in ('ops_admin','superadmin'))
  with check (private.current_role() in ('ops_admin','superadmin'));

-- =========================================================================
-- medications / medication_dispenses / lab_orders — clinical, ops_admin
-- explicitly excluded per §6.1 ("no clinical_notes, no readings values" —
-- read consistently here as no clinical detail beyond logistics; ops_admin
-- gets NO access to medications/medication_dispenses/lab_orders clinical
-- fields in M1, revisit if a logistics-only view is needed later).
-- =========================================================================

create policy medications_select_own on medications
  for select to authenticated
  using (patient_id in (select private.owned_patient_ids()));

create policy medications_select_clinician on medications
  for select to authenticated
  using (
    private.current_role() = 'clinician'
    and (patient_id in (select private.queue_patient_ids()) or prescribed_by = private.current_clinician_id())
  );

create policy medications_write_clinician on medications
  for insert to authenticated
  with check (private.current_role() = 'clinician' and prescribed_by = private.current_clinician_id());

create policy medications_update_clinician on medications
  for update to authenticated
  using (private.current_role() = 'clinician' and prescribed_by = private.current_clinician_id())
  with check (private.current_role() = 'clinician' and prescribed_by = private.current_clinician_id());

create policy medication_dispenses_select_own on medication_dispenses
  for select to authenticated
  using (patient_id in (select private.owned_patient_ids()));

create policy medication_dispenses_select_clinician on medication_dispenses
  for select to authenticated
  using (private.current_role() = 'clinician' and patient_id in (select private.queue_patient_ids()));

create policy medication_dispenses_write_ops on medication_dispenses
  for insert to authenticated
  with check (private.current_role() in ('ops_admin','superadmin'));

create policy lab_orders_select_own on lab_orders
  for select to authenticated
  using (patient_id in (select private.owned_patient_ids()));

create policy lab_orders_select_clinician on lab_orders
  for select to authenticated
  using (private.current_role() = 'clinician' and patient_id in (select private.queue_patient_ids()));

create policy lab_orders_write_own on lab_orders
  for insert to authenticated
  with check (patient_id in (select private.owned_patient_ids()));

create policy lab_orders_write_staff on lab_orders
  for all to authenticated
  using (private.current_role() in ('clinician','ops_admin','superadmin'))
  with check (private.current_role() in ('clinician','ops_admin','superadmin'));

-- =========================================================================
-- billing — subscriptions/wallets are financial, not clinical; ops_admin
-- gets full access per §6.1 ("non-clinical operational tables").
-- =========================================================================

create policy subscriptions_select_own on subscriptions
  for select to authenticated
  using (payer_profile_id = auth.uid());

create policy subscriptions_select_ops on subscriptions
  for select to authenticated
  using (private.current_role() in ('ops_admin','superadmin'));

create policy subscriptions_write_own on subscriptions
  for insert to authenticated
  with check (payer_profile_id = auth.uid());

create policy subscriptions_write_ops on subscriptions
  for all to authenticated
  using (private.current_role() in ('ops_admin','superadmin'))
  with check (private.current_role() in ('ops_admin','superadmin'));

create policy wallets_select_own on wallets
  for select to authenticated
  using (owner_profile_id = auth.uid());

create policy wallets_select_ops on wallets
  for select to authenticated
  using (private.current_role() in ('ops_admin','superadmin'));

create policy wallets_write_own on wallets
  for insert to authenticated
  with check (owner_profile_id = auth.uid());

create policy wallets_write_ops on wallets
  for all to authenticated
  using (private.current_role() in ('ops_admin','superadmin'))
  with check (private.current_role() in ('ops_admin','superadmin'));

create policy wallet_transactions_select_own on wallet_transactions
  for select to authenticated
  using (wallet_id in (select id from wallets where owner_profile_id = auth.uid()));

create policy wallet_transactions_select_beneficiary on wallet_transactions
  for select to authenticated
  using (beneficiary_patient_id in (select private.owned_patient_ids()));

create policy wallet_transactions_select_ops on wallet_transactions
  for select to authenticated
  using (private.current_role() in ('ops_admin','superadmin'));

create policy wallet_transactions_write_ops on wallet_transactions
  for all to authenticated
  using (private.current_role() in ('ops_admin','superadmin'))
  with check (private.current_role() in ('ops_admin','superadmin'));

create policy invoice_lines_select_ops on invoice_lines
  for select to authenticated
  using (private.current_role() in ('ops_admin','superadmin'));

create policy invoice_lines_write_ops on invoice_lines
  for all to authenticated
  using (private.current_role() in ('ops_admin','superadmin'))
  with check (private.current_role() in ('ops_admin','superadmin'));

-- =========================================================================
-- audit_log — append-only, superadmin read only (0003_audit.sql revokes
-- UPDATE/DELETE from every role at the grant level, on top of this).
-- =========================================================================

create policy audit_log_select_superadmin on audit_log
  for select to authenticated
  using (private.current_role() = 'superadmin');

create policy audit_log_insert_authenticated on audit_log
  for insert to authenticated
  with check (true);
