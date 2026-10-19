-- Extend the existing record share link (S09/S09x) with four small things a patient asked for when sharing with an outside doctor:
--   * recipient_label  who the link is for (shown on the share page and in the patient's own list); a label only, not an identity check
--   * max_views        the link stops working after N openings (1 to 50)
--   * window_days      readings and lab results are limited to the last 30, 90 or 180 days
--   * the share page gets a print button (browser print, no new data path; app change only)
-- Nothing else about sharing changes: sections stay a closed set without reproductive_health, PIN and lockout, expiry cap of 30 days, revoke,
-- the patient's access log, and the S05b read filters on superseded values all stay exactly as they are.
--
-- Counted first: record_shares holds 0 rows on the live project as of S09x (2026-10-13); the new columns are nullable and convert nothing.
-- record_share_by_token and record_share_peek were patched by later migrations (S39, S05b), so they are patched here from their live definitions
-- with exact-match anchors that fail loudly if the text has drifted, never guessed.

alter table public.record_shares
  add column recipient_label text check (recipient_label is null or char_length(btrim(recipient_label)) between 1 and 80),
  add column max_views integer check (max_views is null or max_views between 1 and 50),
  add column window_days integer check (window_days is null or window_days in (30, 90, 180));

-- Clients read these columns (the table is granted by column since S09x so pin_hash stays unreadable).
grant select (recipient_label, max_views, window_days) on public.record_shares to authenticated;

-- One door for the new options. It calls the existing create function (same checks, same PIN) and then sets the new columns on the row it made,
-- in the same transaction, for the caller's own row only.
create function public.create_record_share_with_options(
  p_sections text[],
  p_expires_in_hours integer default 24,
  p_use_pin boolean default false,
  p_one_session boolean default false,
  p_recipient_label text default null,
  p_max_views integer default null,
  p_window_days integer default null
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_label text := nullif(btrim(p_recipient_label), '');
  v_res jsonb;
  v_n integer;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  if v_label is not null and char_length(v_label) > 80 then
    raise exception 'the recipient name is too long' using errcode = '22023';
  end if;
  if p_max_views is not null and (p_max_views < 1 or p_max_views > 50) then
    raise exception 'views must be between 1 and 50' using errcode = '22023';
  end if;
  if p_window_days is not null and p_window_days not in (30, 90, 180) then
    raise exception 'the window must be 30, 90 or 180 days' using errcode = '22023';
  end if;

  v_res := public.create_record_share(p_sections, p_expires_in_hours, p_use_pin, p_one_session);

  update public.record_shares
     set recipient_label = v_label, max_views = p_max_views, window_days = p_window_days
   where id = (v_res ->> 'id')::uuid and patient_id = v_uid;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    -- never leave a share without the limits the patient asked for
    raise exception 'could not apply the share options' using errcode = 'P0001';
  end if;

  return v_res || jsonb_build_object('recipient_label', v_label, 'max_views', p_max_views, 'window_days', p_window_days);
end $$;
revoke all on function public.create_record_share_with_options(text[], integer, boolean, boolean, text, integer, integer) from public, anon;
grant execute on function public.create_record_share_with_options(text[], integer, boolean, boolean, text, integer, integer) to authenticated;

-- Patch the public door (record_share_by_token) and its peek, by name so every overload present is patched, each anchor must match exactly once.
do $$
declare
  v_oid oid;
  v_def text;
  v_new text;
  v_n integer := 0;
  c_stop constant text := E'  if v_share.one_session and v_share.first_opened_at is not null\n     and now() > v_share.first_opened_at + make_interval(mins => v_osw) then\n    perform private.log_public_lookup_failure(''record_share'');\n    return null;\n  end if;\n';
  c_stop_new constant text := c_stop || E'\n  -- a link with a view cap stops working once it has been opened that many times (same silent answer as every other dead link)\n  if v_share.max_views is not null and v_share.view_count >= v_share.max_views then\n    perform private.log_public_lookup_failure(''record_share'');\n    return null;\n  end if;\n';
  c_head constant text := E'    ''sections'', v_share.sections,\n';
  c_head_new constant text := E'    ''sections'', v_share.sections,\n    ''recipient_label'', v_share.recipient_label,\n    ''window_days'', v_share.window_days,\n    ''views_left'', case when v_share.max_views is null then null else greatest(v_share.max_views - v_share.view_count, 0) end,\n';
  c_ret constant text := E'  return v_result;\nend;';
  c_ret_new constant text := E'  -- the date window trims time-stamped sections after they are built, so every existing read filter still applies first\n  if v_share.window_days is not null then\n    if v_result ? ''vitals'' then\n      v_result := jsonb_set(v_result, ''{vitals}'', coalesce((select jsonb_agg(e order by (e ->> ''taken_at'')::timestamptz desc) from jsonb_array_elements(v_result -> ''vitals'') e where (e ->> ''taken_at'')::timestamptz >= now() - make_interval(days => v_share.window_days)), ''[]''::jsonb));\n    end if;\n    if v_result ? ''lab_results'' then\n      v_result := jsonb_set(v_result, ''{lab_results}'', coalesce((select jsonb_agg(e order by (e ->> ''taken_at'')::timestamptz desc) from jsonb_array_elements(v_result -> ''lab_results'') e where (e ->> ''taken_at'')::timestamptz >= now() - make_interval(days => v_share.window_days)), ''[]''::jsonb));\n    end if;\n  end if;\n\n  return v_result;\nend;';
begin
  for v_oid in select p.oid from pg_proc p where p.proname = 'record_share_by_token' and p.pronamespace = 'public'::regnamespace loop
    v_def := pg_get_functiondef(v_oid);
    if (length(v_def) - length(replace(v_def, c_stop, ''))) <> length(c_stop)
       or (length(v_def) - length(replace(v_def, c_head, ''))) <> length(c_head)
       or (length(v_def) - length(replace(v_def, c_ret, ''))) <> length(c_ret) then
      raise exception 'record_share_by_token (%): an anchor is missing or repeated, refusing to guess', v_oid::regprocedure;
    end if;
    v_new := replace(replace(replace(v_def, c_stop, c_stop_new), c_head, c_head_new), c_ret, c_ret_new);
    execute v_new;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'record_share_by_token not found'; end if;
end $$;

do $$
declare
  v_def text;
  c_old constant text := E'     or (v_share.one_session and v_share.first_opened_at is not null and now() > v_share.first_opened_at + make_interval(mins => v_osw)) then';
  c_new constant text := E'     or (v_share.one_session and v_share.first_opened_at is not null and now() > v_share.first_opened_at + make_interval(mins => v_osw))\n     or (v_share.max_views is not null and v_share.view_count >= v_share.max_views) then';
begin
  select pg_get_functiondef('public.record_share_peek(text)'::regprocedure) into v_def;
  if (length(v_def) - length(replace(v_def, c_old, ''))) <> length(c_old) then
    raise exception 'record_share_peek: the anchor is missing or repeated, refusing to guess';
  end if;
  execute replace(v_def, c_old, c_new);
end $$;

-- Self-checks: the new door is for signed-in users only, the public door stays anon-callable, the patches landed.
do $$
begin
  if has_function_privilege('anon', 'public.create_record_share_with_options(text[],integer,boolean,boolean,text,integer,integer)', 'execute') then
    raise exception 'anon can execute create_record_share_with_options';
  end if;
  if not has_function_privilege('authenticated', 'public.create_record_share_with_options(text[],integer,boolean,boolean,text,integer,integer)', 'execute') then
    raise exception 'authenticated cannot execute create_record_share_with_options';
  end if;
  if not exists (select 1 from pg_proc p where p.proname = 'record_share_by_token' and p.pronamespace = 'public'::regnamespace
                  and pg_get_functiondef(p.oid) like '%views_left%' and pg_get_functiondef(p.oid) like '%max_views%') then
    raise exception 'record_share_by_token was not patched';
  end if;
  if not has_function_privilege('anon', 'public.record_share_by_token(text,text,text)', 'execute') then
    raise exception 'record_share_by_token must stay anon-executable (the share link)';
  end if;
  if pg_get_functiondef('public.record_share_peek(text)'::regprocedure) not like '%max_views%' then
    raise exception 'record_share_peek was not patched';
  end if;
  if has_column_privilege('authenticated', 'public.record_shares', 'pin_hash', 'select') then
    raise exception 'pin_hash became readable';
  end if;
end $$;
