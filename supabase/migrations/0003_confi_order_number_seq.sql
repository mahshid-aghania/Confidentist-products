-- ============================================================================
-- ConfiDentist — sequential WooCommerce-style order numbers for Stripe-direct
-- orders (CE course registrations, etc.)
-- Migration 0003
--
-- New online registrations (e.g. /api/ce-courses/checkout) are not WooCommerce
-- orders, so they used to get a synthetic order number (e.g. "CE-ab12cd34").
-- To keep a single, continuous numeric order ledger that matches the
-- WooCommerce numbering style, these orders now pull the next value from a
-- real Postgres sequence. Using a sequence (not MAX()+1) makes assignment
-- atomic: two payments completing at the same instant can never collide.
--
-- The sequence is seeded just past the current highest numeric order_number.
-- ============================================================================

create sequence if not exists public.confi_order_number_seq as bigint;

-- Seed: next nextval() returns (current max numeric order_number) + 1.
select setval(
  'public.confi_order_number_seq',
  (select coalesce(max(order_number::bigint), 59022)
     from public.orders where order_number ~ '^[0-9]+$') + 1,
  false
);

-- Reserve-the-next-number helper, callable by the app (service role).
create or replace function public.next_confi_order_number()
  returns bigint
  language sql
  security definer
  set search_path = public
  as $$ select nextval('public.confi_order_number_seq'); $$;

grant execute on function public.next_confi_order_number() to service_role;
