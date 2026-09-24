-- Verified Provider/Lab Directory with User Feedback.
--
-- WHY: the mDoc NaviHealth.ai directory (real-world competitor reference)
-- pairs a credential-verified lab directory with genuine user feedback.
-- list_lab_test_locations (20260829123059) already gives Tarragon the
-- verified-directory half; this migration adds the feedback half — a real
-- patient rating tied to a lab order they actually placed and completed,
-- never an unverifiable testimonial, matching the "real, consented"
-- discipline this platform already applies to Category 1/2 testimonials.
--
-- THE GAP THIS CLOSES FIRST: lab_orders never recorded which specific
-- lab_provider_locations branch (as opposed to which lab_providers chain)
-- a patient used — confirmed live before writing this (no such column, no
-- FK). A self-arranged order (the only kind a patient can currently create;
-- see private.enforce_lab_order_origin and the 20260910011846
-- guidance_only cutover) never engages a provider/facility at all, by
-- design — that guard is untouched here. Recording *which branch the
-- patient personally chose to visit* is a different thing: it creates no
-- billing/liability engagement, so it's added as an ordinary nullable
-- column, deliberately outside enforce_lab_order_origin's self_arranged
-- checks (confirmed by reading that trigger's live definition — it only
-- inspects provider_id/facility_id/total_kobo/status, never a column it
-- doesn't know about).
--
-- lab_orders_update RLS is staff-only (confirmed live via pg_policies), so
-- a patient cannot set location_id via a plain table UPDATE — that's why
-- set_lab_order_location exists below as a narrow SECURITY DEFINER RPC,
-- the same shape as the existing set_lab_order_facility/
-- request_lab_order_partner_visit pattern for a patient-writable field the
-- blanket staff-only UPDATE policy otherwise reserves for staff.

alter table public.lab_orders
  add column location_id uuid references public.lab_provider_locations (id) on delete set null;

comment on column public.lab_orders.location_id is
  'Which lab_provider_locations branch the patient says they used for this self-arranged order. Patient-declared via set_lab_order_location, never a partner/facility engagement (enforce_lab_order_origin is untouched by this column). Backs lab_location_reviews eligibility: a review can only be filed once this matches the order the review claims.';

create index lab_orders_location_idx on public.lab_orders (location_id) where location_id is not null;

create function public.set_lab_order_location(p_order_id uuid, p_location_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.lab_orders%rowtype;
begin
  select * into v_order from public.lab_orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'lab order not found' using errcode = 'P0002';
  end if;
  -- A caregiver with a 'manage'-level grant carrying book_appointments (the
  -- established permission for booking/logistics actions taken on a
  -- dependent's behalf — see sponsor_book_care) may act here too; the row
  -- itself always stays attributed to v_order.patient_id, never the actor.
  if v_order.patient_id is distinct from auth.uid()
     and not private.can_act_for(v_order.patient_id, 'book_appointments'::public.caregiver_permission)
  then
    raise exception 'not your lab order' using errcode = '42501';
  end if;
  if v_order.fulfilment <> 'self_arranged' then
    raise exception 'a branch can only be recorded on a self-arranged order' using errcode = '23514';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'this order is cancelled' using errcode = '23514';
  end if;
  -- Write-once from the point a review becomes possible: once a branch is
  -- recorded AND the order has reached 'resulted', it can no longer be
  -- switched to a different active branch. Without this, a patient could
  -- set branch A pre-result, then swap to a different branch B they never
  -- visited immediately before filing a review, and lab_location_reviews'
  -- own insert-time match check (location_id = the order's *current*
  -- location_id) would wave it through — the "verified, real visit"
  -- premise depends on this being closed. A still-null location_id on a
  -- resulted order is deliberately NOT blocked here: a patient who forgot
  -- to record a branch before the result arrived can still set one once,
  -- which is what unlocks reviewing at all for them.
  if v_order.location_id is not null and v_order.status = 'resulted' then
    raise exception 'the lab branch cannot be changed once your result has arrived' using errcode = '23514';
  end if;
  if p_location_id is not null and not exists (
    select 1
    from public.lab_provider_locations lpl
    join public.lab_providers lp on lp.id = lpl.lab_provider_id
    where lpl.id = p_location_id and lpl.is_active and lp.is_active
  ) then
    raise exception 'location is not an active lab branch' using errcode = '23514';
  end if;

  update public.lab_orders
  set location_id = p_location_id, updated_at = now()
  where id = p_order_id;
end;
$$;

comment on function public.set_lab_order_location(uuid, uuid) is
  'Narrow write: records which lab_provider_locations branch was used for a self-arranged lab_orders row, callable by the order''s own patient or a caregiver with a can_act_for(book_appointments) grant. SECURITY DEFINER because lab_orders_update RLS is staff-only; this function does its own ownership/fulfilment/status/write-once checks rather than relying on that policy.';

revoke all on function public.set_lab_order_location(uuid, uuid) from public, anon;
grant execute on function public.set_lab_order_location(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- lab_location_reviews: one rating+optional comment per completed lab_orders
-- row. "Verified" means tied to an order the reviewing patient actually
-- placed and that reached status='resulted' at a location matching the
-- order's own recorded location — never a free-standing testimonial.
-- ---------------------------------------------------------------------------
create table public.lab_location_reviews (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  lab_order_id     uuid not null unique references public.lab_orders (id) on delete cascade,
  location_id      uuid not null references public.lab_provider_locations (id) on delete cascade,
  rating           smallint not null,
  comment          text,
  status           text not null default 'visible',
  hidden_by        uuid references public.profiles (id) on delete set null,
  hidden_at        timestamptz,
  hidden_reason    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint lab_location_reviews_rating_range check (rating between 1 and 5),
  constraint lab_location_reviews_comment_shape
    check (comment is null or (length(btrim(comment)) > 0 and length(comment) <= 2000)),
  constraint lab_location_reviews_status_values check (status in ('visible', 'hidden')),
  constraint lab_location_reviews_hidden_consistency
    check ((status = 'hidden') = (hidden_at is not null))
);

create index lab_location_reviews_location_idx on public.lab_location_reviews (location_id) where status = 'visible';
create index lab_location_reviews_org_idx on public.lab_location_reviews (organisation_id);
create index lab_location_reviews_patient_idx on public.lab_location_reviews (patient_id);

alter table public.lab_location_reviews enable row level security;

-- A patient reads their own reviews (including one a caregiver filed on
-- their behalf, per can_act_for(book_appointments) -- the same permission
-- the INSERT policy requires of that caregiver, matched here on purpose so
-- someone authorized to file a review is also authorized to read back what
-- they filed; confirmed necessary, not just generous, while shipping this:
-- Postgres requires an INSERT ... RETURNING row to also satisfy the
-- table's SELECT policy, so without this a caregiver-filed insert raises
-- the same "violates row-level security policy" error even when the
-- INSERT's own WITH CHECK genuinely passed, and useMyLabLocationReview's
-- "have you already reviewed this" read would silently show nothing for a
-- caregiver forever after). Staff/admin read every review in their org for
-- moderation. Deliberately NOT readable by other patients directly (that
-- would leak which patient had which test at which branch) — the public,
-- identity-free directory read is list_lab_location_reviews below.
create policy lab_location_reviews_select on public.lab_location_reviews
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.can_act_for(patient_id, 'book_appointments'::public.caregiver_permission)
    or private.is_org_staff(organisation_id)
    or private.is_admin()
  );

-- The verification gate: a review may only be filed for a lab_orders row
-- that genuinely belongs to the review's own declared patient_id, that has
-- completed ('resulted'), and whose current recorded location (set via
-- set_lab_order_location) matches the location being reviewed. lab_order_id
-- is UNIQUE, so this is also "one review per completed visit", not per
-- patient-location pair. The row is always attributed to the real patient
-- (patient_id), never the caller — a caregiver with a 'manage' grant
-- carrying book_appointments (mirroring set_lab_order_location's own check
-- above, and sponsor_book_care's established pattern) may submit it on the
-- patient's behalf.
--
-- The order-match check is a SECURITY DEFINER helper, not a raw EXISTS
-- against lab_orders under the caller's own RLS — a caregiver authorized
-- via can_act_for(..., 'book_appointments') is not necessarily granted
-- 'view_results' too (lab_orders_select's own RLS requires view_results,
-- is_org_staff, or ownership to see a row at all), so a raw EXISTS
-- evaluated as that caregiver would silently see zero rows and reject a
-- perfectly legitimate submission -- confirmed live before shipping this,
-- the same "found it by actually running the test" discipline as the
-- qualification bug below. Routing the objective "does this order match"
-- fact through a definer function cleanly separates it from the
-- authorization check (can_act_for, still evaluated as the real caller)
-- and, as a side effect, removes the entire class of bug the comment below
-- describes: private.lab_order_matches_review's parameters are p_-prefixed,
-- so there is no column name for an unqualified reference to collide with.
--
-- (Keeping this note for the record: the first version of this policy used
-- a bare EXISTS with lab_location_reviews.location_id/organisation_id
-- qualified against lo.* -- necessary at the time because an unqualified
-- reference inside that subquery resolved to the nearer scope, lo.*,
-- silently comparing lo.* to itself rather than to the row being inserted.
-- The definer-function rewrite below made that qualification moot, but the
-- lesson -- always qualify, or better, avoid the ambiguous scope
-- altogether -- is worth keeping visible.)
create function private.lab_order_matches_review(
  p_lab_order_id    uuid,
  p_patient_id      uuid,
  p_location_id     uuid,
  p_organisation_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.lab_orders lo
    where lo.id = p_lab_order_id
      and lo.patient_id = p_patient_id
      and lo.status = 'resulted'
      and lo.location_id = p_location_id
      and lo.organisation_id = p_organisation_id
  );
$$;

revoke all on function private.lab_order_matches_review(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function private.lab_order_matches_review(uuid, uuid, uuid, uuid) to authenticated;

create policy lab_location_reviews_insert on public.lab_location_reviews
  for insert to authenticated
  with check (
    (
      patient_id = (select auth.uid())
      or private.can_act_for(patient_id, 'book_appointments'::public.caregiver_permission)
    )
    and private.lab_order_matches_review(lab_order_id, patient_id, location_id, organisation_id)
  );

-- Defense in depth beyond the role-gated UPDATE policy below: RLS alone
-- can't express "staff may change status/hidden_* but never the patient's
-- own content" (a WITH CHECK has no OLD row to diff against), so a plain
-- role check would let any org staff member silently rewrite a filed
-- review's rating/comment/patient_id/location_id -- not just hide it,
-- despite that being the only thing the policy's own comment promises.
create function private.enforce_lab_location_review_moderation_only_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.rating is distinct from old.rating
     or new.comment is distinct from old.comment
     or new.patient_id is distinct from old.patient_id
     or new.lab_order_id is distinct from old.lab_order_id
     or new.location_id is distinct from old.location_id
     or new.organisation_id is distinct from old.organisation_id
     or new.created_at is distinct from old.created_at
  then
    raise exception 'only moderation fields (status, hidden_by, hidden_at, hidden_reason) may be updated on a filed review' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger lab_location_reviews_moderation_only_update
  before update on public.lab_location_reviews
  for each row execute function private.enforce_lab_location_review_moderation_only_update();

-- Staff-owned once filed, same posture as complaints/clinical_incident_reports:
-- a patient cannot edit or delete their own review after submitting it; the
-- moderation path (hide an abusive/wrong review) is staff/admin only.
create policy lab_location_reviews_update on public.lab_location_reviews
  for update to authenticated
  using (private.is_org_staff(organisation_id) or private.is_admin())
  with check (private.is_org_staff(organisation_id) or private.is_admin());

-- Freshly created table needs its own explicit grant — RLS restricts rows,
-- it does not grant table-level access (the standing "why migration-created
-- tables were unreachable" gotcha).
grant select, insert, update, delete on public.lab_location_reviews to authenticated;

-- ---------------------------------------------------------------------------
-- lab_location_review_reports: "staff-actionable, not automated takedown."
-- No INSERT policy for `authenticated` at all — a report is only ever
-- created via report_lab_location_review (SECURITY DEFINER), so a reporter
-- can never enumerate who else flagged the same review, and staff never see
-- a review auto-hidden by report volume alone.
-- ---------------------------------------------------------------------------
create table public.lab_location_review_reports (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  review_id        uuid not null references public.lab_location_reviews (id) on delete cascade,
  reporter_id      uuid not null references public.profiles (id) on delete cascade,
  reason           text not null,
  created_at       timestamptz not null default now(),
  constraint lab_location_review_reports_reason_shape
    check (length(btrim(reason)) > 0 and length(reason) <= 1000),
  constraint lab_location_review_reports_unique_reporter unique (review_id, reporter_id)
);

create index lab_location_review_reports_org_idx on public.lab_location_review_reports (organisation_id);
create index lab_location_review_reports_review_idx on public.lab_location_review_reports (review_id);

alter table public.lab_location_review_reports enable row level security;

create policy lab_location_review_reports_select on public.lab_location_review_reports
  for select to authenticated
  using (private.is_org_staff(organisation_id) or private.is_admin());

grant select, insert, update, delete on public.lab_location_review_reports to authenticated;

do $$
begin
  if not has_table_privilege('authenticated', 'public.lab_location_reviews', 'SELECT') then
    raise exception 'authenticated must be able to read lab_location_reviews';
  end if;
  if not has_table_privilege('authenticated', 'public.lab_location_reviews', 'INSERT') then
    raise exception 'authenticated must be able to insert lab_location_reviews';
  end if;
  if not has_table_privilege('authenticated', 'public.lab_location_review_reports', 'SELECT') then
    raise exception 'authenticated must be able to read lab_location_review_reports';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- report_lab_location_review: the patient-facing half of moderation. Any
-- authenticated user (not just other patients — a caller need not have used
-- that lab themselves) may flag a currently-visible review; duplicate flags
-- from the same reporter are silently absorbed (ON CONFLICT DO NOTHING),
-- never surfaced as an error.
-- ---------------------------------------------------------------------------
create function public.report_lab_location_review(p_review_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_org    uuid;
  v_status text;
begin
  if v_uid is null then
    raise exception 'must be signed in to report a review' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'a reason is required' using errcode = '23514';
  end if;

  select organisation_id, status into v_org, v_status
  from public.lab_location_reviews
  where id = p_review_id;

  if v_org is null then
    raise exception 'review not found' using errcode = 'P0002';
  end if;
  if v_status <> 'visible' then
    raise exception 'this review is not currently visible' using errcode = '23514';
  end if;

  insert into public.lab_location_review_reports (organisation_id, review_id, reporter_id, reason)
  values (v_org, p_review_id, v_uid, btrim(p_reason))
  on conflict (review_id, reporter_id) do nothing;
end;
$$;

revoke all on function public.report_lab_location_review(uuid, text) from public, anon;
grant execute on function public.report_lab_location_review(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- list_lab_location_reviews: the public, identity-free directory read.
-- Rating/comment/created_at only — never patient_id — so browsing the
-- directory never exposes which patient had which test at which branch,
-- even though the underlying table's own SELECT policy is patient/staff-only.
-- SECURITY DEFINER is what makes that split possible: it composes rows the
-- caller could not read directly, deliberately, the same shape as
-- list_lab_test_locations's own comment already documents for this file.
--
-- Deliberately NOT filtered by organisation_id, here or in
-- list_lab_test_locations' rating aggregate below: a lab_provider_locations
-- branch is platform-wide catalog data (lab_providers/lab_provider_locations
-- themselves carry no organisation_id at all, by design), not a
-- multi-tenant record, so its reputation is a fact about the physical place
-- shared across every organisation on the platform -- the same reason a
-- Google Maps rating for a clinic isn't scoped per referring employer.
-- organisation_id still lives on lab_location_reviews itself (per the
-- platform convention that every patient-linked table carries it), and
-- still gates the raw table's own patient/staff SELECT policy above, so a
-- staff member's moderation view stays scoped to their own org's patients
-- — only this anonymised, identity-free aggregate read is intentionally
-- pooled across all of them.
-- ---------------------------------------------------------------------------
create function public.list_lab_location_reviews(p_location_id uuid, p_limit integer default 20)
returns table (id uuid, rating smallint, comment text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.rating, r.comment, r.created_at
  from public.lab_location_reviews r
  where r.location_id = p_location_id
    and r.status = 'visible'
  order by r.created_at desc
  limit least(coalesce(p_limit, 20), 50);
$$;

revoke all on function public.list_lab_location_reviews(uuid, integer) from public, anon;
grant execute on function public.list_lab_location_reviews(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- list_lab_test_locations gains avg_rating/review_count so the booking
-- flow's location picker can surface it directly rather than a second round
-- trip. DROP+CREATE because RETURNS TABLE's column list is changing — this
-- RPC has zero live callers in apps/web (confirmed before writing this
-- migration), so there is no call-site signature to update alongside it.
-- ---------------------------------------------------------------------------
drop function if exists public.list_lab_test_locations(text, text);

create function public.list_lab_test_locations(
  p_test_code text default null,
  p_state     text default null
)
returns table (
  provider_id        uuid,
  provider_name      text,
  integration_status public.lab_integration_status,
  accreditation      text,
  location_id        uuid,
  location_name      text,
  location_state     text,
  location_address   text,
  contact_phone      text,
  opening_hours      jsonb,
  capabilities       text[],
  turnaround_hours   integer,
  price_kobo         bigint,
  avg_rating         numeric,
  review_count       integer
)
language sql
stable
security definer
set search_path = ''
as $$
  -- Both joins below are LATERAL, deliberately: a plain (non-lateral) join
  -- of lab_tests here, filtered only by provider_id/is_active with the
  -- test-code check folded into the join condition, still matches EVERY
  -- active test row for a provider whenever p_test_code is null (the
  -- condition is then just `true`) -- fanning each location out once per
  -- active lab_tests row that provider has (dozens, once the screening-
  -- ladder catalogues are counted). This RPC had zero real callers before
  -- this migration, so that fan-out was latent and harmless; the patient-
  -- facing directory/picker this migration adds are the first callers that
  -- pass no test code at all, which would otherwise render the same branch
  -- card/option many times over. LATERAL + LIMIT 1 caps each side to at
  -- most one row per location regardless of how many tests/reviews exist.
  select
    lp.id, lp.name, lp.integration_status, lp.accreditation,
    lpl.id, lpl.name, lpl.state, lpl.address, lpl.contact_phone,
    lpl.opening_hours, lpl.capabilities,
    lt.turnaround_hours, lt.price_kobo,
    rv.avg_rating, coalesce(rv.review_count, 0)
  from public.lab_providers lp
  join public.lab_provider_locations lpl on lpl.lab_provider_id = lp.id and lpl.is_active
  left join lateral (
    select lt2.id, lt2.turnaround_hours, lt2.price_kobo
    from public.lab_tests lt2
    where lt2.provider_id = lp.id
      and lt2.is_active
      and lt2.code = p_test_code
    limit 1
  ) lt on p_test_code is not null
  left join lateral (
    select round(avg(r.rating), 1) as avg_rating, count(*) as review_count
    from public.lab_location_reviews r
    where r.location_id = lpl.id
      and r.status = 'visible'
  ) rv on true
  where lp.is_active
    and (p_test_code is null or lt.id is not null)
    and (p_state is null or lpl.state = p_state)
  order by lp.name, lpl.state, lpl.name;
$$;

comment on function public.list_lab_test_locations(text, text) is
  '§56.6/§56.7: which active laboratory branches offer a given test (or, with no test code, every active branch), optionally filtered to one state, plus each branch''s aggregate patient rating from visible lab_location_reviews. Backs the booking flow''s location-selection step. Read-only over already-authenticated-readable catalogues.';

revoke all on function public.list_lab_test_locations(text, text) from public, anon;
grant execute on function public.list_lab_test_locations(text, text) to authenticated;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.list_lab_test_locations('hba1c', null);
  if v_count = 0 then
    raise exception 'list_lab_test_locations found no branch offering hba1c, despite an active priced provider';
  end if;

  perform 1 from public.list_lab_test_locations('hba1c', null) t
  where t.avg_rating is null and t.review_count = 0
  limit 1;
  if not found then
    raise exception 'list_lab_test_locations did not return the expected null-rating/zero-count shape for a branch with no reviews yet';
  end if;
end $$;
