do $$
declare
  t text;
  tables text[] := array[
    'video_consultations', 'clinical_encounter_notes', 'consultation_follow_ups',
    'consultation_feedback', 'video_visit_requests', 'async_consults', 'booking_requests'
  ];
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

do $$
declare
  t text;
  tables text[] := array[
    'video_consultations', 'clinical_encounter_notes', 'consultation_follow_ups',
    'consultation_feedback', 'video_visit_requests', 'async_consults', 'booking_requests'
  ];
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
