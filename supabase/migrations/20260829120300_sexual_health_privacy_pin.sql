-- Sexual & Reproductive Health platform — gap closure 2/3: an optional
-- section-level privacy PIN (spec §47.2 — "Patients should be able to
-- access sensitive services without unnecessary visibility to family
-- members or other users on a shared device").
--
-- THREAT MODEL — read before touching this file
-- ---------------------------------------------------------------------------
-- This is a PRIVACY SCREEN, not a security boundary. Every table this whole
-- module touches is already fully protected by RLS regardless of whether
-- this PIN exists, is set, or is ever guessed — a patient's actual
-- authentication (their real account login) is the security boundary, same
-- as everywhere else on the platform. What this closes is a narrower,
-- real problem: a patient who is already logged in on a shared phone, who
-- wants one more beat of friction before this specific section opens, so a
-- partner or family member glancing at the screen (or picking the phone up
-- while it's unlocked) doesn't land directly on it. A 4-6 digit PIN behind a
-- generous-but-real lockout (5 attempts / 15 minutes, ~480 guesses/day
-- against a 10,000-combination 4-digit space) is the right shape for that —
-- deliberately NOT the same rigour as an account password, because it isn't
-- protecting the same thing.
--
-- Confidentiality-then-accessibility (spec §47.13's own ordering) means this
-- must never become a lockout trap: nothing here can ever block the
-- patient's own account access, and forgetting the PIN never requires
-- support intervention — clear_sexual_health_pin()/set_sexual_health_pin()
-- both just need the patient's normal, already-authenticated session.
--
-- No org-staff read access, unlike every other table in this module — there
-- is no clinical reason for a clinician to know whether or how a patient has
-- PIN-gated their own app section; this is UX, not care.

do $$ begin
  if not exists (select 1 from pg_extension where extname = 'pgcrypto') then
    create extension pgcrypto with schema extensions;
  end if;
end $$;

create table if not exists public.sexual_health_privacy_settings (
  patient_id      uuid primary key references public.profiles (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  pin_hash        text,
  failed_attempts smallint not null default 0,
  locked_until    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.sexual_health_privacy_settings is
  'Optional per-patient privacy-screen PIN for the Sexual & Reproductive Health hub (spec §47.2). See this migration''s header for the threat model — a convenience privacy screen, not a security boundary; the underlying data stays fully RLS-protected regardless of this table''s state. Written only through set_sexual_health_pin/verify_sexual_health_pin/clear_sexual_health_pin — no direct client insert/update/delete.';

drop trigger if exists sexual_health_privacy_settings_set_updated_at on public.sexual_health_privacy_settings;
create trigger sexual_health_privacy_settings_set_updated_at
  before update on public.sexual_health_privacy_settings
  for each row execute function private.set_updated_at();

alter table public.sexual_health_privacy_settings enable row level security;

-- Patient-self only — not even org staff (see header). No insert/update/
-- delete policy at all: every write goes through a SECURITY DEFINER RPC
-- below, so pin_hash can never be set to anything but a real bcrypt hash and
-- failed_attempts/locked_until can never be forged from the client.
drop policy if exists sexual_health_privacy_settings_select on public.sexual_health_privacy_settings;
create policy sexual_health_privacy_settings_select on public.sexual_health_privacy_settings
  for select to authenticated
  using (patient_id = (select auth.uid()));

-- Column-level grant excludes pin_hash — the app never has a legitimate
-- reason to read the hash itself, only whether one is set (a plain null
-- check on a column it CAN read) and the lockout state.
revoke all on public.sexual_health_privacy_settings from authenticated, anon;
grant select (
  patient_id, organisation_id, failed_attempts, locked_until, created_at, updated_at
) on public.sexual_health_privacy_settings to authenticated;

-- ---------------------------------------------------------------------------
-- set_sexual_health_pin — also used to CHANGE an existing PIN (upsert).
-- Clears any lockout: setting a new PIN is a legitimate reset path, not
-- something to punish for a prior string of failed guesses.
-- ---------------------------------------------------------------------------
create or replace function public.set_sexual_health_pin(p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_pin !~ '^[0-9]{4,6}$' then
    raise exception 'PIN must be 4 to 6 digits' using errcode = '22023';
  end if;

  select organisation_id into v_org from public.profiles where id = v_uid;
  if v_org is null then
    raise exception 'no organisation on file' using errcode = '42501';
  end if;

  insert into public.sexual_health_privacy_settings
    (patient_id, organisation_id, pin_hash, failed_attempts, locked_until)
  values (
    v_uid, v_org, extensions.crypt(p_pin, extensions.gen_salt('bf')), 0, null
  )
  on conflict (patient_id) do update
    set pin_hash = excluded.pin_hash,
        failed_attempts = 0,
        locked_until = null;
end;
$$;

comment on function public.set_sexual_health_pin(text) is
  'Sets or changes the caller''s own Sexual & Reproductive Health privacy PIN (spec §47.2). Always resets any lockout — the patient re-proving their own account session is itself the recovery path, so there is never a support-desk dependency.';

revoke all on function public.set_sexual_health_pin(text) from public, anon;
grant execute on function public.set_sexual_health_pin(text) to authenticated;

-- ---------------------------------------------------------------------------
-- clear_sexual_health_pin — turn the feature back off entirely.
-- ---------------------------------------------------------------------------
create or replace function public.clear_sexual_health_pin()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.sexual_health_privacy_settings
  where patient_id = (select auth.uid());
end;
$$;

revoke all on function public.clear_sexual_health_pin() from public, anon;
grant execute on function public.clear_sexual_health_pin() to authenticated;

-- ---------------------------------------------------------------------------
-- verify_sexual_health_pin — the actual gate check. Returns true/false
-- rather than raising, so a wrong guess is an ordinary result the UI can
-- show inline, not an error path; raises only for the lockout state, which
-- the UI needs to render differently (a countdown, not a retry button).
-- ---------------------------------------------------------------------------
create or replace function public.verify_sexual_health_pin(p_pin text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.sexual_health_privacy_settings%rowtype;
  v_ok boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_row from public.sexual_health_privacy_settings where patient_id = v_uid;
  if v_row.patient_id is null or v_row.pin_hash is null then
    -- No PIN set at all — nothing to gate on, so this is trivially "open".
    return true;
  end if;

  if v_row.locked_until is not null and v_row.locked_until > now() then
    raise exception 'too many attempts — try again after %', to_char(v_row.locked_until, 'HH24:MI')
      using errcode = '55006';
  end if;

  v_ok := (extensions.crypt(p_pin, v_row.pin_hash) = v_row.pin_hash);

  if v_ok then
    update public.sexual_health_privacy_settings
      set failed_attempts = 0, locked_until = null
      where patient_id = v_uid;
  else
    update public.sexual_health_privacy_settings
      set failed_attempts = v_row.failed_attempts + 1,
          locked_until = case when v_row.failed_attempts + 1 >= 5
                            then now() + interval '15 minutes'
                            else null end
      where patient_id = v_uid;
  end if;

  return v_ok;
end;
$$;

comment on function public.verify_sexual_health_pin(text) is
  'Checks a PIN attempt against the caller''s own sexual_health_privacy_settings row. Returns true when no PIN is set (nothing to gate). Locks for 15 minutes after 5 consecutive failures — see this migration''s header for why that threshold is appropriate for a privacy screen, not an account-security boundary.';

revoke all on function public.verify_sexual_health_pin(text) from public, anon;
grant execute on function public.verify_sexual_health_pin(text) to authenticated;

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'sexual_health_privacy_settings') then
    raise exception 'FAIL: sexual_health_privacy_settings was not created';
  end if;
  if has_column_privilege('authenticated', 'public.sexual_health_privacy_settings', 'pin_hash', 'SELECT') then
    raise exception 'FAIL: authenticated must not be able to SELECT pin_hash';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'sexual_health_privacy_settings'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'FAIL: sexual_health_privacy_settings must have no direct client write policy';
  end if;
  if has_function_privilege('anon', 'public.verify_sexual_health_pin(text)', 'EXECUTE') then
    raise exception 'FAIL: anon must not be able to call verify_sexual_health_pin';
  end if;
  raise notice 'PASS: sexual_health_privacy_settings + set/clear/verify PIN RPCs installed, hash column unreadable, no direct writes';
end $$;
