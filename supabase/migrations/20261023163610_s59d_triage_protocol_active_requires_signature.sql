-- S59d part 3 of 4: a triage protocol version cannot be ACTIVE unless it carries a recorded signature.
--
-- The app now treats only an active AND signed row as live (liveProtocolConfig in packages/symptom-triage-engine). This puts the same rule
-- in the database, so a hand-run UPDATE that sets is_active on an unsigned draft (the S59 paediatric draft, the S59d pathways) is refused
-- instead of silently putting an unreviewed clinical ruleset in front of patients. public.sign_triage_protocols sets approved_by,
-- approved_at and is_active in one statement, so signing is unaffected.
--
-- NOT VALID on purpose: the constraint is checked for every new or changed row from now on but does not rescan existing rows, so a row that
-- was activated before this rule (if any) cannot make this migration fail. APPLY CHECK: run the query in docs/design/S59d.md section 7
-- against the live project first and confirm the active row has approved_at and approved_by (the app gate now needs both).
--
-- ROWS AFFECTED: none changed.
alter table public.triage_protocols
  add constraint triage_protocols_active_requires_signature
  check (not is_active or (approved_at is not null and approved_by is not null)) not valid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'triage_protocols_active_requires_signature' and conrelid = 'public.triage_protocols'::regclass) then
    raise exception 'S59d assertion: the active-requires-signature constraint is missing';
  end if;
end $$;
