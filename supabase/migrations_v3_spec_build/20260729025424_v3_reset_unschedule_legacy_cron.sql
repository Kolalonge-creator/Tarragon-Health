do $$
declare j record;
begin
  for j in select jobid from cron.job loop
    perform cron.unschedule(j.jobid);
  end loop;
end $$;
