-- Admin allowlist + lock privileged columns. Applied 2026-10-18 via SQL
-- (this project has no migrations workflow). Safe to re-run.
--
-- Before: "admin" meant user_profiles.is_admin, and any signed-in user could
-- update their own is_admin / plan_tier / Stripe columns and insert their own
-- api_keys rows (any tier, any rate limit). That gave free users admin, the
-- full paid dataset, and unlimited paid API keys.

-- 1. Server-side admin allowlist, keyed by user id. No client access at all.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text,
  added_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
revoke all on public.admin_users from public, anon, authenticated;
-- The owner's row is inserted directly in the database, not committed here
-- (this repo is public):
--   insert into public.admin_users (user_id, note) values ('<owner user id>', 'owner');

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from admin_users where user_id = auth.uid())
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- 2. Admin and paid checks use the allowlist, not the user-editable column.
create or replace function public.admin_user_overview()
returns table(user_id uuid, email text, plan_tier text, subscription_status text, signed_up timestamptz,
              active_keys integer, calls_30d bigint, last_activity timestamptz)
language plpgsql security definer set search_path to 'public' as $function$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return query
    select u.id, u.email::text, p.plan_tier, p.subscription_status, u.created_at,
      (select count(*)::int from api_keys k where k.user_id = u.id and k.revoked_at is null),
      (select count(*) from api_usage a where a.user_id = u.id and a.created_at > now() - interval '30 days'),
      (select max(a.created_at) from api_usage a where a.user_id = u.id)
    from auth.users u
    left join user_profiles p on p.user_id = u.id
    order by u.created_at desc;
end $function$;
revoke all on function public.admin_user_overview() from public, anon;
grant execute on function public.admin_user_overview() to authenticated;

create or replace function public.has_paid_access()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select p.plan_tier = 'pro' from user_profiles p where p.user_id = auth.uid()), false)
      or public.is_admin()
$$;

-- 3. Users may edit their profile, but never their admin flag, plan or billing
--    fields. Only server code (service_role, postgres, definer functions) can.
create or replace function public.protect_user_profile_columns()
returns trigger language plpgsql as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.is_admin := false;
      new.plan_tier := 'free';
      new.plan_billing_cycle := 'monthly';
      new.trial_ends_at := null;
      new.stripe_customer_id := null;
      new.stripe_subscription_id := null;
      new.subscription_status := null;
    else
      new.is_admin := old.is_admin;
      new.plan_tier := old.plan_tier;
      new.plan_billing_cycle := old.plan_billing_cycle;
      new.trial_ends_at := old.trial_ends_at;
      new.stripe_customer_id := old.stripe_customer_id;
      new.stripe_subscription_id := old.stripe_subscription_id;
      new.subscription_status := old.subscription_status;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists protect_user_profile_columns on public.user_profiles;
create trigger protect_user_profile_columns
  before insert or update on public.user_profiles
  for each row execute function public.protect_user_profile_columns();

-- 4. API keys are created only by the create-api-key function. Users can
--    revoke their own keys and nothing else; a revoked key stays revoked.
revoke insert, update, delete, truncate on public.api_keys from anon, authenticated;
grant update (revoked_at) on public.api_keys to authenticated;
drop policy if exists "users insert own api keys" on public.api_keys;

create or replace function public.api_keys_no_unrevoke()
returns trigger language plpgsql as $$
begin
  if current_user in ('anon', 'authenticated')
     and old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'revoked keys cannot be restored' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists api_keys_no_unrevoke on public.api_keys;
create trigger api_keys_no_unrevoke
  before update on public.api_keys
  for each row execute function public.api_keys_no_unrevoke();

-- 5. Hygiene: no client role needs TRUNCATE/TRIGGER/REFERENCES here.
revoke truncate, trigger, references on public.user_profiles, public.api_keys, public.api_usage from anon, authenticated;
