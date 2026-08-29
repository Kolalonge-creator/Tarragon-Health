-- Tarragon Health — Imaging & Diagnostic Procedure Platform, part 8/9:
-- AI-assist governance scaffold (spec §59.11: "AI may assist with image
-- triage, quality checks, prioritisation, reporting assistance... but
-- AI-generated findings should remain appropriately governed and should
-- not silently become the definitive clinical report").
--
-- Spec §59.11 is written in the future tense ("Eventually AI may...") --
-- this is governance scaffolding, not a live model integration. No Edge
-- Function or app code calls into this table yet; there is no imaging AI
-- model wired up (same "credential-drop-in-ready, not yet live" posture the
-- wearables cloud-OAuth build shipped in before real provider credentials
-- existed). What this migration DOES lock in now, correctly, rather than
-- retrofit later once a real integration exists under time pressure:
--
--   * Pattern A from case_briefs (20260730121004) / lab_report_extractions
--     (20260803144056) -- a draft lives in its OWN table, has NO
--     INSERT/UPDATE/DELETE RLS policy at all (service-role/Edge-Function
--     write only), and is never patient-readable.
--   * imaging_reports (part 6) has no column an AI process could write to
--     directly -- the only path from a draft into a real clinical record is
--     a human calling confirm_imaging_ai_assist_draft() below, then
--     separately, deliberately, filing/editing the real imaging_reports row
--     themselves. Confirming a draft here does NOT itself write
--     imaging_reports -- that stays a fully human act, so "should not
--     silently become the definitive clinical report" holds structurally,
--     not just by convention.

create type public.imaging_ai_assist_type as enum (
  'triage', 'quality_check', 'prioritisation', 'reporting_assistance'
);

create table public.imaging_ai_assist_drafts (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  imaging_order_id  uuid references public.imaging_orders (id) on delete cascade,
  imaging_report_id uuid references public.imaging_reports (id) on delete cascade,
  assist_type       public.imaging_ai_assist_type not null,
  status            text not null check (status in ('drafted', 'confirmed', 'discarded', 'failed')),
  model_id          text,
  input_snapshot    jsonb not null default '{}'::jsonb,
  draft_output      jsonb not null default '{}'::jsonb,
  error_message     text,
  confirmed_by      uuid references public.profiles (id) on delete restrict,
  confirmed_at      timestamptz,
  created_at        timestamptz not null default now(),
  constraint imaging_ai_assist_drafts_has_subject
    check (imaging_order_id is not null or imaging_report_id is not null)
);

create index imaging_ai_assist_drafts_order_idx on public.imaging_ai_assist_drafts (imaging_order_id);
create index imaging_ai_assist_drafts_report_idx on public.imaging_ai_assist_drafts (imaging_report_id);
create index imaging_ai_assist_drafts_org_idx on public.imaging_ai_assist_drafts (organisation_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS -- org staff SELECT only, no client write path at all.
-- ---------------------------------------------------------------------------
alter table public.imaging_ai_assist_drafts enable row level security;

create policy imaging_ai_assist_drafts_select on public.imaging_ai_assist_drafts
  for select to authenticated using (private.is_org_staff(organisation_id));

grant select on public.imaging_ai_assist_drafts to authenticated;

-- ---------------------------------------------------------------------------
-- Confirm step -- a deliberate human act. Marks the draft accepted; does
-- NOT itself write imaging_reports/imaging_orders (see header).
-- ---------------------------------------------------------------------------
create or replace function public.confirm_imaging_ai_assist_draft(p_draft_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org  uuid;
  v_staff_id uuid;
begin
  select organisation_id into v_org from public.imaging_ai_assist_drafts where id = p_draft_id;
  if v_org is null then
    raise exception 'imaging_ai_assist_drafts row not found';
  end if;

  select id into v_staff_id
  from public.clinical_staff
  where profile_id = (select auth.uid()) and organisation_id = v_org and active
  limit 1;

  if v_staff_id is null then
    raise exception 'not authorised: only an active clinical_staff member of this organisation may confirm an AI-assist draft';
  end if;

  update public.imaging_ai_assist_drafts
  set status = 'confirmed', confirmed_by = (select auth.uid()), confirmed_at = now()
  where id = p_draft_id and status = 'drafted';

  if not found then
    raise exception 'draft is not in a confirmable (drafted) state';
  end if;

  return p_draft_id;
end;
$$;

comment on function public.confirm_imaging_ai_assist_draft(uuid) is
  'Marks an imaging_ai_assist_drafts row confirmed by the calling clinical_staff member. Deliberately does not write imaging_reports/imaging_orders itself -- promoting confirmed AI-assist content into the actual clinical record stays a separate, fully human act (filing/editing the imaging_reports row), so AI output can never become the definitive report merely by being confirmed here.';

revoke all on function public.confirm_imaging_ai_assist_draft(uuid) from public, anon;
grant execute on function public.confirm_imaging_ai_assist_draft(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Self-verification -- the whole point of this table is that it has no
-- direct write policy; assert that structurally rather than trusting intent.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'imaging_ai_assist_drafts' and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'imaging_ai_assist_drafts must have no direct write policy -- service-role only';
  end if;

  if has_table_privilege('authenticated', 'public.imaging_ai_assist_drafts', 'INSERT')
     or has_table_privilege('authenticated', 'public.imaging_ai_assist_drafts', 'UPDATE')
     or has_table_privilege('authenticated', 'public.imaging_ai_assist_drafts', 'DELETE') then
    raise exception 'imaging_ai_assist_drafts: authenticated must not hold INSERT/UPDATE/DELETE';
  end if;

  if has_function_privilege('anon', 'public.confirm_imaging_ai_assist_draft(uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute confirm_imaging_ai_assist_draft';
  end if;

  raise notice 'PASS: imaging_ai_assist_drafts governance scaffold in place, no client write path';
end $$;
