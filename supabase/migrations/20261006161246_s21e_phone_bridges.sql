-- S21 (part 5): the store behind the phone bridge (OQ-131, founder delegated the vendor choice 2026-10-06: Africa's Talking).
--
-- A bridge rings the patient first; when they answer, the vendor calls our callback and we reply with a Dial to the clinician. So the
-- clinician's number has to be held for the few minutes between those two moments. It is held here, on a row only the service role
-- can read, and it is removed (nulled) the moment the bridge ends or fails, and by a sweep every 10 minutes for any that were
-- never closed. Nothing else stores either number, no result or event carries one, and the patient's number is never stored
-- (it is used once, to place the first call).
--
-- Written and read only through the service role (the callback route and the adapter); signed-in users have no access at all.
-- Row counts at writing: new table, no rows, no conversion.

create table public.phone_bridges (
  bridge_id           text primary key check (bridge_id ~ '^br_[0-9a-f]{24}$'),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  encounter_id        uuid not null references public.encounters (id) on delete cascade,
  provider            text not null check (provider in ('africastalking', 'mock')),
  provider_session_id text unique,
  clinician_phone     text check (clinician_phone is null or clinician_phone ~ '^\+[1-9][0-9]{7,14}$'),
  state               text not null default 'ringing' check (state in ('ringing', 'connected', 'ended', 'failed')),
  patient_answered    boolean not null default false,
  clinician_dialled   boolean not null default false,
  started_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  ended_at            timestamptz,
  is_test             boolean not null default false,
  created_at          timestamptz not null default now(),
  check (expires_at > started_at)
);
create index phone_bridges_encounter_idx on public.phone_bridges (encounter_id, state);
-- one live bridge per encounter: two people tapping "call me" at once cannot start two bridges and ring everyone twice. An ended or failed
-- bridge does not count, and the adapter closes a stale live one (past its limit, or with no vendor session after 30 seconds) before it
-- makes a new one.
create unique index phone_bridges_one_live_per_encounter on public.phone_bridges (encounter_id) where state in ('ringing', 'connected');
comment on table public.phone_bridges is
  'S21: live phone bridges. clinician_phone exists only while a bridge is live and is nulled when it ends, fails or expires (trigger and sweep). Service role only.';

alter table public.phone_bridges enable row level security;
revoke all on public.phone_bridges from anon, public, authenticated;
grant select, insert, update on public.phone_bridges to service_role;

-- the number leaves the row the moment the bridge is over, however it ended
create function private.phone_bridges_forget_number() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.state in ('ended', 'failed') then
    new.clinician_phone := null;
    new.ended_at := coalesce(new.ended_at, now());
  end if;
  return new;
end;
$$;
revoke all on function private.phone_bridges_forget_number() from public, anon, authenticated;
create trigger phone_bridges_forget_number before insert or update on public.phone_bridges
  for each row execute function private.phone_bridges_forget_number();

-- anything past its limit is closed and forgotten, even if the vendor never told us the call ended
create function private.sweep_phone_bridges() returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  update public.phone_bridges set state = 'ended' where state in ('ringing', 'connected') and expires_at <= now();
  get diagnostics v_n = row_count;
  -- a bridge that ended without the number being cleared (it cannot happen through the trigger, but a direct write could)
  update public.phone_bridges set clinician_phone = null where clinician_phone is not null and state in ('ended', 'failed');
  return v_n;
end;
$$;
revoke all on function private.sweep_phone_bridges() from public, anon, authenticated;
select cron.schedule('s21-phone-bridge-sweep', '*/10 * * * *', $$ select private.sweep_phone_bridges(); $$);

do $$
begin
  if has_table_privilege('authenticated', 'public.phone_bridges', 'SELECT') or has_table_privilege('anon', 'public.phone_bridges', 'SELECT') then
    raise exception 'S21e: a signed-in or anonymous user can read phone_bridges';
  end if;
  if not has_table_privilege('service_role', 'public.phone_bridges', 'INSERT') then
    raise exception 'S21e: service_role cannot write phone_bridges';
  end if;
end $$;
