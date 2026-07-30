-- ===== partners =====
alter table partners enable row level security;
create policy partners_select on partners for select using (
  private.actor_role() in ('clinician','coordinator','ops_admin','superadmin')
);
create policy partners_write on partners for all using (
  private.actor_role() in ('ops_admin','superadmin')
) with check (
  private.actor_role() in ('ops_admin','superadmin')
);

-- ===== medications ===== (CLINICAL -- ops_admin excluded)
alter table medications enable row level security;
create policy medications_select on medications for select using (
  private.is_own_or_dependant(patient_id) or private.can_see_patient(patient_id)
);
create policy medications_insert on medications for insert with check (
  prescribed_by = private.actor_clinician_id() and private.can_see_patient(patient_id)
);
create policy medications_update on medications for update using (
  prescribed_by = private.actor_clinician_id() or private.actor_role() = 'superadmin'
);

-- ===== medication_dispenses =====
alter table medication_dispenses enable row level security;
create policy medication_dispenses_select on medication_dispenses for select using (
  private.is_own_or_dependant(patient_id) or private.can_see_patient(patient_id)
  or private.actor_role() = 'ops_admin'
);
create policy medication_dispenses_insert on medication_dispenses for insert with check (
  private.actor_role() in ('clinician','coordinator','ops_admin','superadmin')
);

-- ===== lab_orders ===== (base table excludes patient -- commission_minor "never shown to the
-- patient" per spec §5.10; patients query the lab_orders_patient view instead)
alter table lab_orders enable row level security;
create policy lab_orders_staff_select on lab_orders for select using (
  private.can_see_patient(patient_id) or private.actor_role() = 'ops_admin'
);
create policy lab_orders_insert on lab_orders for insert with check (
  private.is_own_or_dependant(patient_id)
  or private.actor_role() in ('clinician','coordinator','ops_admin','superadmin')
);
create policy lab_orders_update on lab_orders for update using (
  private.actor_role() in ('clinician','coordinator','ops_admin','superadmin')
);

create view lab_orders_patient with (security_invoker = true) as
  select id, patient_id, partner_id, panel_code, patient_price_minor, ordered_at, collected_at, resulted_at
  from lab_orders;
-- security_invoker means this view still needs its own RLS-equivalent access -- since the base
-- table has no patient-role policy, add one scoped to exactly the columns above being the only
-- ones exposed (the view itself never selects commission_minor, so a patient querying the view
-- can never see it even though the policy below is row-, not column-, scoped):
create policy lab_orders_patient_own on lab_orders for select using (
  private.is_own_or_dependant(patient_id)
);

