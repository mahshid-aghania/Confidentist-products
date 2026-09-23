-- ============================================================================
-- ConfiDentist — Installment / partial-payment plan per order
-- Migration 0002
--   Models WooCommerce "Partial payment details": a deposit + N scheduled
--   installments, each optionally collected via a Stripe Payment Link.
-- ============================================================================

do $$ begin
  create type installment_status as enum (
    'pending',    -- awaiting payment (link issued / due)
    'paid',
    'cancelled',
    'failed',
    'refunded'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.order_installments (
  id                       uuid primary key default gen_random_uuid(),
  order_id                 uuid not null references public.orders(id) on delete cascade,
  wc_payment_id            text,                     -- e.g. '58451-2'
  sequence                 integer not null,         -- 1 = deposit, 2..n = installments
  kind                     text not null default 'installment',  -- 'deposit' | 'installment'
  label                    text,                     -- 'Deposit' | 'Installment 2 of 6'
  due_date                 date,
  payment_method           text,                     -- 'Deposit' | 'Credit / Debit Card' | 'Link'
  amount                   numeric(12,2) not null default 0,
  currency                 text not null default 'CAD',
  source_status            text,                     -- status as shown in WooCommerce
  status                   installment_status not null default 'pending',
  stripe_payment_link_id   text,
  stripe_payment_link_url  text,
  paid_at                  timestamptz,
  raw                      jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (order_id, sequence)
);
create index if not exists order_installments_order_idx  on public.order_installments (order_id);
create index if not exists order_installments_status_idx on public.order_installments (status);
create index if not exists order_installments_due_idx    on public.order_installments (due_date);

drop trigger if exists trg_order_installments_updated on public.order_installments;
create trigger trg_order_installments_updated before update on public.order_installments
  for each row execute function set_updated_at();

alter table public.order_installments enable row level security;

-- Rollup view: one row per order with installment progress
create or replace view public.v_order_installments_summary as
select
  o.id                                         as order_id,
  o.wc_order_id,
  o.order_number,
  o.total_amount,
  o.currency,
  count(i.*)                                   as installment_count,
  count(*) filter (where i.status = 'paid')    as paid_count,
  count(*) filter (where i.status = 'pending') as pending_count,
  coalesce(sum(i.amount) filter (where i.status = 'paid'), 0)    as amount_paid,
  coalesce(sum(i.amount) filter (where i.status = 'pending'), 0) as amount_outstanding,
  min(i.due_date) filter (where i.status = 'pending')           as next_due_date
from public.orders o
left join public.order_installments i on i.order_id = o.id
group by o.id;
