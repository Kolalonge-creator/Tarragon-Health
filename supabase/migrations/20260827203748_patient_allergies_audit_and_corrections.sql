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
