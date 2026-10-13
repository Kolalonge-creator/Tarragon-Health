-- Extend the "never activate a version older than one already signed" guard to
-- lab_panel_signoffs, the tenth versioned governance table.
--
-- 20261006223248 put private.refuse_activating_superseded_version() on the nine
-- tables that existed then. S27d (20261006212220) added lab_panel_signoffs, whose
-- sign_lab_panels() activates whatever id it is given and deactivates the rest, the
-- same shape as the others, so the same roll-back risk applies: signing an older
-- draft of the lab reference ranges and critical limits would silently put the
-- platform back on older clinical limits behind a routine-looking signature. Global
-- numbering (one live row, version is unique), so no partition columns.
create trigger refuse_superseded_activation before update of is_active on public.lab_panel_signoffs
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();

do $$
declare
  v_n integer;
begin
  select count(*) into v_n from pg_trigger
   where tgname = 'refuse_superseded_activation' and not tgisinternal;
  if v_n <> 10 then
    raise exception 'FAIL: expected 10 refuse_superseded_activation triggers, found %', v_n;
  end if;
end $$;
