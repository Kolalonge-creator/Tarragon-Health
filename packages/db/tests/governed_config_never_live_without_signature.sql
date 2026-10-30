-- Tarragon Health: no governed configuration can be live without a signature (migration 20261029213217).
--
-- Proves, on every guarded table:
--   1. inserting a row that is active and unsigned is refused (SQLSTATE 23514, "cannot be live without a signature");
--   2. turning an unsigned row from inactive to active is refused;
--   3. taking the signature off a live, signed row is refused;
--   4. the control: an active row that IS signed is not refused by this guard (other guards may still object, but never this one);
--   5. registry: every public table with the governed shape (is_active + approved_by + approved_at) is either guarded or on the
--      explicit allowlist below, so a table added later fails here until someone decides which it is;
--   6. both triggers exist on every guarded table, and the function is not callable by anon.
--
-- Sabotage (inside this script, rolled back): drop the insert trigger and the update trigger on alert_rules; the same probes must
-- then be ALLOWED. If they are still refused the probes are not exercising this guard.
--
-- Run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/tests/governed_config_never_live_without_signature.sql

begin;

-- Other triggers on a table (older sibling guards, validators) can refuse the same write first and hide this guard, so each probe
-- switches every OTHER user trigger on the table off while it runs and back on afterwards. Only this guard can then be what refuses.
create function pg_temp.others(p_table text, p_on boolean) returns void
language plpgsql as $$
declare t record;
begin
  for t in select tgname from pg_trigger where tgrelid = ('public.' || quote_ident(p_table))::regclass and not tgisinternal
              and tgname not in ('zz_refuse_unsigned_activation_ins', 'zz_refuse_unsigned_activation_upd') loop
    execute format('alter table public.%I %s trigger %I', p_table, case when p_on then 'enable' else 'disable' end, t.tgname);
  end loop;
end $$;

-- 'refused' | 'allowed' | 'norow' | 'other: <sqlstate> <message>'
create function pg_temp.probe_insert_raw(p_table text, p_signed boolean) returns text
language plpgsql as $$
declare
  r jsonb;
begin
  execute format('select to_jsonb(t) from public.%I t limit 1', p_table) into r;
  if r is null then return 'norow'; end if;
  r := r || jsonb_build_object('id', gen_random_uuid(), 'is_active', true, 'approved_by', null,
                               'approved_at', case when p_signed then to_jsonb(now()) else 'null'::jsonb end);
  if r ? 'version' then r := r || jsonb_build_object('version', 900000 + floor(random() * 90000)::int); end if;
  begin
    execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)', p_table, p_table) using r;
    return 'allowed';
  exception when others then
    if sqlstate = '23514' and sqlerrm like '%cannot be live without a signature%' then return 'refused'; end if;
    return 'other: ' || sqlstate || ' ' || left(sqlerrm, 100);
  end;
end $$;

-- Deactivate one row, then try to reactivate it unsigned. 'skip' when the row cannot be deactivated first.
create function pg_temp.probe_reactivate_raw(p_table text) returns text
language plpgsql as $$
declare
  v_id uuid;
begin
  execute format('select id from public.%I order by is_active desc limit 1', p_table) into v_id;
  if v_id is null then return 'norow'; end if;
  begin
    execute format('update public.%I set is_active = false where id = $1', p_table) using v_id;
  exception when others then return 'skip'; end;
  begin
    execute format('update public.%I set is_active = true, approved_by = null, approved_at = null where id = $1', p_table) using v_id;
    return 'allowed';
  exception when others then
    if sqlstate = '23514' and sqlerrm like '%cannot be live without a signature%' then return 'refused'; end if;
    return 'other: ' || sqlstate || ' ' || left(sqlerrm, 100);
  end;
end $$;

-- Sign a row and make it live (allowed), then try to strip the signature while it is live.
create function pg_temp.probe_unsign_raw(p_table text) returns text
language plpgsql as $$
declare
  v_id uuid;
  v_signer uuid;
  v_fk regclass;
  v_signed boolean := false;
