-- ============================================================================
-- ConfiDentist — Event registrations (seat-deposit leads)
-- Migration 0003
--   Captures name/email/phone for event sign-ups (e.g. "From Associate to
--   Owner") and tracks the $50 seat deposit paid via a Stripe Payment Link.
-- ============================================================================

create table if not exists public.event_registrations (
  id                       uuid primary key default gen_random_uuid(),
  event_slug               text not null,
  event_name               text,
  full_name                text not null,
  email                    text not null,
  phone                    text,
  deposit_amount           numeric(12,2) not null default 0,
  currency                 text not null default 'CAD',
  status                   text not null default 'pending',   -- pending | paid
  stripe_payment_link_id   text,
  stripe_session_id        text,
  paid_at                  timestamptz,
  raw                      jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists event_registrations_event_idx  on public.event_registrations (event_slug);
create index if not exists event_registrations_email_idx  on public.event_registrations (lower(email));
create index if not exists event_registrations_status_idx on public.event_registrations (status);

drop trigger if exists trg_event_registrations_updated on public.event_registrations;
create trigger trg_event_registrations_updated before update on public.event_registrations
  for each row execute function set_updated_at();

alter table public.event_registrations enable row level security;
-- No policies: anon/authenticated see nothing; server routes use the service-role key.
