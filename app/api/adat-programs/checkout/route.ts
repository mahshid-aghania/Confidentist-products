import { NextResponse } from 'next/server'

// GET /api/adat-programs/checkout?p=<key>  — Stripe Checkout for an ADAT program
// purchase (Comprehensive / Crash). Prices live HERE (server-side source of truth);
// the page only sends a program key, so amounts can't be tampered with. 13% HST is
// added as its own line item so the Stripe total matches the on-page pricing. Creates
// a Checkout Session on the fly and 303-redirects to Stripe.
//
// At checkout we collect the buyer's full details so our record is complete:
//   • First name + last name (required custom fields)
//   • Billing address (required) + residential/delivery address (booklets ship here)
//   • Phone number, and SIN (optional custom field)
//
// The webhook (client_reference_id starting "adat-") emails the receipt, sends the
// team the full-info admin record, and records the order in Supabase.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Sales tax: HARD-CODED province rates. No province selector on the ADAT page, so the
// home province (Ontario, 13% HST) is used by default; an optional ?region=XX can
// override it. Outside Canada (INTL) = tax-free. NOTE: not Stripe Tax — see
// STRIPE-TAX-SETUP.md. Confirm rates with filings.
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

// Program prices in CAD (pre-tax). Keys MUST match the ?p= values on /adat-programs/.
const PROGRAMS: Record<string, { name: string; price: number }> = {
  comprehensive: { name: 'ADAT Comprehensive Program', price: 3999 },
  crash: { name: 'ADAT Crash Program', price: 2200 },
}

// Unique, human-readable order number assigned to every registrant.
function genOrderNumber(): string {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `ADAT-${ymd}-${rand}`
}

// Flat shipping rates (CAD cents) for the printed booklets, by region. Stripe Checkout
// allows a MAXIMUM of 5 shipping_options. Pickup + 4 regions keeps us within the cap.
const SHIPPING_OPTIONS: { name: string; amountCents: number }[] = [
  { name: 'Pickup — collect in person (no shipping fee)', amountCents: 0 },
  { name: 'Shipping — within Canada', amountCents: 7500 },
  { name: 'Shipping — United States', amountCents: 15000 },
  { name: 'Shipping — Europe & Africa', amountCents: 35000 },
  { name: 'Shipping — Asia & Oceania', amountCents: 40000 },
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
  const pageUrl = `${url.origin}/adat-programs/`

  const key = (url.searchParams.get('p') || '').trim()
  const program = PROGRAMS[key]

  // Unknown / missing program → send them back to the page to pick a program.
  if (!program) {
    return NextResponse.redirect(pageUrl, 303)
  }

  const basePrice = program.price
  const lineName = program.name

  // Order number assigned to this registrant — carried in metadata for the receipt.
  const orderNumber = genOrderNumber()

  // Buyer's province → hard-coded sales-tax rate. Defaults to Ontario (no selector).
  const regionParam = (url.searchParams.get('region') || '').trim().toUpperCase()
  const region = TAX_RATES[regionParam] ? regionParam : DEFAULT_REGION
  const taxInfo = TAX_RATES[region]
  const taxRate = taxInfo.rate
  const paidTaxCents = Math.round(basePrice * taxRate * 100)

  const params = new URLSearchParams()
  params.set('mode', 'payment')
  params.set('line_items[0][quantity]', '1')
  params.set('line_items[0][price_data][currency]', 'cad')
  params.set('line_items[0][price_data][unit_amount]', String(Math.round(basePrice * 100)))
  params.set('line_items[0][price_data][product_data][name]', lineName)
  // Hard-coded province sales tax as its own line item (skipped when 0 / outside Canada).
  if (paidTaxCents > 0) {
    params.set('line_items[1][quantity]', '1')
    params.set('line_items[1][price_data][currency]', 'cad')
    params.set('line_items[1][price_data][unit_amount]', String(paidTaxCents))
    params.set('line_items[1][price_data][product_data][name]', `Sales tax — ${region} · ${taxInfo.label}`)
  }

  // Collect the buyer's full details at checkout.
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
  params.set('client_reference_id', `adat-programs-${key}`)
  params.set('metadata[product]', `adat-programs-${key}`)
  params.set('metadata[course]', lineName)
  params.set('metadata[order_number]', orderNumber)
  params.set('metadata[course_name]', program.name)
  params.set('metadata[course_subtotal]', program.price.toFixed(2))
  params.set('metadata[tax_mode]', 'hardcoded')
  params.set('metadata[tax_region]', region)
  params.set('metadata[tax_label]', taxInfo.label)
  params.set('metadata[tax_rate]', String(taxRate))
  params.set('metadata[paid_tax]', (paidTaxCents / 100).toFixed(2))
  params.set('metadata[course_tax]', (paidTaxCents / 100).toFixed(2))
  params.set('metadata[plan]', 'full')
  params.set('metadata[num_payments]', '1')
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
    console.error('adat-programs checkout session error', session.error)
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 502 })
  }

  // 303 so the browser follows with a GET to Stripe's hosted checkout.
  return NextResponse.redirect(session.url, 303)
}
