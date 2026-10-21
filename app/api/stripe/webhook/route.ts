import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'
import { verifyStripeSignature } from '@/lib/stripe/webhook'
import { renderInstallmentReceipt } from '@/lib/email/installment-receipt'
import { renderMockExamReceipt, selectionFromRef } from '@/lib/email/mock-exam-receipt'
import { renderMockAdminNotification } from '@/lib/email/mock-admin-notification'
import { renderCourseReceipt } from '@/lib/email/course-receipt'
import { recordMockOrder } from '@/lib/orders/record-mock-order'
import { renderEventRegistrationNotification } from '@/lib/email/event-notification'
import { renderEventConfirmation } from '@/lib/email/event-confirmation'
import { getEvent } from '@/app/events/registry'
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
  customers: {
    first_name: string | null
    last_name: string | null
    email: string | null
    phone: string | null
  } | null
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
  event_slug: string | null
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

  // ── Course "Buy Now" (API Checkout Session, not a Payment Link) ──
  // The /acj-programs/ page sends buyers straight to Stripe Checkout with a
  // client_reference_id starting "acj-". Email the receipt + bcc the team.
  if (!plink) {
    const meta = (session['metadata'] as Record<string, string> | undefined) ?? {}
    const ref =
      typeof session['client_reference_id'] === 'string'
        ? (session['client_reference_id'] as string)
        : ''

    // OSCE Mock Exam (/osce-mock-exams/ → /api/osce-mock/checkout): capture the
    // buyer's full details (name, email, phone, billing address, postal code, SIN)
    // and send a customer receipt + a full-info admin notification.
    if (ref.startsWith('osce-')) {
      const details = (session['customer_details'] as Record<string, unknown> | undefined) ?? {}
      const email =
        (typeof details['email'] === 'string' && (details['email'] as string)) ||
        (typeof session['customer_email'] === 'string' ? (session['customer_email'] as string) : '')
      const phone = typeof details['phone'] === 'string' ? (details['phone'] as string) : undefined
      const name = typeof details['name'] === 'string' ? (details['name'] as string) : ''
      const amountTotal =
        typeof session['amount_total'] === 'number' ? (session['amount_total'] as number) : 0
      const currency =
        typeof session['currency'] === 'string' ? (session['currency'] as string).toUpperCase() : 'CAD'
      const amountLabel = `$${(amountTotal / 100).toFixed(2)} ${currency}`
      const reference = typeof session['id'] === 'string' ? (session['id'] as string) : ref
      const selectionLabel = meta.course || 'OSCE Mock Exam — March 2026'

      // Billing address (collected via billing_address_collection=required).
      const a = (details['address'] as Record<string, unknown> | undefined) ?? {}
      const str = (v: unknown) => (typeof v === 'string' ? v : '')
      const line1 = str(a['line1'])
      const line2 = str(a['line2'])
      const city = str(a['city'])
      const state = str(a['state'])
      const country = str(a['country'])
      const postalCode = str(a['postal_code'])
      const cityLine = [city, state, postalCode].filter(Boolean).join(', ')
      const addressLines = [line1, line2, cityLine, country]

      // Custom fields collected at checkout: first_name, last_name (required) and sin (optional).
      const customFields = Array.isArray(session['custom_fields'])
        ? (session['custom_fields'] as Array<Record<string, unknown>>)
        : []
      const cf = (key: string) => {
        const field = customFields.find((f) => f['key'] === key)
        const text = field?.['text'] as Record<string, unknown> | undefined
        return typeof text?.['value'] === 'string' ? (text['value'] as string) : ''
      }
      const firstName = cf('first_name')
      const lastName = cf('last_name')
      const sin = cf('sin')

      const when = new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' })
      const paymentIntent =
        typeof session['payment_intent'] === 'string' ? (session['payment_intent'] as string) : undefined

      // Record the purchase in the orders tables so it appears in the dashboard
      // (idempotent — Stripe retries this webhook).
      let recorded = false
      try {
        // OSCE adds HST (13%) on top, so the tax portion = total − total/1.13.
        const osceTaxCents = amountTotal - Math.round(amountTotal / 1.13)
        const result = await recordMockOrder(supabase, {
          email,
          firstName,
          lastName,
          phone: phone ?? '',
          addressLine1: line1,
          addressLine2: line2,
          city,
          state,
          postalCode,
          country,
          productName: selectionLabel,
          amountTotalCents: amountTotal,
          taxCents: osceTaxCents,
          currency,
          sessionId: reference,
          paymentIntent,
          sin,
          createdVia: 'osce-mock-checkout',
          orderNumberPrefix: 'OSCE',
          rawSession: session,
        })
        recorded = result.recorded
        if (result.error) console.error('osce order record error', result.error)
      } catch (e) {
        console.error('osce order record failed', e)
      }

      let emailed = false
      let notified = false
      if (email) {
        try {
          const rendered = renderCourseReceipt({
            courseName: selectionLabel,
            customerEmail: email,
            customerPhone: phone,
            amountLabel,
            reference,
          })
          await sendEmail({ to: email, bcc: ADMIN_EMAILS, ...rendered })
          emailed = true
        } catch (e) {
          console.error('osce mock receipt email failed', e)
        }
      }
      // Full-info admin notification (name, phone, billing address, postal code, SIN).
      try {
        const note = renderMockAdminNotification({
          productName: 'OSCE Mock Exam',
          name: [firstName, lastName].filter(Boolean).join(' ') || name,
          firstName,
          lastName,
          email,
          phone: phone ?? '',
          sin,
          addressLines,
          postalCode,
          selectionLabel,
          amountLabel,
          reference,
          when,
        })
        await sendEmail({ to: ADMIN_EMAILS, ...note })
        notified = true
      } catch (e) {
        console.error('osce mock admin notification failed', e)
      }
      return NextResponse.json({ received: true, osce_mock: ref, emailed, notified, recorded })
    }

    if (ref.startsWith('acj-') || ref.startsWith('afk-')) {
      const details = (session['customer_details'] as Record<string, unknown> | undefined) ?? {}
      const email =
        (typeof details['email'] === 'string' && (details['email'] as string)) ||
        (typeof session['customer_email'] === 'string' ? (session['customer_email'] as string) : '')
      const phone = typeof details['phone'] === 'string' ? (details['phone'] as string) : undefined
      const amountTotal =
        typeof session['amount_total'] === 'number' ? (session['amount_total'] as number) : 0
      const currency =
        typeof session['currency'] === 'string' ? (session['currency'] as string).toUpperCase() : 'CAD'
      const courseName =
        meta.course || (ref.startsWith('afk-') ? 'AFK Feb 2027 Subjects' : 'ACJ Comprehensive Program')
      const reference = typeof session['id'] === 'string' ? (session['id'] as string) : ref

      let emailed = false
      if (email) {
        try {
          const rendered = renderCourseReceipt({
            courseName,
            customerEmail: email,
            customerPhone: phone,
            amountLabel: `$${(amountTotal / 100).toFixed(2)} ${currency}`,
            reference,
          })
          await sendEmail({ to: email, bcc: ADMIN_EMAILS, ...rendered })
          emailed = true
        } catch (e) {
          console.error('acj course receipt email failed', e)
        }
      }
      return NextResponse.json({ received: true, course: ref, emailed })
    }

    const regId = meta.registration_id || ref
    if (!regId) {
      return NextResponse.json({ received: true, note: 'no payment_link / registration on session' })
    }

    const { data: regData } = await supabase
      .from('event_registrations')
      .select('id, event_slug, event_name, full_name, email, phone, deposit_amount, currency, status')
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

    // Registrant-facing confirmation (seat is secured). Details come from the
    // event registry so it stays correct per event.
    let confirmed = false
    try {
      const ev = reg.event_slug ? getEvent(reg.event_slug) : null
      const confirmation = renderEventConfirmation({
        firstName: reg.full_name.split(/\s+/)[0] || reg.full_name,
        eventName: ev?.name ?? reg.event_name ?? 'Your Event',
        tagline: ev?.tagline,
        date: ev?.date,
        location: ev?.location,
        ceCredits: ev?.ceCredits,
        speaker: ev?.speaker,
        presenters: ev?.presenters,
      })
      await sendEmail({ to: reg.email, bcc: ADMIN_EMAILS, ...confirmation })
      confirmed = true
    } catch (e) {
      // Payment is recorded; don't force a Stripe retry over an email hiccup.
      console.error('registrant confirmation failed', e)
    }

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
    return NextResponse.json({ received: true, registration: reg.id, confirmed, notified })
  }

  // 1) Find the installment this Payment Link belongs to.
  const { data: instData, error: instErr } = await supabase
    .from('order_installments')
    .select('id, order_id, sequence, status, amount, currency, wc_payment_id')
    .eq('stripe_payment_link_id', plink)
    .single()
  const inst = instData as InstallmentRow | null

  if (instErr || !inst) {
    // Not an installment link — check if it's a one-time AFK Mock Exams purchase
    // (buttons on /afk-mock-exams/ append a client_reference_id like "mocks-134-mini-1").
    const ref =
      typeof session['client_reference_id'] === 'string'
        ? (session['client_reference_id'] as string)
        : ''
    if (ref.startsWith('mocks-')) {
      const details = (session['customer_details'] as Record<string, unknown> | undefined) ?? {}
      const email =
        (typeof details['email'] === 'string' && (details['email'] as string)) ||
        (typeof session['customer_email'] === 'string' ? (session['customer_email'] as string) : '')
      const phone = typeof details['phone'] === 'string' ? (details['phone'] as string) : undefined
      const name = typeof details['name'] === 'string' ? (details['name'] as string) : ''
      const amountTotal =
        typeof session['amount_total'] === 'number' ? (session['amount_total'] as number) : 0
      const currency =
        typeof session['currency'] === 'string' ? (session['currency'] as string).toUpperCase() : 'CAD'
      const amountLabel = `$${(amountTotal / 100).toFixed(2)} ${currency}`
      const reference = typeof session['id'] === 'string' ? (session['id'] as string) : ref
      const selectionLabel = selectionFromRef(ref)

      // Billing address (collected via billing_address_collection=required).
      const a = (details['address'] as Record<string, unknown> | undefined) ?? {}
      const str = (v: unknown) => (typeof v === 'string' ? v : '')
      const line1 = str(a['line1'])
      const line2 = str(a['line2'])
      const city = str(a['city'])
      const state = str(a['state'])
      const country = str(a['country'])
      const postalCode = str(a['postal_code'])
      const cityLine = [city, state, postalCode].filter(Boolean).join(', ')
      const addressLines = [line1, line2, cityLine, country]

      // SIN — collected as a Stripe custom field (key "sin").
      const customFields = Array.isArray(session['custom_fields'])
        ? (session['custom_fields'] as Array<Record<string, unknown>>)
        : []
      const sinField = customFields.find((f) => f['key'] === 'sin')
      const sin =
        sinField && typeof (sinField['text'] as Record<string, unknown>)?.['value'] === 'string'
          ? ((sinField['text'] as Record<string, unknown>)['value'] as string)
          : ''

      const when = new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' })
      const paymentIntent =
        typeof session['payment_intent'] === 'string' ? (session['payment_intent'] as string) : undefined

      // Record the purchase in the orders tables so it appears in the dashboard
      // (idempotent). AFK mock payment links don't charge a separate tax line, so
      // taxCents comes from Stripe's total_details.amount_tax (usually 0).
      const totalDetails = (session['total_details'] as Record<string, unknown> | undefined) ?? {}
      const afkTaxCents =
        typeof totalDetails['amount_tax'] === 'number' ? (totalDetails['amount_tax'] as number) : 0
      let recorded = false
      try {
        const result = await recordMockOrder(supabase, {
          email,
          name,
          phone: phone ?? '',
          addressLine1: line1,
          addressLine2: line2,
          city,
          state,
          postalCode,
          country,
          productName: `AFK Mock Exams — ${selectionLabel}`,
          amountTotalCents: amountTotal,
          taxCents: afkTaxCents,
          currency,
          sessionId: reference,
          paymentIntent,
          sin,
          createdVia: 'afk-mock-checkout',
          orderNumberPrefix: 'AFK',
          rawSession: session,
        })
        recorded = result.recorded
        if (result.error) console.error('afk mock order record error', result.error)
      } catch (e) {
        console.error('afk mock order record failed', e)
      }

      let emailed = false
      let notified = false
      if (email) {
        // Customer confirmation (BCC the team so they also get a copy).
        try {
          const rendered = renderMockExamReceipt({
            customerEmail: email,
            customerPhone: phone,
            amountLabel,
            selectionLabel,
            reference,
          })
          await sendEmail({ to: email, bcc: ADMIN_EMAILS, ...rendered })
          emailed = true
        } catch (e) {
          console.error('mock exam receipt email failed', e)
        }
      }
      // Full-info admin notification (name, phone, address, postal code, SIN).
      try {
        const note = renderMockAdminNotification({
          name,
          email,
          phone: phone ?? '',
          sin,
          addressLines,
          selectionLabel,
          amountLabel,
          reference,
          when,
        })
        await sendEmail({ to: ADMIN_EMAILS, ...note })
        notified = true
      } catch (e) {
        console.error('mock exam admin notification failed', e)
      }
      return NextResponse.json({ received: true, mock_exam: ref, emailed, notified, recorded })
    }
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
    .select('order_number, customers(first_name, last_name, email, phone), order_line_items(name)')
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
  const phone = customer?.phone ?? ''
  const orderNumber = `#${order?.order_number ?? ''}`
  const course = order?.order_line_items?.[0]?.name ?? 'your Confidentist course'

  const next = plan.find(
    (r) => r.sequence > inst.sequence && r.status === 'pending' && r.stripe_payment_link_url,
  )

  const rendered = renderInstallmentReceipt({
    customerName,
    course,
    totalInstallments: plan.length,
    paidSequence: inst.sequence,
    reference: `Order ${orderNumber} · Payment ${inst.wc_payment_id ?? ''}`.trim(),
    amountPaidLabel: money(inst.amount, inst.currency),
    customerEmail: email ?? '',
    customerPhone: phone,
    orderNumber,
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
