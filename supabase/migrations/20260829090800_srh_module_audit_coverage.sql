-- Sexual & Reproductive Health platform, 9/9: extend write-change audit
-- logging to this module's tables (spec §47.12 — "appropriate ... audit
-- logging").
--
-- 20260812030853_row_change_audit_triggers.sql built a generic write-audit
-- trigger (private.audit_row_change(), logging actor/action/entity/changed-
-- column-NAMES/a row hash to audit_log — never column values, so audit_log
-- itself never becomes a second, less-guarded copy of PHI) but deliberately
-- wired it to only 21 named "clinical core" tables, flagging "extending to
-- the rest of the org-staff surface is a mechanical follow-up ... once this
-- pass is reviewed." None of the 7 patient-scoped tables this module added
-- were on that list (they didn't exist yet), which would otherwise leave
-- every write to an STI case, a partner-notification record, a contraception
-- request, or a sexual-dysfunction screen with no "who changed this and
-- when" trail at all — a real gap for a module whose own acceptance
-- criteria lead with confidentiality. This is that mechanical follow-up,
-- scoped to this module only.
--
-- contraception_methods is deliberately excluded: it is a global reference
-- catalogue like screen_types (no organisation_id column, not patient data),
-- the same reason screen_types/exposure_types/etc. were never on the
-- original 21-table list either.

do $$
declare
  t text;
  tables text[] := array[
    'sti_risk_checks', 'sti_case_episodes', 'sti_partner_notifications',
    'contraception_plans', 'emergency_contraception_requests',
    'fertility_assessments', 'sexual_health_screens'
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
    'sti_risk_checks', 'sti_case_episodes', 'sti_partner_notifications',
    'contraception_plans', 'emergency_contraception_requests',
    'fertility_assessments', 'sexual_health_screens'
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
  raise notice 'PASS: write-change audit logging extended to all 7 patient-scoped SRH tables';
end $$;
