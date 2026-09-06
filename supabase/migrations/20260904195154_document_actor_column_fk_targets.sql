-- Tarragon Health — make every actor column say which table it points at.
--
-- THE PROBLEM. This schema has two different "who did it" tables, and the
-- column names do not distinguish them:
--
--   public.profiles        the account/login record (auth.users.id)
--   public.clinical_staff  the employment/credential record, whose own id is
--                          NOT a profile id (it carries profile_id separately)
--
-- 732 foreign-key columns point at one or the other, and the same NAME means
-- different things in different tables. Measured on the live project:
--
--   reviewed_by   19 tables -> clinical_staff,  21 -> profiles
--   approved_by   16 -> clinical_staff,          7 -> profiles
--   resolved_by    4 -> clinical_staff,         14 -> profiles
--   created_by     3 -> clinical_staff,         46 -> profiles
--   ...21 column names are ambiguous in total.
--
-- So `join profiles p on p.id = pv.approved_by` is a coin flip, and when it
-- loses it does NOT error: the join simply matches nothing and the row reads
-- as unattributed. That is the same null-shaped failure this codebase keeps
-- being bitten by (missing table grants looked like an empty result; the
-- anon-EXECUTE-via-PUBLIC bug looked like a working revoke). A wrong zero is
-- the hardest kind of wrong to notice.
--
-- It bites hardest on exactly the columns that matter most. protocol_versions
-- .approved_by is a Clinical Director's signature on a clinical protocol;
-- joined to the wrong table it renders as "unknown", which under-attributes a
-- real sign-off. The platform's own rule is that "Reviewed by Dr. X" must be
-- null-gated on a real record — a null-gated component fed a wrong join
-- correctly hides the name while the signature genuinely exists, so it fails
-- safe but still misrepresents the record.
--
-- NOTE: no such mis-join exists today. Every current consumer was checked
-- against the live catalogue before writing this — app code embeds the target
-- explicitly (clinical_staff!protocol_versions_approved_by_fkey), and the one
-- database function that looked suspicious (finance_approval_history) reads
-- finance_approval_requests, whose reviewed_by legitimately IS a profile.
-- This migration is therefore preventative, not a bug fix.
--
-- THE FIX. Stamp every one of these columns with a comment naming its real
-- target and the wrong one. A comment is the right instrument because it
-- travels with the column into every place someone would actually look:
-- psql \d+, information_schema, Supabase's table editor, generated type
-- tooling, and any agent reading the schema. It costs nothing at runtime and
-- cannot break a query.
--
-- Deliberately NOT renaming the columns to *_staff / *_profile. That would be
-- decisive, but it is 732 columns plus every query, type and migration that
-- references them — a far larger and riskier change than the latent bug it
-- would prevent, and it would have to be coordinated across a dozen
-- concurrent branches.
--
-- Existing hand-written comments are preserved: this only fills in columns
-- that have none, so nobody's more specific note is overwritten.

do $$
declare
  r record;
  v_target text;
  v_other  text;
  v_filled int := 0;
begin
  for r in
    select con.conrelid  as rel,
           con.conrelid::regclass::text as tbl,
           att.attname   as col,
           att.attnum    as attnum,
           con.confrelid::regclass::text as target
    from pg_constraint con
    join lateral unnest(con.conkey) as k(attnum) on true
    join pg_attribute att
      on att.attrelid = con.conrelid and att.attnum = k.attnum
    where con.contype = 'f'
      and con.confrelid in ('public.clinical_staff'::regclass, 'public.profiles'::regclass)
      -- Only actor-shaped columns. organisation_id/patient_id and similar are
      -- unambiguous and do not need the warning.
      and att.attname ~ '_by$|_by_staff$|owner|actor|manager|clinician_id$|clinical_staff_id$'
      -- Never clobber an existing, more specific comment.
      and not exists (
        select 1 from pg_description d
        where d.objoid = con.conrelid and d.objsubid = att.attnum
      )
  loop
    if r.target = 'clinical_staff' then
      v_target := 'public.clinical_staff(id)';
      v_other  := 'public.profiles(id)';
    else
      v_target := 'public.profiles(id)';
      v_other  := 'public.clinical_staff(id)';
    end if;

    execute format(
      'comment on column public.%I.%I is %L',
      r.tbl, r.col,
      'References ' || v_target || ', NOT ' || v_other || '. '
      || 'These two actor tables share column names across the schema and a '
      || 'join to the wrong one matches nothing rather than erroring, so the '
      || 'row silently reads as unattributed. '
      || (case when r.target = 'clinical_staff'
               then 'clinical_staff.id is not a profile id; use clinical_staff.profile_id to reach the account.'
               else 'To reach the employment/credential record, join clinical_staff on profile_id.' end)
    );
    v_filled := v_filled + 1;
  end loop;

  raise notice 'documented % actor columns', v_filled;
