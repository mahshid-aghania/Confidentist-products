import { NextResponse } from 'next/server'

// GET /api/afk-subjects/checkout?s=key1,key2  — Stripe Checkout for individually
// selected AFK Feb 2027 subjects. Prices live HERE (server-side source of truth);
// the page only sends subject keys, so amounts can't be tampered with. Creates a
// Checkout Session on the fly and 303-redirects the buyer to Stripe.
// The webhook (client_reference_id starting "afk-") emails the receipt + notifies the team.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HST_RATE = 0.13

// Subject prices in CAD. Keys MUST match data-key on /afk-subject-feb-2027/.
const SUBJECTS: Record<string, { name: string; price: number }> = {
  'oral-maxillofacial-surgery': { name: 'Oral & Maxillofacial Surgery', price: 800 },
  'local-anesthesia': { name: 'Local Anesthesia', price: 600 },
  periodontics: { name: 'Periodontics', price: 800 },
  pharmacology: { name: 'Pharmacology', price: 800 },
  'restorative-dentistry': { name: 'Restorative Dentistry & Dental Materials', price: 600 },
}

export async function GET(req: Request) {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    return NextResponse.json({ error: 'Payment is not configured.' }, { status: 500 })
  }

  const url = new URL(req.url)
  const pageUrl = `${url.origin}/afk-subject-feb-2027/`

  const keys = (url.searchParams.get('s') || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
  const chosen = keys.map((k) => SUBJECTS[k]).filter(Boolean)

  // Nothing valid selected → send them back to the page to pick subjects.
  if (!chosen.length) {
    return NextResponse.redirect(pageUrl, 303)
  }

  const subtotal = chosen.reduce((s, c) => s + c.price, 0)
  const hstCents = Math.round(subtotal * HST_RATE * 100)

  const params = new URLSearchParams()
  params.set('mode', 'payment')
  chosen.forEach((c, i) => {
    params.set(`line_items[${i}][quantity]`, '1')
    params.set(`line_items[${i}][price_data][currency]`, 'cad')
    params.set(`line_items[${i}][price_data][unit_amount]`, String(Math.round(c.price * 100)))
    params.set(`line_items[${i}][price_data][product_data][name]`, `AFK Subject — ${c.name} (Feb 2027)`)
  })
  // HST as its own line so the Stripe total matches the on-page breakdown.
  const n = chosen.length
  params.set(`line_items[${n}][quantity]`, '1')
  params.set(`line_items[${n}][price_data][currency]`, 'cad')
  params.set(`line_items[${n}][price_data][unit_amount]`, String(hstCents))
  params.set(`line_items[${n}][price_data][product_data][name]`, 'HST (13%)')

  params.set('phone_number_collection[enabled]', 'true')
  params.set('allow_promotion_codes', 'true')
  params.set('client_reference_id', 'afk-subjects-feb-2027')
  params.set('metadata[product]', 'afk-subjects-feb-2027')
  params.set('metadata[course]', `AFK Feb 2027 Subjects — ${chosen.map((c) => c.name).join(', ')}`)
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
    console.error('afk-subjects checkout session error', session.error)
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 502 })
  }

  // 303 so the browser follows with a GET to Stripe's hosted checkout.
  return NextResponse.redirect(session.url, 303)
}
