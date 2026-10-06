-- S23 step 2: scribe_transcripts table
-- Stores encrypted STT output, linked to consent and encounter.
-- Retention-governed: expires_at set from PROPOSED config (default 90 days).

begin;

create table if not exists public.scribe_transcripts (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations(id) on delete restrict,
  scribe_consent_id   uuid not null references public.scribe_consents(id) on delete restrict,
  encounter_note_id   uuid references public.clinical_encounter_notes(id) on delete restrict,
  segments_encrypted  bytea not null,
  duration_ms         integer not null check (duration_ms >= 0),
  language            text not null check (language in ('en-NG', 'pcm')),
  speaker_count       smallint,
  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null default (now() + interval '90 days')
);

comment on table public.scribe_transcripts is
  'Encrypted STT transcripts for the AI scribe. Retention-governed via expires_at. No patient access ever.';
comment on column public.scribe_transcripts.segments_encrypted is
  'AES-256 encrypted JSON of TranscriptSegment[]. Key from Vault, never in this table.';

-- Indexes
create index scribe_transcripts_consent_idx on public.scribe_transcripts(scribe_consent_id);
create index scribe_transcripts_encounter_idx on public.scribe_transcripts(encounter_note_id) where encounter_note_id is not null;
create index scribe_transcripts_expires_idx on public.scribe_transcripts(expires_at);
create index scribe_transcripts_org_idx on public.scribe_transcripts(organisation_id);

-- RLS: staff-only SELECT (same org, clinical tier). No patient access ever.
alter table public.scribe_transcripts enable row level security;

create policy scribe_transcripts_select_staff on public.scribe_transcripts
  for select to authenticated
  using (private.is_org_staff(organisation_id));

create policy scribe_transcripts_insert_staff on public.scribe_transcripts
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

-- DELETE governed by retention: a cron or background job after expires_at.
-- Staff may also delete if consent was revoked (safety case: revoked mid-session).
create policy scribe_transcripts_delete_staff on public.scribe_transcripts
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

-- Grants
grant select, insert, delete on public.scribe_transcripts to authenticated;

-- ── closing assertions ──────────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'scribe_transcripts'
  ) then raise exception 'scribe_transcripts table not created'; end if;

  if not (select relrowsecurity from pg_class where relname = 'scribe_transcripts' and relnamespace = 'public'::regnamespace)
  then raise exception 'RLS not enabled on scribe_transcripts'; end if;

  if not has_table_privilege('authenticated', 'public.scribe_transcripts', 'SELECT')
  then raise exception 'authenticated lacks SELECT on scribe_transcripts'; end if;
  if not has_table_privilege('authenticated', 'public.scribe_transcripts', 'INSERT')
  then raise exception 'authenticated lacks INSERT on scribe_transcripts'; end if;
  if not has_table_privilege('authenticated', 'public.scribe_transcripts', 'DELETE')
  then raise exception 'authenticated lacks DELETE on scribe_transcripts'; end if;
end $$;

commit;
