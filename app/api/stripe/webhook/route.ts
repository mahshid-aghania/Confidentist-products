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
          await sendEmail({ to: email, bcc: [...ADMIN_EMAILS, 'info@confidentist.ca'], ...rendered })
          emailed = true
        } catch (e) {
          console.error('acj course receipt email failed', e)
        }
      }

      // AFK: send a full-info admin notification so the complete record lands in
      // the team inbox — student name + family name, email, phone, SIN, billing
      // address, residential (delivery) address and the chosen shipping option.
      let notified = false
      if (ref.startsWith('afk-')) {
        try {
          const str = (v: unknown) => (typeof v === 'string' ? v : '')
          const esc = (s: string) =>
            s.replace(/[&<>"']/g, (c) =>
              ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
            )
          const fmtAddr = (a: Record<string, unknown> | undefined) => {
            const ad = a ?? {}
            const cityLine = [str(ad['city']), str(ad['state']), str(ad['postal_code'])]
              .filter(Boolean)
              .join(', ')
            return [str(ad['line1']), str(ad['line2']), cityLine, str(ad['country'])]
              .filter(Boolean)
              .join('<br />')
          }

          // Custom fields (keys unchanged: first_name / last_name / sin).
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
          const studentName = [firstName, lastName].filter(Boolean).join(' ') || str(details['name'])

          // Billing address (from customer_details) + residential/shipping address.
          const billing = fmtAddr(details['address'] as Record<string, unknown> | undefined)
          const shippingDetails =
            (session['shipping_details'] as Record<string, unknown> | undefined) ??
            ((session['collected_information'] as Record<string, unknown> | undefined)?.[
              'shipping_details'
            ] as Record<string, unknown> | undefined) ??
            {}
          const residential = fmtAddr(shippingDetails['address'] as Record<string, unknown> | undefined)

          // Shipping amount charged + region label.
          const totalDetails = (session['total_details'] as Record<string, unknown> | undefined) ?? {}
          const shipCents =
            typeof totalDetails['amount_shipping'] === 'number'
              ? (totalDetails['amount_shipping'] as number)
              : 0
          const shipRegion =
            ({ 7500: 'All over Canada', 15000: 'United States', 25000: 'Australia', 35000: 'Europe & Africa', 40000: 'Asia' } as Record<number, string>)[
              shipCents
            ] || (shipCents > 0 ? 'Shipping' : '—')

          const when = new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' })
          const money = (n: number) => `$${n.toFixed(2)}`
          const num = (v: unknown) => Number((typeof v === 'string' ? v : '') || 0)

          const orderNo = (typeof meta['order_number'] === 'string' && meta['order_number']) || reference
          const cleanCourse =
            (typeof meta['course_name'] === 'string' && meta['course_name']) || courseName
          // Stripe Tax computed the tax — read the real amounts from the session.
          const taxCents =
            typeof totalDetails['amount_tax'] === 'number' ? (totalDetails['amount_tax'] as number) : 0
          const tax = taxCents / 100
          const shipping = shipCents / 100
          const paidNow = amountTotal / 100
          const subtotal = (amountTotal - taxCents - shipCents) / 100
          const isInstallment = meta['plan'] === 'installment'
          const numPayments = (typeof meta['num_payments'] === 'string' && meta['num_payments']) || (isInstallment ? '7' : '1')
          const monthlyBase = num(meta['monthly_base'])

          // Partial payment schedule (installment only): deposit paid now + base monthly + tax.
          let scheduleRows = ''
          if (isInstallment) {
            const dates = String(meta['installment_dates'] || '').split('|').filter(Boolean)
            const srow = (id: string, when2: string, amt: string, status: string) =>
              `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(id)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(when2)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${esc(amt)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(status)}</td></tr>`
            scheduleRows += srow(`${orderNo}-1`, 'Deposit (paid now, incl. tax)', money(paidNow), 'Completed')
            dates.forEach((d, i) => {
              scheduleRows += srow(`${orderNo}-${i + 2}`, d, `${money(monthlyBase)} + tax`, 'Pending payment')
            })
          }

          const row = (k: string, v: string) =>
            `<tr><td style="padding:7px 0;color:#586175;width:180px;vertical-align:top">${k}</td><td style="padding:7px 0;font-weight:600;vertical-align:top">${v || '—'}</td></tr>`
          const sumRow = (k: string, v: string, bold = false) =>
            `<tr><td style="padding:6px 0;color:#586175">${k}</td><td style="padding:6px 0;text-align:right;${bold ? 'font-weight:700;color:#072C5E' : ''}">${v}</td></tr>`

          const html = `
            <div style="font-family:Arial,Helvetica,sans-serif;max-width:620px;margin:0 auto;color:#1a1f2e">
              <h2 style="color:#072C5E;margin:0 0 .15rem">New order: #${esc(String(orderNo))}</h2>
              <p style="color:#586175;margin:0 0 1.25rem">New registration from <strong>${esc(studentName || email)}</strong> · ${esc(when)} (Toronto)</p>

              <h3 style="color:#072C5E;margin:1rem 0 .4rem;font-size:15px">Order summary</h3>
              <table style="width:100%;border-collapse:collapse;font-size:14px">
                ${sumRow(`${esc(cleanCourse)} × 1`, money(subtotal))}
                ${sumRow('Subtotal', money(subtotal))}
                ${sumRow(`Shipping: ${esc(shipRegion)}`, money(shipping))}
                ${sumRow('Sales tax (Stripe Tax) · 821980398RT0001', money(tax))}
                ${sumRow('Total paid now', `${money(paidNow)} ${currency}`, true)}
                ${isInstallment ? sumRow('Payment plan', `${esc(String(numPayments))} payments (6 + 1)`) : sumRow('Payment', 'Paid in full')}
                ${isInstallment ? sumRow('Future payments', `6 × ${money(monthlyBase)} + applicable tax (via links)`) : ''}
              </table>

              ${
                isInstallment
                  ? `<h3 style="color:#072C5E;margin:1.5rem 0 .4rem;font-size:15px">Partial payment details</h3>
              <table style="width:100%;border-collapse:collapse;font-size:13px">
                <thead><tr style="background:#f6f8fb">
                  <th style="padding:6px 10px;text-align:left;color:#586175">ID</th>
                  <th style="padding:6px 10px;text-align:left;color:#586175">Payment</th>
                  <th style="padding:6px 10px;text-align:right;color:#586175">Amount</th>
                  <th style="padding:6px 10px;text-align:left;color:#586175">Status</th>
                </tr></thead>
                <tbody>${scheduleRows}</tbody>
              </table>`
                  : ''
              }

              <h3 style="color:#072C5E;margin:1.5rem 0 .4rem;font-size:15px">Student &amp; contact</h3>
              <table style="width:100%;border-collapse:collapse;font-size:14px">
                ${row('Student first name', esc(firstName))}
                ${row('Student family name', esc(lastName))}
                ${row('Phone', esc(phone ?? ''))}
                ${row('Email', esc(email))}
                ${row('SIN', esc(sin))}
                ${row('Order number', esc(String(orderNo)))}
              </table>

              <h3 style="color:#072C5E;margin:1.5rem 0 .4rem;font-size:15px">Billing address</h3>
              <p style="font-size:14px;line-height:1.6;margin:0">${billing || '—'}<br />${esc(phone ?? '')}<br />${esc(email)}</p>

              <h3 style="color:#072C5E;margin:1.5rem 0 .4rem;font-size:15px">Shipping address</h3>
              <p style="font-size:14px;line-height:1.6;margin:0">${residential || billing || '—'}</p>
            </div>`

          const text =
            `New order: #${orderNo}\nRegistration from ${studentName || email} (${when} Toronto)\n\n` +
            `${cleanCourse}\nSubtotal: ${money(subtotal)}\nShipping (${shipRegion}): ${money(shipping)}\n` +
            `Sales tax (Stripe Tax) · 821980398RT0001: ${money(tax)}\nTotal paid now: ${money(paidNow)} ${currency}\n` +
            (isInstallment
              ? `Payment plan: ${numPayments} payments (6 + 1)\nFuture payments: 6 × ${money(monthlyBase)} + applicable tax (via links)\n`
              : `Payment: Paid in full ${money(paidNow)} ${currency}\n`) +
            `\nStudent: ${studentName}\nPhone: ${phone ?? ''}\nEmail: ${email}\nSIN: ${sin}\nOrder number: ${orderNo}\n`

          await sendEmail({
            to: [...ADMIN_EMAILS, 'info@confidentist.ca'],
            replyTo: email || undefined,
            subject: `New order #${orderNo} — ${studentName || email} — ${cleanCourse}`,
            html,
            text,
          })
          notified = true
        } catch (e) {
          console.error('afk admin notification failed', e)
        }
      }

      // AFK: record the order in Supabase so it shows in the dashboard alongside
      // the WooCommerce-synced orders (idempotent on the Stripe session id).
      let recorded = false
      if (ref.startsWith('afk-')) {
        try {
          const str = (v: unknown) => (typeof v === 'string' ? v : '')
          const addr = (details['address'] as Record<string, unknown> | undefined) ?? {}
          const shippingDetails =
            (session['shipping_details'] as Record<string, unknown> | undefined) ??
            ((session['collected_information'] as Record<string, unknown> | undefined)?.[
              'shipping_details'
            ] as Record<string, unknown> | undefined) ??
            {}
          const sAddr = (shippingDetails['address'] as Record<string, unknown> | undefined) ?? {}
          const customFields = Array.isArray(session['custom_fields'])
            ? (session['custom_fields'] as Array<Record<string, unknown>>)
            : []
          const cf = (key: string) => {
            const field = customFields.find((f) => f['key'] === key)
            const t = field?.['text'] as Record<string, unknown> | undefined
            return typeof t?.['value'] === 'string' ? (t['value'] as string) : ''
          }
          const paymentIntent =
            typeof session['payment_intent'] === 'string' ? (session['payment_intent'] as string) : undefined
          const recTotals = (session['total_details'] as Record<string, unknown> | undefined) ?? {}
          const paidTaxCents =
            typeof recTotals['amount_tax'] === 'number' ? (recTotals['amount_tax'] as number) : 0
          const result = await recordMockOrder(supabase, {
            email,
            firstName: cf('first_name'),
            lastName: cf('last_name'),
            phone: phone ?? '',
            addressLine1: str(addr['line1']),
            addressLine2: str(addr['line2']),
            city: str(addr['city']),
            state: str(addr['state']),
            postalCode: str(addr['postal_code']),
            country: str(addr['country']),
            productName: (typeof meta['course_name'] === 'string' && meta['course_name']) || courseName,
            amountTotalCents: amountTotal,
            taxCents: paidTaxCents,
            currency,
            sessionId: reference,
            paymentIntent,
            sin: cf('sin'),
            createdVia: 'afk-programs-checkout',
            orderNumberPrefix: 'AFK',
            orderNumber:
              (typeof meta['order_number'] === 'string' && meta['order_number']) || undefined,
            shipping: {
              firstName: cf('first_name'),
              lastName: cf('last_name'),
              addressLine1: str(sAddr['line1']),
              addressLine2: str(sAddr['line2']),
              city: str(sAddr['city']),
              state: str(sAddr['state']),
              postalCode: str(sAddr['postal_code']),
              country: str(sAddr['country']),
            },
            extraRaw: {
              plan: meta['plan'] || 'full',
              num_payments: meta['num_payments'] || '1',
              installment_first_base: meta['first_base'] || '',
              installment_monthly_base: meta['monthly_base'] || '',
              installment_dates: meta['installment_dates'] || '',
              order_number: meta['order_number'] || '',
            },
          })
          recorded = result.recorded
          if (result.error) console.error('afk order record error', result.error)
        } catch (e) {
          console.error('afk order record failed', e)
        }
      }

      return NextResponse.json({ received: true, course: ref, emailed, notified, recorded })
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
