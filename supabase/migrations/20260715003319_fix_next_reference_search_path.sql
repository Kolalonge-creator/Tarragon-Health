-- Fixes the function_search_path_mutable advisory finding: next_reference()
-- only ever operates on its own already-resolved regclass/prefix arguments
-- (nextval/lpad/concatenation are all built-ins, no table references), so
-- pinning search_path='' is behavior-preserving, matching every other
-- private.* helper's security posture.
create or replace function private.next_reference(prefix text, seq regclass)
returns text
language sql
set search_path = ''
as $$
  select prefix || lpad(nextval(seq)::text, 6, '0');
$$;
