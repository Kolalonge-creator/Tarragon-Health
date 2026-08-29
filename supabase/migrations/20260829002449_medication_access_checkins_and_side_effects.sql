-- Tarragon Health — Module 21: Medication Access & Adherence Engine, part 2/7.
--
-- §21.3 "Were you able to obtain your medication?" affordability check-in and
-- §21.11 the side-effect pathway. Both are immutable patient-reported event
-- tables (same shape as the Sprint-1 `symptoms` table), each with a trigger
-- that routes a real problem straight into the unified Alert System
-- (clinician_alerts, 20260828013011 onward) via the existing
-- private.raise_clinician_alert() helper — no new alert taxonomy needed:
--   * a cost/stock/collection barrier -> category='medication',
--     type_code='pharmacy_problem' (already governed, owner_tier=
--     care_coordinator) or 'refill_due' for a prescription-issue barrier
--     (that type_code's own alert_rules evidence_basis already says
--     "reserved... no staff-facing generator yet" — this and part 4's refill
--     ladder are exactly that generator)
--   * a side-effect report -> category='clinical', type_code='medication_safety'
--     (already governed, default_severity 3), level scaled by patient-selected
--     severity (§21.11: "potentially serious?" -> urgent vs routine review)
-- "forgot" is deliberately NOT alerted here — §21.14 maps forgetting to a
-- reminder, not a clinical escalation; it still feeds the adherence engine
-- (part 3) as a floor signal.
--
-- access_status is updated directly on public.medications by the check-in
-- trigger (SECURITY DEFINER, so it can write a column the plain medications_
-- update RLS policy would otherwise block a Care Coordinator from touching —
-- same "trigger narrows/widens what a grant alone would allow" shape as
-- private.enforce_medication_confirm_only elsewhere in this schema).

create type public.medication_obtained_status as enum ('yes', 'partially', 'no');

create type public.medication_access_barrier as enum (
  'too_expensive', 'pharmacy_unavailable', 'out_of_stock', 'prescription_issue', 'forgot', 'other'
);

create type public.medication_side_effect_severity as enum ('mild', 'moderate', 'severe');

-- ---------------------------------------------------------------------------
-- medication_access_checkins (§21.3)
-- ---------------------------------------------------------------------------

create table public.medication_access_checkins (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  medication_id     uuid not null references public.medications (id) on delete cascade,
  obtained          public.medication_obtained_status not null,
  barrier           public.medication_access_barrier,
  notes             text,
  created_at        timestamptz not null default now(),
  constraint medication_access_checkins_barrier_required_unless_obtained
    check (obtained = 'yes' or barrier is not null),
  constraint medication_access_checkins_notes_length check (char_length(notes) <= 1000)
);

comment on table public.medication_access_checkins is
  'Module 21 §21.3 affordability/obtain-medication check-in — "Were you able to obtain your medication?" Patient-reported, or staff-logged when a Care Coordinator learns the answer during outreach. Immutable event record; see private.handle_medication_access_checkin() for what each answer drives.';

create index medication_access_checkins_patient_idx on public.medication_access_checkins (patient_id, created_at desc);
create index medication_access_checkins_medication_idx on public.medication_access_checkins (medication_id, created_at desc);
create index medication_access_checkins_org_idx on public.medication_access_checkins (organisation_id);

alter table public.medication_access_checkins enable row level security;

-- Same posture as medication_logs/symptoms: patient manages their own rows;
-- org staff may also insert (a Care Coordinator logging what a patient told
-- them by phone) and read/correct any row in their org.
create policy medication_access_checkins_select on public.medication_access_checkins
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy medication_access_checkins_insert on public.medication_access_checkins
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy medication_access_checkins_update on public.medication_access_checkins
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy medication_access_checkins_delete on public.medication_access_checkins
  for delete to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.medication_access_checkins to authenticated;
revoke all on public.medication_access_checkins from anon;

create trigger audit_row_change_trg
  after insert or update or delete on public.medication_access_checkins
  for each row execute function private.audit_row_change();
create trigger capture_record_correction_trg
  after update or delete on public.medication_access_checkins
  for each row execute function private.capture_record_correction();

-- --- handler: derive access_status + route a real barrier to the care team ---
create or replace function private.handle_medication_access_checkin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_drug text;
  v_new_access_status public.medication_access_status;
  v_level public.alert_level;
  v_type_code public.alert_type_code;
  v_title text;
  v_detail text;
begin
  select drug_name into v_drug from public.medications where id = new.medication_id;

  if new.obtained = 'yes' then
    update public.medications set access_status = 'available' where id = new.medication_id;
    return new;
  end if;

  v_new_access_status := case new.barrier
    when 'too_expensive' then 'too_expensive'
    when 'out_of_stock' then 'out_of_stock'
    when 'pharmacy_unavailable' then 'unable_to_collect'
    when 'prescription_issue' then 'unable_to_collect'
    else null
  end;

  if v_new_access_status is not null then
    update public.medications set access_status = v_new_access_status where id = new.medication_id;
  end if;

  -- §21.14: forgetting is a reminder problem, not a clinical escalation —
  -- no clinician_alerts row. The adherence engine (part 3) still treats
  -- repeated "forgot" reports as an adherence signal.
  if new.barrier = 'forgot' then
    return new;
  end if;

  v_level := case new.obtained when 'no' then 'clinician_review' else 'routine' end;
  v_type_code := case when new.barrier = 'prescription_issue' then 'refill_due' else 'pharmacy_problem' end;
  v_title := format('Medication access problem: %s', coalesce(v_drug, 'a medication'));
  v_detail := format(
    'Patient reported they %s able to obtain %s.%s%s',
    case new.obtained when 'no' then 'were not' else 'were only partially' end,
    coalesce(v_drug, 'their medication'),
    case when new.barrier is not null then ' Reason: ' || replace(new.barrier::text, '_', ' ') || '.' else '' end,
    case when new.notes is not null then ' Notes: ' || new.notes else '' end
  );

  perform private.raise_clinician_alert(
    new.organisation_id, new.patient_id, v_level, v_title, v_detail, 'medication', v_type_code
  );

  return new;
