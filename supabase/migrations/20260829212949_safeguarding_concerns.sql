-- Tarragon Health
-- Patient Safety gap-closure, item 3 of 5 (§89.12 "safeguarding" of the
-- 2026-08-29 governance/safety spec audit) -- step 2 of 2. Confirms the spec
-- language directly: "support professional safeguarding workflows for
-- children, vulnerable adults, abuse, neglect, exploitation, immediate
-- safety concerns." CLAUDE.md's Clinical Tier Ladder is not re-split for
-- this -- no new "safeguarding lead" role is introduced (the founder's
-- explicit instruction on this gap-closure pass); a concern routes to the
-- existing Tier 3+/Clinical Director authority the ladder already defines,
-- the same way emergency escalation and prescribing authority each reuse
-- the ladder rather than inventing a parallel one.
--
-- MODELLED ON clinical_incident_reports (open -> under_review -> closed,
-- server-derived attribution, terminal closed state, no DELETE policy) with
-- one deliberate difference: VISIBILITY. A near-miss log is org-staff-wide
-- readable by design (safety-culture signal). A safeguarding concern
-- naming a specific child or vulnerable adult is not -- SELECT is
-- restricted to Tier 3+/Clinical Director plus the reporter themselves (so
-- a Care Coordinator who files one can still see it was received and
-- track its status, without being able to browse anyone else's). Filing
-- (INSERT) stays broad -- same "a Care Coordinator noticing something and
-- reporting it is exactly the safety culture this exists to enable"
-- reasoning as the near-miss log -- only visibility and review authority
-- are narrowed, not who may raise a concern.
--
-- Every concern auto-opens an urgent_escalation clinician_alert via the
-- existing private.raise_clinician_alert() helper (same helper the
-- 2026-08-29 stale-referral safety check uses) -- a safeguarding concern is
-- not something that should sit unseen until someone happens to check a
-- log.

create table public.safeguarding_concerns (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete cascade,
  patient_id          uuid not null references public.profiles (id) on delete restrict,

  reported_by         uuid references public.profiles (id) on delete restrict,
  reported_at         timestamptz not null default now(),

  concern_category    text not null check (concern_category in (
    'child_safety', 'vulnerable_adult', 'abuse', 'neglect', 'exploitation', 'immediate_safety_risk', 'other'
  )),
  description         text not null check (length(btrim(description)) > 0),

  status               text not null default 'open' check (status in ('open', 'under_review', 'closed')),

  reviewed_by_staff    uuid references public.clinical_staff (id) on delete restrict,
  reviewed_at          timestamptz,
  review_outcome       text,
  corrective_action    text,
  closed_by_staff      uuid references public.clinical_staff (id) on delete restrict,
  closed_at            timestamptz,

  clinician_alert_id   uuid references public.clinician_alerts (id) on delete set null,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint safeguarding_concerns_review_requires_reviewer check (
    status not in ('under_review', 'closed')
    or (reviewed_by_staff is not null and reviewed_at is not null)
  ),
  constraint safeguarding_concerns_closed_requires_outcome check (
    status <> 'closed'
    or (
      closed_by_staff is not null and closed_at is not null
      and review_outcome is not null and length(btrim(review_outcome)) > 0
    )
  ),
  constraint safeguarding_concerns_open_is_clean check (
    status <> 'open'
    or (reviewed_by_staff is null and reviewed_at is null and closed_by_staff is null and closed_at is null)
  )
);

comment on table public.safeguarding_concerns is
  'Safeguarding concern log (child/vulnerable-adult/abuse/neglect/exploitation/immediate safety) -- docs spec §89.12. Any org staff may file one; only Tier 3+/Clinical Director may review or close one, and only Tier 3+/Clinical Director plus the original reporter may even read one -- deliberately narrower visibility than clinical_incident_reports given the sensitivity of naming a specific child or vulnerable adult.';

create index safeguarding_concerns_org_status_idx
  on public.safeguarding_concerns (organisation_id, status, reported_at desc);
create index safeguarding_concerns_patient_idx
  on public.safeguarding_concerns (patient_id);

alter table public.safeguarding_concerns enable row level security;

-- ---------------------------------------------------------------------------
-- Authority helper -- Tier 3+ or Clinical Director. A new, dedicated
-- function rather than a reuse of private.can_handle_emergency_escalation
-- (tier_2+): deliberately one rung higher, and free to diverge from that
-- threshold later without changing emergency-escalation authority as a
-- side effect -- same "separate function, same shape" precedent as that
-- function's own comment states for itself vs has_prescribing_authority.
-- ---------------------------------------------------------------------------
create or replace function private.can_review_safeguarding_concern(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = org
      and active
      and (
        is_clinical_director
        or doctor_tier in ('tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist')
      )
  );
$$;

comment on function private.can_review_safeguarding_concern(uuid) is
  'Tier 3+ or the org Clinical Director. Gates reviewing/closing a safeguarding concern AND reading one at all (see safeguarding_concerns_select) -- one rung higher than emergency-escalation authority given the sensitivity of the record.';

create policy safeguarding_concerns_select on public.safeguarding_concerns
  for select to authenticated
  using (
    private.can_review_safeguarding_concern(organisation_id)
    or reported_by = (select auth.uid())
  );

-- Broad on purpose -- same "anyone noticing something can report it" shape
-- as clinical_incident_reports_insert, private.is_org_staff() includes
-- Care Coordinator.
create policy safeguarding_concerns_insert on public.safeguarding_concerns
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

-- Broad on the RLS layer, narrowed by the trigger below -- same "RLS
-- admits, trigger narrows" shape as clinical_incident_reports_update.
create policy safeguarding_concerns_update on public.safeguarding_concerns
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

-- No DELETE policy -- a filed concern is retained, same discipline as
-- clinical_incident_reports / data_breach_incidents.

grant select, insert, update on public.safeguarding_concerns to authenticated;
revoke delete on public.safeguarding_concerns from authenticated;

create trigger safeguarding_concerns_set_updated_at
  before update on public.safeguarding_concerns
  for each row execute function private.set_updated_at();

create or replace function private.enforce_safeguarding_concern_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
  v_tier public.doctor_tier;
begin
  if tg_op = 'INSERT' then
    new.reported_by := (select auth.uid());
    new.reported_at := coalesce(new.reported_at, now());
    new.status := 'open';
    new.reviewed_by_staff := null;
    new.reviewed_at := null;
    new.review_outcome := null;
    new.corrective_action := null;
    new.closed_by_staff := null;
    new.closed_at := null;
    new.clinician_alert_id := private.raise_clinician_alert(
      new.organisation_id,
      new.patient_id,
      'urgent_escalation',
      'Safeguarding concern reported',
      format('Category: %s. %s', new.concern_category, new.description),
      'clinical',
      'safeguarding_concern'
    );
    return new;
  end if;

  if old.status = 'closed' then
    raise exception 'This safeguarding concern is closed and cannot be edited further. File a new concern if something new needs recording.'
      using errcode = '42501';
  end if;

  new.reported_by := old.reported_by;
  new.reported_at := old.reported_at;
  new.clinician_alert_id := old.clinician_alert_id;

  -- Adding detail while still 'open' needs no special authority -- same
  -- carve-out as clinical_incident_reports.
  if new.status = old.status then
    return new;
  end if;

  select cs.id, cs.doctor_tier into v_staff_id, v_tier
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.organisation_id = new.organisation_id
    and cs.active
    and (cs.is_clinical_director or cs.doctor_tier in ('tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist'))
  limit 1;

  if v_staff_id is null then
    raise exception 'Only a Tier 3+ clinician or the Clinical Director can move a safeguarding concern into review or close it.'
      using errcode = '42501';
  end if;

  new.reviewed_by_staff := v_staff_id;
  new.reviewed_at := now();

  if new.status = 'closed' then
    if new.review_outcome is null or length(btrim(new.review_outcome)) = 0 then
      raise exception 'Closing a safeguarding concern needs a stated review outcome, so a closed record always says what was found.';
    end if;
    new.closed_by_staff := v_staff_id;
    new.closed_at := now();
  end if;

  return new;
end;
$$;

comment on function private.enforce_safeguarding_concern_attribution() is
  'INSERT: forces reported_by/reported_at/status server-side and auto-raises an urgent_escalation clinician_alert via raise_clinician_alert(). UPDATE: blocks editing a closed concern, keeps filing attribution immutable, requires Tier 3+/Clinical Director to move a concern into review or close it.';

create trigger safeguarding_concerns_enforce_attribution
  before insert or update on public.safeguarding_concerns
  for each row execute function private.enforce_safeguarding_concern_attribution();

revoke all on function private.enforce_safeguarding_concern_attribution() from public;
revoke all on function private.can_review_safeguarding_concern(uuid) from public;
revoke all on function private.can_review_safeguarding_concern(uuid) from anon;
revoke all on function private.enforce_safeguarding_concern_attribution() from public, anon;
revoke all on function private.can_review_safeguarding_concern(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- Assertions -- the migration is the test.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'safeguarding_concerns') then
    raise exception 'safeguarding_concerns missing after migration';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'safeguarding_concerns' and cmd = 'DELETE'
  ) then
    raise exception 'safeguarding_concerns must have no DELETE policy -- a filed concern is retained';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.safeguarding_concerns'::regclass
      and tgname = 'safeguarding_concerns_enforce_attribution'
      and not tgisinternal
  ) then
    raise exception 'safeguarding_concerns attribution trigger missing';
  end if;

  if not has_table_privilege('authenticated', 'public.safeguarding_concerns', 'INSERT') then
    raise exception 'authenticated lacks INSERT on safeguarding_concerns';
  end if;
  if has_table_privilege('authenticated', 'public.safeguarding_concerns', 'DELETE') then
    raise exception 'authenticated must not hold DELETE on safeguarding_concerns';
  end if;

  if has_function_privilege('anon', 'private.can_review_safeguarding_concern(uuid)', 'EXECUTE') then
    raise exception 'anon must not be able to execute private.can_review_safeguarding_concern';
  end if;

  raise notice 'PASS: safeguarding_concerns table + restricted-visibility RLS + Tier-3+ review gate + auto-alert wiring all present';
end $$;
