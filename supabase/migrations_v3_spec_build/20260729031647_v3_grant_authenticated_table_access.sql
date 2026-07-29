-- RLS policies restrict rows; the `authenticated` role also needs the base SQL-level GRANT on
-- the table itself, which Supabase normally provisions automatically at project creation --
-- dropping and recreating the public schema mid-project does not restore that. Grant broadly
-- (standard Supabase pattern) and let the RLS policies already in place do the real restriction:
-- a table/role with no matching policy still returns zero rows / affects zero rows, it does not
-- error, so this does not widen access beyond what the policies already allow.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage on sequences to authenticated;

-- audit_log stays append-only even under this broader grant (UPDATE/DELETE already revoked
-- explicitly earlier; re-affirm here since the blanket grant above just re-added them).
revoke update, delete on audit_log from authenticated;
