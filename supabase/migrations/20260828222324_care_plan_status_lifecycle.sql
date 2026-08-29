alter type public.care_plan_status add value if not exists 'paused';
alter type public.care_plan_status add value if not exists 'transferred';
alter type public.care_plan_status add value if not exists 'declined';
alter type public.care_plan_status add value if not exists 'discharged';
