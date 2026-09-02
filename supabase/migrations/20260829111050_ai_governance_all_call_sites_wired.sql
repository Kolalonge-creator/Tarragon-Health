-- see supabase/migrations/20260829124416_ai_governance_all_call_sites_wired.sql
update public.ai_systems set runtime_governed = true where not runtime_governed;

do $$
declare
  v_ungoverned text;
begin
  select string_agg(system_code, ', ' order by system_code) into v_ungoverned
  from public.ai_systems where not runtime_governed;

  if v_ungoverned is not null then
    raise exception 'these AI systems still do not consult the registry: %', v_ungoverned;
  end if;

  if (select count(*) from public.ai_systems where runtime_governed) <> 10 then
    raise exception 'expected all 10 registered AI systems to be runtime-governed, found %',
      (select count(*) from public.ai_systems where runtime_governed);
  end if;

  if not (public.ai_runtime_config('AI-010')->>'runtime_governed')::boolean then
    raise exception 'AI-010 was not marked runtime-governed';
  end if;
end;
$$;
