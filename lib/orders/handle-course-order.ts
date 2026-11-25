import type { SupabaseClient } from '@supabase/supabase-js'
import { renderOrderReceipt, type ReceiptPayment } from '@/lib/email/order-receipt'
import { recordMockOrder } from '@/lib/orders/record-mock-order'
import { sendEmail, ADMIN_EMAILS } from '@/lib/email/send'

// Shared handling for a completed course Checkout Session (Virtual OSCE, AFK
// programs, ADAT programs, ACJ). Sends:
//   • the customer a detailed receipt — order number, original price, tax on each
//     payment, shipping, phone, billing + shipping address (never the SIN), and
//   • the team the same receipt plus the SIN,
// then records the order in Supabase (idempotent on the Stripe session id).
//
// Everything is read from the session + the metadata set by the checkout route
// (order_number, course_name, course_subtotal, tax_*, paid_tax, course_tax, plan,
// first_base, monthly_base, num_payments, installment_dates, optional paid_base /
// course_start).

export type CourseOrderOptions = {
  defaultCourseName: string
  createdVia: string // e.g. "afk-programs-checkout"
  orderNumberPrefix: string // e.g. "AFK"
  ships: boolean // false for online-only courses (no booklet / no shipping)
}

const SHIPPING_LABELS: Record<number, string> = {
  0: 'Pickup — collect in person (no shipping fee)',
  7500: 'Shipping — within Canada',
  15000: 'Shipping — United States',
  35000: 'Shipping — Europe & Africa',
  40000: 'Shipping — Asia, Oceania & rest of world',
}

