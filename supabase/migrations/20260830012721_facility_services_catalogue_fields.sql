-- Tarragon Health — facility_services: service-catalogue fields (spec 97.3)
--
-- facility_services (20260707045443) already had a full admin CRUD surface (create/edit/
-- deactivate/delete a service per facility, apps/web/src/app/(dashboard)/admin/facilities/
-- facility-manager.tsx) — the 2026-08-29 gap analysis undercounted this, finding the table
-- but not the existing UI. What was genuinely missing against spec 97.3 ("Service — Cardiology
-- consultation, Telemedicine, Duration 30 min, Price ₦X, Eligible providers: Cardiologists,
-- Available locations: Nigeria"): duration and a type/category a service can be filtered or
-- reasoned about by, plus which specialty is eligible to deliver it. "Available locations" is
-- already covered implicitly — a service belongs to a specific facility, and facilities.state
-- is the location.
--
-- Deliberately NOT a new table. The 2026-08-29 fleet build separately shipped public.
-- provider_org_services with a near-identical shape (name/duration_minutes/price_kobo) — but
-- that table belongs to the entirely different, currently-dormant provider_org_platform module
-- (platform_modules.provider_org_platform, is_enabled=false, "dormant until the first
-- organisation is onboarded" — a third-party hospital/clinic running its OWN Tarragon-facing
-- operation as its own tenant). Reusing it here would misuse a dormant B2B multi-tenant table
-- for Tarragon's own core service catalogue, and would need standing up a whole organisation
-- row just to hold Tarragon's own listings. facility_services, live and already used, is the
-- correct base to extend.
--
-- appointment_type reuses the platform's existing, live categorisation (the same enum the
-- appointment engine itself books against) rather than inventing a second "service type"
-- concept — nullable, since not every facility_services row is bookable through the
-- appointment engine today (e.g. a lab test line item).

alter table public.facility_services
  add column duration_minutes smallint,
  add column appointment_type public.appointment_type,
  add column eligible_specialty text;

comment on column public.facility_services.duration_minutes is
  'How long this service takes, in minutes. Null when not meaningful (e.g. a lab test line item with its own turnaround time).';
comment on column public.facility_services.appointment_type is
  'Ties this service into the same categorisation the appointment engine books against (public.appointment_type) — not a separate, parallel type concept.';
comment on column public.facility_services.eligible_specialty is
  'Free-text specialty/provider-type this service needs (e.g. "Cardiology"). Not an enum: specialties are added faster than a migration cycle elsewhere in this codebase (specialist_type), and this is documentation for admins/patients, not an RLS or booking-eligibility gate.';

alter table public.facility_services
  add constraint facility_services_duration_minutes_range
    check (duration_minutes is null or duration_minutes between 1 and 480);
