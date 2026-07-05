-- Tarragon Health — Sprint 1 foundation
-- 06 · Platform Infrastructure (Category 5)
--
-- Immutable audit log, multi-channel notifications, and the referral
-- programme. conversation_state deliberately lives in Upstash Redis, not
-- Postgres (ARCHITECTURE.md §8), so it is not modelled here.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.notification_channel as enum ('email', 'sms', 'in_app', 'whatsapp');

create type public.notification_status as enum (
  'pending', 'sent', 'delivered', 'failed', 'read'
);

create type public.referral_type as enum (
  'patient_refers_patient', 'doctor_refers_patient', 'corporate_champion'
);

create type public.referral_reward_status as enum ('pending', 'earned', 'paid');

-- ---------------------------------------------------------------------------
-- audit_log — immutable (no UPDATE / DELETE at the Postgres level)
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid references public.organisations (id) on delete set null,
  actor_id          uuid references public.profiles (id) on delete set null,
  action            text not null,
  entity_type       text,
  entity_id         uuid,
  event             jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index audit_log_org_idx on public.audit_log (organisation_id, created_at desc);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);
create index audit_log_actor_idx on public.audit_log (actor_id);

-- Immutability guard: reject any UPDATE or DELETE, for every role.
create or replace function private.reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log is append-only: % is not permitted', tg_op;
end;
$$;

create trigger audit_log_no_update
  before update on public.audit_log
  for each row execute function private.reject_mutation();

create trigger audit_log_no_delete
  before delete on public.audit_log
  for each row execute function private.reject_mutation();

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------

create table public.notifications (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid references public.organisations (id) on delete set null,
  recipient_id      uuid not null references public.profiles (id) on delete cascade,
  channel           public.notification_channel not null default 'whatsapp',
  status            public.notification_status not null default 'pending',
  template          text,
  payload           jsonb not null default '{}'::jsonb,
  sent_at           timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
create index notifications_org_idx on public.notifications (organisation_id, status);

create trigger notifications_set_updated_at
  before update on public.notifications
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- referrals (patient / doctor / corporate champion; reward in kobo)
-- ---------------------------------------------------------------------------

create table public.referrals (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid references public.organisations (id) on delete set null,
  referrer_id       uuid not null references public.profiles (id) on delete cascade,
  referred_id       uuid references public.profiles (id) on delete set null,
  referred_phone    text,
  type              public.referral_type not null default 'patient_refers_patient',
  code              text not null unique,
  reward_kobo       bigint not null default 0,
  reward_status     public.referral_reward_status not null default 'pending',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint referrals_phone_e164 check (referred_phone is null or referred_phone ~ '^\+[1-9][0-9]{7,14}$')
);

create index referrals_referrer_idx on public.referrals (referrer_id);
create index referrals_org_idx on public.referrals (organisation_id);
create index referrals_referred_idx on public.referrals (referred_id);

create trigger referrals_set_updated_at
  before update on public.referrals
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.audit_log      enable row level security;
alter table public.notifications  enable row level security;
alter table public.referrals      enable row level security;

-- audit_log: append-only. Any authenticated actor may write an entry; reads
-- are limited to org staff/admin and the actor's own entries. No UPDATE/DELETE
-- policies exist, and the triggers above hard-block mutation regardless.
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (
    actor_id = (select auth.uid())
    or (organisation_id is not null and private.is_org_staff(organisation_id))
    or private.is_admin()
  );
-- Writers may only log entries attributed to themselves or, for staff, to
-- their own organisation. Trusted server/Edge contexts use the service role
-- and bypass this. Never `with check (true)` — that would let any user forge
-- audit entries as another actor.
create policy audit_log_insert on public.audit_log
  for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    or (organisation_id is not null and private.is_org_staff(organisation_id))
  );

-- notifications: recipient sees own (and may mark read); staff manage org.
create policy notifications_select on public.notifications
  for select to authenticated
  using (recipient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy notifications_insert on public.notifications
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));
create policy notifications_update on public.notifications
  for update to authenticated
  using (recipient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (recipient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy notifications_delete on public.notifications
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

-- referrals: referrer sees own; staff manage org.
create policy referrals_select on public.referrals
  for select to authenticated
  using (referrer_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy referrals_insert on public.referrals
  for insert to authenticated
  with check (referrer_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy referrals_update on public.referrals
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));
create policy referrals_delete on public.referrals
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

-- Append-only: grant INSERT/SELECT but never UPDATE/DELETE on audit_log.
grant select, insert on public.audit_log to authenticated;
grant select, insert, update, delete on public.notifications to authenticated;
grant select, insert, update, delete on public.referrals to authenticated;
