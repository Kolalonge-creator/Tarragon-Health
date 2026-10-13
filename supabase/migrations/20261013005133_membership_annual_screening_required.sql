-- Membership annual panel v2: HIV screen, HBsAg and anti-HCV are REQUIRED every year (CMO decisions C1 and C6, 2026-10-08/12).
--
-- Found 2026-10-12 while building testing days: lab_panel_versions membership_annual v1 (S27g) carries these three analytes with
-- `optional: true` ("only if ordered"). That is the old risk-based design: a result missing all three was classified like a complete
-- one, could auto-release once the CMO signs, and the entry screens labelled them "only if ordered". The CMO decided they are done
-- every year, so they must be required: a result without them is `incomplete` and waits for a clinician.
--
-- A new immutable version (never an edit of v1): v2 is v1 with `optional` removed from exactly these three analytes. v1 is made
-- inactive; any result already stored against v1 keeps its version (INV-16). Counts before this migration (live 2026-10-12):
-- S27 is not yet applied live, so there are no lab results at all. The sign-off draft (lab_panel_signoffs v2) is NOT touched and nothing
-- is signed: it names panel v1 and the CMO must be shown v2 before signing (reported, not changed here).
--
-- Mirror: packages/shared/src/proposed-config registry `lab.panels` v3, checked by lab-panels-mirror.test.ts.
begin;

do $$
declare v1 public.lab_panel_versions%rowtype; v_an jsonb;
begin
  select * into v1 from public.lab_panel_versions where panel_code = 'membership_annual' and version = 1;
  if not found then raise exception 'membership_annual v1 not found'; end if;
  if exists (select 1 from public.lab_panel_versions where panel_code = 'membership_annual' and version >= 2) then
    raise exception 'membership_annual already has a version 2';
  end if;
  select jsonb_agg(case when a ->> 'code' in ('hiv_screen', 'hbsag', 'hcv_ab') then a - 'optional' else a end order by o)
    into v_an from jsonb_array_elements(v1.analytes) with ordinality as t(a, o);
  update public.lab_panel_versions set is_active = false where id = v1.id;
  insert into public.lab_panel_versions (panel_code, version, is_active, analytes, note)
  values ('membership_annual', 2, true, v_an,
    'v1 with HIV screen, HBsAg and anti-HCV made required (CMO C1/C6: every year, not risk-based). PROPOSED, not signed; the CMO signs through lab_panel_signoffs.');
end $$;

do $$
begin
  if (select count(*) from public.lab_panel_versions where is_active) <> 1 then raise exception 'self-check: expected one active panel version'; end if;
  if exists (select 1 from public.lab_panel_versions p, jsonb_array_elements(p.analytes) a
              where p.is_active and a ->> 'code' in ('hiv_screen', 'hbsag', 'hcv_ab') and coalesce((a ->> 'optional')::boolean, false)) then
    raise exception 'self-check: a screening analyte is still optional';
  end if;
  if (select jsonb_array_length(analytes) from public.lab_panel_versions where is_active) <> 18 then raise exception 'self-check: analyte count changed'; end if;
  if private.lab_panels_signed() then raise exception 'self-check: panels must still be unsigned'; end if;
end $$;

commit;
