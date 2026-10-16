-- One page for one dangerous vitals reading, whichever pipeline sees it first: a shared dedupe key per patient, metric and level, with a window.
--
-- THE PROBLEM. A dangerous pulse, SpO2 or temperature reading is seen by two pipelines once vitals_care_triage is signed: the older per-vital trigger
-- (private.handle_pulse_reading_red_flag and its two siblings, which with the S19d flag on page through create_red_page as a 'unified_red' event) and the engine
-- (a vitals_care_triage red result, paged by the paging.create_from_triage subscriber through the same create_red_page). create_red_page already folds a repeat red
-- event into an OPEN, UNACKNOWLEDGED page family for the patient (the P6 merge window), but an acknowledged family is deliberately never joined (INV-05: someone
-- who has stepped away after acknowledging must not be the only thing standing between a new red event and a page). So when the clinician acknowledges the first
-- page in two minutes and the second pipeline's event for THE SAME READING arrives a minute later, a second page rings for a reading already handled.
--
-- THE FIX. private.red_page_dedupe_info(triage_event) names a dedupe key for a single-reading vitals red event, and the reading it is about:
--   key     = 'vitals:' || patient || ':' || metric (pulse, spo2, temperature) || ':' || level (emergency or red)
--   reading = the vitals_readings row both pipelines are looking at
-- from an engine result (rule_set_code vitals_care_triage; metric from the rule id, level from the guidance code VIT-E01 emergency / VIT-E02 red) or from a unified
-- legacy event (basis spo2_red, pulse_red, temperature_red: level red; basis emergency_event: the emergency_events row's source and reading, level emergency).
-- create_red_page, before it looks for a family, asks public.red_page_dedupe_claims whether the same key was claimed inside the merge window
-- (private.paging_delivery_rule('merge_window_minutes'), the existing CMO-owned value) FOR THE SAME READING, by a page that is still open. If so the event is recorded as
-- merged into that page and nobody is paged again, acknowledged or not. A different reading, a different metric, a worse level (emergency after red) or a closed or
-- expired page is not a duplicate and pages as before. Every page that is created or joined for a keyed event records its claim.
--
-- BEHIND THE UNSIGNED STATE. Only two kinds of event carry a key: a vitals_care_triage result that is NOT shadow (create_red_page returns before this code for a
-- shadow one, so nothing changes while the rule set is a draft) and a unified_red_paging row (which exists only when the CMO has switched unified paging on).
-- With both off, no key is ever computed and create_red_page behaves exactly as before.
--
-- create_red_page is patched IN PLACE from its live definition (pg_get_functiondef, md5 227cf60fd56dff031cc6d2befa4ac304 on 2026-10-16, which already carries the
-- S19d edit), with four asserted replacements; this project has clobbered large functions twice by rewriting them from a stale copy. The patch fails loudly if an
-- anchor is missing or appears twice, instead of silently doing nothing.

create table public.red_page_dedupe_claims (
  dedupe_key      text primary key,
  page_id         uuid not null references public.pages (id) on delete cascade,
  reading_id      uuid,
  triage_event_id uuid references public.triage_events (id) on delete cascade,
  claimed_at      timestamptz not null default now()
);
create index red_page_dedupe_claims_page_idx on public.red_page_dedupe_claims (page_id);
alter table public.red_page_dedupe_claims enable row level security;
create policy red_page_dedupe_claims_read on public.red_page_dedupe_claims for select to authenticated
  using (private.can_credential_review() and exists (select 1 from public.pages pg where pg.id = red_page_dedupe_claims.page_id
                                                      and pg.organisation_id = (select pr.organisation_id from public.profiles pr where pr.id = (select auth.uid()))));
revoke all on public.red_page_dedupe_claims from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.red_page_dedupe_claims from authenticated;
grant select on public.red_page_dedupe_claims to authenticated;
create trigger red_page_dedupe_claims_guard before insert or update on public.red_page_dedupe_claims for each row execute function private.guard_paging_write();
comment on table public.red_page_dedupe_claims is 'One row per dedupe key (patient, vitals metric, level): the latest page that was created or joined for a dangerous single-reading vitals event, and the reading it was about. Written only by create_red_page. A second event for the same reading inside the merge window folds into that page instead of ringing again.';

create or replace function private.red_page_dedupe_info(p_triage_event uuid)
returns table (dedupe_key text, reading_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  te public.triage_events%rowtype;
  v_metric text;
  v_level text;
  v_reading uuid;
  v_src text;
begin
  select * into te from public.triage_events where id = p_triage_event;
  if not found or te.patient_id is null then return; end if;
  if te.rule_set_code = 'vitals_care_triage' and te.trigger_type = 'observation' then
    v_metric := case when te.rule_id like 'VT-PU%' then 'pulse' when te.rule_id like 'VT-OX%' then 'spo2' when te.rule_id like 'VT-TE%' then 'temperature' end;
    v_level := case te.explanation_key when 'VIT-E01' then 'emergency' when 'VIT-E02' then 'red' end;
    v_reading := te.trigger_id;
  elsif te.rule_set_code = 'unified_red_paging' and te.trigger_type = 'unified_red' then
    if te.basis in ('spo2_red', 'pulse_red', 'temperature_red') then
      v_metric := split_part(te.basis, '_', 1);
      v_level := 'red';
      v_reading := te.trigger_id;
    elsif te.basis = 'emergency_event' then
      select e.source::text, e.vital_reading_id into v_src, v_reading from public.emergency_events e where e.id = te.trigger_id;
      v_metric := case v_src when 'pulse_red_flag' then 'pulse' when 'spo2_red_flag' then 'spo2' when 'temperature_red_flag' then 'temperature' end;
      v_level := 'emergency';
    end if;
  end if;
  if v_metric is null or v_level is null or v_reading is null then return; end if;
  return query select 'vitals:' || te.patient_id::text || ':' || v_metric || ':' || v_level, v_reading;
end $$;
revoke all on function private.red_page_dedupe_info(uuid) from public, anon, authenticated;

-- A patch helper that insists on exactly one occurrence of its anchor.
create function pg_temp.patch_once(p_def text, p_anchor text, p_replacement text) returns text
language plpgsql as $f$
declare v_count integer;
begin
  v_count := (length(p_def) - length(replace(p_def, p_anchor, ''))) / nullif(length(p_anchor), 0);
  if v_count is distinct from 1 then
    raise exception 'create_red_page patch: anchor found % times (expected once): %', v_count, left(p_anchor, 80);
  end if;
  return replace(p_def, p_anchor, p_replacement);
end $f$;

do $patch$
declare
  v_def text := pg_get_functiondef('public.create_red_page(uuid)'::regprocedure);
begin
  if position('red_page_dedupe_claims' in v_def) > 0 then
    raise exception 'create_red_page already carries the dedupe patch';
  end if;

  -- 1. declarations
  v_def := pg_temp.patch_once(v_def, $a$  v_family public.pages%rowtype;$a$,
    $b$  v_family public.pages%rowtype;
  v_dedupe_key text;
  v_dedupe_reading uuid;
  v_dup uuid;$b$);

  -- 2. a repeat that joins an open family keeps the claim current (so the same reading arriving later still folds in, even after acknowledgement)
  v_def := pg_temp.patch_once(v_def, $a$    update public.pages set merged_count = merged_count + 1, last_merged_at = now() where id = v_family.id;$a$,
    $b$    update public.pages set merged_count = merged_count + 1, last_merged_at = now() where id = v_family.id;
    if v_dedupe_key is not null then
      insert into public.red_page_dedupe_claims (dedupe_key, page_id, reading_id, triage_event_id)
      values (v_dedupe_key, v_family.id, v_dedupe_reading, te.id)
      on conflict (dedupe_key) do update set page_id = excluded.page_id, reading_id = excluded.reading_id, triage_event_id = excluded.triage_event_id, claimed_at = now();
    end if;$b$);

  -- 3. a brand new page records its claim
  v_def := pg_temp.patch_once(v_def, $a$'page.sent', 'page', v_page.id, jsonb_build_object('role', v_page.role, 'level', v_page.escalation_level, 'no_cover', v_page.no_cover));$a$,
    $b$'page.sent', 'page', v_page.id, jsonb_build_object('role', v_page.role, 'level', v_page.escalation_level, 'no_cover', v_page.no_cover));
  if v_dedupe_key is not null then
    perform set_config('tarragon.paging_write', 'on', true);
    insert into public.red_page_dedupe_claims (dedupe_key, page_id, reading_id, triage_event_id)
    values (v_dedupe_key, v_page.id, v_dedupe_reading, te.id)
    on conflict (dedupe_key) do update set page_id = excluded.page_id, reading_id = excluded.reading_id, triage_event_id = excluded.triage_event_id, claimed_at = now();
    perform set_config('tarragon.paging_write', 'off', true);
  end if;$b$);

  -- 4. the dedupe itself, before the family lookup
  v_def := pg_temp.patch_once(v_def, $a$  perform pg_advisory_xact_lock(hashtext('pagefam:' || te.patient_id));$a$,
    $b$  -- Single-reading vitals: the same dangerous reading seen by the engine and by the older trigger is ONE page, acknowledged or not (see red_page_dedupe_claims).
  -- Only the SAME reading on a page that is still open folds in; a new reading, another metric, a worse level or a closed page pages as before.
  select i.dedupe_key, i.reading_id into v_dedupe_key, v_dedupe_reading from private.red_page_dedupe_info(te.id) i;
  if v_dedupe_key is not null then
    perform pg_advisory_xact_lock(hashtext('pagededupe:' || v_dedupe_key));
    select c.page_id into v_dup
      from public.red_page_dedupe_claims c
      join public.pages pg on pg.id = c.page_id and pg.closed_at is null and pg.expired_at is null
     where c.dedupe_key = v_dedupe_key and c.reading_id = v_dedupe_reading
       and c.claimed_at > now() - make_interval(mins => private.paging_delivery_rule('merge_window_minutes'));
    if found then
      perform set_config('tarragon.paging_write', 'on', true);
      insert into public.page_merged_events (triage_event_id, page_id) values (te.id, v_dup);
      update public.pages set merged_count = merged_count + 1, last_merged_at = now() where id = v_dup;
      perform set_config('tarragon.paging_write', 'off', true);
      insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
        values (te.organisation_id, null, 'page.deduplicated', 'page', v_dup, jsonb_build_object('triage_event_id', te.id));
      return v_dup;
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('pagefam:' || te.patient_id));$b$);

  execute v_def;
end $patch$;

revoke all on function public.create_red_page(uuid) from public, anon, authenticated;
grant execute on function public.create_red_page(uuid) to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.create_red_page(uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'public.create_red_page(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'private.red_page_dedupe_info(uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'private.red_page_dedupe_info(uuid)', 'EXECUTE') then
    raise exception 'dedupe self-check: create_red_page and red_page_dedupe_info must be service role only';
  end if;
  if position('red_page_dedupe_claims' in pg_get_functiondef('public.create_red_page(uuid)'::regprocedure)) = 0 then
    raise exception 'dedupe self-check: create_red_page does not carry the dedupe patch';
  end if;
  -- the S19d edit (an emergency-level unified event never joins a lower family) must still be there
  if position('unified_red_paging' in pg_get_functiondef('public.create_red_page(uuid)'::regprocedure)) = 0 then
    raise exception 'dedupe self-check: the S19d edit of create_red_page was lost';
  end if;
  if has_table_privilege('authenticated', 'public.red_page_dedupe_claims', 'INSERT') or has_table_privilege('anon', 'public.red_page_dedupe_claims', 'SELECT') then
    raise exception 'dedupe self-check: the claims table is read-only for staff and closed to anon';
  end if;
end $$;
