-- Pipeline flatline alerting. Applied 2026-10-21 via SQL. Safe to re-run.
--
-- Every collector, sync and extractor gets a row in pipeline_monitors: a query
-- returning the newest row it actually landed (data freshness, not "the cron
-- ran"), a staleness threshold, and whether it is known-dead (suppressed).
-- check_pipeline_freshness() runs hourly and posts to the ops Slack through
-- slack-notify (x-cron-key path, ops channel only):
--   - one message when a pipeline goes stale, one when it recovers;
--   - an error-rate alert when more than 50% of a function's calls in the last
--     2 hours were non-200 or 200s carrying an error / rate_limited body
--     (the severity extractor returned fake 200s for months);
--   - a daily digest at 13:00 UTC while anything is red.
-- Internal tables: RLS on with no policies, so only service code reads them.

-- 1. Which edge function each pg_net request called. pg_net deletes the
--    queued request (and its URL) once sent, so record it on the way in.
create table if not exists public.pipeline_calls (
  id bigint primary key,
  fn text not null,
  called_at timestamptz not null default now()
);
create index if not exists pipeline_calls_fn_idx on public.pipeline_calls (fn, called_at);

create or replace function public.log_pipeline_call()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.url like '%/functions/v1/%' then
    insert into public.pipeline_calls (id, fn)
    values (new.id, split_part(split_part(new.url, '/functions/v1/', 2), '?', 1))
    on conflict (id) do nothing;
  end if;
  return new;
end $$;
-- We may add a trigger to pg_net's table but not drop one (that needs the
-- owner, supabase_admin), so create it only when missing. A pg_net upgrade can
-- remove it; the "Monitor self-check: call log" monitor catches that.
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'log_pipeline_call' and tgrelid = 'net.http_request_queue'::regclass) then
    create trigger log_pipeline_call after insert on net.http_request_queue
      for each row execute function public.log_pipeline_call();
  end if;
end $$;

-- 2. Monitors.
create table if not exists public.pipeline_monitors (
  name text primary key,
  feeds text not null,
  check_sql text not null,               -- must return one timestamptz: newest data landed
  threshold interval not null,
  quiet_ok boolean not null default false, -- source can be legitimately quiet
  fn_name text,                          -- edge function for the error-rate check
  suppressed boolean not null default false,
  suppressed_reason text,
  last_landed timestamptz,
  state text not null default 'unknown', -- ok | stale | suppressed | check_failed
  err_state text not null default 'ok',  -- ok | erroring
  err_detail text,
  state_changed_at timestamptz,
  last_checked timestamptz
);
create table if not exists public.pipeline_alert_state (
  id boolean primary key default true check (id),
  last_digest_at timestamptz
);
insert into public.pipeline_alert_state (id) values (true) on conflict do nothing;

alter table public.pipeline_calls enable row level security;
alter table public.pipeline_monitors enable row level security;
alter table public.pipeline_alert_state enable row level security;
revoke all on public.pipeline_calls, public.pipeline_monitors, public.pipeline_alert_state from anon, authenticated;

-- "30 hours", "21 days" rather than Postgres' "30:00:00".
create or replace function public.pretty_interval(i interval) returns text language sql immutable as $$
  select case when extract(epoch from i) >= 172800 and mod(extract(epoch from i)::bigint, 86400) = 0
              then (extract(epoch from i) / 86400)::int || ' days'
              else (extract(epoch from i) / 3600)::int || ' hours' end
$$;

