create type accountability_model as enum ('tech_layer','provider');
create type user_role as enum ('patient','clinician','coordinator','institution_admin','ops_admin','superadmin');
create type sex_at_birth as enum ('female','male');
create type reading_type as enum ('bp','glucose_fasting','glucose_random','hba1c','weight','height','waist','pulse');
create type reading_source as enum ('patient_manual','patient_device_bt','screening_day','clinician_entered','lab_import');
create type device_validation as enum ('validated','unvalidated_advisory','wrist_advisory','unknown');
create type triage_class as enum ('stable','needs_review','urgent','emergency');
create type criticality as enum ('routine','important','urgent','emergency');
create type comms_channel as enum ('push','in_app','whatsapp','sms','email','voice');
create type content_class as enum ('clinical','non_clinical');
create type delivery_state as enum ('queued','sent','delivered','failed','opened','acted');
create type contact_type as enum ('voice','synchronous_in_app','async_in_app','field_visit');
create type consent_scope as enum ('funder_summary','institution_aggregate','clinical_share','escalation_contact','research_anonymised');
create type enrolment_status as enum ('pending','active','paused','exited');
create type programme_code as enum ('control','concierge');
create type invoice_line_type as enum ('service_fee','performance_bonus','device','onboarding');
create type medication_verification as enum ('verified','unverified','unknown');
create type referral_reason as enum (
  'out_of_protocol','secondary_hypertension_suspected','type_1_diabetes',
  'pregnancy','ckd_stage_3plus','cardiac_symptoms','uncontrolled_at_max_protocol',
  'patient_request','other'
);

