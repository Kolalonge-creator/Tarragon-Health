-- Community go-live: stop waiting on the clinical-operations master.
--
-- G-01 (20261029223751) made `community` a child of `clinical_operations_enabled`, so a feature reads CLOSED while that master is off.
-- That master is held on facts that have nothing to do with a peer group (no approved hypertension protocol, no clinical safety case
-- for doctor-run pathways). Community is members-only text moderated by people, it needs no clinician cover and no pathway, and its own
-- safety path (immediate safety card, own emergency-contact button, held post, safety-reviewer queue, CMO-signed rule set v2) does not
-- run through that master. Left as is, Community could not open however ready it was.
--
-- This only removes the parent link. It does NOT switch Community on: `is_on` stays false, the hold sentence stays, and the existing
-- moderator, safety-reviewer and live-group requirements in the product are untouched. Opening it is still one deliberate switch by an
-- admin or the Chief Medical Officer.
--
-- Rows affected: exactly one (the `community` guard). No data conversion.
update public.go_live_guards
   set parent_key = null
 where key = 'community'
   and parent_key = 'clinical_operations_enabled';

do $$
declare
  g public.go_live_guards;
begin
  select * into g from public.go_live_guards where key = 'community';
  if g.key is null then raise exception 'community guard missing'; end if;
  if g.parent_key is not null then raise exception 'community still has a parent: %', g.parent_key; end if;
  if g.kind <> 'feature' then raise exception 'community must stay a feature, found %', g.kind; end if;
  if g.is_on then raise exception 'this migration must not switch community on'; end if;
end $$;
