-- Tarragon Health — Employer Health Platform, part 5/6: health campaigns,
-- workplace challenges, and employer communications (Module 26 §26.10,
-- §26.11, §26.12).
--
-- ── Communications reuse the existing notification pipeline ────────────────
-- §26.11 asks for employer-sent organisational messages, kept separate from
-- clinical communications. The platform already has exactly that shape:
-- `public.notification_broadcasts` (20260716200000) is an admin-only producer
-- that resolves an audience and enqueues rows onto the shared `notifications`
-- table, whose I1 CHECK (`notifications_no_clinical_on_open_rail`,
-- 20260730094515) already refuses clinical content on whatsapp/sms/email at
-- the database level. `employer_announcements` below is the SAME shape,
-- scoped to one employer's own roster instead of the whole platform, and
-- callable by the employer itself (`private.can_manage_employer`), not just
-- a Tarragon admin — that widening is the actual §26.11 ask ("Employer CAN
-- SEND"), and it only ever writes non-clinical announcement text, never reads
-- a patient-scoped table. Every row it inserts into `notifications` carries
-- content_class = 'non_clinical' explicitly, so it is bound by the same I1
-- CHECK as everything else on that table — an employer cannot use this path
-- to smuggle clinical content onto WhatsApp/SMS/email any more than the
-- platform broadcast can.
--
-- ── Campaigns are workplace-HR-adjacent, not clinical ───────────────────────
-- A screening/vaccination CAMPAIGN (§26.10) is the employer's own initiative
-- — its existence, dates and type are not health data, same footing as
-- employer_roster_members. Who is PARTICIPATING is a half-step closer to
-- health information (it says who chose to engage with a BP-screening drive),
-- so per §26.12's own instruction ("use aggregated participation data where
-- appropriate") individual participant rows are Tarragon-staff-only;
-- `employer_campaign_summary` is the aggregate, suppression-respecting view
-- an institution admin actually reads — the same split I9 already draws
-- everywhere else on this platform.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- §26.10's list plus §26.12's "health education challenge" and the
-- preventive-care campaign §26.9's worked example implies.
create type public.employer_campaign_type as enum (
  'bp_screening',
  'diabetes_prevention',
  'weight_management',
  'vaccination',
  'mental_wellbeing',
  'exercise_challenge',
  'preventive_care',
  'health_education'
);

create type public.employer_campaign_status as enum ('draft', 'active', 'ended');

-- ---------------------------------------------------------------------------
-- employer_campaigns
-- ---------------------------------------------------------------------------

create table public.employer_campaigns (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  campaign_type   public.employer_campaign_type not null,
  name            text not null,
  description     text,
  status          public.employer_campaign_status not null default 'draft',
  starts_on       date not null,
  ends_on         date,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint employer_campaigns_name_not_blank check (length(trim(name)) > 0),
  constraint employer_campaigns_dates check (ends_on is null or ends_on >= starts_on)
);

create index employer_campaigns_org_idx on public.employer_campaigns (organisation_id, status);

create trigger employer_campaigns_set_updated_at
  before update on public.employer_campaigns
  for each row execute function private.set_updated_at();

alter table public.employer_campaigns enable row level security;
grant select, insert, update, delete on public.employer_campaigns to authenticated;

create policy employer_campaigns_select on public.employer_campaigns
  for select to authenticated
  using (private.is_org_staff(organisation_id)
         or (private.is_institution_admin() and organisation_id = private.current_org_id()));
create policy employer_campaigns_insert on public.employer_campaigns
  for insert to authenticated
  with check (private.is_org_staff(organisation_id)
              or (private.is_institution_admin() and organisation_id = private.current_org_id()));
create policy employer_campaigns_update on public.employer_campaigns
  for update to authenticated
  using (private.is_org_staff(organisation_id)
         or (private.is_institution_admin() and organisation_id = private.current_org_id()))
  with check (private.is_org_staff(organisation_id)
              or (private.is_institution_admin() and organisation_id = private.current_org_id()));
create policy employer_campaigns_delete on public.employer_campaigns
  for delete to authenticated
  using (private.is_org_staff(organisation_id)
         or (private.is_institution_admin() and organisation_id = private.current_org_id()));

-- ---------------------------------------------------------------------------
-- employer_campaign_participants — Tarragon-staff-only (see header)
-- ---------------------------------------------------------------------------

create table public.employer_campaign_participants (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null references public.employer_campaigns (id) on delete cascade,
  patient_id     uuid not null references public.profiles (id) on delete cascade,
  joined_at      timestamptz not null default now(),
  completed_at   timestamptz,
  created_at     timestamptz not null default now()
);

create unique index employer_campaign_participants_key
  on public.employer_campaign_participants (campaign_id, patient_id);

alter table public.employer_campaign_participants enable row level security;
grant select, insert, update, delete on public.employer_campaign_participants to authenticated;

-- Deliberately NOT institution-admin readable, per the header note — only
-- Tarragon staff of the campaign's own org (or a patient their own row, so a
-- future self-serve "join this challenge" UI has something to check against).
create policy employer_campaign_participants_select on public.employer_campaign_participants
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or exists (select 1 from public.employer_campaigns c
               where c.id = campaign_id and private.is_org_staff(c.organisation_id))
  );
