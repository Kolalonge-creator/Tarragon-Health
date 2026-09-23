-- Tarragon Health — grant support.view_as to the Customer support administrator preset
--
-- 20260922175144_support_view_as.sql seeded a new `support.view_as` permission key and built
-- the whole "support view-as" tool around it being a delegable capability, not an admin-only
-- one — but never actually granted it to any of the seven role presets seeded by
-- 20260829093427_ops_admin_role_presets.sql. Found in this PR's own /code-review high pass: the
-- "Customer support administrator" preset's own description is literally "Patient support: the
-- inbound inbox, administrative contact details, lead follow-up, and raising an incident when a
-- patient problem turns out to be a platform problem" — exactly this feature's use case — yet it
-- carried no support.view_as grant, so the tool was unusable by any real delegated support
-- operator, only the full `admin` superaccount could ever reach it. apps/web/src/lib/
-- navigation.ts's care_coordinator nav section already anticipated this exact preset (see its
-- "e.g. the Customer support administrator... role presets" comment) but the link was pulled
-- because nothing granted the permission; this migration is what makes that link real again.
--
-- Deliberately NOT granted to the other six presets (Clinical/Provider network/Finance/
-- Content/Technical/Data & analytics administrator) — none of them are a support role, and this
-- capability reads real patient/clinician account data (vitals, medications, appointments,
-- screenings, notifications, clinical_staff), so widening it to presets with no support mandate
-- would be exactly the kind of scope-creep this migration's own header on
-- 20260922175144_support_view_as.sql warns against.
do $$
declare
  v_role_id uuid;
begin
  select id into v_role_id from public.custom_roles where name = 'Customer support administrator';
  if v_role_id is null then
    raise exception 'Customer support administrator preset not found — 20260829093427_ops_admin_role_presets.sql may not be applied';
  end if;

  if not exists (select 1 from public.permissions where key = 'support.view_as') then
    raise exception 'support.view_as permission not found — 20260922175144_support_view_as.sql may not be applied';
  end if;

  insert into public.role_permissions (custom_role_id, permission_key)
  values (v_role_id, 'support.view_as')
  on conflict (custom_role_id, permission_key) do nothing;

  if not exists (
    select 1 from public.role_permissions
    where custom_role_id = v_role_id and permission_key = 'support.view_as'
  ) then
    raise exception 'FAIL: Customer support administrator preset does not carry support.view_as after grant';
  end if;
end $$;
