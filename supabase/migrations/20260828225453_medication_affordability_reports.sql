-- Tarragon Health -- medication affordability signal (Pharmacy Engine spec
-- §12.16, docs/PHARMACY_ENGINE_SPEC.md Phase 1 item 2).
--
-- "Patient did not obtain medicine because of cost" has never had anywhere
-- to go in this schema -- not a missed-dose reason (medication_logs), not a
-- collection record (pharmacy_order_dispenses only exists for medicine the
-- patient DID get). This is deliberately its own small table, same shape as
-- medication_receipt_confirmations: additive, routing-independent (works
-- identically whether or not a real pharmacy partner is ever contracted --
-- see docs/PHARMACY_ENGINE_SPEC.md §1), and becomes a real care-management
-- signal the moment a care coordinator or clinician can see it, not just a
-- database row nobody reads.

create table public.medication_affordability_reports (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  medication_id     uuid references public.medications (id) on delete set null,
  reported_by       uuid references public.profiles (id) on delete set null,
  reported_at       timestamptz not null default now(),
  note              text,
  status            text not null default 'open'
    check (status in ('open', 'in_progress', 'resolved')),
  resolution_action text
    check (resolution_action in (
      'lower_cost_alternative', 'alternative_pharmacy', 'assistance_programme',
      'care_coordinator_intervention', 'other'
    )),
  resolution_note   text,
  resolved_by       uuid references public.profiles (id) on delete set null,
  resolved_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint medication_affordability_reports_resolution_documented
    check (
      status <> 'resolved'
      or (resolved_at is not null and resolved_by is not null and resolution_action is not null)
    )
);

comment on table public.medication_affordability_reports is
  'Pharmacy Engine spec §12.16: "patient did not obtain medicine because of cost" as a structured care-management signal. Independent of pharmacy_orders/pharmacy_order_dispenses -- fires the same way whether the patient could not afford it at a Tarragon-routed pharmacy (dormant) or one of their own choosing (the live self-arranged path).';

create index medication_affordability_reports_patient_idx
  on public.medication_affordability_reports (patient_id, reported_at desc);
create index medication_affordability_reports_org_open_idx
  on public.medication_affordability_reports (organisation_id, status)
  where status <> 'resolved';

create trigger medication_affordability_reports_set_updated_at
  before update on public.medication_affordability_reports
  for each row execute function private.set_updated_at();

alter table public.medication_affordability_reports enable row level security;

-- Same shape as medication_receipt_confirmations/pharmacy_order_dispenses:
-- patient reads/reports their own; org staff (clinician/care_coordinator/
-- admin -- private.is_org_staff excludes pharmacist/lab_partner/etc, see
-- 20260729234618_harden_is_org_staff_exclude_lab_partner.sql) manage.
create policy medication_affordability_reports_select on public.medication_affordability_reports
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy medication_affordability_reports_insert on public.medication_affordability_reports
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
-- Only staff resolve/progress a report -- the patient's own report is an
-- immutable statement of fact once submitted, same posture as an escalation
-- once raised.
create policy medication_affordability_reports_update on public.medication_affordability_reports
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.medication_affordability_reports to authenticated;
revoke all on public.medication_affordability_reports from anon;

create trigger audit_row_change_trg
  after insert or update or delete on public.medication_affordability_reports
  for each row execute function private.audit_row_change();

create trigger capture_record_correction_trg
  after update or delete on public.medication_affordability_reports
  for each row execute function private.capture_record_correction();

do $$
begin
  if not exists (select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'medication_affordability_reports') then
    raise exception 'FAIL: medication_affordability_reports table was not created';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'medication_affordability_reports'
      and policyname = 'medication_affordability_reports_update'
  ) then
    raise exception 'FAIL: update policy missing';
  end if;
  if has_table_privilege('anon', 'public.medication_affordability_reports', 'SELECT') then
    raise exception 'FAIL: anon can select medication_affordability_reports';
  end if;
  raise notice 'PASS: medication_affordability_reports -- table, RLS, audit wiring installed';
end $$;
