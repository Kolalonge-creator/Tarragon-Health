-- Tarragon Health — V1 consumer spec reconciliation (Phase 0)
-- 02 · Seed the default consumer organisation + update handle_new_user()
--
-- Fixed, well-known id (not gen_random_uuid()) so handle_new_user() can
-- reference it as a literal constant, with no lookup query on the signup
-- hot path.

insert into public.organisations (id, name, type, is_active)
values (
  '00000000-0000-0000-0000-000000000001',
  'Tarragon Health Direct',
  'direct_consumer',
  true
)
on conflict (id) do nothing;

-- Self-serve WhatsApp/app signups carry no organisation_id in app_metadata,
-- so they now fall back to the direct-consumer org instead of null. Staff/
-- HMO/corporate invites are unaffected — they already set organisation_id
-- explicitly in app_metadata at invite time.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role, organisation_id, full_name, phone)
  values (
    new.id,
    coalesce((new.raw_app_meta_data ->> 'role')::public.user_role, 'patient'),
    coalesce(
      (new.raw_app_meta_data ->> 'organisation_id')::uuid,
      '00000000-0000-0000-0000-000000000001'
    ),
    new.raw_user_meta_data ->> 'full_name',
    new.phone
  );
  return new;
end;
$$;
