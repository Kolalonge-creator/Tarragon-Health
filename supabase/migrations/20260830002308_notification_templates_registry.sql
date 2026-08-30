-- Health Communication Engine — central template registry (part 3).
--
-- Today every notification's copy lives as ~40 hardcoded TypeScript
-- functions inside supabase/functions/send-pending-notifications/index.ts
-- (the "TEMPLATE_MAP") plus a second, separate hardcoded English-only
-- switch in notification-bell.tsx for in-app rendering. Nothing catalogues
-- what a template is for, who signed off on it, or what channels/audience
-- it's meant for — that lives only in code comments. This is the central,
-- queryable registry: one row per template key, carrying its governance
-- metadata (category, business priority, audience, timing, clinical
-- approval) plus a locale-keyed body table for the actual copy.
--
-- Deliberately NOT a hard foreign key from notifications.template — every
-- existing insert path (~25+ trigger functions across this codebase) uses
-- a free-text template value today, and retrofitting every call site to
-- guarantee registration before this migration could safely add a FK is a
-- separate, much larger and riskier change. Registry completeness is
-- instead a governance/observability concern (see
-- private.notifications_using_unregistered_templates() below) — a
-- template can be sent without being registered here, but an admin can see
-- exactly which ones are, which is strictly better than today's "grep the
-- Edge Function source" discovery mechanism.
--
-- The founder's English-only decision (2026-08-03,
-- english_only_no_voice_channel.sql) is a decision about what content
-- exists and what channel it goes out on, not about whether the schema can
-- hold more than one locale — "additional languages can be added" per the
-- product spec this closes out. notification_template_locales therefore
-- has a real `locale` column from day one; only 'en' rows are ever seeded
-- by this codebase today, and nothing here reopens the voice channel or
-- starts reading profiles.language into the send pipeline (see the
-- companion send-pending-notifications change for the precise, narrow
-- scope of what does consult this table).
create table public.notification_templates (
  key                      text primary key,
  category                 public.notification_category not null,
  business_priority        public.notification_business_priority not null,
  -- Free-text audience label (e.g. 'patient', 'clinician', 'admin',
  -- 'sponsor', 'partner') — deliberately not an enum: new recipient kinds
  -- have been added to this platform every few weeks (sponsor, care
  -- coordinator, partner...) and a template's audience is documentation,
  -- never something RLS or routing branches on.
  audience                 text not null,
  default_channels         public.notification_channel[] not null,
  -- 'immediate' | 'scheduled' | 'digest' — documentation of intent only;
  -- the actual send timing is still driven by whichever cron/trigger
  -- enqueues a given template, this column does not schedule anything
  -- itself.
  timing                   text not null default 'immediate',
  description              text not null,
  requires_clinical_approval boolean not null default false,
  clinical_approved_by     uuid references public.clinical_staff (id) on delete restrict,
  clinical_approved_at     timestamptz,
  is_active                boolean not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint notification_templates_channels_nonempty
    check (array_length(default_channels, 1) >= 1),
  constraint notification_templates_approval_consistent
    check (
      (clinical_approved_by is null) = (clinical_approved_at is null)
    )
);

comment on table public.notification_templates is
  'Central, queryable catalogue of every notification template''s governance metadata (17.5 of the Health Communication Engine spec). The actual runtime copy for the ~40 pre-existing templates still lives in send-pending-notifications/index.ts and notification-bell.tsx (unchanged, to avoid an unverifiable rewrite of a live clinical-safety send path) — this table is those templates'' authoritative catalogue record. A NEW template can be added here plus a notification_template_locales row and sent with zero code changes; see the DB-fallback branch in send-pending-notifications.';
comment on column public.notification_templates.timing is
  'Documentation of the template''s intended cadence, not a scheduler. One of: immediate, scheduled, digest.';

create trigger notification_templates_set_updated_at
  before update on public.notification_templates
  for each row execute function private.set_updated_at();

