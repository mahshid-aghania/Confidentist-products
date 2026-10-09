import { NextResponse } from 'next/server'

// GET /api/acj-programs/checkout  — one-click "Buy Now" for the ACJ Comprehensive
// program on the static /acj-programs/ page. Creates a Stripe Checkout Session on
// the fly (no pre-made Payment Link needed) and 303-redirects the buyer to it.
// Stripe Checkout collects the email + phone; the webhook (client_reference_id
// starting "acj-") emails the receipt and notifies the team.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COURSE_NAME = 'ACJ Comprehensive Program (6-month)'
const CLIENT_REF = 'acj-comprehensive'

// $3,039 CAD + 13% Ontario HST, baked into the charge (same convention as the
// ortho event in app/events/registry.ts). Total = $3,434.07 CAD.
const BASE_CENTS = 303900
const HST_RATE = 0.13
const TOTAL_CENTS = Math.round(BASE_CENTS * (1 + HST_RATE)) // 343407

export async function GET(req: Request) {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    return NextResponse.json({ error: 'Payment is not configured.' }, { status: 500 })
  }

  const origin = new URL(req.url).origin
  const pageUrl = `${origin}/acj-programs/`

  const params = new URLSearchParams()
  params.set('mode', 'payment')
  params.set('line_items[0][quantity]', '1')
  params.set('line_items[0][price_data][currency]', 'cad')
  params.set('line_items[0][price_data][unit_amount]', String(TOTAL_CENTS))
  params.set('line_items[0][price_data][product_data][name]', COURSE_NAME)
  params.set(
    'line_items[0][price_data][product_data][description]',
    '6-month comprehensive AFK preparation — incl. 13% HST',
  )
  params.set('phone_number_collection[enabled]', 'true')
  params.set('allow_promotion_codes', 'true')
  params.set('client_reference_id', CLIENT_REF)
  params.set('metadata[product]', CLIENT_REF)
  params.set('metadata[course]', COURSE_NAME)
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
    console.error('acj checkout session error', session.error)
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 502 })
  }

  // 303 so the browser follows with a GET to Stripe's hosted checkout.
  return NextResponse.redirect(session.url, 303)
}
