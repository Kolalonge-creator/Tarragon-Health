-- Tarragon Health
-- Data Architecture Gaps Build Plan §2 Phase 2 (docs/DATA_ARCHITECTURE_GAPS_BUILD_PLAN.md),
-- scoped down from the doc's original description. The doc describes Phase 2
-- as migrating clinical_encounter_notes's three link columns
-- (video_consultation_id/async_consult_id/escalation_id) to reference
-- clinical_encounters.id INSTEAD OF the three individual FKs. Checked before
-- writing this: apps/web/src/lib/queries/consultation-video.ts and
-- encounter-notes.ts both read/write those three columns directly (e.g.
-- `.eq("video_consultation_id", consultationId)` in the live video-consult
-- flow) -- replacing them outright is real app-layer surgery across a
-- sensitive path, not a pure DB migration, and wasn't attempted here.
--
-- What this migration actually does: ADDS clinical_encounter_id alongside
-- the existing three columns (none of which are touched, renamed, or
-- removed), backfilled from the existing clinical_encounters rows by
-- matching (source_table, source_id) against whichever of the three link
-- columns is set, and kept current by a trigger for new/updated notes. This
-- is the safe, additive half of the Phase 2 consolidation -- a future pass
-- can retire the three original columns once the two app query sites above
-- are migrated to read clinical_encounter_id instead, but that's real
-- app-code work, not assumed done here.

alter table public.clinical_encounter_notes
  add column clinical_encounter_id uuid references public.clinical_encounters (id) on delete set null;

comment on column public.clinical_encounter_notes.clinical_encounter_id is
  'Points at the same encounter public.clinical_encounters already summarises for this note''s video_consultation_id/async_consult_id/escalation_id (exactly one of which is normally set). Additive alongside those three columns, not a replacement for them yet -- see this column''s introducing migration header for why.';

create index clinical_encounter_notes_clinical_encounter_idx
  on public.clinical_encounter_notes (clinical_encounter_id)
  where clinical_encounter_id is not null;

create or replace function private.sync_clinical_encounter_note_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.clinical_encounter_id := (
    select id from public.clinical_encounters
    where (source_table, source_id) = (
      case
        when new.video_consultation_id is not null then row('video_consultations', new.video_consultation_id)
        when new.escalation_id is not null then row('escalations', new.escalation_id)
        when new.async_consult_id is not null then row('async_consults', new.async_consult_id)
        else null
      end
    )
    limit 1
  );
  return new;
end;
$$;

comment on function private.sync_clinical_encounter_note_link() is
  'Resolves clinical_encounter_notes.clinical_encounter_id from whichever of video_consultation_id/async_consult_id/escalation_id is set, by matching public.clinical_encounters (source_table, source_id). Read-derived, never client-supplied.';

revoke all on function private.sync_clinical_encounter_note_link() from public;

create trigger clinical_encounter_notes_sync_encounter_link
  before insert or update of video_consultation_id, escalation_id, async_consult_id
  on public.clinical_encounter_notes
  for each row execute function private.sync_clinical_encounter_note_link();

-- Backfill existing rows (matches the trigger's own resolution logic). The
-- attribution trigger fires on ANY update to this table (no column list,
-- unlike the new sync trigger above) and requires an active clinical-tier
-- caller resolved from auth.uid() -- which a migration has none of. This is
-- system bookkeeping (deriving a value from data that already exists), not
-- a clinical act, so it's exempted the same way a backfill would be for any
-- other attribution-gated table: disable, backfill, re-enable.
alter table public.clinical_encounter_notes disable trigger clinical_encounter_notes_enforce_attribution;

update public.clinical_encounter_notes n
set clinical_encounter_id = ce.id
from public.clinical_encounters ce
where n.clinical_encounter_id is null
  and (
    (n.video_consultation_id is not null and ce.source_table = 'video_consultations' and ce.source_id = n.video_consultation_id)
    or (n.escalation_id is not null and ce.source_table = 'escalations' and ce.source_id = n.escalation_id)
    or (n.async_consult_id is not null and ce.source_table = 'async_consults' and ce.source_id = n.async_consult_id)
  );

alter table public.clinical_encounter_notes enable trigger clinical_encounter_notes_enforce_attribution;

do $$
declare
  v_linked bigint;
  v_linkable bigint;
begin
  select count(*) into v_linkable
  from public.clinical_encounter_notes
  where video_consultation_id is not null or escalation_id is not null or async_consult_id is not null;

  select count(*) into v_linked
  from public.clinical_encounter_notes
  where clinical_encounter_id is not null;

  if v_linked <> v_linkable then
    raise exception 'clinical_encounter_notes backfill mismatch: % notes have a video_consultation_id/escalation_id/async_consult_id set but only % got a clinical_encounter_id -- a clinical_encounters row is missing for one of them', v_linkable, v_linked;
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.clinical_encounter_notes'::regclass
      and tgname = 'clinical_encounter_notes_sync_encounter_link'
      and not tgisinternal
  ) then
    raise exception 'clinical_encounter_notes_sync_encounter_link trigger missing';
  end if;

  raise notice 'PASS: clinical_encounter_notes.clinical_encounter_id added, % existing notes backfilled, trigger keeps it current for new/updated notes', v_linked;
end $$;
