-- Load-test stack bootstrap (SR4).
-- Run ONCE against a fresh `public.ecr.aws/supabase/postgres` container BEFORE replaying supabase/migrations.
-- That image ships the roles, pg_cron, pg_net, vault and a bare `auth` schema, but not the pieces that GoTrue and
-- storage-api create at runtime. The migrations need a few of them, so this file adds minimal stand-ins.
-- It is for a throwaway local database only. Never run it anywhere else.

alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists phone text;
alter table auth.users add column if not exists phone_confirmed_at timestamptz;
alter table auth.users add column if not exists banned_until timestamptz;
alter table auth.users add column if not exists deleted_at timestamptz;
alter table auth.users add column if not exists is_anonymous boolean not null default false;
alter table auth.users add column if not exists is_sso_user boolean not null default false;

create table if not exists auth.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  not_after timestamptz
);

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create table if not exists storage.buckets (
  id text primary key,
  name text not null unique,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[] language plpgsql as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;

grant usage on schema storage to postgres, anon, authenticated, service_role;
grant all on all tables in schema storage to postgres, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;

-- The bare image's auth.uid()/auth.role() read only the old per-claim settings. GoTrue's versions also read the request.jwt.claims JSON
-- that PostgREST (and every proof in packages/db/tests) sets, so use those.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$$;