export async function handleCourseOrder(
  supabase: SupabaseClient,
  session: Record<string, unknown>,
  meta: Record<string, string>,
  ref: string,
  opts: CourseOrderOptions,
): Promise<{ emailed: boolean; notified: boolean; recorded: boolean }> {
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const num = (v: unknown) => Number(str(v) || 0)
  const round2 = (n: number) => Math.round(n * 100) / 100

  const details = (session['customer_details'] as Record<string, unknown> | undefined) ?? {}
  const email = str(details['email']) || str(session['customer_email'])
  const phone = str(details['phone'])
  const amountTotal = typeof session['amount_total'] === 'number' ? (session['amount_total'] as number) : 0
  const currency = str(session['currency']).toUpperCase() || 'CAD'
  const reference = str(session['id']) || ref
  const paymentIntent = str(session['payment_intent']) || undefined

  const customFields = Array.isArray(session['custom_fields'])
    ? (session['custom_fields'] as Array<Record<string, unknown>>)
    : []
  const cf = (key: string) => {
    const field = customFields.find((f) => f['key'] === key)
    const t = field?.['text'] as Record<string, unknown> | undefined
    return str(t?.['value'])
  }
  // Fall back to Stripe's single "name" field when no explicit first/last name was asked.
  const fullName = str(details['name'])
  const firstName = cf('first_name') || fullName.split(/\s+/)[0] || ''
  const lastName = cf('last_name') || (cf('first_name') ? '' : fullName.split(/\s+/).slice(1).join(' '))
  const sin = cf('sin')

  const addrLines = (a: Record<string, unknown> | undefined) => {
    const ad = a ?? {}
    const cityLine = [str(ad['city']), str(ad['state']), str(ad['postal_code'])].filter(Boolean).join(', ')
    return [str(ad['line1']), str(ad['line2']), cityLine, str(ad['country'])].filter(Boolean)
  }
  const billAddr = (details['address'] as Record<string, unknown> | undefined) ?? {}
  const shippingDetails =
    (session['shipping_details'] as Record<string, unknown> | undefined) ??
    ((session['collected_information'] as Record<string, unknown> | undefined)?.['shipping_details'] as
      | Record<string, unknown>
      | undefined) ??
    {}
  const shipAddr = (shippingDetails['address'] as Record<string, unknown> | undefined) ?? {}

  const totals = (session['total_details'] as Record<string, unknown> | undefined) ?? {}
  const shipCents = typeof totals['amount_shipping'] === 'number' ? (totals['amount_shipping'] as number) : 0
  const discountCents = typeof totals['amount_discount'] === 'number' ? (totals['amount_discount'] as number) : 0
  const shippingLabel = opts.ships
    ? SHIPPING_LABELS[shipCents] || `Shipping (${(shipCents / 100).toFixed(2)})`
    : 'Not applicable — online course'

  const orderNo = str(meta['order_number']) || reference
  const courseName = str(meta['course_name']) || str(meta['course']) || opts.defaultCourseName
  const isInstallment = meta['plan'] === 'installment'
  const taxRate = num(meta['tax_rate'])
  const taxLabel = `${str(meta['tax_label']) || 'Sales tax'} — ${str(meta['tax_region']) || 'ON'}`
  const originalPrice = num(meta['course_subtotal'])
  const paidBase = num(meta['paid_base']) || (isInstallment ? num(meta['first_base']) : originalPrice)
  // Hard-coded province tax is carried in metadata; fall back to Stripe Tax's amount_tax.
  const paidTax =
    num(meta['paid_tax']) ||
    (typeof totals['amount_tax'] === 'number' ? (totals['amount_tax'] as number) / 100 : 0)

  const payments: ReceiptPayment[] = []
  if (isInstallment) {
    const dates = str(meta['installment_dates']).split('|').filter(Boolean)
    const n = Number(str(meta['num_payments']) || String(dates.length + 1))
    const later = num(meta['monthly_base'])
    const instNo = Number(str(meta['installment_number']) || '1') || 1
    if (instNo > 1) {
      // A later installment of a fixed-date plan (paid from its own link): show just this payment.
      payments.push({ label: `Payment ${instNo} of ${n}`, when: 'Paid today', base: paidBase, tax: paidTax, shipping: 0, status: 'Paid' })
    } else {
      payments.push({ label: `Payment 1 of ${n}`, when: 'Paid today', base: paidBase, tax: paidTax, shipping: shipCents / 100, status: 'Paid' })
      dates.forEach((d, i) =>
        payments.push({ label: `Payment ${i + 2} of ${n}`, when: d, base: later, tax: round2(later * taxRate), shipping: 0, status: 'Upcoming' }),
      )
    }
  } else {
    payments.push({ label: 'Payment in full', when: 'Paid today', base: paidBase, tax: paidTax, shipping: shipCents / 100, status: 'Paid' })
  }

  const receiptBase = {
    orderNumber: orderNo,
    courseName,
    courseStart: str(meta['course_start']) || undefined,
    originalPrice,
    planLabel: isInstallment ? `${Number(str(meta['num_payments'])) || payments.length} payments (installment plan)` : 'Paid in full',
    taxLabel,
    courseTaxTotal: num(meta['course_tax']) || round2(originalPrice * taxRate),
    payments,
    shippingLabel,
    discount: discountCents / 100,
    paidNow: amountTotal / 100,
    currency,
    firstName,
    lastName,
    email,
    phone,
    billingLines: addrLines(billAddr),
    postalCode: str(billAddr['postal_code']),
    shippingLines: opts.ships ? addrLines(shipAddr) : [],
    showShipping: opts.ships,
  }

  let emailed = false
  if (email) {
    try {
      const r = renderOrderReceipt({ ...receiptBase, audience: 'customer' })
      await sendEmail({ to: email, replyTo: 'info@confidentist.ca', ...r })
      emailed = true
    } catch (e) {
      console.error(`${opts.createdVia} receipt email failed`, e)
    }
  }

  let notified = false
  try {
    const r = renderOrderReceipt({
      ...receiptBase,
      audience: 'admin',
      sin,
      when: new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' }),
    })
    await sendEmail({ to: [...ADMIN_EMAILS, 'info@confidentist.ca'], replyTo: email || undefined, ...r })
    notified = true
  } catch (e) {
    console.error(`${opts.createdVia} admin notification failed`, e)
  }

  let recorded = false
  try {
    const result = await recordMockOrder(supabase, {
      email,
      firstName,
      lastName,
      phone,
      addressLine1: str(billAddr['line1']),
      addressLine2: str(billAddr['line2']),
      city: str(billAddr['city']),
      state: str(billAddr['state']),
      postalCode: str(billAddr['postal_code']),
      country: str(billAddr['country']),
      productName: courseName,
      amountTotalCents: amountTotal,
      taxCents: Math.round(paidTax * 100),
      currency,
      sessionId: reference,
      paymentIntent,
      sin,
      createdVia: opts.createdVia,
      orderNumberPrefix: opts.orderNumberPrefix,
      orderNumber: str(meta['order_number']) || undefined,
      shipping: opts.ships
        ? {
            firstName,
            lastName,
            addressLine1: str(shipAddr['line1']),
            addressLine2: str(shipAddr['line2']),
            city: str(shipAddr['city']),
            state: str(shipAddr['state']),
            postalCode: str(shipAddr['postal_code']),
            country: str(shipAddr['country']),
          }
        : undefined,
      extraRaw: {
        plan: meta['plan'] || 'full',
        num_payments: meta['num_payments'] || '1',
        installment_first_base: meta['first_base'] || '',
        installment_monthly_base: meta['monthly_base'] || '',
        installment_dates: meta['installment_dates'] || '',
        order_number: meta['order_number'] || '',
        shipping_cents: shipCents,
      },
    })
    recorded = result.recorded
    if (result.error) console.error(`${opts.createdVia} order record error`, result.error)
  } catch (e) {
    console.error(`${opts.createdVia} order record failed`, e)
  }

  return { emailed, notified, recorded }
}
