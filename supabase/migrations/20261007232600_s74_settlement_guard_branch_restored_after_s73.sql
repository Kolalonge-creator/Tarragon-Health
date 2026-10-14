-- S74: put the partner_settlement_enabled guard branch back into private.go_live_conditions after S73 replaced the function.
--
-- S74 (20261007161302) gave private.go_live_conditions a branch for its settlement guard by wrapping the function. S73 (20261007164447, sorts after S74) then re-created
-- private.go_live_conditions whole from an older copy, which discarded that wrapper, so the settlement guard read as 'unknown_guard' and could never be satisfied (proof s74
-- check 4.9). S74 is already merged, so the repair is here. It adds the S74 branch to whatever the function is NOW, by the same in-place patch main-dev uses, and does
-- nothing if the branch is already present. It runs after S71 and S72 have wrapped the function (their wrappers keep the anchor).
do $patch$
declare
  v_def text := pg_get_functiondef('private.go_live_conditions(text, uuid)'::regprocedure);
  v_anchor constant text := E'\n  end if;\n  -- An unknown key has no conditions';
  v_branch constant text := $b$
  elsif p_key = 'partner_settlement_enabled' then
    return jsonb_build_array(
      private.go_live_cond('settlement_terms_approved', 'At least one approved settlement term',
        (select count(*) from public.partner_settlement_terms where approved_at is not null and (valid_to is null or valid_to > now())) > 0, 'data',
        (select count(*) from public.partner_settlement_terms where approved_at is not null and (valid_to is null or valid_to > now()))::text || ' approved'),
      private.go_live_cond('admin_confirmation', 'Admin confirmation', true, 'switch', 'Given by an admin pressing the switch'));$b$;
begin
  if v_def like '%partner_settlement_enabled%' then return; end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'private.go_live_conditions no longer ends with the expected fall-through; add the settlement branch by hand' using errcode = '55000';
  end if;
  execute replace(v_def, v_anchor, v_branch || v_anchor);
end $patch$;
