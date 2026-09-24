import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { EVENT } from '@/app/events/from-associate-to-owner/event'

// POST /api/events/register/  — capture a registrant (name/email/phone), store
// the lead, then create a Stripe Checkout Session for the $50 seat deposit
// (email prefilled, phone collected, promotion codes enabled) and return its URL.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: Request) {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) {
    return NextResponse.json({ error: 'Payment is not configured.' }, { status: 500 })
  }

  let body: { fullName?: string; email?: string; phone?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const fullName = (body.fullName ?? '').trim()
  const email = (body.email ?? '').trim()
  const phone = (body.phone ?? '').trim()

  if (!fullName) return NextResponse.json({ error: 'Please enter your name.' }, { status: 400 })
  if (!EMAIL_RE.test(email))
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  if (!phone) return NextResponse.json({ error: 'Please enter your phone number.' }, { status: 400 })

  // Store the lead first (best-effort) so we can reference it from Stripe.
  let registrationId: string | null = null
  try {
    const supabase = createServerClient()
    const { data } = await supabase
      .from('event_registrations')
      .insert({
        event_slug: EVENT.slug,
        event_name: EVENT.name,
        full_name: fullName,
        email,
        phone,
        deposit_amount: EVENT.depositAmount,
        currency: EVENT.currency,
        status: 'pending',
        raw: { source: 'event-page' },
      })
      .select('id')
      .single()
    registrationId = (data as { id: string } | null)?.id ?? null
  } catch (e) {
    console.error('event registration insert failed', e)
  }

  // Create a Checkout Session (promotion codes enabled → validated promo field).
  const params = new URLSearchParams()
  params.set('mode', 'payment')
  params.set('line_items[0][price]', EVENT.priceId)
  params.set('line_items[0][quantity]', '1')
  params.set('customer_email', email)
  params.set('phone_number_collection[enabled]', 'true')
  params.set('allow_promotion_codes', 'true')
  params.set('success_url', `${EVENT.baseUrl}?status=confirmed`)
  params.set('cancel_url', EVENT.baseUrl)
  params.set('metadata[event]', EVENT.slug)
  params.set('metadata[full_name]', fullName)
  params.set('metadata[phone]', phone)
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

  // Record the session id on the lead (best-effort).
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
