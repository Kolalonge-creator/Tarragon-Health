-- Move the Zoom host start link out of the patient's reach (Tarragon 2.0 master architecture assessment, finding S3).
--
-- The problem. video_consultations.host_start_url is the link that starts a Zoom meeting AS THE HOST (it carries the host's zak
-- token). The table's only SELECT policy is `patient_id = auth.uid() OR is_org_staff(organisation_id)`, and `authenticated` holds
-- the table-wide SELECT grant, so a patient could read the host link for their own consultation through PostgREST. The app only
-- avoided it by never selecting the column on patient pages. A column REVOKE would do nothing under the table-wide grant.
--
-- Live state before this migration: 0 rows hold a host link (the first live call, 2026-11-03, ran from a pasted link), so no link
-- has been exposed. About ten server actions and API routes write the column whenever they create a meeting, so the next call
-- scheduled through the app would have stored one.
--
-- The fix, chosen so that no writer has to change in the same release (code before schema is not needed):
--   1. A staff-only side table, public.video_consultation_host_links, one row per consultation.
--   2. Two triggers on video_consultations. BEFORE INSERT OR UPDATE takes any incoming host_start_url off the row (stores NULL)
--      and parks it in a transaction-local setting keyed by the consultation id; AFTER INSERT OR UPDATE, once the row really
--      exists under that id, writes it to the side table. (Writing the side row in the BEFORE trigger would leave an orphan if an
--      INSERT ... ON CONFLICT on another key took the update path.) A write that clears the meeting (zoom_meeting_id changed
--      with no new link, as public.reschedule_lab_result_consult_request does) or ends the call (status cancelled or completed)
--      deletes the stale side row.
--   3. A CHECK keeps host_start_url NULL on the consultation row, as a backstop if the trigger is ever dropped (triggers run before
--      constraints, so the CHECK never fires on a normal write).
--   4. The clinician consultation screen reads the link from the side table (apps/web/src/lib/queries/consultation-video.ts).
-- The column itself stays (always NULL) so that no deployed writer or generated type breaks; dropping it is a later cleanup.

-- 1. Side table -----------------------------------------------------------------------------------------------------------------
create table public.video_consultation_host_links (
  video_consultation_id uuid primary key
    references public.video_consultations (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id),
  host_start_url text not null check (length(host_start_url) > 0),
  updated_at timestamptz not null default now()
);

comment on table public.video_consultation_host_links is
  'The Zoom host start link for a video consultation. Staff only: a patient must never be able to start the meeting as host. '
  'Written only by private.video_consultation_move_host_link (the trigger on video_consultations); read by the clinician '
  'consultation screen.';

alter table public.video_consultation_host_links enable row level security;

create policy video_consultation_host_links_staff_select on public.video_consultation_host_links
  for select to authenticated
  using (private.is_org_staff(organisation_id));

-- No INSERT/UPDATE/DELETE policy: only the definer trigger writes.
revoke all on public.video_consultation_host_links from anon, authenticated;
grant select on public.video_consultation_host_links to authenticated;
grant all on public.video_consultation_host_links to service_role;

-- 2. Trigger --------------------------------------------------------------------------------------------------------------------
-- The parked link lives in a transaction-local setting named for the row id, so only the AFTER trigger for that same row reads it.
create or replace function private.video_consultation_host_link_key(p_id uuid)
returns text
language sql
immutable
set search_path = ''
as $$ select 'tarragon_vc_host.l' || replace(p_id::text, '-', '') $$;

create or replace function private.video_consultation_move_host_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Always (re)set the parked value for this row, so a value parked by an earlier write that never reached its AFTER trigger
  -- (an INSERT ... ON CONFLICT DO NOTHING) can never be picked up by a later, unrelated write in the same transaction.
  perform set_config(private.video_consultation_host_link_key(new.id), coalesce(new.host_start_url, ''), true);
  if new.host_start_url is not null then
    new.host_start_url := null;
  elsif tg_op = 'UPDATE' and (
    new.zoom_meeting_id is distinct from old.zoom_meeting_id
    or (new.status in ('cancelled', 'completed') and new.status is distinct from old.status)
  ) then
    -- The meeting was replaced, cleared or ended without a new host link: the stored one starts the wrong meeting (or none).
    delete from public.video_consultation_host_links where video_consultation_id = new.id;
  end if;
  return new;
end;
$$;

create or replace function private.video_consultation_store_host_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := private.video_consultation_host_link_key(new.id);
  v_link text := nullif(current_setting(v_key, true), '');
begin
  if v_link is not null then
    insert into public.video_consultation_host_links (video_consultation_id, organisation_id, host_start_url, updated_at)
    values (new.id, new.organisation_id, v_link, now())
    on conflict (video_consultation_id) do update
      set host_start_url = excluded.host_start_url,
          organisation_id = excluded.organisation_id,
          updated_at = now();
    perform set_config(v_key, '', true);
  end if;
  return null;
end;
$$;

revoke all on function private.video_consultation_host_link_key(uuid) from public, anon, authenticated;
revoke all on function private.video_consultation_move_host_link() from public, anon, authenticated;
revoke all on function private.video_consultation_store_host_link() from public, anon, authenticated;

-- Name sorts first among the BEFORE triggers so every later trigger (and the AFTER audit_row_change_trg) sees the NULL.
create trigger "000_move_host_link"
  before insert or update on public.video_consultations
  for each row execute function private.video_consultation_move_host_link();

create trigger "zzz_store_host_link"
  after insert or update on public.video_consultations
  for each row execute function private.video_consultation_store_host_link();

-- 3. Move anything already stored, then lock the column to NULL --------------------------------------------------------------------
insert into public.video_consultation_host_links (video_consultation_id, organisation_id, host_start_url)
select id, organisation_id, host_start_url
from public.video_consultations
where host_start_url is not null
on conflict (video_consultation_id) do nothing;

-- Setting the column to NULL takes neither trigger branch; the copy above is the moved value.
update public.video_consultations set host_start_url = null where host_start_url is not null;

alter table public.video_consultations
  add constraint video_consultations_host_start_url_moved check (host_start_url is null);

comment on column public.video_consultations.host_start_url is
  'Always NULL. The host link lives in public.video_consultation_host_links (staff only); a trigger moves any value written here.';

-- 4. Self-check -----------------------------------------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.video_consultations where host_start_url is not null) then
    raise exception 'host_start_url still holds a value on video_consultations';
  end if;
  if has_table_privilege('anon', 'public.video_consultation_host_links', 'SELECT') then
    raise exception 'anon can read video_consultation_host_links';
  end if;
  if has_table_privilege('authenticated', 'public.video_consultation_host_links', 'INSERT')
     or has_table_privilege('authenticated', 'public.video_consultation_host_links', 'UPDATE')
     or has_table_privilege('authenticated', 'public.video_consultation_host_links', 'DELETE') then
    raise exception 'authenticated can write video_consultation_host_links directly';
  end if;
  if has_function_privilege('authenticated', 'private.video_consultation_move_host_link()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.video_consultation_store_host_link()', 'EXECUTE') then
    raise exception 'authenticated can execute the host-link trigger function';
  end if;
end;
$$;