end $$;

-- Columns that already carried a hand-written comment keep it: those notes
-- describe real semantics (who may set the column, which trigger derives it)
-- that a generated line would destroy. But several of them never named the
-- FK target, or named it only in prose ("clinical_staff, not profiles"), so
-- the invariant was not machine-checkable. Append a short, uniform target
-- line to those rather than choosing between the two pieces of information.

do $$
declare
  r record;
  v_target text;
  v_other  text;
  v_appended int := 0;
begin
  for r in
    select con.conrelid::regclass::text as tbl,
           att.attname as col,
           att.attnum  as attnum,
           con.conrelid as rel,
           con.confrelid::regclass::text as target
    from pg_constraint con
    join lateral unnest(con.conkey) as k(attnum) on true
    join pg_attribute att
      on att.attrelid = con.conrelid and att.attnum = k.attnum
    where con.contype = 'f'
      and con.confrelid in ('public.clinical_staff'::regclass, 'public.profiles'::regclass)
      and att.attname ~ '_by$|_by_staff$|owner|actor|manager|clinician_id$|clinical_staff_id$'
      and col_description(con.conrelid, att.attnum) is not null
      and col_description(con.conrelid, att.attnum)
            not like '%' || con.confrelid::regclass::text || '(id)%'
  loop
    if r.target = 'clinical_staff' then
      v_target := 'public.clinical_staff(id)'; v_other := 'public.profiles(id)';
    else
      v_target := 'public.profiles(id)'; v_other := 'public.clinical_staff(id)';
    end if;

    execute format(
      'comment on column public.%I.%I is %L',
      r.tbl, r.col,
      col_description(r.rel, r.attnum)
        || ' FK target: ' || v_target || ', not ' || v_other || '.'
    );
    v_appended := v_appended + 1;
  end loop;

  raise notice 'appended target line to % pre-documented columns', v_appended;
end $$;

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_undocumented int;
  v_sample text;
begin
  select count(*),
         string_agg(tbl || '.' || col, ', ' order by tbl, col)
    into v_undocumented, v_sample
  from (
    select con.conrelid::regclass::text as tbl, att.attname as col
    from pg_constraint con
    join lateral unnest(con.conkey) as k(attnum) on true
    join pg_attribute att
      on att.attrelid = con.conrelid and att.attnum = k.attnum
    where con.contype = 'f'
      and con.confrelid in ('public.clinical_staff'::regclass, 'public.profiles'::regclass)
      and att.attname ~ '_by$|_by_staff$|owner|actor|manager|clinician_id$|clinical_staff_id$'
      and not exists (
        select 1 from pg_description d
        where d.objoid = con.conrelid and d.objsubid = att.attnum
      )
    limit 20
  ) s;

  if v_undocumented > 0 then
    raise exception 'actor columns still undocumented: %', v_sample;
  end if;

  -- Every comment must name the table the FK actually points at. A comment
  -- that names the wrong one is worse than no comment at all.
  select count(*), string_agg(tbl || '.' || col, ', ' order by tbl, col)
    into v_undocumented, v_sample
  from (
    select con.conrelid::regclass::text as tbl, att.attname as col
    from pg_constraint con
    join lateral unnest(con.conkey) as k(attnum) on true
    join pg_attribute att
      on att.attrelid = con.conrelid and att.attnum = k.attnum
    where con.contype = 'f'
      and con.confrelid in ('public.clinical_staff'::regclass, 'public.profiles'::regclass)
      and att.attname ~ '_by$|_by_staff$|owner|actor|manager|clinician_id$|clinical_staff_id$'
      and col_description(con.conrelid, att.attnum)
            not like '%' || con.confrelid::regclass::text || '(id)%'
    limit 20
  ) s;

  if v_undocumented > 0 then
    raise exception 'actor column comments name the wrong FK target: %', v_sample;
  end if;

  -- The column that started this: it must name clinical_staff explicitly.
  if (
    select col_description('public.protocol_versions'::regclass, att.attnum)
    from pg_attribute att
    where att.attrelid = 'public.protocol_versions'::regclass and att.attname = 'approved_by'
  ) not like '%clinical_staff%' then
    raise exception 'protocol_versions.approved_by comment does not name clinical_staff';
  end if;
end $$;
