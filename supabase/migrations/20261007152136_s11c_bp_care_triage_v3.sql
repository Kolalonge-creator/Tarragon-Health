-- S11c: bp_care_triage v3 = version 2 (the CMO's decisions of 2026-10-05) with the silence line moved from 5 days to 7 (decision S11-1,
-- founder and CMO, 2026-10-07).
--
-- Why version 3 and not an edit: a signed rule set is never edited (an approved row is immutable), and version 2 is retired.
-- What happened: the CMO approved version 2 on 2026-10-06 17:45 UTC. At 23:24 the older version 1 (16 rules, still a draft) was approved,
-- and approving a rule set retires whichever one is approved, so version 2 was retired and the live rules went back to the older set (no 200/130
-- symptom question, no 2 hour recheck, no under-90 flag, no postpartum handling). `approve_triage_rule_set` has no "never approve an older
-- version than the one live" guard, which is the same hazard that was closed for the ten other governed tables on 2026-10-06; this migration
-- adds that guard for rule sets too (below).
--
-- The guard does not remove the way back: to return to older rules on purpose, insert a NEW higher version that copies the older rules and approve that
-- (the version number records the decision; nothing is rolled back silently).
--
-- This row is derived in SQL from the stored version 2 (not retyped): same rules and parameters, `version` 3 and `params.silence.days` 7.
-- It stays a DRAFT. Nothing about live behaviour changes until the CMO approves it with `approve_triage_rule_set`, which retires version 1 and
-- approves version 3. Spec safety case 7 says 5 days; the departure is recorded in docs/DECISIONS.md (S11-1) and OQ-273.
begin;

insert into public.triage_rule_sets (code, version, status, rules, note)
select code, 3, 'draft',
       jsonb_set(jsonb_set(rules, '{version}', '3'::jsonb), '{params,silence,days}', '7'::jsonb),
       'bp_care_triage v3: version 2 (CMO decisions 2026-10-05) with the silence line 5 days to 7 (S11-1, 2026-10-07). DRAFT: the CMO approves it with approve_triage_rule_set; it restores version 2 after the 2026-10-06 23:24 rollback.'
  from public.triage_rule_sets
 where code = 'bp_care_triage' and version = 2
on conflict (code, version) do nothing;

-- Never approve an older version than one already approved (the roll-back hazard). approve_triage_rule_set retires the current one and approves
-- the named one; if the named one is older than the highest version that has ever been approved, refuse.
create or replace function private.refuse_approving_older_rule_set() returns trigger
language plpgsql set search_path = '' as $$
declare v_newest integer;
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    select max(version) into v_newest from public.triage_rule_sets
     where code = new.code and approved_at is not null and id <> new.id;
    if v_newest is not null and new.version < v_newest then
      raise exception 'rule set % version % is older than version % which has already been approved; approve a newer version instead of rolling back', new.code, new.version, v_newest
        using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.refuse_approving_older_rule_set() from public;
drop trigger if exists triage_rule_sets_never_approve_older on public.triage_rule_sets;
create trigger triage_rule_sets_never_approve_older before insert or update of status on public.triage_rule_sets
  for each row execute function private.refuse_approving_older_rule_set();

do $$
declare v2 jsonb; v3 jsonb; v_status text;
begin
  select rules into v2 from public.triage_rule_sets where code = 'bp_care_triage' and version = 2;
  select rules, status into v3, v_status from public.triage_rule_sets where code = 'bp_care_triage' and version = 3;
  if v2 is null then raise exception 'S11c self-check: bp_care_triage v2 is missing'; end if;
  if v3 is null then raise exception 'S11c self-check: bp_care_triage v3 was not created'; end if;
  if v_status <> 'draft' then raise exception 'S11c self-check: v3 must be a draft until the CMO approves it, found %', v_status; end if;
  if (v3 #>> '{params,silence,days}')::int <> 7 then raise exception 'S11c self-check: v3 silence line is not 7'; end if;
  if ((v3 #- '{params,silence,days}') - 'version') is distinct from ((v2 #- '{params,silence,days}') - 'version') then
    raise exception 'S11c self-check: v3 differs from v2 in more than the version and the silence line';
  end if;
end $$;

commit;
