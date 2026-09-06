create or replace function private.health_education_flag_content_on_protocol_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_condition public.care_plan_condition;
  v_flagged integer;
begin
  if new.version_number <= 1 then
    return new;
  end if;

  begin
    v_condition := new.protocol_id::public.care_plan_condition;
  exception when invalid_text_representation then
    return new;
  end;

  with flagged as (
    update public.health_education_content
    set content_status = 'review_due'
    where condition = v_condition
      and content_status in ('published')
    returning id
  )
  insert into public.health_education_content_status_history (content_id, from_status, to_status, note)
  select id, 'published', 'review_due',
    format('Protocol %s bumped to version %s (approved %s) — flagged for re-review', new.protocol_id, new.version_number, new.approved_at)
  from flagged;

  get diagnostics v_flagged = row_count;
  return new;
end;
$$;

drop trigger if exists health_education_flag_content_on_protocol_change on public.protocol_versions;
create trigger health_education_flag_content_on_protocol_change
  after insert on public.protocol_versions
  for each row execute function private.health_education_flag_content_on_protocol_change();
