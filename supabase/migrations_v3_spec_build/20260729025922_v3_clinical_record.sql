create table clinical_contacts (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  clinician_id uuid references clinicians(id),
  coordinator_id uuid references profiles(id),
  contact_type contact_type not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_seconds int,
  masked_call_ref text,                -- provider call id
  created_at timestamptz not null default now()
);

create table clinical_notes (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  clinician_id uuid not null references clinicians(id),
  note_type text not null,             -- 'review' | 'escalation' | 'contact' | 'handover' | 'referral'
  body text not null,
  linked_contact_id uuid references clinical_contacts(id),
  linked_classification_id uuid references triage_classifications(id),
  accountability_model_at_signing accountability_model not null,
  mdcn_number_at_signing text not null,
  signed_at timestamptz not null default now()
);

create table escalation_slas (
  criticality criticality primary key,
  sla_minutes int not null,
  channel_sequence text not null
);
insert into escalation_slas (criticality, sla_minutes, channel_sequence) values
  ('routine', 7*24*60, 'batched digest, push only'),
  ('important', 48*60, 'push -> automated whatsapp nudge (non-clinical)'),
  ('urgent', 120, 'phone call - never a message'),
  ('emergency', 0, 'push + whatsapp + sms simultaneously, then documented next-of-kin attempt');

create table escalations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  classification_id uuid references triage_classifications(id),
  criticality criticality not null,
  raised_by uuid references profiles(id),
  raised_at timestamptz not null default now(),
  due_by timestamptz not null,         -- computed from escalation_slas
  resolved_at timestamptz,
  resolution_note_id uuid references clinical_notes(id),
  -- spec's `generated always as (... now() ...) stored` is invalid Postgres (generated
  -- columns must be immutable; now() is not) -- exposed instead via v_escalations below.
  breached boolean not null default false
);

create view v_escalations as
  select e.*, (e.resolved_at is null and now() > e.due_by) as breached_live
  from escalations e;

create table referrals (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  reason referral_reason not null,
  reason_detail text,
  referred_to text,                    -- facility or specialty
  referred_at timestamptz not null default now(),
  clinician_id uuid not null references clinicians(id),
  patient_informed_at timestamptz,
  criteria_version text not null       -- which published referral criteria applied
);

