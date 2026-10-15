-- S39: on a fresh database (local stack, CI replay) `anon` is granted table privileges the live project never had.
-- Production already has none outside the reviewed public-content tables, so this changes nothing there; it makes a
-- replay match production so the S39 catalog proof (2a) holds everywhere.
do $$
declare r record;
begin
  for r in
    select n.nspname, c.relname
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('public', 'private', 'analytics') and c.relkind in ('r', 'v', 'm', 'f', 'p')
       and (n.nspname || '.' || c.relname) not in (
         'public.consent_versions', 'public.public_impact_metrics', 'public.patient_testimonials',
         'public.marketing_resources', 'public.passport_signing_keys', 'public.doctor_testimonials')
       and exists (select 1 from information_schema.role_table_grants g
                    where g.grantee = 'anon' and g.table_schema = n.nspname and g.table_name = c.relname)
  loop
    execute format('revoke all on %I.%I from anon', r.nspname, r.relname);
  end loop;
end $$;
