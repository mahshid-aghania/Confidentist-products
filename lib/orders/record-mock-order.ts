import type { SupabaseClient } from '@supabase/supabase-js'

// Records a paid OSCE Mock Exam purchase into the ConfiDentist orders tables
// (orders + order_addresses + order_line_items + order_taxes + customers) so it
// shows up in the dashboard alongside the WooCommerce-synced orders.
//
// These orders don't originate in WooCommerce, so there's no real wc_order_id.
// We mint a deterministic synthetic one in a high range (>= 9e12) that can never
// collide with real WooCommerce ids, and which doubles as an idempotency guard:
// Stripe retries the webhook, and the unique constraint on wc_order_id (plus the
// order_key pre-check) makes a second insert a no-op.

export type OsceOrderInput = {
  email: string
  firstName: string
  lastName: string
  phone: string
  addressLine1: string
  addressLine2: string
  city: string
  state: string
  postalCode: string
  country: string
  productName: string
  amountTotalCents: number // Stripe amount_total (already includes HST)
  currency: string // e.g. "CAD"
  sessionId: string // Stripe Checkout Session id — idempotency key
  paymentIntent?: string // Stripe PaymentIntent id, if present
  sin?: string // sensitive; stored only in orders.raw
  rawSession?: unknown // full Stripe session, stored in orders.raw for fidelity
}

const HST_RATE = 0.13

// Deterministic synthetic wc_order_id from the session id. Range ~9e12–1e13:
// far above real WooCommerce order ids, within JS safe-integer range, stable
// across webhook retries.
function syntheticWcOrderId(sessionId: string): number {
  let h = 0
  for (let i = 0; i < sessionId.length; i++) {
    h = (h * 31 + sessionId.charCodeAt(i)) % 1_000_000_000_000
  }
  return 9_000_000_000_000 + h
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export async function recordOsceOrder(
  supabase: SupabaseClient,
  d: OsceOrderInput,
): Promise<{ recorded: boolean; skipped?: boolean; orderId?: string; error?: string }> {
  const nowIso = new Date().toISOString()

  // Idempotency: if we've already recorded this Stripe session, do nothing.
  const { data: existing } = await supabase
    .from('orders')
    .select('id')
    .eq('order_key', d.sessionId)
    .maybeSingle()
  if (existing?.id) return { recorded: false, skipped: true, orderId: existing.id as string }

  // Find or create the customer by email.
  let customerId: string | undefined
  const { data: cust } = await supabase
    .from('customers')
    .select('id')
    .eq('email', d.email)
    .limit(1)
    .maybeSingle()
  if (cust?.id) {
    customerId = cust.id as string
  } else if (d.email) {
    const { data: newCust, error: custErr } = await supabase
      .from('customers')
      .insert({
        email: d.email,
        first_name: d.firstName || null,
        last_name: d.lastName || null,
        phone: d.phone || null,
        is_paying_customer: true,
        date_created: nowIso,
      })
      .select('id')
      .single()
    if (custErr) return { recorded: false, error: `customer insert: ${custErr.message}` }
    customerId = newCust?.id as string
  }

  const total = round2(d.amountTotalCents / 100)
  // HST was added as its own line on top of the base price, so base = total / 1.13.
  const subtotal = round2(total / (1 + HST_RATE))
  const tax = round2(total - subtotal)
  const currency = d.currency || 'CAD'

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert({
      wc_order_id: syntheticWcOrderId(d.sessionId),
      order_number: `OSCE-${d.sessionId.slice(-8)}`,
      status: 'completed',
      currency,
      customer_id: customerId ?? null,
      total_amount: total,
      total_tax: tax,
      cart_tax: tax,
      payment_method: 'stripe',
      payment_method_title: 'Stripe — OSCE Mock Checkout',
      transaction_id: d.paymentIntent || d.sessionId,
      order_key: d.sessionId,
      created_via: 'osce-mock-checkout',
      date_paid: nowIso,
      date_completed: nowIso,
      raw: {
        source: 'osce-mock-checkout',
        stripe_session_id: d.sessionId,
        stripe_payment_intent: d.paymentIntent ?? null,
        sin: d.sin || null, // sensitive — kept here, not in a dedicated column
        session: d.rawSession ?? null,
      },
    })
    .select('id')
    .single()
  if (orderErr || !order?.id) {
    return { recorded: false, error: `order insert: ${orderErr?.message ?? 'no id'}` }
  }
  const orderId = order.id as string

  await supabase.from('order_addresses').insert({
    order_id: orderId,
    type: 'billing',
    first_name: d.firstName || null,
    last_name: d.lastName || null,
    address_1: d.addressLine1 || null,
    address_2: d.addressLine2 || null,
    city: d.city || null,
    state: d.state || null,
    postcode: d.postalCode || null,
    country: d.country || null,
    email: d.email || null,
    phone: d.phone || null,
  })

  await supabase.from('order_line_items').insert({
    order_id: orderId,
    name: d.productName,
    quantity: 1,
    price: subtotal,
    subtotal,
    subtotal_tax: tax,
    total: subtotal,
    total_tax: tax,
  })

  await supabase.from('order_taxes').insert({
    order_id: orderId,
    label: 'HST (13%)',
    rate_percent: 13,
    tax_total: tax,
  })

  return { recorded: true, orderId }
}
