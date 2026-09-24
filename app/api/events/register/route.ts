import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { EVENT } from '@/app/events/from-associate-to-owner/event'

// POST /api/events/register/  — capture a registrant (name/email/phone), store
// the lead, and return the Stripe seat-deposit checkout URL (email prefilled).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: Request) {
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

  // Store the lead (best-effort — never block the customer from paying).
  try {
    const supabase = createServerClient()
    await supabase.from('event_registrations').insert({
      event_slug: EVENT.slug,
      event_name: EVENT.name,
      full_name: fullName,
      email,
      phone,
      deposit_amount: EVENT.depositAmount,
      currency: EVENT.currency,
      status: 'pending',
      stripe_payment_link_id: EVENT.paymentLinkId,
      raw: { source: 'event-page' },
    })
  } catch (e) {
    console.error('event registration insert failed', e)
  }

  const url = `${EVENT.paymentLink}?prefilled_email=${encodeURIComponent(email)}`
  return NextResponse.json({ url })
}
