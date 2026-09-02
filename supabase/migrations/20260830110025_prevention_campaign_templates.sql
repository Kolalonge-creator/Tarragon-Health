-- Tarragon Health — employer-requestable prevention campaign templates
-- (Engagement/Retention gap #4).
--
-- Scope decision (asked and confirmed): a corporate_admin picks from a
-- small, Tarragon-curated template menu and requests one for their own
-- org — never authors raw eligibility_rule/actions JSON themselves. That
-- stays entirely in Tarragon's hands, avoiding an employer admin
-- constructing a rule that leaks clinical-categorisation structure (I9).
--
-- campaign_templates is a global catalogue (no organisation_id) — it is
-- Tarragon's own curated menu, not tenant data, same class of table as
-- screen_types.
--
-- No new prevention_campaign_status value needed: status='draft' already
-- means "not patient-visible," which is exactly right for a pending
-- employer request awaiting admin activation.

create table public.campaign_templates (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null unique,
  name                   text not null,
  description            text,
  default_duration_days  integer,
  eligibility_rule       jsonb not null default '{"op":"true"}'::jsonb,
  actions                jsonb not null default '[]'::jsonb,
  is_active              boolean not null default true,
  created_by             uuid references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create trigger campaign_templates_set_updated_at
  before update on public.campaign_templates
  for each row execute function private.set_updated_at();

alter table public.campaign_templates enable row level security;

-- Any authenticated user can browse active templates (an employer admin
-- picking one to request); only a platform admin can author/edit the menu.
create policy campaign_templates_select on public.campaign_templates
  for select to authenticated
  using (is_active or private.is_admin());

create policy campaign_templates_write on public.campaign_templates
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

grant select, insert, update, delete on public.campaign_templates to authenticated;

alter table public.prevention_campaigns
  add column template_id uuid references public.campaign_templates(id) on delete set null,
  add column requested_by uuid references public.profiles(id) on delete set null;

comment on column public.prevention_campaigns.requested_by is
  'Non-null = an employer corporate_admin requested this from a template via requireInstitutionAggregateAccess() (status stays draft until a Tarragon admin activates it). Null = admin-authored directly, as before.';

insert into public.campaign_templates (code, name, description, default_duration_days, eligibility_rule, actions) values
  (
    'know-your-bp',
    'Know Your Blood Pressure',
    'A population-wide awareness drive encouraging every employee to get a blood pressure check, whether or not they already know their numbers.',
    30,
    '{"op": "true"}'::jsonb,
    '[{"type": "education", "detail": "What your blood pressure numbers mean and why regular checks matter"}, {"type": "screening_invite", "detail": "Book a free blood pressure check this month"}]'::jsonb
  ),
  (
    'vaccination-week',
    'Vaccination Week',
    'A time-boxed push reminding employees to catch up on due vaccinations.',
    14,
    '{"op": "true"}'::jsonb,
    '[{"type": "education", "detail": "Which vaccinations you may be due and why they matter"}]'::jsonb
  ),
  (
    'step-challenge',
    'Step Challenge',
    'A 30-day activity challenge open to every employee, logged through the app.',
    30,
    '{"op": "true"}'::jsonb,
    '[{"type": "challenge", "detail": "30-day step challenge — log your activity daily"}]'::jsonb
  ),
  (
    'diabetes-prevention-month',
    'Diabetes Prevention Month',
    'Targeted education and a risk reassessment for employees whose latest diabetes risk tier is moderate or above.',
    30,
    '{"op": "in", "field": "diabetes_tier", "value": ["moderate", "high", "very_high"]}'::jsonb,
    '[{"type": "education", "detail": "A short diabetes-prevention education series"}, {"type": "assessment", "detail": "Complete a diabetes risk reassessment"}]'::jsonb
  );

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'campaign_templates') then
    raise exception 'FAIL: campaign_templates table was not created';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'prevention_campaigns' and column_name = 'requested_by'
  ) then
    raise exception 'FAIL: prevention_campaigns.requested_by was not created';
  end if;
  if (select count(*) from public.campaign_templates where is_active) <> 4 then
    raise exception 'FAIL: expected 4 active seed templates, got %', (select count(*) from public.campaign_templates where is_active);
  end if;
  raise notice 'PASS: campaign_templates created + seeded, prevention_campaigns.template_id/requested_by added';
end $$;
