-- Roozno independent admin panel tables. Additive migration; take a database backup first.
-- The service role is used only inside the Edge Function and must never be exposed to browsers.

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  admin_user_id uuid not null,
  admin_email text not null,
  action text not null check (char_length(action) between 2 and 80),
  target_user_id uuid null,
  reason text not null check (char_length(btrim(reason)) >= 4),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_created_idx on public.admin_audit_log(created_at desc);
create index if not exists admin_audit_log_target_idx on public.admin_audit_log(target_user_id, created_at desc);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon, authenticated;
grant select, insert on public.admin_audit_log to service_role;

-- Reviewable admin-created warnings can reuse security_alerts; this table stores temporary or indefinite auth restrictions.
create table if not exists public.admin_user_restrictions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  restriction_type text not null check (restriction_type in ('warning','competition_suspension','account_ban')),
  reason text not null check (char_length(btrim(reason)) >= 4),
  starts_at timestamptz not null default now(),
  ends_at timestamptz null,
  active boolean not null default true,
  created_by uuid not null,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  cleared_at timestamptz null,
  cleared_by uuid null,
  clear_reason text null
);
create index if not exists admin_user_restrictions_user_active_idx on public.admin_user_restrictions(user_id, active, created_at desc);
alter table public.admin_user_restrictions enable row level security;
revoke all on public.admin_user_restrictions from anon, authenticated;
grant select, insert, update on public.admin_user_restrictions to service_role;

-- Allow signed ledger corrections only when the event type is explicitly admin_adjustment.
-- Existing client roles still have no direct access to xp_events.
alter table public.xp_events drop constraint if exists xp_events_amount_check;
alter table public.xp_events add constraint xp_events_amount_check
  check (amount <> 0 and amount >= -10000 and amount <= 10000 and (amount > 0 or event_type = 'admin_adjustment'));

-- Keep the existing trigger's lifetime XP update. Negative corrections cannot take lifetime XP below zero due to profiles check constraint.
-- This function is not granted to browser roles; Edge Function validates admin identity before inserting an event.
grant select, insert, update on public.security_alerts to service_role;
revoke all on public.admin_audit_log from public, anon, authenticated;
revoke all on public.admin_user_restrictions from public, anon, authenticated;
