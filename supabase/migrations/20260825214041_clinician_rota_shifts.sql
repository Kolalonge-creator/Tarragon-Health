-- Tarragon Health — doctor on-call rota.
--
-- The video/voice consult mechanics (Zoom video visits, Twilio masked
-- calling) are real and wired end-to-end, but nothing in the platform has
-- ever tracked WHO is actually on duty to answer them — accept_video_visit_
-- request lets any active tier-4/5 doctor org-wide accept a request,
-- whether or not anyone is really watching the queue. That is the "human
-- in the loop" gap: a credible telemedicine claim to an HMO or NAFDAC needs
-- a real, inspectable coverage schedule, not just "some doctor eventually
-- clicks accept."
--
-- This is additive and non-breaking: it does NOT change accept_video_visit_
-- request's eligibility (any active tier-4/5 doctor can still accept, same
-- as before — restricting to on-call-only from day one would be unsafe
-- before any org has actually populated a rota). It adds the coverage data
-- itself, plus a lookup function the app layer uses to show "who's on call
-- right now" and to make coverage gaps visible to ops instead of invisible.

create table public.clinician_rota_shifts (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  clinical_staff_id  uuid not null references public.clinical_staff (id) on delete cascade,
  channel            text not null check (channel in ('video', 'voice', 'both')),
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  notes              text,
  created_by         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint clinician_rota_shifts_valid_window check (ends_at > starts_at)
);

create index clinician_rota_shifts_org_time_idx
  on public.clinician_rota_shifts (organisation_id, starts_at, ends_at);
create index clinician_rota_shifts_staff_idx
  on public.clinician_rota_shifts (clinical_staff_id, starts_at);

create trigger clinician_rota_shifts_set_updated_at
  before update on public.clinician_rota_shifts
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- A rota shift may only be assigned to a genuine clinician — same
-- eligibility shape as accept_video_visit_request's inline check and the
-- app-layer isClinicalTier() helper, enforced here too so a bad shift can't
-- be inserted via any path. A Care Coordinator (a real doctor_tier value,
-- explicitly non-clinical per CLAUDE.md) must never appear on this rota.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_rota_shift_clinician()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff record;
begin
  select cs.organisation_id, cs.active, cs.doctor_tier, cs.is_clinical_director
  into v_staff
  from public.clinical_staff cs
  where cs.id = new.clinical_staff_id;

  if v_staff.organisation_id is null then
    raise exception 'clinical staff record not found';
  end if;
  if v_staff.organisation_id <> new.organisation_id then
    raise exception 'clinical staff record belongs to a different organisation';
  end if;
  if not v_staff.active then
    raise exception 'only an active clinical staff member can be put on the rota';
  end if;
  if not (
    v_staff.is_clinical_director
    or v_staff.doctor_tier in ('tier_1', 'tier_2', 'tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist')
  ) then
    raise exception 'only a clinical tier (or the Clinical Director) can be put on the on-call rota — a Care Coordinator is non-clinical and never takes consults'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger clinician_rota_shifts_enforce_clinician
  before insert or update on public.clinician_rota_shifts
  for each row execute function private.enforce_rota_shift_clinician();

-- ---------------------------------------------------------------------------
-- No double-booking: a clinician cannot carry two overlapping shifts. Plain
-- query check rather than a gist exclusion constraint — no other table in
-- this project depends on btree_gist, and a trigger keeps the failure
-- message readable (naming the conflicting window) instead of a bare
-- constraint-violation error.
-- ---------------------------------------------------------------------------
create or replace function private.prevent_rota_shift_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conflict record;
begin
  select starts_at, ends_at into v_conflict
  from public.clinician_rota_shifts
  where clinical_staff_id = new.clinical_staff_id
    and id is distinct from new.id
    and starts_at < new.ends_at
    and ends_at > new.starts_at
  limit 1;

  if v_conflict.starts_at is not null then
    raise exception 'this clinician already has a shift from % to % that overlaps this one',
      v_conflict.starts_at, v_conflict.ends_at
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger clinician_rota_shifts_prevent_overlap
  before insert or update on public.clinician_rota_shifts
  for each row execute function private.prevent_rota_shift_overlap();

-- ---------------------------------------------------------------------------
-- RLS — internal ops data, not patient-facing (unlike clinical_staff itself,
-- which patients read for trust display). Any org staff member may see the
-- rota (a Care Coordinator routing an urgent question may need to know who's
-- on call); write is broad in RLS and narrowed to admin/Clinical Director at
-- the app/server-action layer, same split CLAUDE.md documents for Care
-- Coordinator write restrictions elsewhere — not a new RLS helper per shift
-- type.
-- ---------------------------------------------------------------------------
alter table public.clinician_rota_shifts enable row level security;

create policy clinician_rota_shifts_select on public.clinician_rota_shifts
  for select to authenticated
  using (private.is_org_staff(organisation_id));
create policy clinician_rota_shifts_insert on public.clinician_rota_shifts
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));
create policy clinician_rota_shifts_update on public.clinician_rota_shifts
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));
create policy clinician_rota_shifts_delete on public.clinician_rota_shifts
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.clinician_rota_shifts to authenticated;

-- ---------------------------------------------------------------------------
-- Who's on call, right now (or at a given instant) — the primitive both the
-- clinician-facing queue banner and the admin rota page build on.
-- ---------------------------------------------------------------------------
create or replace function private.on_call_clinician_ids(
  p_org uuid, p_channel text, p_at timestamptz default now()
) returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select clinical_staff_id
  from public.clinician_rota_shifts
  where organisation_id = p_org
    and starts_at <= p_at
    and ends_at > p_at
    and channel in (p_channel, 'both');
$$;

-- Staff-facing: names/photos of whoever is on call now, for the caller's own
-- org. Returns an empty array for a non-staff caller rather than raising —
-- callers treat "nobody on call" and "not allowed to see the rota" the same
-- way (show nothing), so this stays a safe default in any UI that calls it.
create or replace function public.current_on_call_clinicians(p_channel text default 'video')
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.is_org_staff(private.current_org_id()) then coalesce((
    select jsonb_agg(jsonb_build_object(
      'clinical_staff_id', cs.id,
      'full_name', cs.full_name,
      'photo_url', cs.photo_url,
      'doctor_tier', cs.doctor_tier
    ) order by cs.full_name)
    from public.clinical_staff cs
    where cs.id in (
      select private.on_call_clinician_ids(private.current_org_id(), p_channel)
    )
  ), '[]'::jsonb)
  else '[]'::jsonb end;
$$;

revoke execute on function public.current_on_call_clinicians(text) from public, anon;
grant execute on function public.current_on_call_clinicians(text) to authenticated;

do $$
begin
  if to_regclass('public.clinician_rota_shifts') is null then
    raise exception 'clinician_rota_shifts was not created';
  end if;
  if not exists (
    select 1 from pg_proc where proname = 'current_on_call_clinicians'
  ) then
    raise exception 'current_on_call_clinicians was not created';
  end if;
end $$;