end;
$$;

comment on function private.handle_medication_access_checkin() is
  'AFTER INSERT on medication_access_checkins. Updates medications.access_status from the reported barrier and, for anything but "forgot", raises a clinician_alerts row (§21.4 affordability intervention / §21.5 pharmacy stock failure) via the shared private.raise_clinician_alert() helper — routed automatically to the governed owner_tier (care_coordinator for pharmacy_problem/refill_due) by the existing classify-and-assign trigger. Extended in a later migration to also recompute adherence_status.';

create trigger medication_access_checkins_handle
  after insert on public.medication_access_checkins
  for each row execute function private.handle_medication_access_checkin();

-- ---------------------------------------------------------------------------
-- medication_side_effect_reports (§21.11)
-- ---------------------------------------------------------------------------

create table public.medication_side_effect_reports (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  medication_id     uuid not null references public.medications (id) on delete cascade,
  checkin_id        uuid references public.medication_adherence_checkins (id) on delete set null,
  description       text not null,
  severity          public.medication_side_effect_severity not null,
  reported_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  constraint medication_side_effect_reports_description_length check (char_length(description) between 1 and 1000)
);

comment on table public.medication_side_effect_reports is
  'Module 21 §21.11 side-effect pathway entry point. checkin_id links back to the medication_adherence_checkins row (checkin_type=side_effects) when reported that way, but a patient may also report a side effect at any time, so it is nullable. Immutable patient report; the clinical response (treatment decision, medication updated, monitoring updated) happens on the clinician_alerts row this raises, not by editing this record.';

create index medication_side_effect_reports_patient_idx on public.medication_side_effect_reports (patient_id, reported_at desc);
create index medication_side_effect_reports_medication_idx on public.medication_side_effect_reports (medication_id, reported_at desc);
create index medication_side_effect_reports_org_idx on public.medication_side_effect_reports (organisation_id);

alter table public.medication_side_effect_reports enable row level security;

create policy medication_side_effect_reports_select on public.medication_side_effect_reports
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy medication_side_effect_reports_insert on public.medication_side_effect_reports
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy medication_side_effect_reports_update on public.medication_side_effect_reports
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy medication_side_effect_reports_delete on public.medication_side_effect_reports
  for delete to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.medication_side_effect_reports to authenticated;
revoke all on public.medication_side_effect_reports from anon;

create trigger audit_row_change_trg
  after insert or update or delete on public.medication_side_effect_reports
  for each row execute function private.audit_row_change();
create trigger capture_record_correction_trg
  after update or delete on public.medication_side_effect_reports
  for each row execute function private.capture_record_correction();

create or replace function private.raise_medication_side_effect_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_drug text;
  v_level public.alert_level;
begin
  select drug_name into v_drug from public.medications where id = new.medication_id;

  -- §21.11: "potentially serious?" yes -> urgent pathway, no -> clinician
  -- review. Never silently swallowed regardless of severity — mild still
  -- reaches the routine review queue, it just does not page anyone.
  v_level := case new.severity
    when 'severe' then 'urgent_escalation'
    when 'moderate' then 'clinician_review'
    else 'routine'
  end;

  perform private.raise_clinician_alert(
    new.organisation_id, new.patient_id, v_level,
    format('Side effect reported: %s', coalesce(v_drug, 'a medication')),
    format('Patient reported a %s side effect on %s: %s', new.severity, coalesce(v_drug, 'their medication'), new.description),
    'clinical', 'medication_safety'
  );

  return new;
end;
$$;

comment on function private.raise_medication_side_effect_alert() is
  'AFTER INSERT on medication_side_effect_reports. Always raises a clinician_alerts row (category=clinical, type_code=medication_safety) so a side effect is never silently swallowed — level scales with patient-selected severity (§21.11).';

create trigger medication_side_effect_reports_raise_alert
  after insert on public.medication_side_effect_reports
  for each row execute function private.raise_medication_side_effect_alert();

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'medication_access_checkins') then
    raise exception 'medication_access_checkins table was not created';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'medication_side_effect_reports') then
    raise exception 'medication_side_effect_reports table was not created';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'medication_access_checkins_handle' and tgrelid = 'public.medication_access_checkins'::regclass and not tgisinternal
  ) then
    raise exception 'medication_access_checkins_handle trigger was not created';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'medication_side_effect_reports_raise_alert' and tgrelid = 'public.medication_side_effect_reports'::regclass and not tgisinternal
  ) then
    raise exception 'medication_side_effect_reports_raise_alert trigger was not created';
  end if;
  raise notice 'PASS: medication_access_checkins + medication_side_effect_reports installed with alert routing';
end $$;
