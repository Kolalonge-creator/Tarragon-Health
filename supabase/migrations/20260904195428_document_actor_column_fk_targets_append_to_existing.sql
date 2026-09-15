-- Recovered 2026-09-05 from supabase_migrations.schema_migrations.statements.
--
-- This migration was applied live to koiplnmbgnqnbywhpjlf on 2026-09-04 19:54 but
-- never committed to any branch, so the release-integrity "Migration / branch merge
-- drift" job classed it UNTRACED (production SQL existing only in the database).
-- The body below is the applied SQL verbatim; the filename is pinned to the live
-- `version` (20260904195428) so the recovery does not create a second, divergent
-- record of the same change. Do not renumber it.
--
-- What it does: a follow-up to the actor-column documentation pass (PR #485).
-- That pass documented actor columns that had no comment at all; this one appends
-- the "FK target: ..." sentence to actor columns that were ALREADY documented, so
-- every actor column states which table its foreign key points at. See
-- reference_actor_columns_profiles_vs_clinical_staff: `profiles` and
-- `clinical_staff` share 21 column names, and joining the wrong one returns NULL
-- silently rather than erroring.

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

do $$
declare
  v_bad int;
  v_sample text;
begin
  select count(*), string_agg(tbl || '.' || col, ', ' order by tbl, col)
    into v_bad, v_sample
  from (
    select con.conrelid::regclass::text as tbl, att.attname as col
    from pg_constraint con
    join lateral unnest(con.conkey) as k(attnum) on true
    join pg_attribute att
      on att.attrelid = con.conrelid and att.attnum = k.attnum
    where con.contype = 'f'
      and con.confrelid in ('public.clinical_staff'::regclass, 'public.profiles'::regclass)
      and att.attname ~ '_by$|_by_staff$|owner|actor|manager|clinician_id$|clinical_staff_id$'
      and coalesce(col_description(con.conrelid, att.attnum), '')
            not like '%' || con.confrelid::regclass::text || '(id)%'
    limit 20
  ) s;

  if v_bad > 0 then
    raise exception 'actor columns not naming their FK target: %', v_sample;
  end if;
end $$;