create table public.notification_template_locales (
  id            uuid primary key default gen_random_uuid(),
  template_key  text not null references public.notification_templates (key) on delete cascade,
  locale        text not null check (locale in ('en', 'pcm', 'yo', 'ha', 'ig')),
  channel       public.notification_channel not null,
  subject       text,
  -- {{token}} placeholders, substituted from the notifications.payload jsonb
  -- at send time (simple key lookup — see private.render_notification_template_locale).
  body          text not null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (template_key, locale, channel)
);

comment on table public.notification_template_locales is
  'Per-locale, per-channel body text for a notification_templates row. Only locale=''en'' rows are seeded today (17.6: architecture supports localisation from day one; actual non-English copy is a future, explicitly-asked-for product decision, not implied by this table existing). WhatsApp templates are Meta-approved fixed structures and are never rendered from here — this table only ever backs sms/email/push/in_app bodies.';

create trigger notification_template_locales_set_updated_at
  before update on public.notification_template_locales
  for each row execute function private.set_updated_at();

alter table public.notification_templates enable row level security;
alter table public.notification_template_locales enable row level security;

-- Read: any authenticated org staff/admin (this is operational/compliance
-- reference data, not patient data — no patient-scoping needed). Write:
-- admin only, except the clinical-approval columns which only
-- public.approve_notification_template() (below) may set.
create policy notification_templates_select on public.notification_templates
  for select to authenticated using (true);
create policy notification_templates_insert on public.notification_templates
  for insert to authenticated with check (private.is_admin());
create policy notification_templates_update on public.notification_templates
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy notification_templates_delete on public.notification_templates
  for delete to authenticated using (private.is_admin());

create policy notification_template_locales_select on public.notification_template_locales
  for select to authenticated using (true);
create policy notification_template_locales_insert on public.notification_template_locales
  for insert to authenticated with check (private.is_admin());
create policy notification_template_locales_update on public.notification_template_locales
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy notification_template_locales_delete on public.notification_template_locales
  for delete to authenticated using (private.is_admin());

grant select, insert, update, delete on public.notification_templates to authenticated;
grant select, insert, update, delete on public.notification_template_locales to authenticated;

-- Clinical-approval sign-off, same shape as public.sign_alert_rules() /
-- public.sign_escalation_slas() — only an active Clinical Director may
-- approve a template that carries clinical content, and the approval is
-- always self-attributed from the caller's own clinical_staff record.
create or replace function public.approve_notification_template(p_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
begin
  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.active
    and cs.is_clinical_director
  limit 1;

  if v_staff is null then
    raise exception 'not authorised: only an active Clinical Director can approve a notification template';
  end if;

  if not exists (select 1 from public.notification_templates where key = p_key) then
    raise exception 'notification template % not found', p_key;
  end if;

  update public.notification_templates
  set clinical_approved_by = v_staff, clinical_approved_at = now()
  where key = p_key;
end;
$$;

revoke all on function public.approve_notification_template(text) from public, anon;
grant execute on function public.approve_notification_template(text) to authenticated;

-- Observability: which template keys are actually in use on live
-- notifications rows but have no registry entry — the honest alternative
-- to a hard FK (see header). Admin-only; scans a bounded recent window so
-- it stays cheap.
create or replace function public.notifications_using_unregistered_templates(p_since timestamptz default now() - interval '30 days')
returns table (template text, send_count bigint, last_sent_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select n.template, count(*), max(n.created_at)
  from public.notifications n
  where private.is_admin()
    and n.template is not null
    and n.created_at >= p_since
    and not exists (select 1 from public.notification_templates t where t.key = n.template)
  group by n.template
  order by count(*) desc;
$$;

revoke all on function public.notifications_using_unregistered_templates(timestamptz) from public, anon;
grant execute on function public.notifications_using_unregistered_templates(timestamptz) to authenticated;

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'notification_templates') then
    raise exception 'notification_templates was not created';
  end if;
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'notification_template_locales') then
    raise exception 'notification_template_locales was not created';
  end if;
  if has_function_privilege('anon', 'public.approve_notification_template(text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute approve_notification_template';
  end if;
  if has_function_privilege('anon', 'public.notifications_using_unregistered_templates(timestamptz)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute notifications_using_unregistered_templates';
  end if;
end $$;
