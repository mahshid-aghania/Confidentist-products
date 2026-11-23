import { NextResponse } from 'next/server'

// GET /api/acj-programs/checkout            — pay the ACJ Comprehensive program in full
// GET /api/acj-programs/checkout?plan=installment — pay only the FIRST installment now
//
// Creates a Stripe Checkout Session on the fly (no pre-made Payment Link needed) and
// 303-redirects the buyer to it. Stripe Checkout collects the email + phone; the
// webhook (client_reference_id starting "acj-") emails the receipt and bccs the team.
//
// Installment plan: the first payment is charged now; the remaining 4 payments are
// collected later via manually-issued Stripe payment links (same process as AFK).
// On the installment path we also collect the student's first/last name so those
// follow-up links can be addressed correctly.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COURSE_NAME = 'ACJ Comprehensive Program (7-month)'
const CLIENT_REF = 'acj-comprehensive'

// $3,039 CAD + 13% Ontario HST, baked into the charge (same convention as the
// full price shown on /acj-programs/ as "$3,039 CAD + HST"). Total = $3,434.07.
const BASE_CENTS = 303900
const HST_RATE = 0.13
const TOTAL_CENTS = Math.round(BASE_CENTS * (1 + HST_RATE)) // 343407

// Installment plan — base amounts (pre-HST), matching the on-page schedule.
// 499.92 + 4 × 634.85 = 3,039.32 base. 13% HST is added to each payment, so the
// first charge now = round(499.92 × 1.13) = $564.91.
const INSTALLMENT = {
  firstBase: 499.92,
  monthlyBase: 634.85,
  count: 4,
  name: 'ACJ Comprehensive – May 2027 · Installment 1 of 5',
  dates: ['December 23, 2026', 'January 23, 2027', 'February 23, 2027', 'March 23, 2027'],
}

export async function GET(req: Request) {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    return NextResponse.json({ error: 'Payment is not configured.' }, { status: 500 })
  }

  const url = new URL(req.url)
  const pageUrl = `${url.origin}/acj-programs/`

  const isInstallment = (url.searchParams.get('plan') || '').trim() === 'installment'

  // Amount charged now — full price, or just the first installment (both HST-baked).
  const chargeCents = isInstallment
    ? Math.round(INSTALLMENT.firstBase * 100 * (1 + HST_RATE))
    : TOTAL_CENTS
  const lineName = isInstallment ? INSTALLMENT.name : COURSE_NAME
  const clientRef = isInstallment ? `${CLIENT_REF}-installment` : CLIENT_REF
  const lineDescription = isInstallment
    ? 'First installment (1 of 5) for the 7-month ACJ Comprehensive program — incl. 13% HST'
    : '7-month comprehensive ACJ preparation — incl. 13% HST'

  const params = new URLSearchParams()
  params.set('mode', 'payment')
  params.set('line_items[0][quantity]', '1')
  params.set('line_items[0][price_data][currency]', 'cad')
  params.set('line_items[0][price_data][unit_amount]', String(chargeCents))
  params.set('line_items[0][price_data][product_data][name]', lineName)
  params.set('line_items[0][price_data][product_data][description]', lineDescription)
  params.set('phone_number_collection[enabled]', 'true')
  params.set('allow_promotion_codes', 'true')
  params.set('client_reference_id', clientRef)
  params.set('metadata[product]', clientRef)
  params.set('metadata[course]', lineName)
  params.set('metadata[course_name]', COURSE_NAME)
  params.set('metadata[course_subtotal]', (BASE_CENTS / 100).toFixed(2))

  if (isInstallment) {
    // Collect the student's name so the remaining payment links can be issued.
    params.set('custom_fields[0][key]', 'first_name')
    params.set('custom_fields[0][label][type]', 'custom')
    params.set('custom_fields[0][label][custom]', 'Student first name')
    params.set('custom_fields[0][type]', 'text')
    params.set('custom_fields[1][key]', 'last_name')
    params.set('custom_fields[1][label][type]', 'custom')
    params.set('custom_fields[1][label][custom]', 'Student family name')
    params.set('custom_fields[1][type]', 'text')

    params.set('metadata[plan]', 'installment')
    params.set('metadata[num_payments]', String(INSTALLMENT.count + 1))
    params.set('metadata[first_base]', INSTALLMENT.firstBase.toFixed(2))
    params.set('metadata[monthly_base]', INSTALLMENT.monthlyBase.toFixed(2))
    params.set('metadata[monthly_count]', String(INSTALLMENT.count))
    params.set('metadata[installment_dates]', INSTALLMENT.dates.join('|'))
  } else {
    params.set('metadata[plan]', 'full')
    params.set('metadata[num_payments]', '1')
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
    console.error('acj checkout session error', session.error)
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 502 })
  }

  // 303 so the browser follows with a GET to Stripe's hosted checkout.
  return NextResponse.redirect(session.url, 303)
}
