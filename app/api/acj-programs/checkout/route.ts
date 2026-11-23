import { NextResponse } from 'next/server'

// GET /api/acj-programs/checkout                     — pay the ACJ Comprehensive program in full
// GET /api/acj-programs/checkout?plan=installment     — pay only the FIRST installment now
// Optional on both:  &region=<XX>                     — province, sets the sales-tax rate
//
// Creates a Stripe Checkout Session on the fly and 303-redirects the buyer to it.
// Stripe Checkout collects email + phone; the webhook (client_reference_id starting
// "acj-") emails the receipt and bccs the team.
//
// The buyer picks their province on /acj-programs/comprehensive/; it arrives as
// ?region=XX and the matching sales tax is added as its OWN line item so the Stripe
// total matches the on-page estimate. Installment plan: the first payment is charged
// now; the remaining 4 payments are collected later via manually-issued Stripe links
// (same process as AFK). On the installment path we also collect the student's
// first/last name so those follow-up links can be addressed.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COURSE_NAME = 'ACJ Comprehensive Program (7-month)'
const CLIENT_REF = 'acj-comprehensive'

// $3,039 CAD base (pre-tax). Ontario buyer: + 13% HST = $3,434.07 (unchanged).
const BASE_CENTS = 303900

// Hard-coded province sales-tax rates (same convention as /api/afk-programs). This is
// NOT Stripe Tax — see STRIPE-TAX-SETUP.md. HST provinces at their HST rate; GST-only
// (5%) elsewhere; outside Canada (INTL) = tax-free.
const TAX_RATES: Record<string, { rate: number; label: string }> = {
  ON: { rate: 0.13, label: 'HST (13%)' },
  NB: { rate: 0.15, label: 'HST (15%)' },
  NL: { rate: 0.15, label: 'HST (15%)' },
  PE: { rate: 0.15, label: 'HST (15%)' },
  NS: { rate: 0.14, label: 'HST (14%)' },
  QC: { rate: 0.05, label: 'GST (5%)' },
  BC: { rate: 0.05, label: 'GST (5%)' },
  MB: { rate: 0.05, label: 'GST (5%)' },
  SK: { rate: 0.05, label: 'GST (5%)' },
  AB: { rate: 0.05, label: 'GST (5%)' },
  YT: { rate: 0.05, label: 'GST (5%)' },
  NT: { rate: 0.05, label: 'GST (5%)' },
  NU: { rate: 0.05, label: 'GST (5%)' },
  INTL: { rate: 0, label: 'No tax (outside Canada)' },
}
const DEFAULT_REGION = 'ON'

// Installment plan — base amounts (pre-tax), matching the on-page schedule.
// 1,000 + 4 × 509.75 = 3,039.00 base. Sales tax is added to each payment.
const INSTALLMENT = {
  firstBase: 1000,
  monthlyBase: 509.75,
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

  // Province → hard-coded sales-tax rate (unknown/missing falls back to Ontario).
  const regionParam = (url.searchParams.get('region') || '').trim().toUpperCase()
  const region = TAX_RATES[regionParam] ? regionParam : DEFAULT_REGION
  const taxInfo = TAX_RATES[region]
  const taxRate = taxInfo.rate

  // Amount charged now (pre-tax): full price, or just the first installment.
  const baseCents = isInstallment ? Math.round(INSTALLMENT.firstBase * 100) : BASE_CENTS
  const paidTaxCents = Math.round(baseCents * taxRate)
  const courseTaxCents = Math.round(BASE_CENTS * taxRate)
  const lineName = isInstallment ? INSTALLMENT.name : COURSE_NAME
  const clientRef = isInstallment ? `${CLIENT_REF}-installment` : CLIENT_REF
  const lineDescription = isInstallment
    ? 'First installment (1 of 5) for the 7-month ACJ Comprehensive program'
    : '7-month comprehensive ACJ preparation'

  const params = new URLSearchParams()
  params.set('mode', 'payment')
  params.set('line_items[0][quantity]', '1')
  params.set('line_items[0][price_data][currency]', 'cad')
  params.set('line_items[0][price_data][unit_amount]', String(baseCents))
  params.set('line_items[0][price_data][product_data][name]', lineName)
  params.set('line_items[0][price_data][product_data][description]', lineDescription)
  // Hard-coded province sales tax as its own line item (skipped outside Canada).
  if (paidTaxCents > 0) {
    params.set('line_items[1][quantity]', '1')
    params.set('line_items[1][price_data][currency]', 'cad')
    params.set('line_items[1][price_data][unit_amount]', String(paidTaxCents))
    params.set('line_items[1][price_data][product_data][name]', `Sales tax — ${region} · ${taxInfo.label}`)
  }
  params.set('phone_number_collection[enabled]', 'true')
  params.set('allow_promotion_codes', 'true')
  params.set('client_reference_id', clientRef)
  params.set('metadata[product]', clientRef)
  params.set('metadata[course]', lineName)
  params.set('metadata[course_name]', COURSE_NAME)
  params.set('metadata[course_subtotal]', (BASE_CENTS / 100).toFixed(2))
  params.set('metadata[tax_mode]', 'hardcoded')
  params.set('metadata[tax_region]', region)
  params.set('metadata[tax_label]', taxInfo.label)
  params.set('metadata[tax_rate]', String(taxRate))
  params.set('metadata[paid_tax]', (paidTaxCents / 100).toFixed(2))
  params.set('metadata[course_tax]', (courseTaxCents / 100).toFixed(2))

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
