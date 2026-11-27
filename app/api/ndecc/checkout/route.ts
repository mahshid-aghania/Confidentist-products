import { NextResponse } from 'next/server'
import { nextOrderNumber } from '@/lib/orders/next-order-number'

// GET /api/ndecc/checkout?p=<product>&o=<option>[&plan=installment]
//
// Stripe Checkout for every NDECC product (product pages under /ndecc-programs/…/register/).
// Prices and installment splits live HERE (server-side source of truth) and match the
// former confidentist.ca WooCommerce products; the page only sends keys.
//
// Tax: the buyer picks their province on the product page (same selector and rates as
// the AFK / ACJ checkouts); it arrives as &region=XX and the matching sales tax is added
// as its own line item. Unknown/missing region → Ontario. Outside Canada (INTL) → no tax.
//
// Installments: the first payment is charged now; the rest are collected monthly by
// manually-issued Stripe links (same process as AFK/ACJ). Due dates are one month apart,
// counted from the purchase date (same as the old WooCommerce deposit plugin).
//
// The webhook (client_reference_id starting "ndecc-") sends the detailed receipt,
// notifies the team and records the order (see lib/orders/handle-course-order.ts).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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

type Option = { label: string; price: number }
type Plan = { first: number; later: number[] } // pre-tax amounts; sum = option price
type Product = {
  name: string
  page: string
  options: Record<string, Option>
  installments?: (price: number) => Plan
  // Fixed due dates for the later payments (instead of monthly from purchase).
  dueDates?: string[]
  // Installments only — no pay-in-full option.
  installmentOnly?: boolean
  // Fixed order number shared by every payment of a private plan. Taken from the
  // reserved band 70001–71000: above WooCommerce's ids (~59k) and below the
  // confi_order_number_seq start (71001), so the sequence can never reuse it.
  fixedOrderNumber?: string
  // Show the shipping line ($0.00) on the receipt.
  showZeroShipping?: boolean
}

const round2 = (n: number) => Math.round(n * 100) / 100
// "2 + 1 payments": 40% now, then 2 × 30% monthly (matches the old product pages).
const twoPlusOne = (price: number): Plan => {
  const later = round2(price * 0.3)
  return { first: round2(price - 2 * later), later: [later, later] }
}
// "1 + 1 payments": half now, half in a month.
const half = (price: number): Plan => {
  const later = round2(price / 2)
  return { first: round2(price - later), later: [later] }
}

