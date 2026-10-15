-- S80 (25.10): AI model cost by feature.
--
-- Reconciled first. Every governed AI call already writes `ai_interaction_log` with `model_identifier` and token counts
-- (`input_token_count`, `output_token_count`), and `ai_systems` names the feature. What was missing: any price. Nothing here
-- invents one.
--
--   public.ai_model_prices        append-only price list per model: input and output price per million tokens in INTEGER minor units
--                                 of the row's currency, valid from a date. PROPOSED and unsigned (config_status, signed_* stay
--                                 null: no function signs it; a person must). Ships EMPTY. A price is entered through
--                                 add_ai_model_price with a source note saying where the number came from.
--   public.add_ai_model_price()   admin or ai_governance.manage. Audited.
--   public.ai_cost_by_feature()   admin or ai_governance.manage (an admin sees the platform, anyone else their organisation).
--                                 Joins each logged call to the price valid when it was made. Where no price (or no token count)
--                                 exists the cost is NULL, never a guess and never zero. Audited on every read (it is a read of
--                                 usage across the platform). Cost is returned as `cost_millionths_minor`: millionths of a minor unit,
--                                 an exact integer (tokens x price per million), so no float is involved; divide by 1,000,000 to show.
--                                 ai_interaction_log has no is_test column, so there is nothing to exclude; this is stated on the screen.
-- Counts at write time: ai_model_prices is new and empty; no existing rows are changed.

create table public.ai_model_prices (
  id                        uuid primary key default gen_random_uuid(),
  model_identifier          text not null check (char_length(btrim(model_identifier)) > 0),
  input_per_million_minor   bigint not null check (input_per_million_minor >= 0),
  output_per_million_minor  bigint not null check (output_per_million_minor >= 0),
  currency                  text not null check (currency ~ '^[A-Z]{3}$'),
  valid_from                timestamptz not null,
  config_status             text not null default 'PROPOSED' check (config_status = 'PROPOSED'),
  signed_by                 text,
  signed_at                 timestamptz,
  source_note               text not null check (char_length(btrim(source_note)) >= 10),
  created_by                uuid references public.profiles (id) on delete set null,
  created_at                timestamptz not null default now(),
  unique (model_identifier, valid_from)
);
alter table public.ai_model_prices enable row level security;
create policy ai_model_prices_read on public.ai_model_prices for select to authenticated using (private.has_permission('ai_governance.manage'));
revoke all on public.ai_model_prices from anon, authenticated;
grant select on public.ai_model_prices to authenticated;

create function private.ai_model_prices_append_only() returns trigger
language plpgsql set search_path = ''
as $$ begin raise exception 'ai_model_prices is append-only: add a new price with a later valid_from' using errcode = '42501'; end $$;
create trigger ai_model_prices_no_change before update or delete on public.ai_model_prices
  for each row execute function private.ai_model_prices_append_only();

create function public.add_ai_model_price(
  p_model text, p_input_per_million_minor bigint, p_output_per_million_minor bigint, p_currency text, p_valid_from timestamptz, p_source_note text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if (select auth.uid()) is null or not private.has_permission('ai_governance.manage') then
    raise exception 'you may not enter AI model prices' using errcode = '42501';
  end if;
  insert into public.ai_model_prices (model_identifier, input_per_million_minor, output_per_million_minor, currency, valid_from, source_note, created_by)
  values (btrim(p_model), p_input_per_million_minor, p_output_per_million_minor, upper(btrim(p_currency)), p_valid_from, btrim(p_source_note), (select auth.uid()))
  returning id into v_id;
  perform private.log_audit('ai.model_price_added', 'ai_model_prices', v_id,
    jsonb_build_object('model', btrim(p_model), 'currency', upper(btrim(p_currency)), 'valid_from', p_valid_from));
  return v_id;
exception when check_violation or not_null_violation then
  raise exception 'those price details were not accepted' using errcode = '22023';
end $$;
revoke all on function public.add_ai_model_price(text, bigint, bigint, text, timestamptz, text) from public, anon;
grant execute on function public.add_ai_model_price(text, bigint, bigint, text, timestamptz, text) to authenticated;

create function public.ai_cost_by_feature(p_from timestamptz, p_to timestamptz)
returns table (
  system_code text, system_name text, model_identifier text, currency text,
  interactions bigint, input_tokens bigint, output_tokens bigint, priced_interactions bigint, cost_millionths_minor bigint
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_all boolean := private.is_admin();
  v_org uuid := private.current_org_id();
begin
  if (select auth.uid()) is null or not private.has_permission('ai_governance.manage') then
    raise exception 'you may not read AI cost' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '400 days' then
    raise exception 'give a start and an end, at most 400 days apart' using errcode = '22023';
  end if;
  perform private.log_audit('ai.cost_viewed', 'ai_systems', null,
    jsonb_build_object('from', p_from, 'to', p_to, 'scope', case when v_all then 'platform' else 'organisation' end));

  return query
    with calls as (
      select l.ai_system_id, l.model_identifier, l.input_token_count, l.output_token_count,
             pr.currency as price_currency, pr.input_per_million_minor, pr.output_per_million_minor
        from public.ai_interaction_log l
        left join lateral (
          select p.currency, p.input_per_million_minor, p.output_per_million_minor
            from public.ai_model_prices p
           where p.model_identifier = l.model_identifier and p.valid_from <= l.created_at
           order by p.valid_from desc limit 1) pr on true
       where l.created_at >= p_from and l.created_at < p_to and (v_all or l.organisation_id = v_org)
    )
    select s.system_code, s.name, c.model_identifier, c.price_currency,
           count(*)::bigint,
           coalesce(sum(c.input_token_count), 0)::bigint,
           coalesce(sum(c.output_token_count), 0)::bigint,
           count(*) filter (where c.price_currency is not null and (c.input_token_count is not null or c.output_token_count is not null))::bigint,
           sum(case when c.price_currency is not null and (c.input_token_count is not null or c.output_token_count is not null)
                    then coalesce(c.input_token_count, 0)::bigint * c.input_per_million_minor + coalesce(c.output_token_count, 0)::bigint * c.output_per_million_minor
               end)::bigint
      from calls c join public.ai_systems s on s.id = c.ai_system_id
     group by s.system_code, s.name, c.model_identifier, c.price_currency
     order by s.system_code, c.model_identifier, c.price_currency nulls last;
end $$;
revoke all on function public.ai_cost_by_feature(timestamptz, timestamptz) from public, anon;
grant execute on function public.ai_cost_by_feature(timestamptz, timestamptz) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.ai_cost_by_feature(timestamptz, timestamptz)', 'EXECUTE')
     or has_function_privilege('anon', 'public.add_ai_model_price(text, bigint, bigint, text, timestamptz, text)', 'EXECUTE') then
    raise exception 'ai cost functions are executable by anon';
  end if;
  if has_table_privilege('authenticated', 'public.ai_model_prices', 'INSERT') or has_table_privilege('anon', 'public.ai_model_prices', 'SELECT') then
    raise exception 'ai_model_prices has a grant it must not have';
  end if;
  if (select count(*) from public.ai_model_prices) <> 0 then raise exception 'ai_model_prices must ship empty'; end if;
end $$;
