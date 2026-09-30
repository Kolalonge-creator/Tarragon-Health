-- S03 (sign-up, verification, recovery), part 1: delivery log for the auth Send SMS hook.
-- Decisions applied: INV-08 (SMS only for verification codes), OQ-21 (hook behind a provider interface), D-05.
-- Design: docs/design/S03.md.
--
-- Counted first (live, 2026-09-30): no table of this name, no [auth.hook.send_sms]; 0 of 11 auth users have a phone.
--
-- public.sms_delivery_log records every attempt the hook makes (or refuses) to send a verification code. It is also
-- the phone-keyed rate limit's source of truth: the hook counts recent rows for the same phone_hash, so rotating IP
-- addresses cannot bypass "5 codes per hour".
--   * Only service_role (the hook) can read or write it. No patient, clinician, admin or anon role has any access.
--   * The phone is stored only as an HMAC (phone_hash, keyed by a secret the hook holds), never in clear, and the
--     code itself is never stored.
--   * purpose is CHECKed to 'auth_otp': the database itself refuses a log row for any other SMS use (INV-08).

create table if not exists public.sms_delivery_log (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  purpose             text not null default 'auth_otp' check (purpose = 'auth_otp'),
  phone_hash          text not null check (char_length(phone_hash) = 64),
  user_id             uuid references auth.users(id) on delete set null,
  provider            text not null check (provider in ('mock', 'termii')),
  status              text not null check (status in ('sent', 'failed', 'rate_limited')),
  attempts            integer not null default 1 check (attempts between 1 and 5),
  provider_message_id text,
  error_code          text
);

comment on table public.sms_delivery_log is
  'S03: one row per verification-code SMS attempt by the auth Send SMS hook. Service-role only. phone_hash is an HMAC, '
  'never the number; the code is never stored. purpose is CHECKed to auth_otp (INV-08).';

create index if not exists sms_delivery_log_phone_recent_idx
  on public.sms_delivery_log (phone_hash, created_at desc);

alter table public.sms_delivery_log enable row level security;
-- No policies on purpose: with RLS on and no policy, every non-bypass role reads and writes nothing.

revoke all on public.sms_delivery_log from public, anon, authenticated;
grant select, insert on public.sms_delivery_log to service_role;

do $$
begin
  if has_table_privilege('anon', 'public.sms_delivery_log', 'SELECT')
     or has_table_privilege('authenticated', 'public.sms_delivery_log', 'SELECT')
     or has_table_privilege('authenticated', 'public.sms_delivery_log', 'INSERT') then
    raise exception 'S03 assertion: sms_delivery_log must not be reachable by anon or authenticated';
  end if;
  if not has_table_privilege('service_role', 'public.sms_delivery_log', 'INSERT') then
    raise exception 'S03 assertion: service_role must be able to write sms_delivery_log';
  end if;
end $$;
