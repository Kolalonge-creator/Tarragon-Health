-- Tarragon Health — Health Data Architecture & MDM (spec §34.4)
-- Duplicate patient detection: candidates only, reviewed safely, never
-- auto-merged ("Potential matches should be reviewed safely rather than
-- automatically merged without appropriate controls.").
--
-- MATCHING STRATEGY — blocked, not a full cross join
-- With one Tarragon Patient ID per person as the platform's stated goal
-- (§34.2/§34.3), comparing every patient row against every other row is
-- the naive approach and does not scale (O(n^2)). Instead this uses three
-- BLOCKING keys — phone exact match, date_of_birth exact match (further
-- scored by name similarity), and email exact match (via auth.users,
-- since email lives there, not on public.profiles — the same access
-- pattern already used by 20260720120004_prescription_lab_order_patient_
-- emails.sql) — each an indexed equality join, so the expensive part
-- (trigram name similarity) only ever runs WITHIN an already-small block
-- of patients who already share a DOB, never across the whole table.
--
-- WHAT THIS DOES NOT DO
-- No automatic merge, ever. A candidate row is a SUGGESTION with a score
-- and the fields that matched; a human (admin) reviews it via
-- review_patient_match_candidate() and records confirmed_duplicate,
-- confirmed_different, or merged — the actual merge mechanics (which
-- record wins on conflicting fields, what happens to the losing profile's
-- history) are deliberately NOT built here: that is a materially bigger,
-- higher-risk piece of work (reassigning FKs across ~110 patient-scoped
-- tables) that belongs in its own reviewed migration once a real duplicate
-- is confirmed, not spent up front on a currently-empty candidate table.

create type public.patient_match_status as enum (
  'pending',
  'confirmed_duplicate',
  'confirmed_different',
  'merged'
);

create table public.patient_match_candidates (
  id             uuid primary key default gen_random_uuid(),
  -- Canonical ordering (a < b) makes the pair unique regardless of which
  -- side a detector run finds first, and lets ON CONFLICT dedupe cleanly.
  patient_a_id   uuid not null references public.profiles (id) on delete cascade,
  patient_b_id   uuid not null references public.profiles (id) on delete cascade,
  matched_fields text[] not null,
  score          numeric not null,
  status         public.patient_match_status not null default 'pending',
  reviewed_by    uuid references public.profiles (id) on delete set null,
  reviewed_at    timestamptz,
  review_note    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint patient_match_candidates_ordered_pair check (patient_a_id < patient_b_id),
  constraint patient_match_candidates_score_range check (score >= 0 and score <= 1),
  unique (patient_a_id, patient_b_id)
);

comment on table public.patient_match_candidates is
  'Suggested duplicate-patient pairs (§34.4). Never auto-merged — status is a human review decision only.';

create index patient_match_candidates_status_idx on public.patient_match_candidates (status) where status = 'pending';
create index patient_match_candidates_patient_a_idx on public.patient_match_candidates (patient_a_id);
create index patient_match_candidates_patient_b_idx on public.patient_match_candidates (patient_b_id);

create trigger patient_match_candidates_set_updated_at
  before update on public.patient_match_candidates
  for each row execute function private.set_updated_at();

-- Supporting indexes for the blocking joins below. Partial on role='patient'
-- since staff/admin rows are never duplicate-detection subjects.
create index if not exists profiles_phone_patient_idx
  on public.profiles (phone) where role = 'patient' and phone is not null;
create index if not exists profiles_dob_patient_idx
  on public.profiles (date_of_birth) where role = 'patient' and date_of_birth is not null;
create index if not exists profiles_full_name_trgm_idx
  on public.profiles using gin (full_name extensions.gin_trgm_ops) where role = 'patient';

-- ---------------------------------------------------------------------------
-- Detector. Idempotent: re-running only adds new blocked pairs or widens
-- matched_fields/score on existing PENDING candidates — a decision already
-- recorded (confirmed_duplicate/confirmed_different/merged) is never
-- touched again by a re-run, so a re-run can never silently overwrite a
-- human's review.
-- ---------------------------------------------------------------------------

create or replace function private.detect_patient_match_candidates()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Block 1: exact phone match.
  insert into public.patient_match_candidates (patient_a_id, patient_b_id, matched_fields, score)
  select least(a.id, b.id), greatest(a.id, b.id), array['phone'], 0.90
  from public.profiles a
  join public.profiles b
    on b.phone = a.phone and b.id <> a.id and a.id < b.id and b.role = 'patient'
  where a.role = 'patient' and a.phone is not null
  on conflict (patient_a_id, patient_b_id) do update
    set matched_fields = (select array_agg(distinct x) from unnest(public.patient_match_candidates.matched_fields || excluded.matched_fields) as x),
        score = greatest(public.patient_match_candidates.score, excluded.score),
        updated_at = now()
    where public.patient_match_candidates.status = 'pending';

  -- Block 2: exact date_of_birth match, scored further by full_name
  -- trigram similarity (only computed within this already-narrow block).
  -- The 0.3 threshold was calibrated against real name-variant pairs, not
  -- picked arbitrarily: "John Chukwuemeka Okafor" vs "Jon C. Okafor" (a
  -- realistic nickname + abbreviated-middle-name duplicate) scores 0.37;
  -- two genuinely unrelated Nigerian names score 0.0. 0.3 catches the
  -- former without opening the door to noise from the latter.
  insert into public.patient_match_candidates (patient_a_id, patient_b_id, matched_fields, score)
  select least(a.id, b.id), greatest(a.id, b.id), array['dob', 'name'],
    least(1.0, 0.30 + 0.60 * extensions.similarity(private.normalise_term(a.full_name), private.normalise_term(b.full_name)))
  from public.profiles a
  join public.profiles b
    on b.date_of_birth = a.date_of_birth and b.id <> a.id and a.id < b.id and b.role = 'patient'
  where a.role = 'patient'
    and a.date_of_birth is not null
    and a.full_name is not null and b.full_name is not null
    and extensions.similarity(private.normalise_term(a.full_name), private.normalise_term(b.full_name)) >= 0.3
  on conflict (patient_a_id, patient_b_id) do update
    set matched_fields = (select array_agg(distinct x) from unnest(public.patient_match_candidates.matched_fields || excluded.matched_fields) as x),
        score = greatest(public.patient_match_candidates.score, excluded.score),
        updated_at = now()
    where public.patient_match_candidates.status = 'pending';

  -- Block 3: exact email match. Email lives on auth.users, not
  -- public.profiles — security definer + explicit auth.users read is the
  -- established pattern for this (see migration header).
  insert into public.patient_match_candidates (patient_a_id, patient_b_id, matched_fields, score)
  select least(a.id, b.id), greatest(a.id, b.id), array['email'], 0.90
  from public.profiles a
  join auth.users ua on ua.id = a.id
  join auth.users ub on ub.email = ua.email and ub.id <> ua.id
  join public.profiles b on b.id = ub.id and b.role = 'patient' and a.id < b.id
  where a.role = 'patient' and ua.email is not null
  on conflict (patient_a_id, patient_b_id) do update
    set matched_fields = (select array_agg(distinct x) from unnest(public.patient_match_candidates.matched_fields || excluded.matched_fields) as x),
        score = greatest(public.patient_match_candidates.score, excluded.score),
        updated_at = now()
    where public.patient_match_candidates.status = 'pending';

  return (select count(*)::integer from public.patient_match_candidates where status = 'pending');
end;
$$;

comment on function private.detect_patient_match_candidates is
  'Scans public.profiles (role=patient) for phone/DOB+name/email overlaps and upserts pending patient_match_candidates rows. Returns the total pending count after the run. Never touches an already-reviewed row.';

-- Admin-only public entry point. is_admin() check lives here (not just in
-- RLS) so the function can be called safely even though it runs security
-- definer and would otherwise bypass RLS entirely.
create or replace function public.run_patient_duplicate_detection()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'only an admin may run duplicate-patient detection';
  end if;
  return private.detect_patient_match_candidates();
end;
$$;

comment on function public.run_patient_duplicate_detection is
  'Admin-gated entry point for the §34.4 duplicate-patient detector. Safe to call repeatedly (see detect_patient_match_candidates).';

-- Review workflow — records a human decision, never executes a merge.
create or replace function public.review_patient_match_candidate(
  p_candidate_id uuid,
  p_status public.patient_match_status,
  p_note text default null
)
returns public.patient_match_candidates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.patient_match_candidates;
begin
  if not private.is_admin() then
    raise exception 'only an admin may review a patient match candidate';
  end if;
  if p_status = 'pending' then
    raise exception 'cannot set a review decision back to pending — that is the un-reviewed default, not a decision';
  end if;

  update public.patient_match_candidates
  set status = p_status,
      review_note = p_note,
      reviewed_by = (select auth.uid()),
      reviewed_at = now()
  where id = p_candidate_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'patient_match_candidates row % not found', p_candidate_id;
  end if;

  return v_row;
end;
$$;

comment on function public.review_patient_match_candidate is
  'Records an admin''s review decision on a duplicate-patient candidate (confirmed_duplicate / confirmed_different / merged). Deliberately does not perform any merge — see this migration''s header for why that is out of scope here.';

-- ---------------------------------------------------------------------------
-- RLS — admin-only, both directions. This table names two patients by ID
-- side by side, which is exactly the kind of cross-patient linkage a
-- same-org staff member should not casually see (it is not "my patient's
-- record", it is "here are two people who might be the same person",
-- across potentially different care teams) — so this is intentionally
-- narrower than the usual is_org_staff() shape.
-- ---------------------------------------------------------------------------

alter table public.patient_match_candidates enable row level security;

create policy patient_match_candidates_select on public.patient_match_candidates
  for select to authenticated using (private.is_admin());
create policy patient_match_candidates_insert on public.patient_match_candidates
  for insert to authenticated with check (private.is_admin());
create policy patient_match_candidates_update on public.patient_match_candidates
  for update to authenticated using (private.is_admin()) with check (private.is_admin());
create policy patient_match_candidates_delete on public.patient_match_candidates
  for delete to authenticated using (private.is_admin());

grant select, insert, update, delete on public.patient_match_candidates to authenticated;
revoke all on public.patient_match_candidates from anon;

revoke execute on function public.run_patient_duplicate_detection() from public;
revoke execute on function public.run_patient_duplicate_detection() from anon;
revoke execute on function public.review_patient_match_candidate(uuid, public.patient_match_status, text) from public;
revoke execute on function public.run_patient_duplicate_detection() from public, anon;
revoke execute on function public.review_patient_match_candidate(uuid, public.patient_match_status, text) from public, anon;
grant execute on function public.run_patient_duplicate_detection() to authenticated, service_role;
grant execute on function public.review_patient_match_candidate(uuid, public.patient_match_status, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------

do $$
begin
  if has_function_privilege('anon', 'public.run_patient_duplicate_detection()', 'EXECUTE') then
    raise exception 'FAIL: anon still holds EXECUTE on public.run_patient_duplicate_detection';
  end if;
  if has_table_privilege('anon', 'public.patient_match_candidates', 'SELECT') then
    raise exception 'FAIL: anon still holds SELECT on public.patient_match_candidates';
  end if;
end;
$$;
