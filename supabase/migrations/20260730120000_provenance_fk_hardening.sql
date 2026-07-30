-- Tarragon Health — v3 port: provenance hardening (SET NULL -> RESTRICT)
--
-- CLAUDE.md's pivot-reversal banner lists "provenance NOT NULL" among the v3
-- disciplines to port in; this session's earlier summaries shorthanded it as
-- "recorded_by NOT NULL provenance" and flagged it "architecturally tricky
-- — conflicts with the existing on delete set null pattern, needs its own
-- design decision, not a quick migration."
--
-- Investigated rather than guessed: grepped the whole codebase for any path
-- that hard-deletes a public.profiles or public.clinical_staff row (raw SQL
-- DELETE, or auth.admin.deleteUser from the app) — found NONE. Clinician
-- deactivation is done via clinical_staff.active = false everywhere (the
-- nightly activation guard, indemnity exemptions, etc.); there is no
-- account-deletion feature at all (no NDPR/right-to-be-forgotten flow).
--
-- Given that, a literal "make these columns NOT NULL" reading would be
-- WRONG — most of the 85 attribution FKs found below are legitimately null
-- until an action occurs (escalations.reviewed_by is null while open,
-- clinician_alerts.acknowledged_by is null until acknowledged, etc.); a
-- blanket NOT NULL would break every one of those insert paths for no
-- safety benefit. The real "provenance" concern proof_log/v3 care about is
-- narrower and correct: once an attribution IS set, it must never be
-- silently erased by an unrelated later event. That is exactly what
-- ON DELETE SET NULL currently allows and ON DELETE RESTRICT prevents — and
-- since no code path ever deletes the referenced row today, converting is a
-- zero-behaviour-change hardening (same "tighten, never loosen" reasoning
-- already used for the vaccination schedule and escalation SLA work this
-- session), not a breaking schema change.
--
-- Applied as one data-driven migration (not 85 hand-written ALTER TABLE
-- statements — mechanical, lower error surface, and inherently covers every
-- such FK rather than whatever subset a manual grep happened to enumerate).
--
-- Applied via the Supabase CLI (`db query --linked`), not apply_migration —
-- the Supabase MCP server was unreachable this session (net::ERR_FAILED on
-- every call); see reference_supabase_cli_sql_access.md for the fallback
-- recipe. Recorded in supabase_migrations.schema_migrations in the same
-- transaction as the DDL, same as apply_migration would have done.

do $$
declare
  r record;
  v_converted integer := 0;
begin
  for r in
    select
      con.conname,
      con.conrelid::regclass::text as tbl,
      a.attname as col,
      con.confrelid::regclass::text as reftbl
    from pg_constraint con
    join pg_attribute a
      on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
    where con.contype = 'f'
      and con.confdeltype = 'n' -- ON DELETE SET NULL
      and con.confrelid in ('public.profiles'::regclass, 'public.clinical_staff'::regclass)
      and array_length(con.conkey, 1) = 1
  loop
    execute format(
      'alter table %s drop constraint %I, add constraint %I foreign key (%I) references %s (id) on delete restrict',
      r.tbl, r.conname, r.conname, r.col, r.reftbl
    );
    v_converted := v_converted + 1;
    raise notice 'Converted % (%.% -> %) from ON DELETE SET NULL to ON DELETE RESTRICT',
      r.conname, r.tbl, r.col, r.reftbl;
  end loop;

  raise notice 'Converted % attribution FK(s) total', v_converted;

  if v_converted = 0 then
    raise exception 'FAIL: expected to convert a nonzero number of attribution FKs';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Assertion — the migration is the test: zero attribution FKs to
-- profiles/clinical_staff should still be ON DELETE SET NULL afterward.
-- ---------------------------------------------------------------------------
do $$
declare
  v_remaining integer;
begin
  select count(*) into v_remaining
  from pg_constraint con
  where con.contype = 'f'
    and con.confdeltype = 'n'
    and con.confrelid in ('public.profiles'::regclass, 'public.clinical_staff'::regclass);

  if v_remaining <> 0 then
    raise exception 'FAIL: % attribution FK(s) still ON DELETE SET NULL after conversion', v_remaining;
  end if;

  raise notice 'PASS: zero remaining ON DELETE SET NULL attribution FKs to profiles/clinical_staff';
end $$;
