-- OQ-666 follow-up (CMO OQ-358): put the admin / CMO search by MDCN folio back, through a staff-only door.
--
-- Live facts read 2026-10-30 from koiplnmbgnqnbywhpjlf: OQ-666 itself (the directory view returning the folio to patients) was already
-- closed by 20261015004428 (view has no credential_number) and 20261022114116 (clinical_staff base table: no SELECT on the column for
-- authenticated; public.clinical_staff_folio() is the reader). One regression remained: /api/admin/search matched clinicians on the
-- column through the caller's session, and a folio is no longer a search column there, so typing a folio found no clinician.
--
-- This function returns clinical_staff ids whose folio contains the term, only to the callers entitled to read a folio
-- (private.can_credential_review(): admin or CMO) and only for their own organisation. Anyone else gets zero rows, never an error,
-- so it cannot be used to test whether a folio exists. It returns ids only; the route shows the folio through clinical_staff_folio().
-- No existing function is changed; no overload is added.

create function public.search_clinical_staff_by_folio(p_term text)
returns table (clinical_staff_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_term text := btrim(coalesce(p_term, ''));
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  -- two characters at least, so a one-letter probe cannot walk the register; wildcards in the term are literal
  if length(v_term) < 2 or not private.can_credential_review() then return; end if;
  return query
    select cs.id
      from public.clinical_staff cs
     where cs.credential_number is not null
       and private.is_org_staff(cs.organisation_id)
       and strpos(lower(cs.credential_number), lower(v_term)) > 0
     order by cs.full_name
     limit 6;
end;
$$;

comment on function public.search_clinical_staff_by_folio(text) is
  'Ids of clinicians whose MDCN folio contains the term, for admin and the CMO (private.can_credential_review(), same organisation) only; anyone else gets zero rows. The folio itself is read through clinical_staff_folio(). CMO OQ-358 / OQ-666.';

revoke all on function public.search_clinical_staff_by_folio(text) from public, anon;
grant execute on function public.search_clinical_staff_by_folio(text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.search_clinical_staff_by_folio(text)', 'EXECUTE') then
    raise exception 'anon can execute search_clinical_staff_by_folio';
  end if;
  if not has_function_privilege('authenticated', 'public.search_clinical_staff_by_folio(text)', 'EXECUTE') then
    raise exception 'authenticated cannot execute search_clinical_staff_by_folio';
  end if;
  if has_column_privilege('authenticated', 'public.clinical_staff', 'credential_number', 'SELECT') then
    raise exception 'authenticated can read the folio column again';
  end if;
end $$;

notify pgrst, 'reload schema';
