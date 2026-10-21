-- Exact aggregates for browse-page counts. Applied 2026-10-21 via SQL. Safe to
-- re-run. The pages used to count client-side from `.limit(50000)` selects,
-- but the API returns at most 1,000 rows per request, so totals and dropdown
-- counts were computed from the first 1,000 rows only.
-- SECURITY INVOKER: callers still need paid access to the underlying tables.

create or replace function public.audit_firm_counts()
returns table(audit_firm text, n bigint)
language sql stable security invoker set search_path to 'public' as $$
  select audit_firm, count(*) from audit_history
  where audit_firm is not null group by audit_firm order by count(*) desc
$$;

create or replace function public.audit_chain_counts()
returns table(chain text, n bigint)
language sql stable security invoker set search_path to 'public' as $$
  select c, count(*) from audit_history, unnest(audited_chains) c
  where c is not null and c <> '' group by c order by count(*) desc
$$;

create or replace function public.funding_round_type_counts()
returns table(round_type text, n bigint)
language sql stable security invoker set search_path to 'public' as $$
  select round_type, count(*) from funding_rounds
  where round_type is not null group by round_type order by count(*) desc
$$;

revoke all on function public.audit_firm_counts(), public.audit_chain_counts(), public.funding_round_type_counts() from public, anon;
grant execute on function public.audit_firm_counts(), public.audit_chain_counts(), public.funding_round_type_counts() to authenticated;
