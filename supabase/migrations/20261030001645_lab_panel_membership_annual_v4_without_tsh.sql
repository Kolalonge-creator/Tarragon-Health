-- lab_panel_versions membership_annual v4 = v3 minus ONE analyte, tsh. PROPOSED, UNSIGNED: nothing here signs and nothing is switched on for release.
--
-- Founder decision 2026-10-30: TSH is not part of the Membership Plus yearly blood panel. A doctor orders it only when a patient needs it (the
-- existing clinician "Order a lab test" flow, "Thyroid Function (TSH, Free T4)", which gives the patient a request to take to any laboratory or a
-- partner laboratory). Every other analyte, range, critical limit, sex-specific range and flag on v3 is carried over untouched (copied from the live
-- row, not retyped).
--
-- Counts first (live 2026-10-30): 3 membership_annual panel versions, v3 active; 0 lab results carry a membership_annual panel version, so there is
-- nothing to convert and nothing that this changes (a result keeps the version it was judged under, INV-16).
--
-- NOTE, same as S46d (20261020183958): v4 becomes the ACTIVE panel version when this migration applies (a panel version is not gated by the sign-off
-- row; release stays governed by it), and a draft sign-off is created below for the Chief Medical Officer to sign with sign_lab_panels(). Consequence
-- to know about: private.classify_lab_result and propose_lab_code_mapping refuse an analyte that is not on the active panel (lab_unknown_analyte), so a
-- yearly-panel submission that carries a tsh value is refused from now on. A TSH ordered by a doctor is not a yearly-panel result.
-- The DB proofs that sent tsh as part of a full panel are updated in the same change.

do $$
declare v3 public.lab_panel_versions%rowtype;
begin
  select * into v3 from public.lab_panel_versions where panel_code = 'membership_annual' and version = 3;
  if not found then raise exception 'membership_annual v3 not found'; end if;
  if exists (select 1 from public.lab_panel_versions where panel_code = 'membership_annual' and version >= 4) then raise exception 'membership_annual already has a version 4'; end if;
  if not exists (select 1 from jsonb_array_elements(v3.analytes) a where a ->> 'code' = 'tsh') then raise exception 'tsh is not on membership_annual v3'; end if;
  update public.lab_panel_versions set is_active = false where id = v3.id;
  insert into public.lab_panel_versions (panel_code, version, is_active, analytes, note)
  values ('membership_annual', 4, true,
    (select jsonb_agg(a order by ord) from jsonb_array_elements(v3.analytes) with ordinality t(a, ord) where a ->> 'code' <> 'tsh'),
    'v3 minus TSH (founder decision 2026-10-30: a doctor orders TSH only when a patient needs it; it is not part of the yearly panel). Every other analyte is v3 unchanged. PROPOSED, not signed; the CMO signs through lab_panel_signoffs.');
end $$;

-- A draft lab sign-off for the CMO to sign with panel v4 in view. It carries the same release policy as the SIGNED, ACTIVE sign-off (never an unsigned
-- draft, which may hold unreviewed edits); it is NOT signed and NOT active, so which sign-off governs result release does not change.
do $$
declare v_n integer;
begin
  insert into public.lab_panel_signoffs (version, is_active, config, notes)
  select (select max(version) from public.lab_panel_signoffs) + 1, false, l.config,
         'TSH removal: panel membership_annual v4 is v3 without TSH (founder decision 2026-10-30). Same release policy as the signed sign-off version ' || l.version || '. PROPOSED, unsigned: sign_lab_panels() by the CMO.'
    from public.lab_panel_signoffs l where l.is_active and l.approved_by is not null;
  get diagnostics v_n = row_count;
  -- Production has one signed, active sign-off. A fresh database (CI replay, a local reset) has none, because signing is the CMO's act and nothing here signs.
  if v_n = 0 then
    raise notice 'TSH removal: no signed active lab sign-off here (a fresh database); no draft sign-off created. The CMO signs one before panel v4 releases results.';
  elsif v_n <> 1 then
    raise exception 'TSH removal: expected at most one signed active lab sign-off, found %', v_n;
  end if;
end $$;

-- Self-checks ---------------------------------------------------------------------------------------------------------------------
do $$
begin
  if (select count(*) from public.lab_panel_versions where is_active) <> 1 then raise exception 'TSH removal self-check: expected one active panel version'; end if;
  if (select version from public.lab_panel_versions where is_active) <> 4 then raise exception 'TSH removal self-check: v4 is not the active panel version'; end if;
  if (select jsonb_array_length(analytes) from public.lab_panel_versions where is_active) <> 18 then raise exception 'TSH removal self-check: expected 18 analytes'; end if;
  if exists (select 1 from public.lab_panel_versions v, jsonb_array_elements(v.analytes) a where v.is_active and a ->> 'code' = 'tsh') then raise exception 'TSH removal self-check: tsh is still on the active panel'; end if;
  -- nothing else moved: v4 is v3 minus tsh, analyte for analyte, in order
  if (select analytes from public.lab_panel_versions where panel_code = 'membership_annual' and version = 4)
     <> (select jsonb_agg(a order by ord) from public.lab_panel_versions v3, jsonb_array_elements(v3.analytes) with ordinality t(a, ord)
          where v3.panel_code = 'membership_annual' and v3.version = 3 and a ->> 'code' <> 'tsh') then
    raise exception 'TSH removal self-check: v4 differs from v3 by more than tsh';
  end if;
  if exists (select 1 from public.lab_panel_signoffs where is_active and approved_by is not null)
     and not exists (select 1 from public.lab_panel_signoffs where not is_active and approved_by is null and notes like 'TSH removal:%') then raise exception 'TSH removal self-check: no draft lab sign-off'; end if;
end $$;
