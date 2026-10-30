-- P4 follow-up: make an exercise session safe to send twice, so the phone can save it first and send it later (offline outbox).
--
-- The phone's offline outbox gives every queued item a client id and resends until the server confirms. If the server wrote the row but the reply was
-- lost, the resend would create a second session and inflate the person's progress. activity_log_entries solves this with a client_id column that is
-- unique per patient; exercise_session_logs gets the same. A resend hits the unique index (23505), which the outbox treats as "already done".
--
-- Nothing changes for existing rows or for the web (client_id is null there; any number of null rows per patient is allowed). The symptom alert
-- trigger is AFTER INSERT, so a rejected duplicate never raises a second clinician alert.

alter table public.exercise_session_logs add column client_id uuid;

create unique index exercise_session_logs_client_id_uidx
  on public.exercise_session_logs (patient_id, client_id)
  where client_id is not null;

comment on column public.exercise_session_logs.client_id is
  'Idempotency key from the phone''s offline outbox. A repeat send of the same session violates the unique index and is treated as already saved.';

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'exercise_session_logs_client_id_uidx') then
    raise exception 'exercise_session_logs_client_id_uidx is missing';
  end if;
end $$;