const NDECC_PRODUCTS: Record<string, Product> = {
  'clinical-skills': {
    name: 'NDECC Clinical Skills – Core Package 2026',
    page: '/ndecc-programs/clinical-skills/register/',
    options: {
      '3-month': { label: '3-Month Program (Morning, 8:00 AM – 5:00 PM)', price: 5999 },
      '6-month': { label: '6-Month Program · Comprehensive Package', price: 11400 },
    },
    installments: twoPlusOne,
  },
  'skills-mock': {
    name: 'Professional NDECC Skills Mock Exam',
    page: '/ndecc-programs/skills-mock-exam/register/',
    options: {
      '1': { label: '1 Mock Exam', price: 1250 },
      '2': { label: '2 Mock Exams', price: 2400 },
      '3': { label: '3 Mock Exams', price: 3200 },
      '4': { label: '4 Mock Exams', price: 4000 },
      '5': { label: '5 Mock Exams', price: 4500 },
    },
  },
  'sj-course': {
    name: 'NDECC Situational Judgement In-person – 2026',
    page: '/ndecc-programs/situational-judgement/register/',
    options: {
      core: { label: 'Situational Judgement In-person (Core) – July intake', price: 4499 },
      comprehensive: { label: 'Situational Judgement Comprehensive In-person – June intake', price: 7599 },
    },
    installments: twoPlusOne,
  },
  'sj-mock': {
    name: 'Situational Judgement Mock Exam',
    page: '/ndecc-programs/situational-judgement-mock-exam/register/',
    options: {
      '2': { label: '2 Mock Exams', price: 1200 },
      '4': { label: '4 Mock Exams', price: 2300 },
      '8': { label: '8 Mock Exams', price: 3100 },
    },
    installments: half,
  },
  bundle: {
    name: 'The Brilliant Bundle – 2026 (NDECC)',
    page: '/ndecc-programs/bundles/register/',
    options: { full: { label: 'All-inclusive NDECC program', price: 24499 } },
    // Bundle price $24,499 (regular $25,249): 4,899.82 now + 6 × 3,266.53 = 24,499.00.
    installments: () => ({ first: 4899.82, later: Array(6).fill(3266.53) }),
  },
  'bundle-essential': {
    name: 'The Brilliant Bundle – Essential (NDECC)',
    page: '/ndecc-programs/brilliant-essential/register/',
    options: { full: { label: 'Complete NDECC program (Essential — basic tools not included)', price: 20500 } },
    // Essential bundle $20,500 in 3 installments: $7,000 now + 2 × $6,750 = $20,500.
    installments: () => ({ first: 7000, later: [6750, 6750] }),
  },
  // Private plan (unlisted page /ndecc-programs/plan/practice-5m-pb/): Priyansh Behimani —
  // 5-month practice program, $21,500 + tax in two payments of $10,750 + tax.
  // Payment 1 at checkout; payment 2 due December 27, 2026 (&pay=2 charges it).
  'practice-5m': {
    name: 'NDECC 5-Month Practice Program',
    page: '/ndecc-programs/plan/practice-5m-pb/',
    options: { pb: { label: 'Private plan — Priyansh Behimani', price: 21500 } },
    installments: () => ({ first: 10750, later: [10750] }),
    dueDates: ['December 27, 2026'],
    installmentOnly: true,
    fixedOrderNumber: '70001',
    showZeroShipping: true,
  },
}

// SJ mock exams run on a chosen month; validated against this list.
const SJ_MOCK_MONTHS = ['September', 'October', 'November', 'December']

function addMonths(d: Date, n: number): string {
  const x = new Date(d)
  const day = x.getDate()
  x.setMonth(x.getMonth() + n)
  if (x.getDate() < day) x.setDate(0) // clamp (e.g. Jan 31 → Feb 28)
  return x.toLocaleDateString('en-US', { timeZone: 'America/Toronto', month: 'long', day: 'numeric', year: 'numeric' })
}

