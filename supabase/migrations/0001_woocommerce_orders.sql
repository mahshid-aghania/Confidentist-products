-- ============================================================================
-- ConfiDentist — WooCommerce Orders schema (dashboard)
-- Migration 0001
--
-- Models WooCommerce orders for an admin order dashboard:
--   list view  -> public.v_order_list  (one row per order, scannable)
--   detail view-> join orders + addresses + line_items + taxes + coupons
--                 + refunds + notes  (everything about one order)
--
-- Design notes:
--  * Every table that mirrors WooCommerce keeps a `wc_*_id` natural key so a
--    sync job can upsert idempotently, plus a `raw jsonb` column that stores
--    the untouched WooCommerce payload (nothing is ever lost).
--  * Money is NUMERIC(12,2); WooCommerce sends amounts as strings — cast on sync.
--  * Access is admin-only: RLS is ON and there are NO permissive policies, so
--    the anon/publishable key sees nothing. The dashboard reads server-side with
--    the service-role key (bypasses RLS). Authenticated-admin policies can be
--    added later (see the commented block at the bottom).
-- ============================================================================

-- gen_random_uuid() ships with Postgres 13+ (Supabase). Safe to ensure.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type order_status as enum (
    'pending',      -- awaiting payment
    'processing',   -- paid, being fulfilled
    'on-hold',      -- awaiting payment / manual review
    'completed',    -- fulfilled
    'cancelled',
    'refunded',
    'failed',
    'trash',
    'checkout-draft'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type address_type as enum ('billing', 'shipping');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- customers  (WooCommerce customers; guests allowed via order.billing email)
-- ---------------------------------------------------------------------------
create table if not exists public.customers (
  id                  uuid primary key default gen_random_uuid(),
  wc_customer_id      bigint unique,                 -- null for guest checkouts
  email               text not null,
  first_name          text,
  last_name           text,
  username            text,
  phone               text,
  is_paying_customer  boolean default false,
  orders_count        integer default 0,
  total_spent         numeric(12,2) default 0,
  date_created        timestamptz,
  raw                 jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists customers_email_idx on public.customers (lower(email));

drop trigger if exists trg_customers_updated on public.customers;
create trigger trg_customers_updated before update on public.customers
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- products  (the courses/bundles sold; catalog snapshot from WooCommerce)
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id                uuid primary key default gen_random_uuid(),
  wc_product_id     bigint unique,
  name              text not null,
  slug              text,
  sku               text,
  type              text,                            -- simple | variable | subscription | ...
  status            text,                            -- publish | draft | ...
  permalink         text,                            -- link to the course page
  price             numeric(12,2),
  regular_price     numeric(12,2),
  sale_price        numeric(12,2),
  short_description  text,
  description        text,
  categories        text[],                          -- e.g. {AFK, Mock Exams}
  image_url         text,
  raw               jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists products_slug_idx on public.products (slug);
create index if not exists products_sku_idx  on public.products (sku);

drop trigger if exists trg_products_updated on public.products;
create trigger trg_products_updated before update on public.products
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- orders  (one row per WooCommerce order — the heart of the dashboard)
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id                   uuid primary key default gen_random_uuid(),
  wc_order_id          bigint unique not null,       -- WooCommerce order id
  order_number         text,                         -- display number (may differ from id)
  status               order_status not null default 'pending',
  currency             text not null default 'CAD',

  customer_id          uuid references public.customers(id) on delete set null,
  customer_note        text,

  -- money (order-level)
  discount_total       numeric(12,2) default 0,
  discount_tax         numeric(12,2) default 0,
  shipping_total       numeric(12,2) default 0,
  shipping_tax         numeric(12,2) default 0,
  cart_tax             numeric(12,2) default 0,
  total_amount         numeric(12,2) not null default 0,
  total_tax            numeric(12,2) default 0,
  prices_include_tax   boolean default false,

  -- payment
  payment_method       text,                         -- code, e.g. 'stripe'
  payment_method_title text,                         -- label, e.g. 'Credit Card (Stripe)'
  transaction_id       text,
  date_paid            timestamptz,
  date_completed       timestamptz,

  -- provenance / audit
  order_key            text,
  created_via          text,                         -- checkout | admin | rest-api | ...
  ip_address           text,
  user_agent           text,

  -- lifecycle
  date_created         timestamptz not null default now(),
  date_modified        timestamptz,

  raw                  jsonb,                         -- full WooCommerce order payload
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists orders_status_idx        on public.orders (status);
create index if not exists orders_date_created_idx  on public.orders (date_created desc);
create index if not exists orders_customer_id_idx   on public.orders (customer_id);
create index if not exists orders_order_number_idx  on public.orders (order_number);

drop trigger if exists trg_orders_updated on public.orders;
create trigger trg_orders_updated before update on public.orders
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- order_addresses  (billing + shipping; 1 row per type per order)
-- ---------------------------------------------------------------------------
create table if not exists public.order_addresses (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders(id) on delete cascade,
  type         address_type not null,
  first_name   text,
  last_name    text,
  company      text,
  address_1    text,
  address_2    text,
  city         text,
  state        text,
  postcode     text,
  country      text,                                 -- ISO-2, e.g. 'CA'
  email        text,                                 -- billing only, usually
  phone        text,
  created_at   timestamptz not null default now(),
  unique (order_id, type)
);
create index if not exists order_addresses_order_idx on public.order_addresses (order_id);

-- ---------------------------------------------------------------------------
-- order_line_items  (the courses/products purchased in an order)
-- ---------------------------------------------------------------------------
create table if not exists public.order_line_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders(id) on delete cascade,
  wc_line_item_id  bigint,
  product_id       uuid references public.products(id) on delete set null,
  wc_product_id    bigint,
  wc_variation_id  bigint,
  name             text not null,                    -- course name snapshot at purchase
  sku              text,
  quantity         integer not null default 1,
  price            numeric(12,2),                    -- per-unit price
  subtotal         numeric(12,2) default 0,          -- before discounts
  subtotal_tax     numeric(12,2) default 0,
  total            numeric(12,2) default 0,          -- after discounts
  total_tax        numeric(12,2) default 0,
  meta             jsonb,                            -- variation attrs, custom fields
  created_at       timestamptz not null default now(),
  unique (order_id, wc_line_item_id)
);
create index if not exists line_items_order_idx   on public.order_line_items (order_id);
create index if not exists line_items_product_idx on public.order_line_items (product_id);

-- ---------------------------------------------------------------------------
-- order_coupons  (coupons applied to an order)
-- ---------------------------------------------------------------------------
create table if not exists public.order_coupons (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders(id) on delete cascade,
  wc_coupon_id   bigint,
  code           text not null,
  discount       numeric(12,2) default 0,
  discount_tax   numeric(12,2) default 0,
  raw            jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists order_coupons_order_idx on public.order_coupons (order_id);

-- ---------------------------------------------------------------------------
-- order_taxes  (tax lines per order)
-- ---------------------------------------------------------------------------
create table if not exists public.order_taxes (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  wc_rate_id    bigint,
  rate_code     text,                                -- e.g. 'CA-HST-1'
  label         text,                                -- e.g. 'HST'
  rate_percent  numeric(6,3),                        -- e.g. 13.000
  tax_total     numeric(12,2) default 0,
  shipping_tax_total numeric(12,2) default 0,
  is_compound   boolean default false,
  created_at    timestamptz not null default now()
);
create index if not exists order_taxes_order_idx on public.order_taxes (order_id);

-- ---------------------------------------------------------------------------
-- order_refunds  (refunds issued against an order)
-- ---------------------------------------------------------------------------
create table if not exists public.order_refunds (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  wc_refund_id  bigint unique,
  amount        numeric(12,2) not null default 0,
  reason        text,
  refunded_by   text,
  date_created  timestamptz,
  raw           jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists order_refunds_order_idx on public.order_refunds (order_id);

-- ---------------------------------------------------------------------------
-- order_notes  (WooCommerce order notes / activity log)
-- ---------------------------------------------------------------------------
create table if not exists public.order_notes (
  id                uuid primary key default gen_random_uuid(),
  order_id          uuid not null references public.orders(id) on delete cascade,
  wc_note_id        bigint unique,
  content           text,
  is_customer_note  boolean default false,           -- true = visible to customer
  author            text,
  date_created      timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists order_notes_order_idx on public.order_notes (order_id);

-- ---------------------------------------------------------------------------
-- sync_log  (audit of WooCommerce -> Supabase sync runs; optional but handy)
-- ---------------------------------------------------------------------------
create table if not exists public.sync_log (
  id            uuid primary key default gen_random_uuid(),
  source        text not null default 'woocommerce',
  entity        text,                                -- orders | products | customers
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text,                                -- running | success | error
  records       integer default 0,
  message       text
);

-- ============================================================================
-- Dashboard list view — one scannable row per order.
-- The detail page then loads the normalized child rows for the clicked order.
-- ============================================================================
create or replace view public.v_order_list as
select
  o.id,
  o.wc_order_id,
  o.order_number,
  o.status,
  o.currency,
  o.total_amount,
  o.date_created,
  o.date_paid,
  o.payment_method_title,
  -- customer display: prefer linked customer, fall back to billing address
  coalesce(
    nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
    nullif(trim(concat_ws(' ', b.first_name, b.last_name)), ''),
    b.email,
    c.email
  )                                   as customer_name,
  coalesce(c.email, b.email)          as customer_email,
  b.city                              as billing_city,
  b.state                             as billing_state,
  b.country                           as billing_country,
  (select count(*) from public.order_line_items li where li.order_id = o.id) as item_count,
  (select string_agg(li.name, ', ' order by li.name)
     from public.order_line_items li where li.order_id = o.id)               as course_names
from public.orders o
left join public.customers c on c.id = o.customer_id
left join public.order_addresses b on b.order_id = o.id and b.type = 'billing';

-- ============================================================================
-- Row-Level Security — locked down by default (admin dashboard reads via
-- the service-role key server-side, which bypasses RLS).
-- ============================================================================
alter table public.customers        enable row level security;
alter table public.products         enable row level security;
alter table public.orders           enable row level security;
alter table public.order_addresses  enable row level security;
alter table public.order_line_items enable row level security;
alter table public.order_coupons    enable row level security;
alter table public.order_taxes      enable row level security;
alter table public.order_refunds    enable row level security;
alter table public.order_notes      enable row level security;
alter table public.sync_log         enable row level security;

-- No policies = deny all for anon/authenticated. Service role bypasses RLS.
-- When you add real admin logins, replace with policies like:
--
--   create policy "admins read orders" on public.orders
--     for select to authenticated
--     using (exists (select 1 from public.admin_users a where a.user_id = auth.uid()));
--
-- (repeat per table, or use a SECURITY DEFINER helper.)
