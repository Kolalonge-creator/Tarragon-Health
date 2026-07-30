-- Tarragon Control — M3: grant USAGE on the private schema
--
-- 0002_rls.sql revoked ALL on schema private from authenticated
-- (correctly, to keep it locked down) but that also revoked USAGE, which
-- blocks resolving ANY private.* name at all -- not just calling one
-- without EXECUTE. Every SECURITY DEFINER function in this schema is
-- already individually EXECUTE-gated (and each checks private.current_role()
-- internally), so USAGE on the schema itself grants nothing sensitive by
-- itself; the real boundary stays per-function. Caught by the M3 exit
-- test the first time a test called a private.* function as an
-- authenticated (non-postgres) role, rather than by inspection.

grant usage on schema private to authenticated, service_role;
