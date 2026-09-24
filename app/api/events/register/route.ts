import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { EVENT, resolvePromo } from '@/app/events/from-associate-to-owner/event'

// POST /api/events/register/  — capture a registrant (name/email/phone + optional
// promotion code). Promotions are applied HERE, before Stripe:
//   • 100% off  -> deposit waived, no Stripe, registration confirmed for free.
//   • partial   -> Stripe Checkout Session with the discounted amount.
//   • none      -> Stripe Checkout Session at the full $50 deposit.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: Request) {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    return NextResponse.json({ error: 'Payment is not configured.' }, { status: 500 })
  }

  let body: { fullName?: string; email?: string; phone?: string; promoCode?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const fullName = (body.fullName ?? '').trim()
  const email = (body.email ?? '').trim()
  const phone = (body.phone ?? '').trim()
  const promoRaw = (body.promoCode ?? '').trim()

  if (!fullName) return NextResponse.json({ error: 'Please enter your name.' }, { status: 400 })
  if (!EMAIL_RE.test(email))
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  if (!phone) return NextResponse.json({ error: 'Please enter your phone number.' }, { status: 400 })

  // Resolve promo BEFORE Stripe.
  const percentOff = resolvePromo(promoRaw)
  if (percentOff === null) {
    return NextResponse.json({ error: `Promotion code “${promoRaw}” isn’t valid.` }, { status: 400 })
  }
  const fullCents = Math.round(EVENT.depositAmount * 100)
  const dueCents = Math.round((fullCents * (100 - percentOff)) / 100)
  const promoApplied = percentOff > 0 ? promoRaw : null

  // Store the lead first (best-effort).
  let registrationId: string | null = null
  try {
    const supabase = createServerClient()
    const free = dueCents === 0
    const { data } = await supabase
      .from('event_registrations')
      .insert({
        event_slug: EVENT.slug,
        event_name: EVENT.name,
        full_name: fullName,
        email,
        phone,
        deposit_amount: dueCents / 100,
        currency: EVENT.currency,
        status: free ? 'paid' : 'pending',
        paid_at: free ? new Date().toISOString() : null,
        raw: { source: 'event-page', promo_code: promoApplied, percent_off: percentOff, comped: free },
      })
      .select('id')
      .single()
    registrationId = (data as { id: string } | null)?.id ?? null
  } catch (e) {
    console.error('event registration insert failed', e)
  }

  // 100% off → skip Stripe entirely, confirm for free.
  if (dueCents === 0) {
    return NextResponse.json({ url: `${EVENT.baseUrl}?status=confirmed`, free: true })
  }

  // Otherwise create a Checkout Session for the (possibly discounted) amount.
  const params = new URLSearchParams()
  params.set('mode', 'payment')
  params.set('line_items[0][quantity]', '1')
  if (percentOff > 0) {
    // Discounted amount via inline price_data.
    params.set('line_items[0][price_data][currency]', EVENT.currency.toLowerCase())
    params.set('line_items[0][price_data][unit_amount]', String(dueCents))
    params.set('line_items[0][price_data][product_data][name]', 'From Associate to Owner — Seat Deposit')
  } else {
    params.set('line_items[0][price]', EVENT.priceId)
  }
  params.set('customer_email', email)
  params.set('phone_number_collection[enabled]', 'true')
  params.set('allow_promotion_codes', 'true')
  params.set('success_url', `${EVENT.baseUrl}?status=confirmed`)
  params.set('cancel_url', EVENT.baseUrl)
  params.set('metadata[event]', EVENT.slug)
  params.set('metadata[full_name]', fullName)
  params.set('metadata[phone]', phone)
  if (promoApplied) params.set('metadata[promo_code]', promoApplied)
  if (registrationId) {
    params.set('metadata[registration_id]', registrationId)
    params.set('client_reference_id', registrationId)
  }

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })
  const session = (await res.json()) as { id?: string; url?: string; error?: { message?: string } }

  if (!res.ok || !session.url) {
    console.error('stripe checkout session error', session.error)
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 502 })
  }

  if (registrationId && session.id) {
    try {
      const supabase = createServerClient()
      await supabase
        .from('event_registrations')
        .update({ stripe_session_id: session.id })
        .eq('id', registrationId)
    } catch (e) {
      console.error('event registration session update failed', e)
    }
  }

  return NextResponse.json({ url: session.url })
}
