-- Patient Health Record architecture review — patient_allergies was missing
-- from the clinical-core audit/correction coverage entirely.
--
-- audit_row_change (20260812030853_row_change_audit_triggers.sql) named 21
-- tables as "the clinical core" — patient_allergies was not among them,
-- despite being this platform's own reference-quality pattern (see
-- docs/PATIENT_HEALTH_RECORD_ARCHITECTURE.md §1.8: "hold it up as the
-- reference pattern") and safety-critical (apps/web/src/lib/rules/drug-
-- safety.ts runs cross-reactivity checks against it before every
-- prescription). A wrongly corrected or deleted allergy today leaves
-- literally no trail anywhere — not even the hash-only audit_log. This
-- migration is a new file rather than an edit to 20260812030853 because
-- that migration is already-applied history on the live project.
--
-- Both existing generic functions are reused unchanged — private.audit_
-- row_change() (20260812030853) and private.capture_record_correction()
-- (20260827195333_record_corrections_platform_wide.sql, which also treats
-- patient_allergies as one of its two reason-MANDATORY tables alongside
-- patient_conditions: an UPDATE or DELETE here without app.change_reason
-- set will raise, not silently record a null reason — confirmed safe to
-- enforce immediately, see that migration's header for the grep proving no
-- existing call site updates or deletes this table today).

create trigger audit_row_change_trg
  after insert or update or delete on public.patient_allergies
  for each row execute function private.audit_row_change();

create trigger capture_record_correction_trg
  after update or delete on public.patient_allergies
  for each row execute function private.capture_record_correction();

do $$
begin
  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    where c.relname = 'patient_allergies' and tg.tgname = 'audit_row_change_trg' and not tg.tgisinternal
  ) then
    raise exception 'FAIL: patient_allergies is missing audit_row_change_trg';
  end if;
  if not exists (
    select 1 from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
    where c.relname = 'patient_allergies' and tg.tgname = 'capture_record_correction_trg' and not tg.tgisinternal
  ) then
    raise exception 'FAIL: patient_allergies is missing capture_record_correction_trg';
  end if;
  raise notice 'PASS: patient_allergies_audit_and_corrections -- both triggers attached';
end $$;
