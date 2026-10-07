-- S59b part 2: ONE UNSIGNED, INACTIVE triage_protocols draft in which chest pain with sweating, breathlessness or arm or jaw pain is an
-- emergency at ANY severity (CMO decision of 2026-10-07: remove the severity floor for the cardiac pattern).
--
-- WHAT THIS IS, AND IS NOT
--   * The new row is the currently ACTIVE signed config (or version 1 when none is active, as on a fresh replay) with exactly one change:
--     the rule of the red flag `chest_pain.cardiac_pattern` loses its `minSeverity` (the signed v1 value is 6). Every other pathway and
--     every other rule is copied unchanged, so signing this version alone would change nothing else.
--   * It is created with is_active = false and no approved_by or approved_at. NO AGENT SIGNS OR ACTIVATES IT. Only the Chief Medical Officer,
--     through public.sign_triage_protocols(), can. Signing replaces the whole active config.
--   * The bundled on-device red-flag floor (packages/symptom-triage-engine SEED_PATHWAYS, which is also what apps/mobile uses) is
--     deliberately kept EQUAL TO THE SIGNED protocol (minSeverity 6 stays there). When this draft is signed, the bundled copy and
--     packages/symptom-triage-engine/src/protocols/db-seed-fixture.json MUST be updated in the same change: the Jest parity test
--     (bundled-floor-parity.test.ts) fails if the bundled floor and the signed fixture differ, and the server reports drift loudly
--     (Sentry) on every check where the active protocol's red flags differ from the bundled floor. See OQ-S59b-02.
--   * Relationship to the paediatric draft (S59 part 4): that draft ALSO carries this change (it is built from this draft's pathways),
--     so the CMO can sign this one alone, or the merged one that adds the adult v2 pathways and the paediatric ones.
--
-- ROWS AFFECTED: one row inserted (idempotent: skipped when a row with this note already exists). No existing row changes. The version
-- number is computed when the migration is applied (highest existing plus one), never typed by hand.

do $$
declare
  v_version integer;
  v_base jsonb;
  v_pathways jsonb;
begin
  if exists (select 1 from public.triage_protocols where notes like 'S59b draft: chest pain%') then
    return;
  end if;
  select coalesce(max(version), 0) + 1 into v_version from public.triage_protocols;
  select coalesce((select config from public.triage_protocols where is_active limit 1),
                  (select config from public.triage_protocols where version = 1)) into v_base;
  if v_base is null then
    raise exception 'S59b: no base triage protocol (neither an active one nor version 1) to copy';
  end if;

  -- Rebuild the pathway list, preserving order, changing only chest_pain.cardiac_pattern's rule.
  select jsonb_agg(
           case when p ->> 'key' = 'chest_pain' then
             jsonb_set(p, '{redFlagScreen}', (
               select jsonb_agg(
                        case when f ->> 'key' = 'chest_pain.cardiac_pattern'
                             then jsonb_set(f, '{rule}', (f -> 'rule') - 'minSeverity')
                             else f end
                        order by fo)
                 from jsonb_array_elements(p -> 'redFlagScreen') with ordinality as ft(f, fo)))
           else p end
           order by po)
    into v_pathways
    from jsonb_array_elements(v_base -> 'pathways') with ordinality as pt(p, po);

  insert into public.triage_protocols (version, config, notes, is_active)
  values (v_version, jsonb_build_object('version', v_version, 'pathways', v_pathways),
    'S59b draft: chest pain cardiac pattern has NO severity floor. UNSIGNED and INACTIVE. The active signed pathways, copied unchanged, except that chest_pain.cardiac_pattern (breathlessness, sweating or arm or jaw pain with chest pain) is an emergency at any severity instead of from severity 6. Needs the Chief Medical Officer to review and sign through sign_triage_protocols. When signed, update the bundled red-flag floor and db-seed-fixture.json in the same change.',
    false);
end $$;

do $$
declare
  v_row public.triage_protocols%rowtype;
  v_base jsonb;
  v_f jsonb;
begin
  select * into v_row from public.triage_protocols where notes like 'S59b draft: chest pain%';
  if not found then raise exception 'S59b assertion: the chest pain draft was not created'; end if;
  if v_row.is_active or v_row.approved_at is not null or v_row.approved_by is not null then
    raise exception 'S59b assertion: the chest pain draft is active or signed';
  end if;
  if (v_row.config ->> 'version')::integer <> v_row.version then
    raise exception 'S59b assertion: the config version does not match the row version';
  end if;
  select f into v_f
    from jsonb_array_elements(v_row.config -> 'pathways') p, jsonb_array_elements(p -> 'redFlagScreen') f
   where p ->> 'key' = 'chest_pain' and f ->> 'key' = 'chest_pain.cardiac_pattern';
  if v_f is null then raise exception 'S59b assertion: chest_pain.cardiac_pattern is missing from the draft'; end if;
  if (v_f -> 'rule') ? 'minSeverity' then raise exception 'S59b assertion: the cardiac pattern still has a severity floor'; end if;
  if jsonb_array_length(v_f -> 'rule' -> 'anyAssociatedSymptom') <> 3 then
    raise exception 'S59b assertion: the cardiac pattern lost an associated symptom';
  end if;
end $$;
