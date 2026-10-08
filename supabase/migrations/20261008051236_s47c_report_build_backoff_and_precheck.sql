-- S47 review fix 8: the yearly report build. Nothing signed, nothing applied to production. New migration (the S46 functions it restates were created on the
-- integration branch). Counted first: public.health_reports is created by S46, unapplied, so there are 0 live rows and 0 failures to carry over.
--
--   * A patient whose build keeps failing no longer blocks the others. Failures are recorded (public.health_report_build_failures) and the candidate list puts
--     failed patients behind everyone else, waits longer after each failure (a day, doubling), and gives up after 5 attempts for that year (the attempt count is
--     a technical retry limit, not a clinical value). An operator can clear a row to retry.
--   * The route asks health_report_build_allowed BEFORE it requests an AI draft, so no patient data is sent to a model while the guard is off or the settings are
--     unsigned. The writer still checks everything again (it is the authority); this is the cheap early answer.

create table public.health_report_build_failures (
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  year            integer not null,
  attempts        integer not null default 1 check (attempts >= 1),
  last_attempt_at timestamptz not null default now(),
  last_reason     text not null,
  primary key (patient_id, year)
);
alter table public.health_report_build_failures enable row level security;
revoke all on public.health_report_build_failures from public, anon, authenticated;
grant select, insert, update, delete on public.health_report_build_failures to service_role;
comment on table public.health_report_build_failures is 'S47: one row per patient and year whose yearly report build failed. Read and written by the build route only (service role). No patient or staff policy.';

create function public.record_health_report_build_failure(p_patient uuid, p_year integer, p_reason text) returns integer
language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  insert into public.health_report_build_failures (patient_id, year, attempts, last_reason)
    values (p_patient, p_year, 1, left(coalesce(p_reason, 'unknown'), 200))
    on conflict (patient_id, year) do update set attempts = public.health_report_build_failures.attempts + 1, last_attempt_at = now(), last_reason = excluded.last_reason
    returning attempts into v_n;
  return v_n;
end $$;
revoke all on function public.record_health_report_build_failure(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.record_health_report_build_failure(uuid, integer, text) to service_role;

create or replace function public.health_report_candidates(p_year integer, p_limit integer default 25) returns table (patient_id uuid)
language sql stable security definer set search_path = ''
as $$
  select p.id
    from public.profiles p
    left join public.health_report_build_failures f on f.patient_id = p.id and f.year = p_year
   where p.role = 'patient' and p.is_active and p.organisation_id is not null
     and not exists (select 1 from public.health_reports hr where hr.patient_id = p.id and hr.year = p_year)
     -- a failed patient waits (1 day, then 2, 4, 8) and is dropped after 5 attempts, so one bad record cannot hold a slot for ever
     and (f.patient_id is null or (f.attempts < 5 and f.last_attempt_at < now() - (interval '1 day' * power(2, f.attempts - 1))))
     and (exists (select 1 from public.lab_results r where r.patient_id = p.id and r.release_state = 'released'
                    and r.released_at >= make_timestamptz(p_year, 1, 1, 0, 0, 0, 'Africa/Lagos') and r.released_at < make_timestamptz(p_year + 1, 1, 1, 0, 0, 0, 'Africa/Lagos'))
          or exists (select 1 from public.vitals_readings v where v.patient_id = p.id and v.vital_type = 'blood_pressure'
                    and v.taken_at >= make_timestamptz(p_year, 1, 1, 0, 0, 0, 'Africa/Lagos') and v.taken_at < make_timestamptz(p_year + 1, 1, 1, 0, 0, 0, 'Africa/Lagos')))
   order by coalesce(f.attempts, 0), p.created_at
   limit least(greatest(coalesce(p_limit, 25), 1), 100)
$$;
revoke all on function public.health_report_candidates(integer, integer) from public, anon, authenticated;
grant execute on function public.health_report_candidates(integer, integer) to service_role;

-- The early answer: 'ok', or the reason the writer would refuse. Mirrors the writer's first three checks; the writer stays the authority.
create function public.health_report_build_allowed(p_patient uuid, p_year integer) returns text
language plpgsql stable security definer set search_path = ''
as $$
declare v_test boolean;
begin
  select is_test into v_test from public.profiles where id = p_patient and role = 'patient';
  if not found then return 'patient_not_found'; end if;
  if not private.go_live_open_patient('health_report_generation_enabled', p_patient) then return 'guard_off'; end if;
  if not exists (select 1 from public.health_report_config_versions where is_active and approved_by is not null)
     and not (coalesce(v_test, false) and exists (select 1 from public.health_report_config_versions)) then return 'settings_unsigned'; end if;
  if exists (select 1 from public.health_reports where patient_id = p_patient and year = p_year and status = 'pending_signature') then return 'draft_waiting'; end if;
  return 'ok';
end $$;
revoke all on function public.health_report_build_allowed(uuid, integer) from public, anon, authenticated;
grant execute on function public.health_report_build_allowed(uuid, integer) to service_role;

do $$
begin
  if has_table_privilege('authenticated', 'public.health_report_build_failures', 'SELECT') or has_table_privilege('anon', 'public.health_report_build_failures', 'SELECT') then
    raise exception 'S47c: failures table readable by a client role';
  end if;
  if has_function_privilege('authenticated', 'public.health_report_build_allowed(uuid,integer)', 'EXECUTE') or has_function_privilege('anon', 'public.record_health_report_build_failure(uuid,integer,text)', 'EXECUTE') then
    raise exception 'S47c: a build function is reachable by a client role';
  end if;
end $$;
