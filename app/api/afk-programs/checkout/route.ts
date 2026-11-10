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

// Sales tax by billing region. The buyer selects their province/country on the
// AFK page and it's passed as ?region=; outside Canada is tax-free. These are the
// common combined sales-tax rates — adjust any of them if your filings differ.
const TAX_RATES: Record<string, { rate: number; label: string }> = {
  ON: { rate: 0.13, label: 'HST (13%)' },
  NB: { rate: 0.15, label: 'HST (15%)' },
  NL: { rate: 0.15, label: 'HST (15%)' },
  PE: { rate: 0.15, label: 'HST (15%)' },
  NS: { rate: 0.14, label: 'HST (14%)' },
  QC: { rate: 0.14975, label: 'GST + QST (14.975%)' },
  BC: { rate: 0.12, label: 'GST + PST (12%)' },
  MB: { rate: 0.12, label: 'GST + PST (12%)' },
  SK: { rate: 0.11, label: 'GST + PST (11%)' },
  AB: { rate: 0.05, label: 'GST (5%)' },
  YT: { rate: 0.05, label: 'GST (5%)' },
  NT: { rate: 0.05, label: 'GST (5%)' },
  NU: { rate: 0.05, label: 'GST (5%)' },
  INTL: { rate: 0, label: 'No tax (outside Canada)' },
}
const DEFAULT_REGION = 'ON'

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

  // Tax by billing region (buyer-selected on the page). Falls back to Ontario.
  const regionParam = (url.searchParams.get('region') || '').trim().toUpperCase()
  const region = TAX_RATES[regionParam] ? regionParam : DEFAULT_REGION
  const taxInfo = TAX_RATES[region]
  const taxRate = taxInfo.rate

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

  const hstCents = Math.round(basePrice * taxRate * 100)
  // Full-course tax + total (independent of installment first payment) and the
  // order number assigned to this registrant — carried in metadata for the receipt.
  const courseTaxCents = Math.round(program.price * taxRate * 100)
  const orderNumber = genOrderNumber()

  const params = new URLSearchParams()
  params.set('mode', 'payment')
  params.set('line_items[0][quantity]', '1')
  params.set('line_items[0][price_data][currency]', 'cad')
  params.set('line_items[0][price_data][unit_amount]', String(Math.round(basePrice * 100)))
  params.set('line_items[0][price_data][product_data][name]', lineName)
  // Tax as its own line so the Stripe total matches the on-page breakdown. Skipped
  // entirely when the buyer is outside Canada (no tax).
  if (hstCents > 0) {
    params.set('line_items[1][quantity]', '1')
    params.set('line_items[1][price_data][currency]', 'cad')
    params.set('line_items[1][price_data][unit_amount]', String(hstCents))
    params.set('line_items[1][price_data][product_data][name]', taxInfo.label)
  }

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
  params.set('metadata[course_tax]', (courseTaxCents / 100).toFixed(2))
  // HST actually charged on THIS payment (full course, or just the first installment).
  params.set('metadata[paid_tax]', (hstCents / 100).toFixed(2))
  params.set('metadata[region]', region)
  params.set('metadata[tax_label]', taxInfo.label)
  if (isInstallment) {
    const inst = INSTALLMENTS[key]
    if (inst) {
      params.set('metadata[plan]', 'installment')
      params.set('metadata[num_payments]', String(inst.count + 1))
      params.set('metadata[first_total]', (Math.round(inst.first * (1 + taxRate) * 100) / 100).toFixed(2))
      params.set('metadata[monthly_total]', (Math.round(inst.monthly * (1 + taxRate) * 100) / 100).toFixed(2))
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
