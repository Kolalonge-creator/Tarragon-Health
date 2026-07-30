-- ===== notification_templates =====
alter table notification_templates enable row level security;
create policy notification_templates_select on notification_templates for select using (
  private.actor_role() in ('clinician','coordinator','ops_admin','superadmin')
);
create policy notification_templates_write on notification_templates for all using (
  private.actor_role() in ('ops_admin','superadmin')
) with check (
  private.actor_role() in ('ops_admin','superadmin')
);

-- ===== notification_sends =====
alter table notification_sends enable row level security;
create policy notification_sends_select on notification_sends for select using (
  private.is_own_or_dependant(patient_id)
  or private.can_see_patient(patient_id)
  or private.actor_role() in ('ops_admin','superadmin')
);
create policy notification_sends_insert on notification_sends for insert with check (
  private.actor_role() in ('clinician','coordinator','ops_admin','superadmin')
);

-- ===== notification_events ===== (joins to notification_sends for patient linkage)
alter table notification_events enable row level security;
create policy notification_events_select on notification_events for select using (
  exists (
    select 1 from notification_sends s
    where s.id = notification_events.send_id
      and (
        private.is_own_or_dependant(s.patient_id)
        or private.can_see_patient(s.patient_id)
        or private.actor_role() in ('ops_admin','superadmin')
      )
  )
);
create policy notification_events_insert on notification_events for insert with check (
  private.actor_role() in ('clinician','coordinator','ops_admin','superadmin')
);

-- ===== device_heartbeats =====
alter table device_heartbeats enable row level security;
create policy device_heartbeats_select on device_heartbeats for select using (
  private.is_own_or_dependant(patient_id) or private.can_see_patient(patient_id)
  or private.actor_role() = 'ops_admin'
);
create policy device_heartbeats_upsert on device_heartbeats for insert with check (
  private.is_own_or_dependant(patient_id)
);
create policy device_heartbeats_update on device_heartbeats for update using (
  private.is_own_or_dependant(patient_id)
);

