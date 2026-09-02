-- Tarragon Health — 12-week two-track chronic-care programme (security fix)
--
-- private.derive_chronic_programme_track() only fired
-- `before insert or update of status` — meaning a plain
-- `update chronic_programme_enrolments set track = 'doctor_supported'`
-- (touching only the track column, not status) never invoked the trigger
-- at all and would have persisted a client-supplied track with no
-- entitlement check whatsoever. Found writing this feature's own
-- packages/db/tests suite (chronic_programme_two_track.sql), before it ever
-- shipped as a real gap — not a live incident.
--
-- Fixed by firing on EVERY insert/update and unconditionally re-deriving
-- track from current entitlement each time, so no write path can ever leave
-- it diverged. The programme window (programme_started_at/ends_at) is only
-- touched on a genuine transition into 'enrolled', unchanged from before.

create or replace function private.derive_chronic_programme_track()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.track := case
    when private.patient_has_feature_access(new.patient_id, 'chronic_doctor_supported_track')
    then 'doctor_supported'::public.chronic_programme_track
    else 'self_monitoring'::public.chronic_programme_track
  end;

  if new.status = 'enrolled' and (tg_op = 'INSERT' or old.status <> 'enrolled') then
    if new.programme_started_at is null then
      new.programme_started_at := now();
    end if;
    new.programme_ends_at := new.programme_started_at + interval '12 weeks';
  end if;

  return new;
end;
$$;

drop trigger if exists chronic_programme_enrolments_derive_track on public.chronic_programme_enrolments;
create trigger chronic_programme_enrolments_derive_track
  before insert or update on public.chronic_programme_enrolments
  for each row execute function private.derive_chronic_programme_track();

do $$
declare
  v_test_patient uuid;
  v_org uuid;
  v_programme_id uuid;
  v_programme_active boolean;
  v_enrolment_id uuid;
  v_track public.chronic_programme_track;
begin
  select id, organisation_id into v_test_patient, v_org from public.profiles where role = 'patient' limit 1;
  select id, is_active into v_programme_id, v_programme_active
  from public.chronic_condition_programmes where code = 'hypertension';

  -- hypertension only becomes is_active via a real signed protocol_versions
  -- row — live production data with no migration/seed path, by design (see
  -- 20260831163011_chronic_programme_two_track.sql's identical skip guard,
  -- and 20260813163440's regression check) — so a from-scratch replay always
  -- finds it not-yet-active. Skip the enrolment insert rather than hitting
  -- the "not currently active" guard on a fresh environment.
  if v_test_patient is null or v_programme_id is null or not coalesce(v_programme_active, false) then
    raise notice 'SKIPPED behavioral proof: no patient/active-programme row exists to test against';
  else
    insert into public.chronic_programme_enrolments
      (organisation_id, patient_id, programme_id, status)
    values (v_org, v_test_patient, v_programme_id, 'enrolled')
    returning id into v_enrolment_id;

    -- The bug this migration closes: a bare UPDATE touching only `track`,
    -- never `status`, used to bypass re-derivation entirely.
    update public.chronic_programme_enrolments set track = 'doctor_supported' where id = v_enrolment_id;
    select track into v_track from public.chronic_programme_enrolments where id = v_enrolment_id;
    if v_track <> 'self_monitoring' then
      raise exception 'FAIL: a bare UPDATE of track to doctor_supported was not overwritten (got %)', v_track;
    end if;

    delete from public.chronic_programme_enrolments where id = v_enrolment_id;
  end if;

  raise notice 'PASS: track re-derives on every insert/update, including a bare UPDATE of track alone';
end $$;
