-- M4: device validation (build spec v3 §5.4). Ported/adapted from the parallel tarragon-control
-- build of this same spec.
--
-- The validated-device list is a real, open decision per spec §21.4 ("Validated-device list
-- source"). Seeded empty here -- every device with no rows in this table is correctly
-- unvalidated_advisory by the rule below, the safe default until ops populates the real list.
create table validated_devices (
  make text not null,
  model text not null,
  device_kind reading_type not null,
  added_by uuid references profiles(id),
  added_at timestamptz not null default now(),
  primary key (make, model, device_kind)
);

alter table validated_devices enable row level security;

create policy validated_devices_select on validated_devices for select using (
  private.actor_role() is not null
);
create policy validated_devices_write on validated_devices for all using (
  private.actor_role() in ('ops_admin','superadmin')
) with check (
  private.actor_role() in ('ops_admin','superadmin')
);

grant select on validated_devices to authenticated;
grant insert, update, delete on validated_devices to authenticated;

-- Auto-computes devices.validation. Same three rules, same order, as the spec's §5.4 validation
-- rules list. On UPDATE it only re-runs if a determining column actually changed -- otherwise a
-- clinician's own note-taking update (e.g. just setting validated_by/validated_at after manually
-- inspecting an advisory device) doesn't get silently clobbered back to a recomputed value.
create or replace function private.compute_device_validation() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    if new.is_wrist is not distinct from old.is_wrist
       and new.make is not distinct from old.make
       and new.model is not distinct from old.model
       and new.device_kind is not distinct from old.device_kind
       and new.approx_age_years is not distinct from old.approx_age_years
    then
      return new;
    end if;
  end if;

  if new.is_wrist then
    new.validation := 'wrist_advisory';
  elsif not exists (
    select 1 from validated_devices vd
    where vd.make = new.make and vd.model = new.model and vd.device_kind = new.device_kind
  ) then
    new.validation := 'unvalidated_advisory';
  elsif new.approx_age_years is not null and new.approx_age_years > 4 then
    new.validation := 'unvalidated_advisory';
  else
    new.validation := 'validated';
  end if;

  return new;
end;
$$;

create trigger compute_device_validation_trigger
  before insert or update on devices
  for each row execute function private.compute_device_validation();
