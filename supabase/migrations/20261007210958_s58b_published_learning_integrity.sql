-- S58b (S55-06b): a published learning item keeps the evidence it was published on.
--
-- The S55 publish gate checks the reviewer, review date and source only at the MOMENT an item becomes published. Nothing stopped a
-- later edit of a still-published (or review_due, still served) item from clearing them, which would leave live content with no named
-- reviewer or source and, for a creator's item, a paid fee with nothing behind it. This trigger refuses that: while an item stays
-- published or review_due, its named reviewer, review date, clinician_reviewed flag and source cannot be cleared or blanked. Changing
-- them to other real values is still allowed (a re-review). To remove evidence, take the item out of service first.
-- It also refuses to publish a micro-lesson whose check question has fewer than two answer options or an answer_index outside them,
-- so the draft check questions seeded without options cannot go live unfinished.
--
-- Rows affected: 0 (a trigger only). Counts to record in the dry run: select count(*) from health_education_content
-- where content_status in ('published','review_due') and (reviewed_by_name is null or reviewed_at is null
-- or (source_reference is null and evidence_source is null)); any row listed was already missing evidence before this trigger.

create or replace function private.health_education_published_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_q jsonb;
begin
  if tg_op = 'UPDATE'
     and old.content_status in ('published', 'review_due') and new.content_status in ('published', 'review_due') then
    if old.reviewed_by_name is not null and (new.reviewed_by_name is null or char_length(btrim(new.reviewed_by_name)) < 3) then
      raise exception 'A published item keeps its named clinical reviewer' using errcode = '23514';
    end if;
    if old.reviewed_at is not null and new.reviewed_at is null then
      raise exception 'A published item keeps its review date' using errcode = '23514';
    end if;
    if old.clinician_reviewed and not coalesce(new.clinician_reviewed, false) then
      raise exception 'A published item keeps its clinician-reviewed mark' using errcode = '23514';
    end if;
    if (old.source_reference is not null or old.evidence_source is not null)
       and (new.source_reference is null or char_length(btrim(new.source_reference)) < 3)
       and (new.evidence_source is null or char_length(btrim(new.evidence_source)) < 3) then
      raise exception 'A published item keeps its source' using errcode = '23514';
    end if;
  end if;
  if new.content_status = 'published' and new.is_micro_lesson
     and (tg_op = 'INSERT' or old.content_status is distinct from 'published') then
    for v_q in select value from jsonb_array_elements(case when jsonb_typeof(new.knowledge_check) = 'array' then new.knowledge_check else '[]'::jsonb end) loop
      if jsonb_typeof(v_q -> 'options') is distinct from 'array' or jsonb_array_length(v_q -> 'options') < 2
         or jsonb_typeof(v_q -> 'answer_index') is distinct from 'number'
         or (v_q ->> 'answer_index')::integer < 0 or (v_q ->> 'answer_index')::integer >= jsonb_array_length(v_q -> 'options') then
        raise exception 'A micro-lesson check question needs at least two options and a valid answer' using errcode = '23514';
      end if;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function private.health_education_published_integrity() from public, anon, authenticated;

drop trigger if exists health_education_published_integrity on public.health_education_content;
create trigger health_education_published_integrity
  before insert or update on public.health_education_content
  for each row execute function private.health_education_published_integrity();

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'health_education_published_integrity' and not tgisinternal) then
    raise exception 'S58b: the published-integrity trigger is missing';
  end if;
end $$;
