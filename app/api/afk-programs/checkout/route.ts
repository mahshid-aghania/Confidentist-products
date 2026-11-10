import { NextResponse } from 'next/server'

// GET /api/afk-programs/checkout?p=<key>  — Stripe Checkout for a full AFK program
// purchase (Extended / Comprehensive cohorts). Prices live HERE (server-side source
// of truth); the page only sends a program key, so amounts can't be tampered with.
// 13% HST is added as its own line item so the Stripe total matches the on-page
// "+ HST" pricing. Creates a Checkout Session on the fly and 303-redirects to Stripe.
//
// At checkout we collect the buyer's full details so our record is complete:
//   • First name + last name (required custom fields — Stripe's address form only
//     captures a single combined name, so we ask explicitly)
//   • Billing address (required) → address lines, city, postal code, country
//   • Phone number
//   • SIN (Social Insurance Number) as an optional custom field
//
// The webhook (client_reference_id starting "afk-") emails the receipt + bccs the team.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HST_RATE = 0.13

// Program prices in CAD (pre-HST). Keys MUST match the ?p= values on /afk-programs/.
const PROGRAMS: Record<string, { name: string; price: number }> = {
  'extended-aug-2027': { name: 'AFK Extended – Aug 2027', price: 6499 },
  'comprehensive-feb-2027': { name: 'AFK Comprehensive – Feb 2027', price: 4999 },
  'comprehensive-aug-2027': { name: 'AFK Comprehensive – Aug 2027 (Early Bird)', price: 4749 },
}

// Installment plans (first payment, pre-HST). When ?plan=installment is passed we
// charge only the FIRST payment now; the remaining payments are collected later via
// manually-issued Stripe payment links. 13% HST is still added on top of each amount.
// 6 + 1 plan: $1,429.78 today, then 6 × $844.87 monthly = $6,499 pre-HST total.
const INSTALLMENTS: Record<string, { first: number; name: string }> = {
  'extended-aug-2027': { first: 1429.78, name: 'AFK Extended – Aug 2027 · Installment 1 of 7' },
}

export async function GET(req: Request) {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    return NextResponse.json({ error: 'Payment is not configured.' }, { status: 500 })
  }

  const url = new URL(req.url)
  const pageUrl = `${url.origin}/afk-programs/`

  const key = (url.searchParams.get('p') || '').trim()
  const program = PROGRAMS[key]

  // Unknown / missing program → send them back to the page to pick a cohort.
  if (!program) {
    return NextResponse.redirect(pageUrl, 303)
  }

  // Optional installment plan: charge only the first payment now.
  const isInstallment = (url.searchParams.get('plan') || '').trim() === 'installment'
  let basePrice = program.price
  let lineName = program.name
  let refSuffix = ''
  if (isInstallment) {
    const inst = INSTALLMENTS[key]
    // Installments aren't offered for this program → fall back to the page.
    if (!inst) return NextResponse.redirect(pageUrl, 303)
    basePrice = inst.first
    lineName = inst.name
    refSuffix = '-installment'
  }

  const hstCents = Math.round(basePrice * HST_RATE * 100)

  const params = new URLSearchParams()
  params.set('mode', 'payment')
  params.set('line_items[0][quantity]', '1')
  params.set('line_items[0][price_data][currency]', 'cad')
  params.set('line_items[0][price_data][unit_amount]', String(Math.round(basePrice * 100)))
  params.set('line_items[0][price_data][product_data][name]', lineName)
  // HST as its own line so the Stripe total matches the on-page breakdown.
  params.set('line_items[1][quantity]', '1')
  params.set('line_items[1][price_data][currency]', 'cad')
  params.set('line_items[1][price_data][unit_amount]', String(hstCents))
  params.set('line_items[1][price_data][product_data][name]', 'HST (13%)')

  // Collect the buyer's full details at checkout.
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
  params.set('client_reference_id', `afk-programs-${key}${refSuffix}`)
  params.set('metadata[product]', `afk-programs-${key}${refSuffix}`)
  params.set('metadata[course]', lineName)
  if (isInstallment) {
    params.set('metadata[plan]', 'installment')
    params.set('metadata[installment]', '1 of 7')
    params.set('metadata[installment_schedule]', '6 x $844.87 + HST monthly after first payment')
  }
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
    console.error('afk-programs checkout session error', session.error)
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 502 })
  }

  // 303 so the browser follows with a GET to Stripe's hosted checkout.
  return NextResponse.redirect(session.url, 303)
}
