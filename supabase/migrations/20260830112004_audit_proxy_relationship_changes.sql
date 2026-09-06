-- Tarragon Health
-- Patient Identity & MPI gap analysis (docs/PATIENT_IDENTITY_MPI_SPEC.md §82.13) found that
-- private.audit_row_change() (20260812030853_row_change_audit_triggers.sql) covers writes on 21
-- tables including `profiles`, but NOT `profile_access` or `care_access_requests` — so a proxy
-- grant being created, its permission_level changing, its clinical_access consent flipping, or a
-- grant being revoked produces no audit_log row at all. Tarragon could not currently answer "who
-- was granted access to my mother's record, and when was it revoked."
--
-- Neither table carries organisation_id (profile_access.sql's own header: "access grants are
-- between individuals regardless of org") — private.audit_row_change() already handles a missing
-- column gracefully (`to_jsonb(NEW) ->> 'organisation_id'` is simply null, not an error), so no
-- change to the trigger function itself is needed, only attaching it to these two tables. Same
-- mechanical follow-up the original migration's own header anticipated ("extending to the rest of
-- the org-staff surface... just needs its array extended").

do $$
declare
  t text;
  tables text[] := array['profile_access', 'care_access_requests'];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists audit_row_change_trg on public.%I', t);
    execute format(
      'create trigger audit_row_change_trg '
      'after insert or update or delete on public.%I '
      'for each row execute function private.audit_row_change()',
      t
    );
  end loop;
end $$;

-- Proof, not hope.
do $$
declare
  t text;
  tables text[] := array['profile_access', 'care_access_requests'];
  v_count int;
begin
  foreach t in array tables loop
    select count(*) into v_count
      from pg_trigger tg
      join pg_class c on c.oid = tg.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t
        and tg.tgname = 'audit_row_change_trg' and not tg.tgisinternal;
    if v_count <> 1 then
      raise exception 'audit_row_change_trg missing or duplicated on public.%: found %', t, v_count;
    end if;
  end loop;
end $$;
