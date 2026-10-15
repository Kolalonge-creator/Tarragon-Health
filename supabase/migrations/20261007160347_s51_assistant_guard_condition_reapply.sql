-- S51: re-apply the assistant_enabled branch of private.go_live_conditions, AFTER every other migration that redefines that function.
--
-- Why this file exists: private.go_live_conditions is a single function that several sessions replace WHOLE (S37, S37b, S28c). S28c, which sorts
-- after the S51 guard migration, replaced it again without the assistant_enabled branch, so on a fresh replay the branch is gone and the guard
-- would read as "no conditions" (a guard with no conditions is never satisfied, so it fails closed, but the screen would show nothing to meet).
-- This migration adds the branch back to whatever the CURRENT body is. It is idempotent: when the branch is already there it does nothing.
--
-- It cannot stop a LATER session from replacing the function whole again; what catches that is the proof
-- packages/db/tests/s51_assistant_guard_and_knowledge.sql, which asserts the assistant_enabled conditions on a full replay and fails loudly.
-- A session that replaces private.go_live_conditions must keep the assistant_enabled branch (see docs/design/S51.md).
do $$
declare
  v_def text := pg_get_functiondef('private.go_live_conditions(text,uuid)'::regprocedure);
  v_patched text;
begin
  if v_def not like '%assistant_enabled%' then
    v_patched := regexp_replace(v_def, '(\nbegin\n)', E'\\1  if p_key = ''assistant_enabled'' then return private.go_live_conditions_assistant(p_org); end if;\n', 'n');
    if v_patched = v_def or v_patched not like '%assistant_enabled%' then
      raise exception 'could not add the assistant_enabled branch to private.go_live_conditions';
    end if;
    execute v_patched;
  end if;
  if pg_get_functiondef('private.go_live_conditions(text,uuid)'::regprocedure) not like '%go_live_conditions_assistant%' then
    raise exception 'assistant_enabled conditions are not wired into private.go_live_conditions';
  end if;
end $$;
