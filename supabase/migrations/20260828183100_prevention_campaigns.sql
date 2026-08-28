-- Tarragon Health — Risk & Prevention Engine enhancement, 4/7. Committed to
-- git but never actually applied to production. Content byte-identical to
-- the committed 20260827202346_prevention_campaigns.sql.

create type public.prevention_campaign_status as enum ('draft', 'active', 'ended');
create type public.prevention_campaign_action_type as enum (
  'education', 'screening_invite', 'assessment', 'discount', 'challenge'
);
create type public.prevention_campaign_enrolment_status as enum (
  'invited', 'joined', 'completed', 'declined'
);

create table public.prevention_campaigns (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  code              text not null,
  name              text not null,
  description       text,
  starts_on         date not null,
  ends_on           date,
  eligibility_rule  jsonb not null default '{"op":"true"}'::jsonb,
  actions           jsonb not null default '[]'::jsonb,
  status            public.prevention_campaign_status not null default 'draft',
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint prevention_campaigns_dates check (ends_on is null or ends_on >= starts_on),
  unique (organisation_id, code)
);

create index prevention_campaigns_org_status_idx
  on public.prevention_campaigns (organisation_id, status);

create trigger prevention_campaigns_set_updated_at
  before update on public.prevention_campaigns
  for each row execute function private.set_updated_at();

create table public.prevention_campaign_enrolments (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  campaign_id       uuid not null references public.prevention_campaigns (id) on delete cascade,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  status            public.prevention_campaign_enrolment_status not null default 'joined',
  joined_at         timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (campaign_id, patient_id)
);

create index prevention_campaign_enrolments_patient_idx
  on public.prevention_campaign_enrolments (patient_id);
create index prevention_campaign_enrolments_campaign_idx
  on public.prevention_campaign_enrolments (campaign_id);

create trigger prevention_campaign_enrolments_set_updated_at
  before update on public.prevention_campaign_enrolments
  for each row execute function private.set_updated_at();

alter table public.prevention_campaigns enable row level security;
alter table public.prevention_campaign_enrolments enable row level security;

create policy prevention_campaigns_select on public.prevention_campaigns
  for select to authenticated
  using (
    private.is_org_staff(organisation_id)
    or (
      status <> 'draft'
      and exists (
        select 1 from public.profiles p
        where p.id = (select auth.uid()) and p.organisation_id = prevention_campaigns.organisation_id
      )
    )
  );

create policy prevention_campaigns_insert on public.prevention_campaigns
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));
create policy prevention_campaigns_update on public.prevention_campaigns
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));
create policy prevention_campaigns_delete on public.prevention_campaigns
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

create policy prevention_campaign_enrolments_select on public.prevention_campaign_enrolments
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy prevention_campaign_enrolments_insert on public.prevention_campaign_enrolments
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy prevention_campaign_enrolments_update on public.prevention_campaign_enrolments
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
create policy prevention_campaign_enrolments_delete on public.prevention_campaign_enrolments
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.prevention_campaigns to authenticated;
grant select, insert, update, delete on public.prevention_campaign_enrolments to authenticated;
