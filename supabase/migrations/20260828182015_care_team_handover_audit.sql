-- Tarragon Health — care team handover (Care Team / Provider Workspace §5.15:
-- "clinicians should be able to securely hand over or collaborate... each
-- participant sees only what they need").
--
-- Scoped deliberately narrow, and two things the spec's literal wording
-- suggests are NOT attempted here, for reasons worth recording:
--
--   * "Each participant sees only what they need" for the internal team
--     (doctor / clinical director / care coordinator) is NOT scoped-by-
--     assignment here. private.is_org_staff's broad, org-wide read access is
--     a deliberate design choice (clinician/patients/page.tsx's own header
--     comment: "every org-staff account can still see the whole roster
--     (cross-coverage)") — shift-based staffing needs any covering doctor to
--     reach any patient. Narrowing that to "only your assigned patients" would
--     be a platform-wide access-model change, not a workspace feature, and
--     is out of scope for this session to make unilaterally.
--   * A Specialist role/portal is NOT built. docs/Tarragon_Health_Master_
--     Operating_Plan_v4.md's Phase 2/3 list (surfaced in CLAUDE.md's Clinical
--     Tier Ladder section) explicitly names "full specialist-matching engine"
--     as something not to build functional code for without an explicit
--     ask — and specialist_referrals has no column linking a referral to a
--     specific specialist's own Tarragon account at all, so a scoped
--     specialist view would mean building that account/matching model from
--     nothing, squarely the thing the guardrail exists to prevent.
--
-- What IS real and safe to build: care_team_assignment already models a
-- three-person named team per patient (clinician_id, clinical_director_id,
-- care_coordinator_id, added across 20260712201000 and 20260723010024) and
-- the Pharmacist role (20260716178000) already demonstrates genuine
-- scoped-to-what-they-need access for an external collaborator. What was
-- missing: reassigning who holds a team role left no record of *why*, or
-- that a deliberate handover — not just an administrative correction —
-- happened. This adds that audit trail plus an explicit, note-carrying
-- handover action.

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

-- Insert only via hand_over_care below (SECURITY DEFINER) or the automatic
-- trigger on care_team_assignment — no direct client insert path, so a
-- handover record can't be fabricated after the fact with an invented note.
grant select on public.care_team_handovers to authenticated;

-- ---------------------------------------------------------------------------
-- Explicit handover with a reason — the one path that gets a real note
-- attached, atomically with the reassignment. Defined before the trigger
-- below since the trigger reads the session-local GUC this sets.
-- ---------------------------------------------------------------------------
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

  -- Session-local so the trigger above records this call's own note rather
  -- than leaving it null the way an ordinary CareTeamForm upsert would.
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

-- ---------------------------------------------------------------------------
-- Automatic trail: ANY change to who holds clinician_id/care_coordinator_id
-- (via the plain CareTeamForm upsert, hand_over_care, or anything else) gets
-- logged. Picks up the session-local note when hand_over_care set one
-- (immediately above), then clears it so it never bleeds into an unrelated
-- later update in the same session — otherwise a plain CareTeamForm
-- reassignment made right after a hand_over_care call in the same session
-- would wrongly inherit that call's note.
-- ---------------------------------------------------------------------------
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

revoke all on function public.hand_over_care(uuid, text, uuid, text) from public, anon;
grant execute on function public.hand_over_care(uuid, text, uuid, text) to authenticated;
revoke execute on function public.hand_over_care(uuid, text, uuid, text) from anon;

-- ---------------------------------------------------------------------------
-- Proof, not hope.
-- ---------------------------------------------------------------------------
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
