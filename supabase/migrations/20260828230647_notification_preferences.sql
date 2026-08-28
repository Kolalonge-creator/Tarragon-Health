-- Patient Engagement Engine, step 3: communication preferences (§16.14).
--
-- Confirmed by grep across all prior migrations: no notification_preferences /
-- quiet_hours / channel_preference table existed anywhere before this. The
-- `notifications` table already carries `content_class` ('clinical' / 'non_clinical',
-- from the v3-ported I1 invariant) — this migration reuses that same distinction as
-- the override boundary: a clinical notification (abnormal result, red-flag vitals,
-- escalation) always goes out regardless of a patient's quiet hours or channel
-- choices; a non_clinical one (reminders, encouragement, milestones) respects them.
-- Timezone is always Africa/Lagos per platform convention — no per-patient tz column.

create table if not exists public.notification_preferences (
  patient_id         uuid primary key references public.profiles (id) on delete cascade,
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  preferred_channel  public.notification_channel not null default 'whatsapp',
  language           text not null default 'en',
  frequency          text not null default 'normal' check (frequency in ('minimal', 'normal', 'frequent')),
  quiet_hours_start   time,
  quiet_hours_end     time,
  email_enabled        boolean not null default true,
  sms_enabled           boolean not null default true,
  push_enabled          boolean not null default true,
  whatsapp_enabled      boolean not null default true,
  in_app_enabled        boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;

drop policy if exists notification_preferences_select on public.notification_preferences;
create policy notification_preferences_select on public.notification_preferences
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists notification_preferences_insert on public.notification_preferences;
create policy notification_preferences_insert on public.notification_preferences
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists notification_preferences_update on public.notification_preferences;
create policy notification_preferences_update on public.notification_preferences
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

drop policy if exists notification_preferences_delete on public.notification_preferences;
create policy notification_preferences_delete on public.notification_preferences
  for delete to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.notification_preferences to authenticated;

create or replace function private.touch_notification_preferences_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists notification_preferences_touch_updated_at on public.notification_preferences;
create trigger notification_preferences_touch_updated_at
  before update on public.notification_preferences
  for each row
  execute function private.touch_notification_preferences_updated_at();

-- Single source of truth for "should this notification actually go out right now,"
-- called by the send pipeline before dispatch. Clinical content always passes.
-- Non-clinical content is gated on the channel being enabled and (if quiet hours are
-- set) the current Lagos-local time falling outside them — quiet hours may wrap past
-- midnight (e.g. 22:00-07:00), handled below.
create or replace function private.notification_allowed_now(
  p_patient_id uuid,
  p_channel public.notification_channel,
  p_content_class public.notification_content_class default 'non_clinical'
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    case
      when p_content_class = 'clinical' then true
      else coalesce(
        (
          select
            case p_channel
              when 'email' then np.email_enabled
              when 'sms' then np.sms_enabled
              when 'push' then np.push_enabled
              when 'whatsapp' then np.whatsapp_enabled
              when 'in_app' then np.in_app_enabled
              else true
            end
            and (
              np.quiet_hours_start is null
              or np.quiet_hours_end is null
              or not (
                case
                  when np.quiet_hours_start <= np.quiet_hours_end then
                    (now() at time zone 'Africa/Lagos')::time between np.quiet_hours_start and np.quiet_hours_end
                  else
                    -- window wraps past midnight, e.g. 22:00-07:00
                    (now() at time zone 'Africa/Lagos')::time >= np.quiet_hours_start
                    or (now() at time zone 'Africa/Lagos')::time <= np.quiet_hours_end
                end
              )
            )
          from public.notification_preferences np
          where np.patient_id = p_patient_id
        ),
        true -- no preferences row yet => default-on, matches every *_enabled column default
      )
    end
$$;

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'notification_preferences'
  ) then
    raise exception 'notification_preferences table missing after migration';
  end if;
end $$;
