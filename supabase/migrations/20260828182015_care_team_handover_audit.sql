-- Tarragon Health — care team handover (Care Team / Provider Workspace
-- §5.15). Committed to git but never actually applied to production —
-- found and fixed alongside the other four same-day Care Team / Provider
-- Workspace migrations. Content below is byte-identical to the committed
-- 20260827210136_care_team_handover_audit.sql.

create table if not exists public.care_team_handovers (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  role            text not null check (role in ('clinician', 'care_coordinator')),
  from_profile_id uuid references public.profiles (id) on delete set null,
  to_profile_id   uuid references public.profiles (id) on delete set null,
  note            text,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint care_team_handovers_note_length check (char_length(note) <= 1000)
);

create index if not exists care_team_handovers_patient_idx
  on public.care_team_handovers (patient_id, created_at desc);

alter table public.care_team_handovers enable row level security;

drop policy if exists care_team_handovers_select on public.care_team_handovers;
create policy care_team_handovers_select on public.care_team_handovers
  for select to authenticated
  using (private.is_org_staff(organisation_id));

grant select on public.care_team_handovers to authenticated;

create or replace function public.hand_over_care(
  p_patient_id uuid,
  p_role text,
  p_new_profile_id uuid,
  p_note text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if p_role not in ('clinician', 'care_coordinator') then
    raise exception 'role must be clinician or care_coordinator' using errcode = '22023';
  end if;

  select organisation_id into v_org from public.profiles where id = p_patient_id;
  if v_org is null or not private.is_org_staff(v_org) then
    raise exception 'not authorised';
  end if;

  perform set_config('app.care_team_handover_note', coalesce(p_note, ''), true);

  if p_role = 'clinician' then
    update public.care_team_assignment set clinician_id = p_new_profile_id where patient_id = p_patient_id;
  else
    update public.care_team_assignment set care_coordinator_id = p_new_profile_id where patient_id = p_patient_id;
  end if;

  if not found then
    raise exception 'No care team assignment exists yet for this patient — assign a doctor first';
  end if;
end;
$$;

create or replace function private.log_care_team_handover()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(current_setting('app.care_team_handover_note', true), '');
begin
  if old.clinician_id is distinct from new.clinician_id then
    insert into public.care_team_handovers
      (organisation_id, patient_id, role, from_profile_id, to_profile_id, note, created_by)
    values (new.organisation_id, new.patient_id, 'clinician', old.clinician_id, new.clinician_id, v_note, (select auth.uid()));
  end if;

  if old.care_coordinator_id is distinct from new.care_coordinator_id then
    insert into public.care_team_handovers
      (organisation_id, patient_id, role, from_profile_id, to_profile_id, note, created_by)
    values (new.organisation_id, new.patient_id, 'care_coordinator', old.care_coordinator_id, new.care_coordinator_id, v_note, (select auth.uid()));
  end if;

  perform set_config('app.care_team_handover_note', '', true);
  return new;
end;
$$;

drop trigger if exists care_team_assignment_log_handover on public.care_team_assignment;
create trigger care_team_assignment_log_handover
  after update on public.care_team_assignment
  for each row execute function private.log_care_team_handover();

comment on function public.hand_over_care(uuid, text, uuid, text) is
  'Reassigns a care team role (clinician or care_coordinator) and records why, atomically. '
  'See 20260827210136_care_team_handover_audit.sql. The plain CareTeamForm upsert path still '
  'works and still gets logged — just without a note.';

revoke all on function public.hand_over_care(uuid, text, uuid, text) from public;
grant execute on function public.hand_over_care(uuid, text, uuid, text) to authenticated;
revoke execute on function public.hand_over_care(uuid, text, uuid, text) from anon;

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'care_team_handovers'
  ) then
    raise exception 'care_team_handovers table was not created';
  end if;
  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    where c.relname = 'care_team_assignment' and tg.tgname = 'care_team_assignment_log_handover'
      and not tg.tgisinternal
  ) then
    raise exception 'care_team_assignment_log_handover trigger was not created';
  end if;
  if has_function_privilege('anon', 'public.hand_over_care(uuid, text, uuid, text)', 'EXECUTE') then
    raise exception 'hand_over_care is EXECUTE-able by anon — ACL did not land as intended';
  end if;
  if not has_function_privilege('authenticated', 'public.hand_over_care(uuid, text, uuid, text)', 'EXECUTE') then
    raise exception 'hand_over_care is NOT EXECUTE-able by authenticated — grant failed';
  end if;
end $$;
