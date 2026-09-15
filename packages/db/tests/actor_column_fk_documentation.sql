-- Guards the bug class documented by
-- 20260904195154_document_actor_column_fk_targets.sql.
--
-- This schema has two "who did it" tables whose column names do not
-- distinguish them: public.profiles (the login/account record) and
-- public.clinical_staff (the employment/credential record, whose own id is
-- NOT a profile id). 405 actor columns point at one or the other, and 21
-- column names are used for BOTH — reviewed_by is 19 tables to clinical_staff
-- against 21 to profiles, a coin flip.
--
-- Joining such a column to the wrong table does not error. It matches nothing,
-- and the row reads as unattributed. That is the same null-shaped failure mode
-- this codebase keeps hitting: a missing table grant looked like an empty
-- result, and anon-EXECUTE-via-PUBLIC looked like a working revoke. A wrong
-- zero is the hardest kind of wrong to notice, and on a column like
-- protocol_versions.approved_by it silently erases a Clinical Director's
-- signature on a clinical protocol.
--
-- The mitigation is that every one of these columns carries a comment naming
-- its real target. This test exists because a comment sweep is worthless if
-- the next twenty tables are born without one — it fails the moment a new
-- actor column is added undocumented.
--
-- Run inside a transaction and roll back; nothing here writes.
--   npx supabase db query --linked -f packages/db/tests/actor_column_fk_documentation.sql

begin;

create temp table results(check_name text, expected text, actual text) on commit drop;

create temp view actor_columns as
  select con.conrelid::regclass::text          as tbl,
         att.attname                            as col,
         con.confrelid::regclass::text          as target,
         col_description(con.conrelid, att.attnum) as comment
  from pg_constraint con
  join lateral unnest(con.conkey) as k(attnum) on true
  join pg_attribute att
    on att.attrelid = con.conrelid and att.attnum = k.attnum
  where con.contype = 'f'
    and con.confrelid in ('public.clinical_staff'::regclass, 'public.profiles'::regclass)
    and att.attname ~ '_by$|_by_staff$|owner|actor|manager|clinician_id$|clinical_staff_id$';

-- 1. Every actor column is documented at all.
insert into results
select 'actor columns with no comment',
       '0',
       coalesce(string_agg(tbl || '.' || col, ', ' order by tbl, col), '0')
from actor_columns where comment is null;

-- 2. Each comment names the table the FK actually points at. A comment that
--    names the wrong table is worse than none, so this is checked separately
--    from mere presence.
insert into results
select 'comments naming the wrong target',
       '0',
       coalesce(string_agg(tbl || '.' || col, ', ' order by tbl, col), '0')
from actor_columns
where comment is not null
  and comment not like '%' || target || '(id)%';

-- 3. The specific column this came from: it must name clinical_staff, because
--    joining it to profiles under-attributes a signed protocol.
insert into results
select 'protocol_versions.approved_by names clinical_staff',
       'true',
       coalesce((
         select (comment like '%clinical_staff(id)%')::text
         from actor_columns
         where tbl = 'protocol_versions' and col = 'approved_by'
       ), 'MISSING');

-- 4. Sanity: the ambiguity this guards against is real, so the test is not
--    passing vacuously against a schema where no name is shared. If this ever
--    reports 0, the two-table split has gone away and this test can go too.
insert into results
select 'column names used by BOTH tables (ambiguous)',
       '> 0',
       (select count(*)::text from (
          select col from actor_columns
          group by col
          having count(*) filter (where target = 'clinical_staff') > 0
             and count(*) filter (where target = 'profiles') > 0
        ) s);

select check_name,
       expected,
       actual,
       case
         when check_name = 'column names used by BOTH tables (ambiguous)'
           then case when actual::int > 0 then 'PASS' else 'FAIL' end
         when actual = expected then 'PASS'
         else 'FAIL'
       end as status
from results
order by check_name;

rollback;
