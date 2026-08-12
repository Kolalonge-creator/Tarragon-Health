-- Tarragon Health — bring preventive_programmes into the same
-- protocol-sign-off governance ladder chronic_condition_programmes already
-- enforces.
--
-- Found during a 2026-08-10 preventative-programme review: unlike the 7
-- chronic conditions (each gated by private.enforce_chronic_programme_
-- protocol_signed(), which structurally refuses to flip is_active=true
-- without a matching signed protocol_versions row), preventive_programmes
-- (20260716191000_preventive_programmes.sql) has no protocol_slug column
-- and no equivalent gate at all — its 5 rows shipped is_active=true by
-- default with zero governance mechanism, and protocol_versions has zero
-- rows platform-wide (confirmed live, matches the same finding the
-- Diabetes/HTN/Obesity gap-closure docs already made for their own
-- pathways). This migration does not change today's live behaviour for
-- patients — all 5 rows stay exactly as active as they already were, since
-- the gate (mirroring the chronic pattern exactly) only fires on a
-- transition INTO is_active=true, never retroactively against a row that's
-- already there. What it adds: the DB can no longer be told to (re)activate
-- a dormant or new preventive programme without a real Clinical Director
-- signature behind it, the same discipline every chronic condition already
-- has, and each programme gets its own protocol_slug so Director sign-off
-- can happen per clinical domain rather than as one undifferentiated block.
--
-- Deliberately NOT modeled as a chronic_condition_programmes row: that
-- table's `condition` column is typed public.care_plan_condition and its
-- activation gate assumes the programme spawns a single condition's
-- care_plan — neither true for a screening programme, whose abnormal
-- results instead spawn one of the *existing* condition care_plans via
-- private.handle_abnormal_screening_result / screening_upgrades. Extending
-- care_plan_condition with a fake "prevention" member to force-fit this
-- table would misrepresent what that enum means everywhere else it's read.
-- A parallel, purpose-built gate on preventive_programmes itself is the
-- honest structural fit.
--
-- Also deliberately NOT touching the abnormal-result escalation trigger
-- itself: per CLAUDE.md's "never deprioritise or silently swallow an
-- abnormal screening result event," and matching how the chronic
-- pathways' own safety-net triggers (bp/lpe/foot-check) already run
-- unconditionally regardless of chronic_condition_programmes.is_active,
-- this governance layer gates catalogue *visibility/activation* only,
-- never the safety net.

alter table public.preventive_programmes
  add column if not exists protocol_slug text;

update public.preventive_programmes set protocol_slug = case code
  when 'annual_health_check'        then 'preventive_annual_health_check_who'
  when 'cardiometabolic_prevention' then 'preventive_cardiometabolic_who'
  when 'womens_health'              then 'preventive_womens_health_who'
  when 'mens_health'                then 'preventive_mens_health_who'
  when 'cancer_screening'           then 'preventive_cancer_screening_who'
end
where protocol_slug is null;

do $$
begin
  if exists (select 1 from public.preventive_programmes where protocol_slug is null) then
    raise exception 'FAIL: a preventive_programmes row has no protocol_slug backfilled — add a case branch above for its code';
  end if;
end $$;

alter table public.preventive_programmes
  alter column protocol_slug set not null;
alter table public.preventive_programmes
  add constraint preventive_programmes_protocol_slug_unique unique (protocol_slug);

-- --- activation gate ----------------------------------------------------
-- Byte-identical semantics to private.enforce_chronic_programme_protocol_
-- signed(): only fires on a transition INTO is_active=true (insert, or
-- update from false), so the 5 already-active rows are untouched by this
-- migration. Deactivation always allowed.
create or replace function private.enforce_preventive_programme_protocol_signed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_active and (tg_op = 'INSERT' or not old.is_active) then
    if not exists (
      select 1 from public.protocol_versions pv
      where pv.protocol_id = new.protocol_slug
    ) then
      raise exception
        'Cannot activate preventive programme "%": no signed protocol version exists for protocol "%". A Clinical Director must sign the protocol first.',
        new.code, new.protocol_slug
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists preventive_programmes_protocol_gate on public.preventive_programmes;
create trigger preventive_programmes_protocol_gate
  before insert or update on public.preventive_programmes
  for each row execute function private.enforce_preventive_programme_protocol_signed();

-- --- assertions -----------------------------------------------------------
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.preventive_programmes where is_active;
  if v_count <> 5 then
    raise exception 'FAIL: expected all 5 preventive_programmes rows to remain active (no retroactive deactivation), found %', v_count;
  end if;

  begin
    insert into public.preventive_programmes (code, name, protocol_slug, is_active)
    values ('__gate_test__', 'Gate test', 'no_such_signed_protocol', true);
    raise exception 'FAIL: inserting an active programme with an unsigned protocol_slug should have been rejected';
  exception
    when check_violation then
      raise notice 'PASS: gate correctly rejects activation without a signed protocol';
  end;

  -- An inactive insert must still succeed (matches the chronic pattern —
  -- cataloguing a not-yet-signed programme is fine, only activating isn't).
  insert into public.preventive_programmes (code, name, protocol_slug, is_active)
  values ('__gate_test_inactive__', 'Gate test inactive', 'no_such_signed_protocol', false);
  delete from public.preventive_programmes where code in ('__gate_test__', '__gate_test_inactive__');

  raise notice 'PASS: preventive_programmes protocol governance gate installed, 5 rows backfilled with distinct protocol_slugs, zero behaviour change to current activation state';
end $$;