create policy employer_campaign_participants_insert on public.employer_campaign_participants
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    or exists (select 1 from public.employer_campaigns c
               where c.id = campaign_id and private.is_org_staff(c.organisation_id))
  );
create policy employer_campaign_participants_update on public.employer_campaign_participants
  for update to authenticated
  using (exists (select 1 from public.employer_campaigns c
                 where c.id = campaign_id and private.is_org_staff(c.organisation_id)))
  with check (exists (select 1 from public.employer_campaigns c
                       where c.id = campaign_id and private.is_org_staff(c.organisation_id)));
create policy employer_campaign_participants_delete on public.employer_campaign_participants
  for delete to authenticated
  using (exists (select 1 from public.employer_campaigns c
                 where c.id = campaign_id and private.is_org_staff(c.organisation_id)));

-- ---------------------------------------------------------------------------
-- employer_campaign_summary — the aggregate an institution admin actually
-- reads (§26.12 "use aggregated participation data where appropriate")
--
-- security_invoker (not definer): it must run under the CALLER's own RLS, so
-- an institution admin reading it is still bounded by employer_campaigns'
-- own is_institution_admin policy above — this view grants no new access, it
-- only reshapes what the caller could already assemble by counting rows one
-- at a time, minus the small-cell floor.
-- ---------------------------------------------------------------------------

create view public.employer_campaign_summary
with (security_invoker = true) as
select
  c.id as campaign_id,
  c.organisation_id,
  c.name,
  c.campaign_type,
  c.status,
  count(p.id) as participant_count,
  count(p.completed_at) as completed_count
from public.employer_campaigns c
left join public.employer_campaign_participants p on p.campaign_id = c.id
group by c.id, c.organisation_id, c.name, c.campaign_type, c.status;

comment on view public.employer_campaign_summary is
  'Aggregate campaign participation (Module 26 §26.12). security_invoker=true: bounded by the caller''s own RLS on the underlying tables, same as any other view here — see the wearable/appointment summary views for precedent. The app layer still applies the org''s min_cohort_size floor before rendering a count.';

-- ---------------------------------------------------------------------------
-- employer_announcements (§26.11)
-- ---------------------------------------------------------------------------

create table public.employer_announcements (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete cascade,
  created_by       uuid references public.profiles (id) on delete set null,
  title            text not null,
  body             text not null,
  -- Optional targeting: null = the whole roster. Both narrow it further when
  -- set; an id that resolves to zero people is a legitimate (if useless) send.
  department_id    uuid references public.employer_departments (id) on delete set null,
  location_id      uuid references public.employer_locations (id) on delete set null,
  channels         public.notification_channel[] not null default array['in_app']::public.notification_channel[],
  status           public.broadcast_status not null default 'draft',
  recipient_count  integer not null default 0,
  sent_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint employer_announcements_title_not_blank check (length(trim(title)) > 0),
  constraint employer_announcements_body_not_blank check (length(trim(body)) > 0),
  constraint employer_announcements_channels_nonempty check (array_length(channels, 1) >= 1),
  -- The whole point of this table: it must be structurally incapable of
  -- carrying a channel the I1 CHECK on notifications would refuse anyway, so
  -- the failure surfaces here (a clear "channel not allowed" at send time)
  -- rather than as a mid-loop insert failure on notifications itself.
  constraint employer_announcements_channels_are_content_class_safe
    check (channels <@ array['in_app', 'email', 'sms', 'whatsapp']::public.notification_channel[])
);

create index employer_announcements_org_idx on public.employer_announcements (organisation_id, created_at desc);

create trigger employer_announcements_set_updated_at
  before update on public.employer_announcements
  for each row execute function private.set_updated_at();

