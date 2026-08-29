grant execute on function private.has_permission(text) to anon;

do $$
begin
  if not has_function_privilege('anon', 'private.has_permission(text)', 'EXECUTE') then
    raise exception 'anon still lacks EXECUTE on private.has_permission(text) after grant';
  end if;
end $$;
