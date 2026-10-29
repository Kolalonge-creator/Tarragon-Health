-- Found by /code-review high on migration 20261029192438: private.is_sensitive_analyte_code matched HIV and hepatitis C/B surface
-- antigen by prefix but not hepatitis B viral markers (hbv_dna) or HIV monitoring markers (cd4, viral load), which are just as
-- sensitive. A patient could have been offered those for self-confirmation onto their own chart. Widened; still conservative.
create or replace function private.is_sensitive_analyte_code(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_code is null
      or lower(p_code) ~ '^(hiv|hbsag|hbs|hbv|hbe|hcv|hep|hepatitis|cd4|cd8|viral|vl_|tpha|treponem|syphilis|rpr|vdrl|chlamydia|gonorrh|ct_ng)'
      or exists (select 1 from public.screen_types st where st.sensitive and lower(st.code) = lower(p_code))
$$;

do $$
begin
  if not (private.is_sensitive_analyte_code('hbv_dna') and private.is_sensitive_analyte_code('cd4_count')
          and private.is_sensitive_analyte_code('viral_load') and private.is_sensitive_analyte_code('hiv')
          and private.is_sensitive_analyte_code('hep_b') and private.is_sensitive_analyte_code(null)) then
    raise exception 'a sensitive analyte code is not recognised as sensitive';
  end if;
  if private.is_sensitive_analyte_code('hba1c') or private.is_sensitive_analyte_code('ldl') or private.is_sensitive_analyte_code('creatinine') then
    raise exception 'an ordinary analyte code is wrongly treated as sensitive';
  end if;
end $$;
