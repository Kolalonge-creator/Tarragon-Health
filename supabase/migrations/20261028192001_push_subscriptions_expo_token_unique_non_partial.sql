-- S40 gate finding (2026-10-28): the Expo app registers its push token with
-- supabase.from('push_subscriptions').upsert(..., { onConflict: 'expo_push_token' }).
-- PostgREST turns that into ON CONFLICT (expo_push_token), and Postgres can only
-- infer an arbiter index for that clause from a NON-partial unique index. The index
-- from 20260809195100 was partial (WHERE expo_push_token IS NOT NULL), so every
-- native registration failed with 42P10 "there is no unique or exclusion constraint
-- matching the ON CONFLICT specification" (HTTP 400). The app treats registration as
-- best effort and swallowed the error, and the Release build on a simulator retried it
-- thousands of times in minutes. No native token has ever been stored: live holds
-- 0 ios/android rows (2 web rows) at the time of writing.
--
-- A plain unique index is equivalent: Postgres treats NULLs as distinct, so web rows
-- (expo_push_token is null) still coexist, and non-null tokens stay unique.
drop index if exists public.push_subscriptions_expo_push_token_key;

create unique index push_subscriptions_expo_push_token_key
  on public.push_subscriptions (expo_push_token);

do $$
begin
  if exists (
    select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
     where c.relname = 'push_subscriptions_expo_push_token_key' and i.indpred is not null
  ) then
    raise exception 'push_subscriptions_expo_push_token_key must not be a partial index';
  end if;
end $$;
