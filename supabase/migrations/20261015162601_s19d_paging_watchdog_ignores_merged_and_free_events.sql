-- S19d (separate file so it can be reverted on its own): the S78a paging watchdog must not treat a merged or Free red event as unpaged.
--
-- BEHAVIOUR CHANGE THAT APPLIES WHILE THE UNIFIED-PAGING FLAG IS OFF. This is a fix to a bug that already exists for blood pressure:
-- private.sweep_unpaged_red_events() (S78a) pages any non-shadow, non-test red triage event that has no ROOT page. An event that joined an open page family
-- (public.page_merged_events, S19c) has no root page of its own by design, and a Free patient's event has none either, so every 15 seconds for six hours the watchdog
-- calls create_red_page for each of them, writes a page.watchdog_created audit row, raises the sev1 incident "paging path stalled" on a healthy system, and lets those
-- rows fill its 50-row window ahead of a genuinely unpaged event. S19c's own reconciler already excludes both; the watchdog now does too. A genuinely unpaged event
-- is still found and paged exactly as before.
--
-- Patched in place from the current definition with a counted anchor; skipped when the watchdog is not installed yet (it arrives with S78a: a replay where it exists
-- unpatched fails the s19d proof). ROLLBACK: restore the S78a body from 20261013222100_s78a_watchdog_counts_its_own_pages.sql.
create function pg_temp.s19d_wd_patch(p_fn regprocedure, p_from text, p_to text) returns void
language plpgsql as
$h$
declare v_def text; v_count integer;
begin
  v_def := pg_get_functiondef(p_fn);
  if position(p_to in v_def) > 0 then return; end if;
  v_count := (length(v_def) - length(replace(v_def, p_from, ''))) / length(p_from);
  if v_count <> 1 then raise exception 'S19d watchdog: anchor found % times, expected 1', v_count; end if;
  execute replace(v_def, p_from, p_to);
end
$h$;

do $patch$
begin
  if to_regprocedure('private.sweep_unpaged_red_events()') is not null then
    perform pg_temp.s19d_wd_patch('private.sweep_unpaged_red_events()'::regprocedure,
      $a$and not exists (select 1 from public.pages p where p.triage_event_id = te.id and p.parent_page_id is null)$a$,
      $b$and not exists (select 1 from public.pages p where p.triage_event_id = te.id and p.parent_page_id is null)
       and not exists (select 1 from public.page_merged_events m where m.triage_event_id = te.id)
       and not exists (select 1 from public.free_red_events f where f.triage_event_id = te.id)$b$);
    if position('page_merged_events' in pg_get_functiondef('private.sweep_unpaged_red_events()'::regprocedure)) = 0 then
      raise exception 'S19d: the paging watchdog was not patched';
    end if;
  end if;
end
$patch$;
