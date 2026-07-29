-- Not explicitly DDL'd in the spec, but §5.2's "-- extends auth.users" comment implies this is
-- required for auth to function at all: every auth.users row needs a matching profiles row.
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into profiles (id, full_name, email, phone_e164, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', 'Unnamed'),
    new.email,
    new.raw_user_meta_data->>'phone_e164',
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'patient')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

