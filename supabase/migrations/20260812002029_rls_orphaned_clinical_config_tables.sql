-- medication_review_cadences and drug_monitoring_rules (both from the
-- 2026-07-16 medication review engine / drug-class lab monitoring work) were
-- never given the RLS treatment their sibling global-config table
-- bp_ladder_steps got in 20260720020742_bp_drug_ladder_and_safety.sql. They
-- carry no organisation_id/patient_id — global clinical protocol reference
-- data read by SECURITY DEFINER engine functions (postgres/service_role,
-- both BYPASSRLS) — so this was never reachable via PostgREST (zero grants
-- to anon/authenticated existed either). Not a live exposure, but exactly
-- the shape of gap that has bitten this project before: a future blanket
-- `grant ... to authenticated` on a batch of tables would have made these
-- fully readable/writable with no RLS to fall back on. Bringing them in
-- line with bp_ladder_steps closes that off and lets staff/patient UIs read
-- this reference data directly if a future feature wants to.

alter table public.medication_review_cadences enable row level security;

drop policy if exists medication_review_cadences_read on public.medication_review_cadences;
create policy medication_review_cadences_read on public.medication_review_cadences
  for select to authenticated using (true);

drop policy if exists medication_review_cadences_admin on public.medication_review_cadences;
create policy medication_review_cadences_admin on public.medication_review_cadences
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

grant select, insert, update, delete on public.medication_review_cadences to authenticated;

alter table public.drug_monitoring_rules enable row level security;

drop policy if exists drug_monitoring_rules_read on public.drug_monitoring_rules;
create policy drug_monitoring_rules_read on public.drug_monitoring_rules
  for select to authenticated using (true);

drop policy if exists drug_monitoring_rules_admin on public.drug_monitoring_rules;
create policy drug_monitoring_rules_admin on public.drug_monitoring_rules
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

grant select, insert, update, delete on public.drug_monitoring_rules to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'medication_review_cadences' and c.relrowsecurity
  ) then
    raise exception 'medication_review_cadences did not get RLS enabled';
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'drug_monitoring_rules' and c.relrowsecurity
  ) then
    raise exception 'drug_monitoring_rules did not get RLS enabled';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'medication_review_cadences') <> 2 then
    raise exception 'medication_review_cadences should have exactly 2 policies (read, admin)';
  end if;

  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'drug_monitoring_rules') <> 2 then
    raise exception 'drug_monitoring_rules should have exactly 2 policies (read, admin)';
  end if;
end $$;