begin
  execute format('select id from public.%I order by is_active desc limit 1', p_table) into v_id;
  if v_id is null then return 'norow'; end if;
  -- approved_by points at profiles on some tables and clinical_staff on others: read the foreign key and take any row it allows
  select confrelid::regclass into v_fk from pg_constraint
   where conrelid = ('public.' || quote_ident(p_table))::regclass and contype = 'f'
     and conkey = array[(select attnum from pg_attribute where attrelid = ('public.' || quote_ident(p_table))::regclass and attname = 'approved_by')];
  if v_fk is not null then execute format('select id from %s limit 1', v_fk) into v_signer; end if;
  -- sign it and make it live (a signed, live row is exactly what this guard must protect); some tables want a signer, some forbid one
  begin
    execute format('update public.%I set approved_at = now(), approved_by = $2, is_active = true where id = $1', p_table) using v_id, v_signer;
    v_signed := true;
  exception when others then null; end;
  if not v_signed then
    begin
      execute format('update public.%I set approved_at = now(), approved_by = null, is_active = true where id = $1', p_table) using v_id;
      v_signed := true;
    exception when others then return 'skip'; end;
  end if;
  begin
    execute format('update public.%I set approved_at = null, approved_by = null where id = $1', p_table) using v_id;
    return 'allowed';
  exception when others then
    if sqlstate = '23514' and sqlerrm like '%cannot be live without a signature%' then return 'refused'; end if;
    return 'other: ' || sqlstate || ' ' || left(sqlerrm, 100);
  end;
end $$;

create function pg_temp.probe_insert(p_table text, p_signed boolean) returns text language plpgsql as $$
declare r text; begin
  perform pg_temp.others(p_table, false); r := pg_temp.probe_insert_raw(p_table, p_signed); perform pg_temp.others(p_table, true); return r; end $$;
create function pg_temp.probe_reactivate(p_table text) returns text language plpgsql as $$
declare r text; begin
  perform pg_temp.others(p_table, false); r := pg_temp.probe_reactivate_raw(p_table); perform pg_temp.others(p_table, true); return r; end $$;
create function pg_temp.probe_unsign(p_table text) returns text language plpgsql as $$
declare r text; begin
  perform pg_temp.others(p_table, false); r := pg_temp.probe_unsign_raw(p_table); perform pg_temp.others(p_table, true); return r; end $$;

do $$
declare
  v_guarded text[];
  -- governed-shaped tables that are deliberately NOT guarded, each for a named reason
  v_allow text[] := array[
    'legacy_notice_retirement_config',  -- switch-style: activation is the CMO's switch, separate from signing
    'unified_red_paging_config',        -- switch-style: activation is the CMO's switch, separate from signing
    'clinical_config_versions',         -- status-based ledger (draft/approved), one live row per kind
    'poc_panel_versions',               -- catalogue seeded active; approved_* is a review stamp
    'bp_target_config',                 -- no live row; own approval flow
    'pharmacy_partners',                -- approved_* is partner approval, not a configuration signature
    'ai_guardrails',                    -- AI governance registry: approval is a human judgement and is never seeded
    'ai_knowledge_sources',             -- AI governance registry: approval is a human judgement and is never seeded
    'ai_prompt_versions'                -- AI governance registry: approval is a human judgement and is never seeded
  ];
  v_t text;
  v_res text;
  v_n integer;
  v_refused integer := 0;
  v_other text := '';
  v_shape text[];
