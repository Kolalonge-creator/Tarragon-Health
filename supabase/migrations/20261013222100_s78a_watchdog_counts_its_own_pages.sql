-- S78a (paging watchdog): count the pages THIS sweep created, correctly.
--
-- The review fix in 20261007160301_s75_80_review_fixes.sql decided "this call created the page" by comparing the page's xmin with txid_current(). The insert runs
-- inside the loop's `begin ... exception` block, which is a subtransaction with its own id, so the comparison was never true: the watchdog created pages but wrote no
-- audit row and opened no 'outbox stalled' incident. It now takes the same advisory lock create_red_page takes, checks whether a page already exists, then calls it.
-- Same behaviour otherwise. Found by replaying the migrations locally (proof s78a). Idempotent.
CREATE OR REPLACE FUNCTION private.sweep_unpaged_red_events()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r record;
  v_grace integer := coalesce((private.paging_rule('watchdog_grace_seconds') #>> '{}')::integer, 60);
  v_look integer := coalesce((private.paging_rule('watchdog_lookback_minutes') #>> '{}')::integer, 360);
  v_page uuid;
  v_created integer := 0;
  v_errors integer := 0;
  v_was boolean;
begin
  for r in
    select te.id, te.organisation_id
      from public.triage_events te
     where te.grade = 'red' and not te.shadow and not te.is_test
       and te.patient_id is not null
       and te.actions @> '[{"kind":"page_on_call"}]'::jsonb
       and te.created_at <= now() - make_interval(secs => v_grace)
       and te.created_at > now() - make_interval(mins => v_look)
       and not exists (select 1 from public.pages p where p.triage_event_id = te.id and p.parent_page_id is null)
     order by te.created_at
     limit 50
  loop
    begin
      -- the very function the outbox subscriber calls: idempotent, advisory-locked, unique per event
      -- Decide whether THIS call creates the page. The same advisory lock create_red_page takes is taken first, so the subscriber cannot slip a page in between the
      -- check and the insert. (Comparing the page's row version with the transaction id cannot work: the insert runs inside this block's subtransaction.)
      perform pg_advisory_xact_lock(hashtext('page:' || r.id));
      v_was := exists (select 1 from public.pages p where p.triage_event_id = r.id and p.parent_page_id is null);
      v_page := public.create_red_page(r.id);
      -- create_red_page also returns the existing page when the outbox subscriber won the race. Only a page inserted by THIS
      -- transaction means the outbox path really was stalled, so only that earns an audit row and an incident.
      if v_page is not null and not v_was then
        v_created := v_created + 1;
        insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
          values (r.organisation_id, 'page.watchdog_created', 'page', v_page, jsonb_build_object('triage_event_id', r.id, 'grace_seconds', v_grace));
        perform private.page_incident(r.organisation_id, 'page_outbox_stalled', 'Red event paging path stalled',
          'A red event had no page after the grace period, so the database watchdog created it. The event processor (process-events) may be down or behind. Check it now.');
      end if;
    exception
      when unique_violation then null;   -- the subscriber created the page between the check and the insert: nothing to do
      when others then
        v_errors := v_errors + 1;
        perform set_config('tarragon.paging_write', 'off', true);
        insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
          values (r.organisation_id, 'page_watchdog.error', 'triage_event', r.id, jsonb_build_object('error', sqlerrm));
        perform private.page_incident(r.organisation_id, 'page_watchdog_failed', 'Red event watchdog failed',
          'The watchdog could not create a page for a red event; see audit_log action page_watchdog.error. A red event may be unpaged.');
    end;
  end loop;
  return jsonb_build_object('created', v_created, 'errors', v_errors);
end;
$function$;
