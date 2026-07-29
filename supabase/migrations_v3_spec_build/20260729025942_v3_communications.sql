create table notification_templates (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  channel comms_channel not null,
  content_class content_class not null,
  criticality criticality not null,
  body_template text not null,
  vendor_template_name text,           -- Meta-approved template name for whatsapp
  active boolean not null default true
);

-- I1, at the database level
alter table notification_templates add constraint no_clinical_on_open_rails
  check (not (content_class = 'clinical'
              and channel in ('whatsapp','sms','email')));

create table notification_sends (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references notification_templates(id),
  patient_id uuid not null references patients(id) on delete cascade,
  channel comms_channel not null,
  criticality criticality not null,
  content_class content_class not null,
  vendor_message_id text,
  cost_minor int,                      -- kobo; populated from vendor webhook
  queued_at timestamptz not null default now()
);

alter table notification_sends add constraint sends_no_clinical_on_open_rails
  check (not (content_class = 'clinical'
              and channel in ('whatsapp','sms','email')));

create table notification_events (
  id uuid primary key default gen_random_uuid(),
  send_id uuid not null references notification_sends(id) on delete cascade,
  state delivery_state not null,
  occurred_at timestamptz not null default now(),
  detail jsonb
);

create table device_heartbeats (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references patients(id) on delete cascade,
  expo_push_token text,
  push_permission_granted boolean not null,
  app_version text,
  os text, os_version text, device_model text,
  last_seen_at timestamptz not null default now(),
  consecutive_push_failures int not null default 0,
  forced_channel comms_channel          -- set to 'whatsapp' or 'sms' when push is unreliable
);

