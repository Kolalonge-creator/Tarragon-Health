-- Tarragon Health — Patient Identity & MPI gap analysis (docs/PATIENT_IDENTITY_MPI_SPEC.md §82.6)
-- Duplicate-patient detection. Confirmed a total gap before this migration (no migration, RPC, or
-- UI referenced duplicate patient records anywhere). This is deliberately a FLAG-only feature —
-- it never merges anything itself; see 20260830113247_patient_record_merge.sql for the separate,
-- explicit merge step an admin takes after reviewing a flagged pair.
--
-- Match signal: name similarity (pg_trgm, so "Kola Longe" / "Kola A Longe" / "K. Longe" — the
-- exact §82.1 example — actually score similarly) plus exact matches on phone/email/date of birth.
-- A phone or email match counts for more than name similarity alone, on the reasoning that two
-- unrelated people share a common Nigerian name far more easily than a phone number or email.
-- Scoped to same-organisation pairs only for this first pass (matching
-- merge_patient_records' same-org default) — cross-org duplicate detection is a real but separate
-- question this migration doesn't attempt.
--
-- Persisted, not recomputed-and-shown fresh each time: `patient_duplicate_flags` remembers an
-- admin's dismissal (status='dismissed') so a real false positive doesn't get re-surfaced every
-- sweep — the sweep's ON CONFLICT only touches rows still 'open'.

create extension if not exists pg_trgm with schema extensions;

create type public.patient_duplicate_flag_status as enum ('open', 'dismissed', 'merged');

create table public.patient_duplicate_flags (
  id             uuid primary key default gen_random_uuid(),
  profile_id_a   uuid not null references public.profiles (id) on delete cascade,
  profile_id_b   uuid not null references public.profiles (id) on delete cascade,
  confidence     numeric not null,
  reasons        jsonb not null default '{}'::jsonb,
  status         public.patient_duplicate_flag_status not null default 'open',
  reviewed_by    uuid references public.profiles (id) on delete set null,
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint patient_duplicate_flags_ordered check (profile_id_a < profile_id_b),
  constraint patient_duplicate_flags_confidence_range check (confidence >= 0 and confidence <= 1),
  unique (profile_id_a, profile_id_b)
);

create index patient_duplicate_flags_status_idx on public.patient_duplicate_flags (status, confidence desc);

create trigger patient_duplicate_flags_set_updated_at
  before update on public.patient_duplicate_flags
  for each row execute function private.set_updated_at();

alter table public.patient_duplicate_flags enable row level security;

create policy patient_duplicate_flags_select on public.patient_duplicate_flags
  for select to authenticated
  using (private.has_permission('patients.duplicates.review'));

create policy patient_duplicate_flags_update on public.patient_duplicate_flags
  for update to authenticated
  using (private.has_permission('patients.duplicates.review'))
  with check (private.has_permission('patients.duplicates.review'));

-- No insert/delete policy for authenticated — flags are only ever created by the sweep function
-- (SECURITY DEFINER) and status-transitioned via update (dismiss) or by the merge function
-- (marks 'merged' — see below).
grant select, update on public.patient_duplicate_flags to authenticated;

create or replace function private.sweep_duplicate_patient_candidates()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_confidence numeric;
  v_reasons jsonb;
begin
  for r in
    select
      a.id as a_id,
      b.id as b_id,
      extensions.similarity(lower(coalesce(a.full_name, '')), lower(coalesce(b.full_name, ''))) as name_sim,
      (a.date_of_birth is not null and a.date_of_birth = b.date_of_birth) as same_dob,
      (a.phone is not null and a.phone = b.phone) as same_phone,
      (ua.email is not null and lower(ua.email) = lower(ub.email)) as same_email
    from public.profiles a
    join public.profiles b
      on b.id > a.id
      and b.role = 'patient'
      and b.merged_into_profile_id is null
      and b.organisation_id is not distinct from a.organisation_id
    join auth.users ua on ua.id = a.id
    left join auth.users ub on ub.id = b.id
    where a.role = 'patient'
      and a.merged_into_profile_id is null
      and (
        extensions.similarity(lower(coalesce(a.full_name, '')), lower(coalesce(b.full_name, ''))) > 0.35
        or (a.phone is not null and a.phone = b.phone)
        or (ua.email is not null and ub.email is not null and lower(ua.email) = lower(ub.email))
        or (
          a.date_of_birth is not null and a.date_of_birth = b.date_of_birth
          and a.full_name is not null and b.full_name is not null
          and extensions.similarity(lower(a.full_name), lower(b.full_name)) > 0.15
        )
      )
  loop
    v_reasons := jsonb_build_object(
      'name_similarity', round(r.name_sim::numeric, 2),
      'same_date_of_birth', r.same_dob,
      'same_phone', r.same_phone,
      'same_email', r.same_email
    );

    v_confidence := least(1.0,
      (case when r.same_phone then 0.45 else 0 end)
      + (case when r.same_email then 0.45 else 0 end)
      + (case when r.same_dob then 0.2 else 0 end)
      + (coalesce(r.name_sim, 0) * 0.4)
    );

    if v_confidence < 0.3 then
      continue;
    end if;

    insert into public.patient_duplicate_flags (profile_id_a, profile_id_b, confidence, reasons)
    values (r.a_id, r.b_id, v_confidence, v_reasons)
    on conflict (profile_id_a, profile_id_b) do update
      set confidence = excluded.confidence, reasons = excluded.reasons
      where public.patient_duplicate_flags.status = 'open';
  end loop;
end;
$$;

revoke all on function private.sweep_duplicate_patient_candidates() from public;

-- Client-facing "run now" wrapper for the admin duplicates page, gated the same way the merge
-- function is gated (permission check lives inside, not just in the grant).
create or replace function public.admin_run_duplicate_patient_sweep()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_permission('patients.duplicates.review') then
    raise exception 'Not authorised to run the duplicate-patient sweep' using errcode = '42501';
  end if;
  perform private.sweep_duplicate_patient_candidates();
end;
$$;

revoke all on function public.admin_run_duplicate_patient_sweep() from public;
revoke execute on function public.admin_run_duplicate_patient_sweep() from anon;
grant execute on function public.admin_run_duplicate_patient_sweep() to authenticated;

select cron.schedule(
  'patient-duplicate-sweep',
  '0 5 * * *',
  $$select private.sweep_duplicate_patient_candidates()$$
);

-- Proof, not hope.
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'patient_duplicate_flags'
  ) then
    raise exception 'FAIL: patient_duplicate_flags table missing';
  end if;

  if not exists (select 1 from cron.job where jobname = 'patient-duplicate-sweep') then
    raise exception 'FAIL: patient-duplicate-sweep cron job was not scheduled';
  end if;

  if has_function_privilege('anon', 'public.admin_run_duplicate_patient_sweep()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute public.admin_run_duplicate_patient_sweep';
  end if;

  raise notice 'PASS: patient_duplicate_flags + sweep function + cron job all in place';
end $$;
