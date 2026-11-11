import { NextResponse } from 'next/server'

// GET /api/ce-courses/checkout?p=<key>  — Stripe Checkout for a Continuing Education
// (CE) online course from /continue-education/. Prices live HERE (server-side source
// of truth); the page only sends a course key, so amounts can't be tampered with.
//
// These are online courses, so there is NO shipping. Sales tax ("+ HST") is handled
// by Stripe Tax (automatic_tax): Stripe calculates the correct GST/HST/PST/QST from
// the buyer's billing address at checkout (0% outside Canada). No tax is hard-coded.
//
// We collect the buyer's full details so our record is complete:
//   • First name + last name (required custom fields)
//   • Billing address (required) → drives Stripe Tax
//   • Phone number
//
// The webhook (client_reference_id starting "ce-") emails the receipt + notifies the team.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Course prices in CAD (pre-HST). Keys MUST match the ?p= values on /continue-education/.
const COURSES: Record<string, { name: string; price: number; credits: number }> = {
  'exocad-essentials': { name: 'EXOCAD Essentials', price: 300, credits: 4 },
  'orthodontic-clear-alignment': { name: 'Orthodontic and Clear Alignment', price: 349, credits: 5 },
}

// Unique, human-readable order number assigned to every registrant.
function genOrderNumber(): string {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `CE-${ymd}-${rand}`
}

export async function GET(req: Request) {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    return NextResponse.json({ error: 'Payment is not configured.' }, { status: 500 })
  }

  const url = new URL(req.url)
  const pageUrl = `${url.origin}/continue-education/`

  const key = (url.searchParams.get('p') || '').trim()
  const course = COURSES[key]

  // Unknown / missing course → send them back to the page.
  if (!course) {
    return NextResponse.redirect(pageUrl, 303)
  }

  // Order number assigned to this registrant — carried in metadata for the receipt.
  const orderNumber = genOrderNumber()

  const params = new URLSearchParams()
  params.set('mode', 'payment')
  // Stripe Tax: calculate sales tax from the buyer's billing address automatically.
  params.set('automatic_tax[enabled]', 'true')
  params.set('line_items[0][quantity]', '1')
  params.set('line_items[0][price_data][currency]', 'cad')
  params.set('line_items[0][price_data][unit_amount]', String(Math.round(course.price * 100)))
  params.set('line_items[0][price_data][product_data][name]', course.name)
  params.set(
    'line_items[0][price_data][product_data][description]',
    `Online CE course · ${course.credits} CE credits`,
  )
  // Price is pre-tax; Stripe adds the calculated tax on top.
  params.set('line_items[0][price_data][tax_behavior]', 'exclusive')

  // Collect the buyer's full details at checkout. Billing address is required so
  // Stripe Tax can determine the correct rate; name + phone for our records.
  params.set('billing_address_collection', 'required')
  params.set('phone_number_collection[enabled]', 'true')
  params.set('custom_fields[0][key]', 'first_name')
  params.set('custom_fields[0][label][type]', 'custom')
  params.set('custom_fields[0][label][custom]', 'Student first name')
  params.set('custom_fields[0][type]', 'text')
  params.set('custom_fields[1][key]', 'last_name')
  params.set('custom_fields[1][label][type]', 'custom')
  params.set('custom_fields[1][label][custom]', 'Student family name')
  params.set('custom_fields[1][type]', 'text')
  params.set('allow_promotion_codes', 'true')
  params.set('client_reference_id', `ce-${key}`)
  params.set('metadata[product]', `ce-courses-${key}`)
  params.set('metadata[course]', course.name)
  params.set('metadata[order_number]', orderNumber)
  params.set('metadata[course_name]', course.name)
  params.set('metadata[course_subtotal]', course.price.toFixed(2))
  params.set('metadata[ce_credits]', String(course.credits))
  params.set('metadata[tax_mode]', 'auto')
  params.set('metadata[plan]', 'full')
  params.set('metadata[num_payments]', '1')
  params.set('success_url', `${pageUrl}?status=confirmed`)
  params.set('cancel_url', `${pageUrl}#courses`)

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
    console.error('ce-courses checkout session error', session.error)
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 502 })
  }

  // 303 so the browser follows with a GET to Stripe's hosted checkout.
  return NextResponse.redirect(session.url, 303)
}
