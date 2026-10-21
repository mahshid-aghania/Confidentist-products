import { NextResponse } from 'next/server'

// GET /api/osce-mock/checkout  — Stripe Checkout for the single OSCE Mock Exam
// (March 2026). The price lives HERE (server-side source of truth), so the
// amount can't be tampered with from the page. Creates a Checkout Session on
// the fly and 303-redirects the buyer to Stripe. 13% HST is added as its own
// line item so the Stripe total matches the on-page breakdown.
// The webhook (client_reference_id starting "osce-") emails the receipt + bccs the team.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HST_RATE = 0.13

// OSCE Mock Exam price in CAD.
const OSCE_MOCK = { name: 'OSCE Mock Exam — March 2026', price: 500 }

export async function GET(req: Request) {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    return NextResponse.json({ error: 'Payment is not configured.' }, { status: 500 })
  }

  const url = new URL(req.url)
  const pageUrl = `${url.origin}/osce-mock-exams/`

  const subtotal = OSCE_MOCK.price
  const hstCents = Math.round(subtotal * HST_RATE * 100)

  const params = new URLSearchParams()
  params.set('mode', 'payment')
  params.set('line_items[0][quantity]', '1')
  params.set('line_items[0][price_data][currency]', 'cad')
  params.set('line_items[0][price_data][unit_amount]', String(Math.round(OSCE_MOCK.price * 100)))
  params.set('line_items[0][price_data][product_data][name]', OSCE_MOCK.name)
  // HST as its own line so the Stripe total matches the on-page breakdown.
  params.set('line_items[1][quantity]', '1')
  params.set('line_items[1][price_data][currency]', 'cad')
  params.set('line_items[1][price_data][unit_amount]', String(hstCents))
  params.set('line_items[1][price_data][product_data][name]', 'HST (13%)')

  // Collect the buyer's full details at checkout so our record is complete:
  //  • first name + last name (required custom fields — Stripe's address form
  //    only captures a single combined name, so we ask explicitly)
  //  • billing address (required) → address lines, city, postal code, country
  //  • phone number
  //  • SIN as an optional custom field
  params.set('billing_address_collection', 'required')
  params.set('phone_number_collection[enabled]', 'true')
  params.set('custom_fields[0][key]', 'first_name')
  params.set('custom_fields[0][label][type]', 'custom')
  params.set('custom_fields[0][label][custom]', 'First name')
  params.set('custom_fields[0][type]', 'text')
  params.set('custom_fields[1][key]', 'last_name')
  params.set('custom_fields[1][label][type]', 'custom')
  params.set('custom_fields[1][label][custom]', 'Last name')
  params.set('custom_fields[1][type]', 'text')
  params.set('custom_fields[2][key]', 'sin')
  params.set('custom_fields[2][label][type]', 'custom')
  params.set('custom_fields[2][label][custom]', 'Social Insurance Number (SIN)')
  params.set('custom_fields[2][type]', 'text')
  params.set('custom_fields[2][optional]', 'true')
  params.set('allow_promotion_codes', 'true')
  params.set('client_reference_id', 'osce-mock-march-2026')
  params.set('metadata[product]', 'osce-mock-march-2026')
  params.set('metadata[course]', OSCE_MOCK.name)
  params.set('success_url', `${pageUrl}?status=confirmed`)
  params.set('cancel_url', pageUrl)

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })
  const session = (await res.json()) as { url?: string; error?: { message?: string } }

  if (!res.ok || !session.url) {
    console.error('osce-mock checkout session error', session.error)
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 502 })
  }

  // 303 so the browser follows with a GET to Stripe's hosted checkout.
  return NextResponse.redirect(session.url, 303)
}
