import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { verifyStripeSignature } from '@/lib/stripe/webhook'
import { renderInstallmentReceipt } from '@/lib/email/installment-receipt'
import { renderEventRegistrationNotification } from '@/lib/email/event-notification'
import { sendEmail, ADMIN_EMAILS } from '@/lib/email/send'

// Stripe webhook: POST /api/stripe/webhook
// On `checkout.session.completed`:
//  • Payment Link → installment payment: mark paid + email customer receipt.
//  • Checkout Session for an event: mark the registration paid + notify admins.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function money(amount: number | string, currency = 'CAD'): string {
  return `$${Number(amount).toFixed(2)} ${currency}`
}

type InstallmentRow = {
  id: string
  order_id: string
  sequence: number
  status: string
  amount: number | string
  currency: string
  wc_payment_id: string | null
}

type OrderInfo = {
  order_number: string | null
  customers: { first_name: string | null; last_name: string | null; email: string | null } | null
  order_line_items: { name: string }[] | null
}

type PlanRow = {
  sequence: number
  status: string
  amount: number | string
  currency: string
  due_date: string | null
  stripe_payment_link_url: string | null
}

type EventRegRow = {
  id: string
  event_name: string | null
  full_name: string
  email: string
  phone: string | null
  deposit_amount: number | string
  currency: string
  status: string
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Missing STRIPE_WEBHOOK_SECRET' }, { status: 500 })
  }

  const payload = await req.text()
  const signature = req.headers.get('stripe-signature')
  if (!verifyStripeSignature(payload, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  let event: { type?: string; data?: { object?: Record<string, unknown> } }
  try {
    event = JSON.parse(payload)
  } catch {
    return NextResponse.json({ error: 'Bad JSON' }, { status: 400 })
  }

  if (event.type !== 'checkout.session.completed') {
    return NextResponse.json({ received: true, ignored: event.type })
  }

  const session = event.data?.object ?? {}
  const paymentStatus = session['payment_status']
  if (typeof paymentStatus === 'string' && paymentStatus !== 'paid') {
    return NextResponse.json({ received: true, note: 'session not paid' })
  }
  const plink = typeof session['payment_link'] === 'string' ? (session['payment_link'] as string) : null
  const supabase = createServerClient()

  // ── Event registration (Checkout Session, not a Payment Link) ──
  if (!plink) {
    const meta = (session['metadata'] as Record<string, string> | undefined) ?? {}
    const regId =
      meta.registration_id ||
      (typeof session['client_reference_id'] === 'string'
        ? (session['client_reference_id'] as string)
        : '')
    if (!regId) {
      return NextResponse.json({ received: true, note: 'no payment_link / registration on session' })
    }

    const { data: regData } = await supabase
      .from('event_registrations')
      .select('id, event_name, full_name, email, phone, deposit_amount, currency, status')
      .eq('id', regId)
      .single()
    const reg = regData as EventRegRow | null
    if (!reg) return NextResponse.json({ received: true, note: 'no matching registration', regId })
    if (reg.status === 'paid')
      return NextResponse.json({ received: true, note: 'registration already processed' })

    await supabase
      .from('event_registrations')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', reg.id)

    let notified = false
    try {
      const note = renderEventRegistrationNotification({
        eventName: reg.event_name ?? 'Event',
        fullName: reg.full_name,
        email: reg.email,
        phone: reg.phone ?? '',
        amountLabel: money(reg.deposit_amount, reg.currency),
        status: 'paid',
        when: new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' }),
      })
      await sendEmail({ to: ADMIN_EMAILS, ...note })
      notified = true
    } catch (e) {
      console.error('event admin notification failed', e)
    }
    return NextResponse.json({ received: true, registration: reg.id, notified })
  }

  // 1) Find the installment this Payment Link belongs to.
  const { data: instData, error: instErr } = await supabase
    .from('order_installments')
    .select('id, order_id, sequence, status, amount, currency, wc_payment_id')
    .eq('stripe_payment_link_id', plink)
    .single()
  const inst = instData as InstallmentRow | null

  if (instErr || !inst) {
    return NextResponse.json({ received: true, note: 'no matching installment', plink })
  }
  // Idempotency — Stripe retries webhooks; only process the first time.
  if (inst.status === 'paid') {
    return NextResponse.json({ received: true, note: 'already processed' })
  }

  // 2) Mark it paid.
  await supabase
    .from('order_installments')
    .update({ status: 'paid', paid_at: new Date().toISOString(), source_status: 'paid (stripe)' })
    .eq('id', inst.id)

  // 3) Order + customer + course.
  const { data: orderData } = await supabase
    .from('orders')
    .select('order_number, customers(first_name, last_name, email), order_line_items(name)')
    .eq('id', inst.order_id)
    .single()
  const order = orderData as OrderInfo | null

  // 4) Full plan (for total count + the next pending installment).
  const { data: planData } = await supabase
    .from('order_installments')
    .select('sequence, status, amount, currency, due_date, stripe_payment_link_url')
    .eq('order_id', inst.order_id)
    .order('sequence', { ascending: true })
  const plan = (planData as PlanRow[] | null) ?? []

  const customer = order?.customers ?? null
  const customerName =
    `${customer?.first_name ?? ''} ${customer?.last_name ?? ''}`.trim() || 'there'
  const email = customer?.email ?? null
  const course = order?.order_line_items?.[0]?.name ?? 'your Confidentist course'

  const next = plan.find(
    (r) => r.sequence > inst.sequence && r.status === 'pending' && r.stripe_payment_link_url,
  )

  const rendered = renderInstallmentReceipt({
    customerName,
    course,
    totalInstallments: plan.length,
    paidSequence: inst.sequence,
    reference: `Order #${order?.order_number ?? ''} · Payment ${inst.wc_payment_id ?? ''}`.trim(),
    amountPaidLabel: money(inst.amount, inst.currency),
    next: next
      ? {
          sequence: next.sequence,
          dueDate: next.due_date ?? '',
          amountLabel: money(next.amount, next.currency),
          link: next.stripe_payment_link_url as string,
        }
      : undefined,
  })

  let emailed = false
  if (email) {
    try {
      await sendEmail({ to: email, bcc: ADMIN_EMAILS, ...rendered })
      emailed = true
    } catch (e) {
      // Payment is already recorded; don't force a Stripe retry over an email hiccup.
      console.error('receipt email failed', e)
    }
  }

  return NextResponse.json({ received: true, installment: inst.wc_payment_id, emailed })
}
