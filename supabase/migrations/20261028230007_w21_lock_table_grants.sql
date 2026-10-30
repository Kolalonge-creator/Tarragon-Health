-- W-21 follow-up: the five bereavement tables were created with the project's default table privileges, which grant authenticated INSERT,
-- UPDATE and DELETE. Row-level security already denies those writes (the tables have read policies only, and every write goes through
-- SECURITY DEFINER functions), so nothing was exposed, but append-only safety records should also be locked at the grant level, as
-- clinician_time_entries, restore_drills and the W-02 tables are.
-- Live check 2026-10-28 (read-only): these five were the only tables of the W-01/W-02/W-10/W-21/W-25/W-40 set with write grants.
-- Reads stay as granted by the W-21 migrations (select to authenticated, filtered by their policies).

revoke insert, update, delete, truncate on
  public.death_records,
  public.death_record_requests,
  public.death_record_reversals,
  public.bereavement_sponsor_notices,
  public.goodwill_refund_requests
from authenticated;

do $$
declare t text;
begin
  foreach t in array array['death_records', 'death_record_requests', 'death_record_reversals', 'bereavement_sponsor_notices', 'goodwill_refund_requests'] loop
    if has_table_privilege('authenticated', 'public.' || t, 'INSERT') or has_table_privilege('authenticated', 'public.' || t, 'UPDATE')
       or has_table_privilege('authenticated', 'public.' || t, 'DELETE') or has_table_privilege('authenticated', 'public.' || t, 'TRUNCATE') then
      raise exception 'W-21 grants: authenticated can still write public.%', t;
    end if;
    if not has_table_privilege('authenticated', 'public.' || t, 'SELECT') then
      raise exception 'W-21 grants: authenticated lost its read grant on public.%', t;
    end if;
    if has_table_privilege('anon', 'public.' || t, 'SELECT') then
      raise exception 'W-21 grants: anon can read public.%', t;
    end if;
  end loop;
end $$;