export async function GET(req: Request) {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    return NextResponse.json({ error: 'Payment is not configured.' }, { status: 500 })
  }
  const url = new URL(req.url)
  const key = (url.searchParams.get('p') || '').trim()
  const product = NDECC_PRODUCTS[key]
  if (!product) return NextResponse.redirect(`${url.origin}/ndecc-programs/`, 303)
  const optKey = (url.searchParams.get('o') || Object.keys(product.options)[0]).trim()
  const option = product.options[optKey]
  const pageUrl = `${url.origin}${product.page}`
  if (!option) return NextResponse.redirect(pageUrl, 303)

  const month = (url.searchParams.get('m') || '').trim()
  const monthLabel = key === 'sj-mock' && SJ_MOCK_MONTHS.includes(month) ? month : ''

  const regionParam = (url.searchParams.get('region') || '').trim().toUpperCase()
  const TAX_REGION = TAX_RATES[regionParam] ? regionParam : DEFAULT_REGION
  const TAX_RATE = TAX_RATES[TAX_REGION].rate
  const TAX_LABEL = TAX_RATES[TAX_REGION].label

  const isInstallment =
    !!product.installments && (product.installmentOnly || (url.searchParams.get('plan') || '').trim() === 'installment')
  const plan = isInstallment && product.installments ? product.installments(option.price) : null
  // &pay=N charges installment N (N ≥ 2) of a fixed-date plan; default is the first payment.
  const payNo = plan && product.dueDates ? Math.min(Math.max(Number(url.searchParams.get('pay') || '1') || 1, 1), plan.later.length + 1) : 1
  const basePrice = plan ? (payNo > 1 ? plan.later[payNo - 2] : plan.first) : option.price
  const paidTaxCents = Math.round(basePrice * TAX_RATE * 100)
  const courseTaxCents = Math.round(option.price * TAX_RATE * 100)
  const optionName = `${option.label}${monthLabel ? ` · ${monthLabel}` : ''}`
  const courseName = `${product.name} — ${optionName}`
  const numPayments = plan ? plan.later.length + 1 : 1
  const lineName = plan ? `${courseName} · Installment ${payNo} of ${numPayments}` : courseName
  const clientRef = `ndecc-${key}-${optKey}${plan ? '-installment' : ''}${payNo > 1 ? `-pay${payNo}` : ''}`

  let orderNumber: string
  try {
    orderNumber = product.fixedOrderNumber ?? (await nextOrderNumber())
  } catch (e) {
    console.error('ndecc order number error', e)
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 502 })
  }

  const params = new URLSearchParams()
  params.set('mode', 'payment')
  params.set('line_items[0][quantity]', '1')
  params.set('line_items[0][price_data][currency]', 'cad')
  params.set('line_items[0][price_data][unit_amount]', String(Math.round(basePrice * 100)))
  params.set('line_items[0][price_data][product_data][name]', lineName)
  if (paidTaxCents > 0) {
    params.set('line_items[1][quantity]', '1')
    params.set('line_items[1][price_data][currency]', 'cad')
    params.set('line_items[1][price_data][unit_amount]', String(paidTaxCents))
    params.set('line_items[1][price_data][product_data][name]', `Sales tax — ${TAX_REGION} · ${TAX_LABEL}`)
  }

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
  params.set('custom_fields[2][key]', 'sin')
  params.set('custom_fields[2][label][type]', 'custom')
  params.set('custom_fields[2][label][custom]', 'Social Insurance Number (SIN)')
  params.set('custom_fields[2][type]', 'text')
  params.set('custom_fields[2][optional]', 'true')
  params.set('allow_promotion_codes', 'true')

  params.set('client_reference_id', clientRef)
  params.set('metadata[product]', clientRef)
  params.set('metadata[course]', lineName)
  params.set('metadata[course_name]', courseName)
  params.set('metadata[order_number]', orderNumber)
  if (product.showZeroShipping) params.set('metadata[show_shipping]', '1')
  params.set('metadata[course_subtotal]', option.price.toFixed(2))
  params.set('metadata[tax_mode]', 'hardcoded')
  params.set('metadata[tax_region]', TAX_REGION)
  params.set('metadata[tax_label]', TAX_LABEL)
  params.set('metadata[tax_rate]', String(TAX_RATE))
  params.set('metadata[paid_base]', basePrice.toFixed(2))
  params.set('metadata[paid_tax]', (paidTaxCents / 100).toFixed(2))
  params.set('metadata[course_tax]', (courseTaxCents / 100).toFixed(2))
  if (plan) {
    const now = new Date()
    const dates = product.dueDates ?? plan.later.map((_, i) => addMonths(now, i + 1))
    // Equal later payments (all current plans) — the receipt shows one amount per date.
    params.set('metadata[plan]', 'installment')
    params.set('metadata[num_payments]', String(numPayments))
    params.set('metadata[first_base]', plan.first.toFixed(2))
    params.set('metadata[monthly_base]', plan.later[0].toFixed(2))
    params.set('metadata[monthly_count]', String(plan.later.length))
    params.set('metadata[installment_dates]', dates.join('|'))
    params.set('metadata[installment_number]', String(payNo))
  } else {
    params.set('metadata[plan]', 'full')
    params.set('metadata[num_payments]', '1')
  }

  params.set('success_url', `${pageUrl}?status=confirmed`)
  params.set('cancel_url', pageUrl)

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  const session = (await res.json()) as { url?: string; error?: { message?: string } }
  if (!res.ok || !session.url) {
    console.error('ndecc checkout session error', session.error)
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 502 })
  }
  return NextResponse.redirect(session.url, 303)
}
