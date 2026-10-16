-- S75a (convergence): three functions built by other tracks read a smallest-group number on their own, so they could drift from the one rule S75a
-- defines (private.min_cell_floor). The S75a proof scans every function body for exactly this and names these three:
--   * public.corporate_wellbeing_cohort (S56)   read the organisation's min_cohort_size alone (floor of 5)
--   * public.chain_reliability_report (P1)      read the platform minimum alone, with a hard-coded fallback of 20
--   * private.fund_min_cell (S72)               read the platform minimum alone
-- Each is PATCHED IN PLACE (the rest of the body is untouched) so any change a later migration made to it is kept. An organisation can raise its floor,
-- never lower it below the platform minimum, so the corporate cohort figure only gets stricter (it was 5 or the organisation's number; it is now the
-- greater of that and 20). Idempotent: a function already routed is left alone; a definition that has drifted raises rather than guesses.

do $do$
declare
  r record;
  v_def text;
begin
  for r in select * from (values
    ('public.corporate_wellbeing_cohort(uuid)',
     'greatest(coalesce(min_cohort_size, 10), 5) into v_min',
     'private.min_cell_floor(min_cohort_size) into v_min'),
    ('public.chain_reliability_report(integer)',
     'coalesce((private.outcome_rule(''min_cell'') #>> ''{}'')::integer, 20)',
     'private.min_cell_floor()'),
    ('private.fund_min_cell()',
     'greatest((private.outcome_rule(''min_cell'') #>> ''{}'')::integer, 2)',
     'greatest(private.min_cell_floor(), 2)')
  ) as t(fn, old_text, new_text) loop
    if to_regprocedure(r.fn) is null then
      raise exception 'S75a convergence: % does not exist', r.fn;
    end if;
    v_def := pg_get_functiondef(to_regprocedure(r.fn));
    if position('min_cell_floor' in v_def) > 0 then continue; end if;
    if position(r.old_text in v_def) = 0 then
      raise exception 'S75a convergence: the expected minimum-group read was not found in % (definition drifted)', r.fn;
    end if;
    execute replace(v_def, r.old_text, r.new_text);
  end loop;
end $do$;
