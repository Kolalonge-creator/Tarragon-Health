-- ===== profiles =====
alter table profiles enable row level security;
create policy profiles_own on profiles for select using (id = auth.uid());
create policy profiles_staff_sees_visible_patients on profiles for select using (
  exists (select 1 from patients p where p.profile_id = profiles.id and private.can_see_patient(p.id))
);
create policy profiles_superadmin on profiles for select using (private.is_superadmin());
create policy profiles_insert_self on profiles for insert with check (id = auth.uid());
create policy profiles_update_self on profiles for update using (id = auth.uid() or private.is_superadmin());

-- ===== patients =====
alter table patients enable row level security;
create policy patients_select on patients for select using (
  private.is_own_or_dependant(id) or private.can_see_patient(id)
);
create policy patients_insert on patients for insert with check (
  profile_id = auth.uid() or private.actor_role() in ('clinician','coordinator','ops_admin','superadmin')
);
create policy patients_update on patients for update using (
  private.is_own_or_dependant(id) or private.can_see_patient(id)
);

-- ===== clinicians =====
alter table clinicians enable row level security;
create policy clinicians_select on clinicians for select using (
  profile_id = auth.uid() or private.actor_role() in ('clinician','coordinator','ops_admin','superadmin')
);
create policy clinicians_insert on clinicians for insert with check (
  private.actor_role() in ('ops_admin','superadmin')
);
create policy clinicians_update on clinicians for update using (
  profile_id = auth.uid() or private.actor_role() in ('ops_admin','superadmin')
);

-- ===== organisations =====
-- NOTE: the spec has no table linking institution_admin profiles to a specific organisation
-- (no organisation_admins/profiles.organisation_id). Left as a flagged gap for M8 (institution
-- portal) -- institution_admin gets no policy here yet, which is a safe default (zero rows),
-- not a broken one.
alter table organisations enable row level security;
create policy organisations_select on organisations for select using (
  private.actor_role() in ('clinician','coordinator','ops_admin','superadmin')
);
create policy organisations_write on organisations for all using (
  private.actor_role() in ('ops_admin','superadmin')
) with check (
  private.actor_role() in ('ops_admin','superadmin')
);

-- ===== programmes =====
alter table programmes enable row level security;
create policy programmes_select on programmes for select using (auth.uid() is not null);
create policy programmes_write on programmes for all using (
  private.actor_role() in ('ops_admin','superadmin')
) with check (
  private.actor_role() in ('ops_admin','superadmin')
);

-- ===== enrolments =====
alter table enrolments enable row level security;
create policy enrolments_select on enrolments for select using (
  private.is_own_or_dependant(patient_id) or private.can_see_patient(patient_id)
  or private.actor_role() in ('ops_admin','superadmin')
);
create policy enrolments_insert on enrolments for insert with check (
  private.is_own_or_dependant(patient_id)
  or private.actor_role() in ('clinician','coordinator','ops_admin','superadmin')
);
create policy enrolments_update on enrolments for update using (
  private.actor_role() in ('clinician','coordinator','ops_admin','superadmin')
);

-- ===== devices =====
alter table devices enable row level security;
create policy devices_select on devices for select using (
  private.is_own_or_dependant(patient_id) or private.can_see_patient(patient_id)
  or private.actor_role() = 'ops_admin'
);
create policy devices_insert on devices for insert with check (
  private.is_own_or_dependant(patient_id) or private.can_see_patient(patient_id)
);
create policy devices_update on devices for update using (
  private.can_see_patient(patient_id)
);

