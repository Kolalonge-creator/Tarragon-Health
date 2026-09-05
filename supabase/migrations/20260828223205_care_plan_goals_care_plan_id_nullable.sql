alter table public.care_plan_goals alter column care_plan_id drop not null;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'care_plan_goals'
      and column_name = 'care_plan_id' and is_nullable = 'NO'
  ) then
    raise exception 'care_plan_goals.care_plan_id is still NOT NULL';
  end if;
  raise notice 'PASS: care_plan_goals.care_plan_id is nullable';
end $$;
