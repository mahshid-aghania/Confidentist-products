import { NextResponse } from 'next/server'
import { nextOrderNumber } from '@/lib/orders/next-order-number'

// GET /api/virtual-osce/checkout                    — pay the Virtual OSCE course (March 2027) in full
// GET /api/virtual-osce/checkout?plan=installment   — pay only the FIRST installment now ($1,399 + tax)
// Optional on both:  &region=<XX>                   — province, sets the sales-tax rate
//
// Creates a Stripe Checkout Session on the fly and 303-redirects the buyer to it.
// Prices live HERE (server-side source of truth); the page only sends plan + region.
//
// At checkout we collect the buyer's full details:
//   • Student first + family name (custom fields) and optional SIN
//   • Billing address (required) and phone number
//   • Delivery address + shipping option for the printed booklet. Shipping is charged
//     ONCE, on this first checkout (full payment or first installment); the second
//     installment is collected later by a manually-issued Stripe link without shipping.
//
// An order number is minted here (same sequence as AFK — see nextOrderNumber) and
// carried in metadata so the customer receipt, the admin email and the recorded order
// all show the SAME number. The webhook (client_reference_id starting "virtual-osce-")
// sends the detailed receipt and records the order.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COURSE_NAME = 'Virtual OSCE Course – March 2027'
const CLIENT_REF = 'virtual-osce-march-2027'

// $2,799 CAD base (pre-tax).
const PRICE = 2799

// Installment plan — 2 payments, matching the product page.
// 1,399 + 1,400 = 2,799 base. Sales tax is added to each payment.
const INSTALLMENT = {
  firstBase: 1399,
  monthlyBase: 1400,
  count: 1,
  name: 'Virtual OSCE Course – March 2027 · Installment 1 of 2',
  dates: ['December 24, 2026'],
}

// Hard-coded province sales-tax rates (same table as /api/afk-programs and
// /api/acj-programs). NOT Stripe Tax — see STRIPE-TAX-SETUP.md.
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

// Flat shipping rates for the printed booklet — same options and prices as AFK.
// Stripe Checkout pre-selects the FIRST option, so "within Canada" is listed first
// (the default); pickup is still available. MAXIMUM of 5 shipping_options.
const SHIPPING_OPTIONS: { name: string; amountCents: number }[] = [
  { name: 'Shipping — within Canada', amountCents: 7500 },
  { name: 'Shipping — United States', amountCents: 15000 },
  { name: 'Shipping — Europe & Africa', amountCents: 35000 },
  { name: 'Shipping — Asia & Oceania', amountCents: 40000 },
  { name: 'Pickup — collect in person (no shipping fee)', amountCents: 0 },
]

const SHIPPING_COUNTRIES = [
  'CA', 'US',
  'GB', 'IE', 'FR', 'DE', 'IT', 'ES', 'PT', 'NL', 'BE', 'LU', 'CH', 'AT', 'SE', 'NO',
  'DK', 'FI', 'IS', 'PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'GR', 'HR', 'SI', 'RS', 'UA',
  'EE', 'LV', 'LT', 'CY', 'MT',
  'ZA', 'NG', 'EG', 'KE', 'GH', 'MA', 'TN', 'DZ', 'ET', 'TZ', 'UG', 'ZW', 'ZM', 'CM', 'SN', 'CI',
  'IN', 'PK', 'BD', 'LK', 'NP', 'CN', 'HK', 'JP', 'KR', 'TW', 'SG', 'MY', 'TH', 'VN',
  'PH', 'ID', 'AE', 'SA', 'QA', 'KW', 'BH', 'OM', 'JO', 'LB', 'IQ', 'IL', 'TR',
  'KZ', 'UZ', 'AZ', 'GE', 'AM',
  'AU', 'NZ',
  'MX', 'BR', 'AR', 'CL', 'CO', 'PE',
]

export async function GET(req: Request) {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    return NextResponse.json({ error: 'Payment is not configured.' }, { status: 500 })
  }

  const url = new URL(req.url)
  const pageUrl = `${url.origin}/virtual-osce/march-2027/`

  const isInstallment = (url.searchParams.get('plan') || '').trim() === 'installment'

  const regionParam = (url.searchParams.get('region') || '').trim().toUpperCase()
  const region = TAX_RATES[regionParam] ? regionParam : DEFAULT_REGION
  const taxInfo = TAX_RATES[region]
  const taxRate = taxInfo.rate

  // Amount charged now (pre-tax): full price, or just the first installment.
  const basePrice = isInstallment ? INSTALLMENT.firstBase : PRICE
  const baseCents = Math.round(basePrice * 100)
  const paidTaxCents = Math.round(basePrice * taxRate * 100)
  const courseTaxCents = Math.round(PRICE * taxRate * 100)
  const lineName = isInstallment ? INSTALLMENT.name : COURSE_NAME
  const clientRef = isInstallment ? `${CLIENT_REF}-installment` : CLIENT_REF

  let orderNumber: string
  try {
    orderNumber = await nextOrderNumber()
  } catch (e) {
    console.error('virtual-osce order number error', e)
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 502 })
  }

  const params = new URLSearchParams()
  params.set('mode', 'payment')
  params.set('line_items[0][quantity]', '1')
  params.set('line_items[0][price_data][currency]', 'cad')
  params.set('line_items[0][price_data][unit_amount]', String(baseCents))
  params.set('line_items[0][price_data][product_data][name]', lineName)
  params.set(
    'line_items[0][price_data][product_data][description]',
    isInstallment
      ? 'First installment (1 of 2) · course starts December 19, 2026'
      : '2.5-month Virtual OSCE course · starts December 19, 2026',
  )
  if (paidTaxCents > 0) {
    params.set('line_items[1][quantity]', '1')
    params.set('line_items[1][price_data][currency]', 'cad')
    params.set('line_items[1][price_data][unit_amount]', String(paidTaxCents))
    params.set('line_items[1][price_data][product_data][name]', `Sales tax — ${region} · ${taxInfo.label}`)
  }

  // Buyer details: billing address, phone, delivery address + shipping, names, SIN.
  params.set('billing_address_collection', 'required')
  params.set('phone_number_collection[enabled]', 'true')
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

  params.set('client_reference_id', clientRef)
  params.set('metadata[product]', clientRef)
  params.set('metadata[course]', lineName)
  params.set('metadata[course_name]', COURSE_NAME)
  params.set('metadata[order_number]', orderNumber)
  params.set('metadata[course_subtotal]', PRICE.toFixed(2))
  params.set('metadata[course_start]', 'December 19, 2026')
  params.set('metadata[tax_mode]', 'hardcoded')
  params.set('metadata[tax_region]', region)
  params.set('metadata[tax_label]', taxInfo.label)
  params.set('metadata[tax_rate]', String(taxRate))
  params.set('metadata[paid_base]', basePrice.toFixed(2))
  params.set('metadata[paid_tax]', (paidTaxCents / 100).toFixed(2))
  params.set('metadata[course_tax]', (courseTaxCents / 100).toFixed(2))
  if (isInstallment) {
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
    console.error('virtual-osce checkout session error', session.error)
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 502 })
  }

  return NextResponse.redirect(session.url, 303)
}
