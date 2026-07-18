-- Tarragon Health — Unified patient timeline (derived read-model)
--
-- One chronological stream the dashboard can read, WITHOUT introducing a new
-- source of truth: this is a security_invoker view that UNIONs the existing
-- RLS'd patient tables. Because it runs with the caller's own privileges, a
-- patient sees only their own rows and org staff see only their org's rows —
-- the underlying tables' RLS is what enforces access, so the view adds no new
-- exposure. Every metric already has an authoritative home; the timeline just
-- reads them together.
create or replace view public.patient_timeline
with (security_invoker = true) as
  -- Hospital admissions (the new self-reported source)
  select
    a.id                                   as event_id,
    a.patient_id,
    a.organisation_id,
    (a.admitted_on::timestamptz)           as event_at,
    'hospital_admission'                   as event_type,
    'Hospital admission'                   as title,
    trim(both ' ' from
      coalesce(a.self_reported_diagnosis, '') ||
      case when a.discharged_on is not null
           then ' · discharged ' || a.discharged_on::text
           else ' · still admitted' end)  as detail,
    case when a.discharged_on is null then 'admitted' else 'discharged' end as status,
    'patient_hospital_admissions'          as source_table
  from public.patient_hospital_admissions a

  union all
  -- Vitals
  select
    v.id, v.patient_id, v.organisation_id,
    v.taken_at,
    'vital',
    'Reading logged',
    coalesce(nullif(v.vital_type::text, ''), 'vital') ||
      coalesce(' · ' || nullif(v.note, ''), ''),
    v.source::text,
    'vitals_readings'
  from public.vitals_readings v

  union all
  -- Symptoms
  select
    s.id, s.patient_id, s.organisation_id,
    s.reported_at,
    'symptom',
    'Symptom reported',
    s.symptom_type::text ||
      case when s.severity is not null then ' · severity ' || s.severity::text || '/10' else '' end ||
      coalesce(' · ' || nullif(s.description, ''), ''),
    case when s.is_red_flag then 'red_flag' else 'logged' end,
    'symptoms'
  from public.symptoms s

  union all
  -- Lab orders
  select
    l.id, l.patient_id, l.organisation_id,
    l.ordered_at,
    'lab',
    'Lab order',
    coalesce('Order ' || nullif(l.order_number, ''), 'Lab order'),
    l.status::text,
    'lab_orders'
  from public.lab_orders l

  union all
  -- Emergency events
  select
    e.id, e.patient_id, e.organisation_id,
    e.created_at,
    'emergency',
    'Emergency reported',
    coalesce(e.trigger_detail, 'Emergency event (' || e.source::text || ')'),
    e.status::text,
    'emergency_events'
  from public.emergency_events e

  union all
  -- Care plans (clinician-authored)
  select
    c.id, c.patient_id, c.organisation_id,
    c.created_at,
    'care_plan',
    'Care plan',
    c.condition::text,
    c.status::text,
    'care_plans'
  from public.care_plans c

  union all
  -- Medications started
  select
    m.id, m.patient_id, m.organisation_id,
    m.created_at,
    'medication',
    'Medication',
    m.drug_name || coalesce(' · ' || nullif(m.dose, ''), ''),
    case when m.is_active then 'active' else 'inactive' end,
    'medications'
  from public.medications m;

grant select on public.patient_timeline to authenticated;

comment on view public.patient_timeline is
  'security_invoker union of existing patient-scoped tables into one chronological stream. Derived read-model — no new source of truth; underlying RLS enforces access.';
