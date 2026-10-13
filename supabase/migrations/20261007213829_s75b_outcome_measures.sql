-- S75b (slimmed): the programme reporting configuration that S75c reads: response-time bands, retention days and the sponsor-pack wording.
-- Design: docs/design/S75.md. Research: docs/research/S75.md.
--
-- WHY SLIMMED. This file first built a second set of HbA1c, weight, PHQ-9 and GAD-7 outcome snapshots (its own `outcome_measure_snapshots`, compute job,
-- report and safeguarding follow-up). S75 track D (#1094) built the same measures first and is the one design that ships (founder decision 2026-10-13):
-- `outcome_measure_snapshots` (HbA1c, weight) and `outcome_mh_snapshots` (PHQ-9, GAD-7) with the config in `outcome_config`. Two tables with the same name
-- cannot both exist, so everything about the measures was removed from this file. What is left is only what S75c needs and #1094 does not have:
--   * outcome_measure_config: versioned, PROPOSED, CMO owned, mirrored as `outcomes.measures` in the code registry (drift test). Immutable once written
--     (a change is a new version). It now holds response_times, retention and pack ONLY.
--   * private.outcome_measure_rule(path): reads one value of the active version.
-- The measure definitions, windows, goals, exclusions and severity bands live in outcome_config (v3, and v4 from 20261013221500_s75_outcome_exclusions_and_bands.sql).
-- Nothing is signed by this migration.

create table public.outcome_measure_config (
  version     integer primary key check (version >= 1),
  is_active   boolean not null default false,
  owner       text not null default 'CMO',
  config      jsonb not null check (jsonb_typeof(config) = 'object'),
  note        text,
  created_at  timestamptz not null default now()
);
create unique index outcome_measure_config_one_active on public.outcome_measure_config ((true)) where is_active;
alter table public.outcome_measure_config enable row level security;
revoke all on public.outcome_measure_config from public, anon, authenticated;

-- A sign-off binds to a version, so the value of a version may never change after the fact (only is_active may).
create function private.outcome_measure_config_immutable() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'outcome_measure_config_immutable' using errcode = 'P0001'; end if;
  if new.config is distinct from old.config or new.version is distinct from old.version or new.owner is distinct from old.owner then
    raise exception 'outcome_measure_config_immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger outcome_measure_config_immutable before update or delete on public.outcome_measure_config
  for each row execute function private.outcome_measure_config_immutable();
revoke all on function private.outcome_measure_config_immutable() from public, anon, authenticated;

-- measures-rules-begin
insert into public.outcome_measure_config (version, is_active, config, note) values (1, true, $json$
{
  "response_times": {
    "min_clinicians_per_group": 3,
    "priority_bands": {
      "urgent": [
        1,
        2
      ],
      "soon": [
        3,
        5
      ],
      "routine": [
        6,
        9
      ]
    }
  },
  "retention": {
    "days": [
      30,
      90,
      180
    ],
    "engaged_window_days": 30
  },
  "pack": {
    "evaluation_design": "What this pack is: a descriptive before-and-after summary of the members who agreed to share group figures, taken at the day they joined and again 90 and 180 days later. There is no comparison group, members were not chosen at random, and the people who stay are not the same as the people who leave. For these reasons the figures describe what happened to these members and cannot show what would have happened without the programme. Differences between months or groups can arise from who joined, not from anything the programme did.",
    "caveat": "A change in a measure is not a verdict on the programme. Results for the same programme will differ with who joined, how long they stayed and how often they were measured."
  }
}
$json$::jsonb, 'PROPOSED, v1 (2026-10-07). Owner: CMO. Response-time bands, retention days and the sponsor-pack wording. The outcome measures themselves are in outcome_config.');
-- measures-rules-end

create function private.outcome_measure_rule(p_path text[]) returns jsonb
language sql stable security definer set search_path = ''
as $$ select config #> p_path from public.outcome_measure_config where is_active $$;
revoke all on function private.outcome_measure_rule(text[]) from public, anon, authenticated;

do $$
begin
  if (select count(*) from public.outcome_measure_config where is_active) <> 1 then raise exception 'S75b: exactly one active config expected'; end if;
  if has_table_privilege('anon', 'public.outcome_measure_config', 'SELECT') or has_table_privilege('authenticated', 'public.outcome_measure_config', 'SELECT') then
    raise exception 'S75b: the config table must not be readable by a user';
  end if;
end $$;
