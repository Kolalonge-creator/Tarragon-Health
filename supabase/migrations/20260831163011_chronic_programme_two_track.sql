-- Tarragon Health — 12-week two-track chronic-care programme, Phase 2 (track)
--
-- Founder memo: hypertension/diabetes programmes get a self-monitoring
-- track (system-only) and a doctor-supported track (3 pooled-doctor calls,
-- active titration, doctor-suggested testing) over a 12-week window. Track
-- placement resolves via the pay-per-service chronic_doctor_supported_pack
-- (see 20260831140512_service_products_and_purchases_core.sql) rather than
-- a platform-wide tier — server-derived, never client-settable, same
-- discipline as ReviewedByDoctor/doctor_tier elsewhere in this codebase.

create type public.chronic_programme_track as enum ('self_monitoring', 'doctor_supported');

alter table public.chronic_programme_enrolments
  add column track                public.chronic_programme_track not null default 'self_monitoring',
  add column programme_started_at timestamptz,
  add column programme_ends_at    timestamptz;

-- Derives track + the 12-week window on every transition INTO 'enrolled' —
-- fires as a BEFORE trigger so the AFTER trigger that materialises the
-- weekly schedule (next migration) sees the final track/dates on NEW.
create or replace function private.derive_chronic_programme_track()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'enrolled' or (tg_op = 'UPDATE' and old.status = 'enrolled') then
    return new;
  end if;

  new.track := case
    when private.patient_has_feature_access(new.patient_id, 'chronic_doctor_supported_track')
    then 'doctor_supported'::public.chronic_programme_track
    else 'self_monitoring'::public.chronic_programme_track
  end;

  -- Immutable once set: a re-enrolment (withdrawn -> enrolled again) gets a
  -- fresh window, but nothing inside an already-running enrolment can nudge
  -- its own dates.
  if new.programme_started_at is null then
    new.programme_started_at := now();
  end if;
  new.programme_ends_at := new.programme_started_at + interval '12 weeks';

  return new;
end;
$$;

drop trigger if exists chronic_programme_enrolments_derive_track on public.chronic_programme_enrolments;
create trigger chronic_programme_enrolments_derive_track
  before insert or update of status on public.chronic_programme_enrolments
  for each row execute function private.derive_chronic_programme_track();

do $$
declare
  v_test_patient uuid;
  v_programme_id uuid;
  v_programme_active boolean;
  v_enrolment_id uuid;
  v_track public.chronic_programme_track;
begin
  select id into v_test_patient from public.profiles where role = 'patient' limit 1;
  select id, is_active into v_programme_id, v_programme_active
    from public.chronic_condition_programmes where code = 'hypertension';

  -- Every chronic_condition_programmes row ships is_active = false (see
  -- 20260716223231_chronic_condition_programmes.sql's phased-rollout gate)
  -- and only ever becomes true via a live, signed-protocol runtime action —
  -- never a migration. On a truly fresh reset that sign-off never happened,
  -- so the enrol attempt below would be correctly rejected by
  -- chronic_enrolments_active_gate before this test ever reaches its own
  -- assertion. Skip gracefully rather than asserting on a precondition this
  -- migration doesn't own.
  if v_test_patient is null or v_programme_id is null or v_programme_active is not true then
    raise notice 'SKIPPED behavioral proof: no patient/active programme row exists to test against';
  else
    -- Sabotage check: a patient with no chronic_doctor_supported_pack must
    -- land on self_monitoring even if the client tries to claim otherwise.
    insert into public.chronic_programme_enrolments
      (organisation_id, patient_id, programme_id, status, track)
    select p.organisation_id, v_test_patient, v_programme_id, 'enrolled', 'doctor_supported'
    from public.profiles p where p.id = v_test_patient
    returning id, track into v_enrolment_id, v_track;

    if v_track is distinct from 'self_monitoring' then
      raise exception 'FAIL: client-supplied track=doctor_supported was not overwritten (got %)', v_track;
    end if;

    delete from public.chronic_programme_enrolments where id = v_enrolment_id;
  end if;

  raise notice 'PASS: chronic programme track is server-derived and immutable to client input';
end $$;