-- 3. The hourly check.
create or replace function public.check_pipeline_freshness(p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  m record;
  v_last timestamptz;
  v_new text;
  v_calls int; v_bad int; v_sample text;
  went_red text[] := '{}';
  recovered text[] := '{}';
  err_new text[] := '{}';
  err_ok text[] := '{}';
  red_now text[];
  msg text;
  digest_due boolean;
  posted int := 0;
begin
  delete from pipeline_calls where called_at < now() - interval '3 days';

  for m in select * from pipeline_monitors order by name loop
    -- freshness
    begin
      execute m.check_sql into v_last;
      v_new := case when m.suppressed then 'suppressed'
                    when v_last is null or now() - v_last > m.threshold then 'stale'
                    else 'ok' end;
    exception when others then
      v_last := null; v_new := 'check_failed';
    end;
    if v_new in ('stale', 'check_failed') and m.state not in ('stale', 'check_failed') then
      went_red := went_red || format('%s: no new data since %s (threshold %s)%s', m.name,
        coalesce(to_char(v_last at time zone 'UTC', 'YYYY-MM-DD HH24:MI'), 'never'), public.pretty_interval(m.threshold),
        case when v_new = 'check_failed' then ' [check query failed]' else '' end);
    elsif v_new = 'ok' and m.state in ('stale', 'check_failed') then
      recovered := recovered || format('%s: data landing again (latest %s UTC)', m.name, to_char(v_last at time zone 'UTC', 'YYYY-MM-DD HH24:MI'));
    end if;
    update pipeline_monitors set last_landed = v_last, last_checked = now(),
      state_changed_at = case when state <> v_new then now() else state_changed_at end, state = v_new
    where name = m.name;

    -- error rate (last 2 hours, at least 3 calls)
    if m.fn_name is not null and not m.suppressed then
      select count(*),
             count(*) filter (where r.status_code is distinct from 200
                               or r.content ~ '"ok"\s*:\s*false'
                               or r.content ~ '"rate_limited"\s*:\s*[1-9]'
                               or r.content ~ '^\s*\{\s*"error"'),
             (array_agg(left(coalesce(r.content, r.error_msg, ''), 140) order by c.called_at desc)
                filter (where r.status_code is distinct from 200 or r.content ~ '"ok"\s*:\s*false'
                          or r.content ~ '"rate_limited"\s*:\s*[1-9]' or r.content ~ '^\s*\{\s*"error"'))[1]
        into v_calls, v_bad, v_sample
      from pipeline_calls c join net._http_response r on r.id = c.id
      where c.fn = m.fn_name and c.called_at > now() - interval '2 hours';
      if v_calls >= 3 and v_bad * 2 > v_calls then
        if m.err_state <> 'erroring' then
          err_new := err_new || format('%s (%s): %s of %s calls failed in 2h. Latest: %s', m.name, m.fn_name, v_bad, v_calls, coalesce(v_sample, '?'));
        end if;
        update pipeline_monitors set err_state = 'erroring', err_detail = format('%s/%s bad: %s', v_bad, v_calls, v_sample) where name = m.name;
      elsif m.err_state = 'erroring' and v_calls >= 1 then
        err_ok := err_ok || format('%s (%s): calls succeeding again', m.name, m.fn_name);
        update pipeline_monitors set err_state = 'ok', err_detail = null where name = m.name;
      end if;
    end if;
  end loop;

  -- One message per run for new problems, one for recoveries.
  if cardinality(went_red) + cardinality(err_new) > 0 then
    msg := ':rotating_light: *AuditScope pipeline alert*' || chr(10) ||
           array_to_string(array(select '• ' || x from unnest(went_red || err_new) x), chr(10));
    if not p_dry_run then perform public.post_ops_slack(msg); end if;
    posted := posted + 1;
  end if;
  if cardinality(recovered) + cardinality(err_ok) > 0 then
    msg := ':white_check_mark: *AuditScope pipeline recovered*' || chr(10) ||
           array_to_string(array(select '• ' || x from unnest(recovered || err_ok) x), chr(10));
    if not p_dry_run then perform public.post_ops_slack(msg); end if;
    posted := posted + 1;
  end if;

  -- Daily digest at 13:00 UTC while anything is red.
  select array_agg(format('%s: %s since %s', name,
           case when state <> 'ok' and err_state = 'erroring' then 'stale + erroring' when err_state = 'erroring' then 'erroring' else state end,
           coalesce(to_char(last_landed at time zone 'UTC', 'YYYY-MM-DD'), 'never')) order by name)
    into red_now
  from pipeline_monitors where not suppressed and (state in ('stale', 'check_failed') or err_state = 'erroring');
  select extract(hour from now() at time zone 'UTC') = 13
         and coalesce((select last_digest_at from pipeline_alert_state) < now() - interval '20 hours', true)
    into digest_due;
  if digest_due and cardinality(coalesce(red_now, '{}')) > 0 then
    msg := ':clipboard: *AuditScope daily pipeline digest*: ' || cardinality(red_now) || ' red ('
           || (select count(*) from pipeline_monitors where suppressed) || ' known-dead suppressed)' || chr(10)
           || array_to_string(array(select '• ' || x from unnest(red_now) x), chr(10));
    if not p_dry_run then
      perform public.post_ops_slack(msg);
      update pipeline_alert_state set last_digest_at = now();
    end if;
    posted := posted + 1;
  end if;

  return jsonb_build_object('went_red', to_jsonb(went_red), 'recovered', to_jsonb(recovered),
    'erroring', to_jsonb(err_new), 'errors_cleared', to_jsonb(err_ok), 'red_now', to_jsonb(coalesce(red_now, '{}')),
    'messages', posted, 'dry_run', p_dry_run);
end $function$;

-- Ops channel only: slack-notify's x-cron-key path ignores any webhook in the
-- body and posts to SLACK_WEBHOOK_URL.
create or replace function public.post_ops_slack(p_text text)
returns bigint language sql security definer set search_path to 'public' as $$
  select net.http_post(
    url := 'https://qktjbtmcjrwzmtqnszbq.supabase.co/functions/v1/slack-notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-key', public.cron_key()),
    body := jsonb_build_object('text', left(p_text, 1990)),
    timeout_milliseconds := 30000)
$$;

revoke all on function public.check_pipeline_freshness(boolean) from public, anon, authenticated;
revoke all on function public.post_ops_slack(text) from public, anon, authenticated;
revoke all on function public.log_pipeline_call() from public, anon, authenticated;

-- 4. Hourly schedule.
select cron.unschedule('check-pipeline-freshness-hourly') where exists (select 1 from cron.job where jobname = 'check-pipeline-freshness-hourly');
select cron.schedule('check-pipeline-freshness-hourly', '25 * * * *', 'select public.check_pipeline_freshness()');
