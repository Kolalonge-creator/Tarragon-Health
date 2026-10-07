-- S57 step 2 of 4: the private journal (function 10.8), the server half.
--
-- The journal is DEVICE-FIRST: entries are written and encrypted on the phone or browser with a key that never leaves it. This server
-- half exists only for a person who explicitly turns sync on, and what it stores is CIPHERTEXT the server cannot read (the key is not
-- here). Nobody else can read it either: no staff reader, no Care Circle category, no sponsor, and break-glass does not reach it (there is
-- no function that returns it to anyone but its owner). Turning sync off deletes every server copy.
-- ROWS AFFECTED: none existing (new tables).
create table if not exists public.journal_sync_settings (
  patient_id      uuid primary key references public.profiles (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  enabled         boolean not null default false,
  enabled_at      timestamptz,
  updated_at      timestamptz not null default now()
);
create index if not exists journal_sync_settings_org_idx on public.journal_sync_settings (organisation_id);

create table if not exists public.journal_synced_entries (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  client_entry_id  uuid not null,
  alg              text not null check (alg in ('xchacha20poly1305-v1')),
  iv               text not null check (char_length(iv) between 16 and 64),
  ciphertext       text not null check (char_length(ciphertext) between 16 and 40000),
  client_updated_at timestamptz not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  is_test          boolean not null default false,
  unique (patient_id, client_entry_id)
);
create index if not exists journal_synced_entries_org_idx on public.journal_synced_entries (organisation_id);

alter table public.journal_sync_settings enable row level security;
alter table public.journal_synced_entries enable row level security;
-- Owner only. No supporter, no staff, no admin policy. Writes go through the functions below (no insert/update/delete grant).
drop policy if exists journal_sync_settings_select on public.journal_sync_settings;
create policy journal_sync_settings_select on public.journal_sync_settings for select to authenticated using (patient_id = (select auth.uid()));
drop policy if exists journal_synced_entries_select on public.journal_synced_entries;
create policy journal_synced_entries_select on public.journal_synced_entries for select to authenticated using (patient_id = (select auth.uid()));
revoke all on public.journal_sync_settings, public.journal_synced_entries from anon;
revoke insert, update, delete, truncate on public.journal_sync_settings, public.journal_synced_entries from authenticated;
grant select on public.journal_sync_settings, public.journal_synced_entries to authenticated;

create or replace function public.set_journal_sync(p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_pr public.profiles%rowtype; v_deleted integer := 0;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into v_pr from public.profiles where id = v_uid and role = 'patient';
  if not found then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_enabled is null then raise exception 'choose on or off' using errcode = '22023'; end if;
  insert into public.journal_sync_settings (patient_id, organisation_id, enabled, enabled_at)
  values (v_uid, v_pr.organisation_id, p_enabled, case when p_enabled then now() end)
  on conflict (patient_id) do update set enabled = excluded.enabled,
    enabled_at = case when excluded.enabled then coalesce(public.journal_sync_settings.enabled_at, now()) else null end, updated_at = now();
  if not p_enabled then
    delete from public.journal_synced_entries where patient_id = v_uid;
    get diagnostics v_deleted = row_count;
  end if;
  return jsonb_build_object('enabled', p_enabled, 'server_copies_deleted', v_deleted);
end $$;
revoke all on function public.set_journal_sync(boolean) from public, anon;
grant execute on function public.set_journal_sync(boolean) to authenticated;

create or replace function public.upsert_journal_entry(p_client_entry_id uuid, p_alg text, p_iv text, p_ciphertext text, p_client_updated_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_pr public.profiles%rowtype;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into v_pr from public.profiles where id = v_uid and role = 'patient';
  if not found then raise exception 'not authorised' using errcode = '42501'; end if;
  if not coalesce((select enabled from public.journal_sync_settings where patient_id = v_uid), false) then
    raise exception 'sync is off' using errcode = '42501';
  end if;
  insert into public.journal_synced_entries (organisation_id, patient_id, client_entry_id, alg, iv, ciphertext, client_updated_at, is_test)
  values (v_pr.organisation_id, v_uid, p_client_entry_id, p_alg, p_iv, p_ciphertext, p_client_updated_at, coalesce(v_pr.is_test, false))
  on conflict (patient_id, client_entry_id) do update set alg = excluded.alg, iv = excluded.iv, ciphertext = excluded.ciphertext,
    client_updated_at = excluded.client_updated_at, updated_at = now()
    where public.journal_synced_entries.client_updated_at <= excluded.client_updated_at;
end $$;
revoke all on function public.upsert_journal_entry(uuid, text, text, text, timestamptz) from public, anon;
grant execute on function public.upsert_journal_entry(uuid, text, text, text, timestamptz) to authenticated;

create or replace function public.delete_journal_entry(p_client_entry_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not authorised' using errcode = '42501'; end if;
  delete from public.journal_synced_entries where patient_id = (select auth.uid()) and client_entry_id = p_client_entry_id;
end $$;
revoke all on function public.delete_journal_entry(uuid) from public, anon;
grant execute on function public.delete_journal_entry(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.upsert_journal_entry(uuid,text,text,text,timestamptz)', 'EXECUTE') then raise exception 'FAIL: anon can write the journal'; end if;
  if has_table_privilege('authenticated', 'public.journal_synced_entries', 'INSERT') then raise exception 'FAIL: direct journal insert is granted'; end if;
end $$;
