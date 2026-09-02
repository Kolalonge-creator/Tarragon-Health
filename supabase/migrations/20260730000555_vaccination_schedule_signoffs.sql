-- Tarragon Health — Child Immunisation: versioned, clinician-signed schedule layer
--
-- vaccination_catalog is the live reference schedule (global, no organisation_id)
-- and has been directly migration-edited since 2026-07-06, with real WHO/NPHCDA
-- dosing-accuracy fixes as recently as 2026-07-24 (tetanus/shingles). This adds
-- a versioned sign-off record ON TOP of it — mirrors cv_risk_config's signing
-- model (20260720122000_cv_risk_config.sql) — so a future change to the catalog
-- requires a real Clinical Director's review before it governs what patients
-- are notified about. It does NOT replace vaccination_catalog/vaccination_
-- records/vaccination_schedules, and it does NOT (yet) gate the live
-- vaccination_due reminder cron — see the note below for why.
--
-- GRANDFATHER STEP NOT YET DONE: checked live before writing this migration —
-- zero rows in clinical_staff with is_clinical_director=true and active=true
-- exist in production today. So this migration creates the schema and the
-- sign RPC only; it deliberately does not insert a signed row, and does not
-- wire private.queue_vaccination_reminders to require one. Until a real
-- Clinical Director exists and actually signs the current catalog,
-- vaccination_due reminders keep firing exactly as they do today, unchanged.

create table public.vaccination_schedule_signoffs (
  id            uuid primary key default gen_random_uuid(),
  version       integer not null,
  notes         text,
  source_url    text,
  -- approved_by references clinical_staff (a named, credentialed record), not
  -- profiles — same provenance rule as protocol_versions/cv_risk_config. Null
  -- until signed.
  approved_by   uuid references public.clinical_staff (id) on delete restrict,
  approved_at   timestamptz,
  is_active     boolean not null default false,
  created_at    timestamptz not null default now(),
  -- A row can only be active once a Clinical Director has signed it.
  constraint vaccination_schedule_signoffs_active_requires_signature
    check (not is_active or (approved_by is not null and approved_at is not null)),
  unique (version)
);

-- Global (no organisation_id), mirrors vaccination_catalog's own scope — the
-- reference schedule and its sign-off apply platform-wide, not per-org.
create unique index vaccination_schedule_signoffs_one_active
  on public.vaccination_schedule_signoffs (is_active) where is_active;

alter table public.vaccination_schedule_signoffs enable row level security;

-- Any authenticated user may read (parents/clinicians can see whether the
-- current schedule has been reviewed). Only admin may create drafts, and only
-- unsigned/inactive — signing is exclusively via sign_vaccination_schedule(),
-- so a direct insert can never forge a signature or self-activate.
create policy vaccination_schedule_signoffs_select on public.vaccination_schedule_signoffs
  for select to authenticated using (true);

create policy vaccination_schedule_signoffs_insert on public.vaccination_schedule_signoffs
  for insert to authenticated
  with check (
    private.is_admin()
    and approved_by is null
    and approved_at is null
    and is_active = false
  );
-- No update/delete policy — a review means a new version; activation/signing
-- flips is_active via the SECURITY DEFINER RPC only.

grant select, insert on public.vaccination_schedule_signoffs to authenticated;

-- ---------------------------------------------------------------------------
-- sign_vaccination_schedule — a Clinical Director's forge-proof sign-off.
-- Global catalog, so any org's active Clinical Director may sign (mirrors how
-- vaccination_catalog itself has no organisation_id).
-- ---------------------------------------------------------------------------
create or replace function public.sign_vaccination_schedule(p_signoff_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
begin
  if not exists (select 1 from public.vaccination_schedule_signoffs where id = p_signoff_id) then
    raise exception 'Vaccination schedule sign-off record not found';
  end if;

  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.active
    and cs.is_clinical_director
  limit 1;

  if v_staff is null then
    raise exception 'not authorised: only an active Clinical Director can sign the vaccination schedule';
  end if;

  update public.vaccination_schedule_signoffs set is_active = false
    where is_active and id <> p_signoff_id;

  update public.vaccination_schedule_signoffs
    set approved_by = v_staff, approved_at = now(), is_active = true
    where id = p_signoff_id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  select cs.organisation_id, (select auth.uid()), 'vaccination_schedule.signed',
         'vaccination_schedule_signoffs', p_signoff_id,
         jsonb_build_object('signed_by_clinical_staff', v_staff)
  from public.clinical_staff cs where cs.id = v_staff;

  return p_signoff_id;
end $$;

revoke all on function public.sign_vaccination_schedule(uuid) from public, anon;
revoke all on function public.sign_vaccination_schedule(uuid) from anon;
grant execute on function public.sign_vaccination_schedule(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.sign_vaccination_schedule(uuid)', 'EXECUTE') then
    raise exception 'sign_vaccination_schedule must not be anon-executable';
  end if;
end $$;