begin
  select array_agg(distinct c.relname::text order by c.relname::text) into v_guarded
    from pg_trigger tg join pg_class c on c.oid = tg.tgrelid
   where tg.tgname = 'zz_refuse_unsigned_activation_ins' and not tg.tgisinternal;
  if coalesce(array_length(v_guarded, 1), 0) < 40 then raise exception 'FAIL 6: only % tables carry the guard', coalesce(array_length(v_guarded, 1), 0); end if;

  -- 6. both triggers on every guarded table, enabled; function closed to anon
  foreach v_t in array v_guarded loop
    select count(*) into v_n from pg_trigger tg
     where tg.tgrelid = ('public.' || quote_ident(v_t))::regclass and not tg.tgisinternal and tg.tgenabled = 'O'
       and tg.tgname in ('zz_refuse_unsigned_activation_ins', 'zz_refuse_unsigned_activation_upd');
    if v_n <> 2 then raise exception 'FAIL 6: % has % of the 2 guard triggers enabled', v_t, v_n; end if;
  end loop;
  if has_function_privilege('anon', 'private.refuse_unsigned_activation()', 'EXECUTE') then raise exception 'FAIL 6: anon can execute the guard function'; end if;

  -- 5. registry
  select array_agg(c.relname::text order by c.relname::text) into v_shape
    from pg_class c join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   where c.relkind = 'r' and 3 = (select count(*) from pg_attribute a where a.attrelid = c.oid and not a.attisdropped and a.attname in ('is_active', 'approved_by', 'approved_at'));
  foreach v_t in array v_shape loop
    if not (v_t = any (v_guarded)) and not (v_t = any (v_allow)) then
      raise exception 'FAIL 5: public.% has is_active, approved_by and approved_at but is neither guarded nor on the allowlist. Add the triggers (migration 20261029213217 shows how) or name why not in this proof.', v_t;
    end if;
  end loop;
  foreach v_t in array v_allow loop
    if not (v_t = any (v_shape)) then raise exception 'FAIL 5: allowlisted table % no longer has the governed shape; remove it from the allowlist', v_t; end if;
    if v_t = any (v_guarded) then raise exception 'FAIL 5: % is both guarded and allowlisted', v_t; end if;
  end loop;

  -- 1. insert active + unsigned is refused on every guarded table that has a row to copy
  v_n := 0;
  foreach v_t in array v_guarded loop
    v_res := pg_temp.probe_insert(v_t, false);
    if v_res = 'refused' then v_refused := v_refused + 1;
    elsif v_res <> 'norow' then v_other := v_other || E'\n  ' || v_t || ' -> ' || v_res; end if;
  end loop;
  if v_other <> '' then raise exception 'FAIL 1: an active, unsigned insert was not refused by this guard:%', v_other; end if;
  if v_refused < 25 then raise exception 'FAIL 1: only % tables could be probed (expected at least 25); the proof has gone vacuous', v_refused; end if;
  raise notice 'check 1: % tables refused an active, unsigned insert', v_refused;

  -- 4. control: a signed active row is never refused by THIS guard
  foreach v_t in array v_guarded loop
    v_res := pg_temp.probe_insert(v_t, true);
    if v_res = 'refused' then raise exception 'FAIL 4: % refused a SIGNED active insert; the guard is too wide', v_t; end if;
  end loop;

  -- 2. reactivating an unsigned row is refused
  v_refused := 0; v_other := '';
  foreach v_t in array v_guarded loop
    v_res := pg_temp.probe_reactivate(v_t);
    if v_res = 'refused' then v_refused := v_refused + 1;
    elsif v_res not in ('norow', 'skip') then v_other := v_other || E'\n  ' || v_t || ' -> ' || v_res; end if;
  end loop;
  if v_other <> '' then raise exception 'FAIL 2: reactivating an unsigned row was not refused by this guard:%', v_other; end if;
  if v_refused < 20 then raise exception 'FAIL 2: only % tables could be probed (expected at least 20)', v_refused; end if;
  raise notice 'check 2: % tables refused reactivating an unsigned row', v_refused;

  -- 3. stripping a signature from a live row is refused
  v_refused := 0; v_other := '';
  foreach v_t in array v_guarded loop
    v_res := pg_temp.probe_unsign(v_t);
    if v_res = 'refused' then v_refused := v_refused + 1;
    elsif v_res not in ('norow', 'skip') then v_other := v_other || E'\n  ' || v_t || ' -> ' || v_res; end if;
  end loop;
  if v_other <> '' then raise exception 'FAIL 3: stripping a signature from a live row was not refused by this guard:%', v_other; end if;
  if v_refused < 15 then raise exception 'FAIL 3: only % tables could be probed (expected at least 15)', v_refused; end if;
  raise notice 'check 3: % tables refused un-signing a live row', v_refused;

  -- Sabotage: with the triggers gone on alert_rules the same probes must be allowed.
  drop trigger zz_refuse_unsigned_activation_ins on public.alert_rules;
  drop trigger zz_refuse_unsigned_activation_upd on public.alert_rules;
  if pg_temp.probe_insert('alert_rules', false) = 'refused' then raise exception 'VACUOUS: the insert probe still refuses with the trigger dropped'; end if;
  if pg_temp.probe_reactivate('alert_rules') = 'refused' then raise exception 'VACUOUS: the reactivate probe still refuses with the trigger dropped'; end if;

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
