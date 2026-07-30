-- ===== screening_events =====
alter table screening_events enable row level security;
create policy screening_events_staff on screening_events for all using (
  private.actor_role() in ('clinician','coordinator','ops_admin','superadmin')
) with check (
  private.actor_role() in ('clinician','coordinator','ops_admin','superadmin')
);

-- ===== screening_participants =====
alter table screening_participants enable row level security;
create policy screening_participants_staff on screening_participants for all using (
  private.actor_role() in ('clinician','coordinator','ops_admin','superadmin')
) with check (
  private.actor_role() in ('clinician','coordinator','ops_admin','superadmin')
);
create policy screening_participants_own on screening_participants for select using (
  patient_id is not null and private.is_own_or_dependant(patient_id)
);

-- ===== readings ===== (CLINICAL -- ops_admin explicitly excluded per spec §6.1)
alter table readings enable row level security;
create policy readings_select on readings for select using (
  private.is_own_or_dependant(patient_id) or private.can_see_patient(patient_id)
);
create policy readings_insert on readings for insert with check (
  private.is_own_or_dependant(patient_id) or private.can_see_patient(patient_id)
);

-- ===== protocol_configs ===== (config data, not patient-keyed)
alter table protocol_configs enable row level security;
create policy protocol_configs_select on protocol_configs for select using (
  private.actor_role() in ('clinician','coordinator','ops_admin','superadmin')
);
create policy protocol_configs_write on protocol_configs for all using (
  private.actor_role() in ('clinician','superadmin')
) with check (
  private.actor_role() in ('clinician','superadmin')
);

-- ===== triage_classifications ===== (CLINICAL -- ops_admin excluded)
alter table triage_classifications enable row level security;
create policy triage_classifications_select on triage_classifications for select using (
  private.is_own_or_dependant(patient_id) or private.can_see_patient(patient_id)
);
create policy triage_classifications_insert on triage_classifications for insert with check (
  private.can_see_patient(patient_id) or private.actor_role() = 'superadmin'
);
create policy triage_classifications_update on triage_classifications for update using (
  private.actor_role() in ('clinician','superadmin')
);