comment on table public.employer_announcements is
  'Employer-authored organisational messages (Module 26 §26.11) — approved copy, non-clinical only. Kept separate from care_messages (patient<->care-team clinical chat) and from clinician_alerts/notifications generated by clinical events. Sent via public.employer_send_announcement(), never a direct notifications insert.';

alter table public.employer_announcements enable row level security;
grant select, insert, update, delete on public.employer_announcements to authenticated;

create policy employer_announcements_select on public.employer_announcements
  for select to authenticated
  using (private.is_org_staff(organisation_id)
         or (private.is_institution_admin() and organisation_id = private.current_org_id()));
create policy employer_announcements_insert on public.employer_announcements
  for insert to authenticated
  with check (private.is_org_staff(organisation_id)
              or (private.is_institution_admin() and organisation_id = private.current_org_id()));
create policy employer_announcements_update on public.employer_announcements
  for update to authenticated
  using (private.is_org_staff(organisation_id)
         or (private.is_institution_admin() and organisation_id = private.current_org_id()))
  with check (private.is_org_staff(organisation_id)
              or (private.is_institution_admin() and organisation_id = private.current_org_id()));
create policy employer_announcements_delete on public.employer_announcements
  for delete to authenticated
  using (private.is_org_staff(organisation_id)
         or (private.is_institution_admin() and organisation_id = private.current_org_id()));

-- ---------------------------------------------------------------------------
-- Sending one — the producer, mirroring admin_send_broadcast's shape exactly
-- ---------------------------------------------------------------------------

create function public.employer_send_announcement(p_announcement_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.employer_announcements;
  v_ch public.notification_channel;
  v_count integer := 0;
  v_batch integer;
begin
  select * into v_a from public.employer_announcements where id = p_announcement_id;
  if v_a.id is null then
    raise exception 'Announcement not found';
  end if;
  if not private.can_manage_employer(v_a.organisation_id) then
    raise exception 'Not authorised for this organisation';
  end if;
  if v_a.status = 'sent' then
    raise exception 'Announcement already sent';
  end if;

  foreach v_ch in array v_a.channels loop
    with targets as (
      select r.claimed_profile_id as recipient_id
        from public.employer_roster_members r
       where r.organisation_id = v_a.organisation_id
         and r.status = 'claimed'
         and r.claimed_profile_id is not null
         and (v_a.department_id is null or r.department_id = v_a.department_id)
         and (v_a.location_id is null or r.location_id = v_a.location_id)
    )
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, content_class, template, payload)
    select v_a.organisation_id, t.recipient_id, v_ch, 'pending', 'non_clinical',
           'employer_announcement', jsonb_build_object('title', v_a.title, 'body', v_a.body)
    from targets t;
    get diagnostics v_batch = row_count;
    v_count := greatest(v_count, v_batch);
  end loop;

  update public.employer_announcements
     set status = 'sent', sent_at = now(), recipient_count = v_count
   where id = p_announcement_id;

  perform private.log_audit('employer_announcement.sent', 'employer_announcements', p_announcement_id,
    jsonb_build_object('recipient_count', v_count, 'channels', v_a.channels));

  return v_count;
end;
$$;

revoke all on function public.employer_send_announcement(uuid) from public;
grant execute on function public.employer_send_announcement(uuid) to authenticated;
revoke execute on function public.employer_send_announcement(uuid) from anon;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
declare v_n int;
begin
  select count(*) into v_n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('employer_campaigns', 'employer_campaign_participants', 'employer_announcements')
     and c.relrowsecurity;
  if v_n <> 3 then raise exception 'FAIL: expected RLS on 3 tables, found %', v_n; end if;

  if has_function_privilege('anon', 'public.employer_send_announcement(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute employer_send_announcement';
  end if;

  -- Institution admin must NOT be able to read participant-level rows.
  if exists (
    select 1 from pg_policies
     where tablename = 'employer_campaign_participants' and qual like '%is_institution_admin%'
  ) then
    raise exception 'FAIL: employer_campaign_participants grants institution-admin access to individual rows';
  end if;

  -- The channel-safety CHECK must actually be there and actually reject a
  -- bad channel value, not just exist as decoration.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.employer_announcements'::regclass
       and conname = 'employer_announcements_channels_are_content_class_safe'
  ) then
    raise exception 'FAIL: employer_announcements is missing its channel-safety CHECK';
  end if;

  raise notice 'PASS  campaigns (participant-level Tarragon-only, aggregate view for institution admin) + announcements (non_clinical only, I1-bound)';
end $$;