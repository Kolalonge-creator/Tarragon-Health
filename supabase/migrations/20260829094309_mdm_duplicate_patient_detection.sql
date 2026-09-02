-- Tarragon Health — Health Data Architecture & MDM (spec §34.4)
-- Duplicate patient detection: candidates only, reviewed safely, never
-- auto-merged.

create type public.patient_match_status as enum (
  'pending',
  'confirmed_duplicate',
  'confirmed_different',
  'merged'
);

create table public.patient_match_candidates (
  id             uuid primary key default gen_random_uuid(),
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

create index if not exists profiles_phone_patient_idx
  on public.profiles (phone) where role = 'patient' and phone is not null;
create index if not exists profiles_dob_patient_idx
  on public.profiles (date_of_birth) where role = 'patient' and date_of_birth is not null;
create index if not exists profiles_full_name_trgm_idx
  on public.profiles using gin (full_name extensions.gin_trgm_ops) where role = 'patient';

create or replace function private.detect_patient_match_candidates()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
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
  'Admin-gated entry point for the §34.4 duplicate-patient detector. Safe to call repeatedly.';

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
  'Records an admin''s review decision on a duplicate-patient candidate (confirmed_duplicate / confirmed_different / merged). Deliberately does not perform any merge.';

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
