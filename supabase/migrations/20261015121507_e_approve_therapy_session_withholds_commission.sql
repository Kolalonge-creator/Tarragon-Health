-- Track E (8.16), part 2: public.approve_therapy_session (SECURITY DEFINER) returns the whole therapy_sessions row, so a clinician calling it over the
-- API receives commission_kobo in the response body even though the column is off the authenticated surface. S56 replaced the function (three
-- arguments, returns the row, a refusal returns null) after Track E was written, so Track E's void version no longer applies. This patches the
-- CURRENT definition in place: the returned row has commission_kobo cleared before it is handed back. The signature, the null-on-refusal contract
-- the queue relies on, the grants and every other line are untouched.
do $$
declare
  v_fn regprocedure;
  v_def text;
  v_new text;
begin
  v_fn := to_regprocedure('public.approve_therapy_session(uuid, boolean, timestamptz)');
  if v_fn is null then raise exception 'Track E: approve_therapy_session(uuid, boolean, timestamptz) not found'; end if;
  v_def := pg_get_functiondef(v_fn);
  if v_def like '%v_row.commission_kobo := null%' then return; end if;
  v_new := replace(v_def, E'  return v_row;', E'  v_row.commission_kobo := null; -- Track E: the commission never leaves the database through this function\n  return v_row;');
  if v_new = v_def then raise exception 'Track E: approve_therapy_session marker not found (definition drifted)'; end if;
  execute v_new;
end $$;

do $$
begin
  if pg_get_functiondef('public.approve_therapy_session(uuid, boolean, timestamptz)'::regprocedure) not like '%v_row.commission_kobo := null%' then
    raise exception 'FAIL: approve_therapy_session still returns commission_kobo';
  end if;
  if has_function_privilege('anon', 'public.approve_therapy_session(uuid, boolean, timestamptz)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.approve_therapy_session(uuid, boolean, timestamptz)', 'EXECUTE') then
    raise exception 'FAIL: approve_therapy_session grants are wrong';
  end if;
end $$;
