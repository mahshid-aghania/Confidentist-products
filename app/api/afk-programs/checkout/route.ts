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

// Sales tax is handled by Stripe Tax (automatic_tax): Stripe calculates the correct
// GST/HST/PST/QST from the buyer's billing address at checkout, and 0% outside Canada.
// No tax rates are hard-coded here.

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
const INSTALLMENTS: Record<
  string,
  { first: number; monthly: number; count: number; name: string; dates: string[] }
> = {
  'extended-aug-2027': {
    first: 1429.78,
    monthly: 844.87,
    count: 6,
    name: 'AFK Extended – Aug 2027 · Installment 1 of 7',
    dates: [
      'December 10, 2026',
      'January 10, 2027',
      'February 10, 2027',
      'March 10, 2027',
      'April 10, 2027',
      'May 10, 2027',
    ],
  },
}

// Unique, human-readable order number assigned to every registrant.
function genOrderNumber(): string {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `AFK-${ymd}-${rand}`
}

// Flat shipping rates (CAD cents) for the printed booklets, by region. The buyer
// selects the matching option in Stripe Checkout against their delivery address.
const SHIPPING_OPTIONS: { name: string; amountCents: number }[] = [
  { name: 'Shipping — within Canada', amountCents: 7500 },
  { name: 'Shipping — United States', amountCents: 15000 },
  { name: 'Shipping — Australia', amountCents: 25000 },
  { name: 'Shipping — Europe & Africa', amountCents: 35000 },
  { name: 'Shipping — Asia', amountCents: 40000 },
]

// Countries the residential/shipping address may be in (ISO 3166-1 alpha-2).
const SHIPPING_COUNTRIES = [
  'CA', 'US',
  // Europe
  'GB', 'IE', 'FR', 'DE', 'IT', 'ES', 'PT', 'NL', 'BE', 'LU', 'CH', 'AT', 'SE', 'NO',
  'DK', 'FI', 'IS', 'PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'GR', 'HR', 'SI', 'RS', 'UA',
  'EE', 'LV', 'LT', 'CY', 'MT',
  // Africa
  'ZA', 'NG', 'EG', 'KE', 'GH', 'MA', 'TN', 'DZ', 'ET', 'TZ', 'UG', 'ZW', 'ZM', 'CM', 'SN', 'CI',
  // Asia & Middle East
  'IN', 'PK', 'BD', 'LK', 'NP', 'CN', 'HK', 'JP', 'KR', 'TW', 'SG', 'MY', 'TH', 'VN',
  'PH', 'ID', 'AE', 'SA', 'QA', 'KW', 'BH', 'OM', 'JO', 'LB', 'IQ', 'IL', 'TR',
  'KZ', 'UZ', 'AZ', 'GE', 'AM',
  // Oceania
  'AU', 'NZ',
  // Latin America
  'MX', 'BR', 'AR', 'CL', 'CO', 'PE',
]

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

  // Order number assigned to this registrant — carried in metadata for the receipt.
  const orderNumber = genOrderNumber()

  const params = new URLSearchParams()
  params.set('mode', 'payment')
  // Stripe Tax: calculate sales tax from the buyer's billing address automatically.
  params.set('automatic_tax[enabled]', 'true')
  params.set('line_items[0][quantity]', '1')
  params.set('line_items[0][price_data][currency]', 'cad')
  params.set('line_items[0][price_data][unit_amount]', String(Math.round(basePrice * 100)))
  params.set('line_items[0][price_data][product_data][name]', lineName)
  // Price is pre-tax; Stripe adds the calculated tax on top.
  params.set('line_items[0][price_data][tax_behavior]', 'exclusive')

  // Collect the buyer's full details at checkout.
  // Billing address (required) + residential/delivery address (shipping) with
  // regional shipping rates, plus the student's name, phone and SIN.
  params.set('billing_address_collection', 'required')
  params.set('phone_number_collection[enabled]', 'true')
  // Residential / delivery address — booklets ship here; drives shipping options.
  SHIPPING_COUNTRIES.forEach((c, i) => {
    params.set(`shipping_address_collection[allowed_countries][${i}]`, c)
  })
  SHIPPING_OPTIONS.forEach((s, i) => {
    params.set(`shipping_options[${i}][shipping_rate_data][type]`, 'fixed_amount')
    params.set(`shipping_options[${i}][shipping_rate_data][fixed_amount][amount]`, String(s.amountCents))
    params.set(`shipping_options[${i}][shipping_rate_data][fixed_amount][currency]`, 'cad')
    params.set(`shipping_options[${i}][shipping_rate_data][display_name]`, s.name)
    params.set(`shipping_options[${i}][shipping_rate_data][tax_behavior]`, 'exclusive')
  })
  params.set('custom_fields[0][key]', 'first_name')
  params.set('custom_fields[0][label][type]', 'custom')
  params.set('custom_fields[0][label][custom]', 'Student first name')
  params.set('custom_fields[0][type]', 'text')
  params.set('custom_fields[1][key]', 'last_name')
  params.set('custom_fields[1][label][type]', 'custom')
  params.set('custom_fields[1][label][custom]', 'Student family name')
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
  params.set('metadata[order_number]', orderNumber)
  params.set('metadata[course_name]', program.name)
  params.set('metadata[course_subtotal]', program.price.toFixed(2))
  // Tax is computed by Stripe Tax; the webhook reads the actual amount from the session.
  params.set('metadata[tax_mode]', 'auto')
  if (isInstallment) {
    const inst = INSTALLMENTS[key]
    if (inst) {
      params.set('metadata[plan]', 'installment')
      params.set('metadata[num_payments]', String(inst.count + 1))
      // Pre-tax base amounts; Stripe Tax adds the tax on each payment.
      params.set('metadata[first_base]', inst.first.toFixed(2))
      params.set('metadata[monthly_base]', inst.monthly.toFixed(2))
      params.set('metadata[monthly_count]', String(inst.count))
      params.set('metadata[installment_dates]', inst.dates.join('|'))
    }
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
    console.error('afk-programs checkout session error', session.error)
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 502 })
  }

  // 303 so the browser follows with a GET to Stripe's hosted checkout.
  return NextResponse.redirect(session.url, 303)
}
