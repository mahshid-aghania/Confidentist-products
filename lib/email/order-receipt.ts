// Detailed order receipt — used for course purchases (Virtual OSCE, AFK programs,
// ADAT programs, ACJ). Pure render function: no side effects.
//
// Shows: order number, course + original price, payment plan, every payment with its
// own base amount + sales tax + total, the shipping option and price (charged on the
// first payment only), discount (if a promo code was used), total paid now, and the
// buyer's name, email, phone, billing address (with postal code) and delivery address.
// The admin variant also includes the SIN (never sent to the customer copy).

export type ReceiptPayment = {
  label: string // e.g. "Payment 1 of 2"
  when: string // e.g. "Paid today" | "December 24, 2026"
  base: number // pre-tax amount (CAD)
  tax: number // sales tax on this payment (CAD)
  shipping: number // shipping charged with this payment (CAD)
  status: 'Paid' | 'Upcoming'
}

export type OrderReceiptData = {
  audience: 'customer' | 'admin'
  orderNumber: string
  courseName: string
  courseStart?: string
  originalPrice: number // full course price before tax (CAD)
  planLabel: string // e.g. "Paid in full" | "2 payments (installment plan)"
  taxLabel: string // e.g. "HST (13%) — ON"
  courseTaxTotal: number // tax on the full course price
  payments: ReceiptPayment[]
  shippingLabel: string // e.g. "Shipping — within Canada" | "Pickup"
  discount: number // promo-code discount applied at checkout (CAD), 0 if none
  paidNow: number // Stripe amount_total (CAD)
  currency: string
  firstName: string
  lastName: string
  email: string
  phone: string
  billingLines: string[] // address lines incl. city/province/postal code + country
  postalCode: string
  shippingLines: string[]
  showShipping?: boolean // default true; false for online-only courses (hides all shipping info)
  sin?: string // admin only
  when?: string // admin only — timestamp
}

const BRAND = '#072C5E'
const MUTED = '#5b6b7c'

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
const money = (n: number) =>
  '$' + n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export function renderOrderReceipt(d: OrderReceiptData): { subject: string; html: string; text: string } {
  const isAdmin = d.audience === 'admin'
  const ship = d.showShipping !== false
  const name = [d.firstName, d.lastName].filter(Boolean).join(' ')
  const cell = 'padding:9px 12px;border-bottom:1px solid #eef1f5;font-size:14px;'
  const kv = (k: string, v: string, bold = false) =>
    `<tr><td style="${cell}color:${MUTED};width:42%">${k}</td><td style="${cell}text-align:right;${bold ? `font-weight:bold;color:${BRAND};` : ''}">${v}</td></tr>`
  const section = (title: string) =>
    `<p style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${MUTED};margin:24px 0 8px;font-weight:bold">${title}</p>`
  const box = (rows: string) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6e9ee;border-radius:8px;border-collapse:separate">${rows}</table>`

  const payRows = d.payments
    .map((p) => {
      const total = p.base + p.tax + p.shipping
      return `<tr>
        <td style="${cell}">${esc(p.label)}<br /><span style="color:${MUTED};font-size:12px">${esc(p.when)}</span></td>
        <td style="${cell}text-align:right">${money(p.base)}</td>
        <td style="${cell}text-align:right">${money(p.tax)}</td>
        ${ship ? `<td style="${cell}text-align:right">${p.shipping ? money(p.shipping) : '—'}</td>` : ''}
        <td style="${cell}text-align:right;font-weight:bold">${money(total)}</td>
        <td style="${cell}text-align:center;color:${p.status === 'Paid' ? '#0b8a3b' : MUTED};font-weight:bold">${p.status}</td>
      </tr>`
    })
    .join('')
  const th = (t: string, align = 'right') =>
    `<th style="padding:8px 12px;font-size:12px;color:${MUTED};text-align:${align};background:#f6f8fb;border-bottom:1px solid #e6e9ee">${t}</th>`

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1a2b3c;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 0;"><tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e6e9ee;">
  <tr><td style="background:${BRAND};padding:26px 30px;color:#ffffff;">
    <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;opacity:.8;">Confidentist</div>
    <div style="font-size:23px;font-weight:bold;margin-top:6px;">${isAdmin ? `New order #${esc(d.orderNumber)}` : 'Enrollment confirmed ✅'}</div>
    <div style="font-size:14px;margin-top:6px;opacity:.9;">Order number: <strong>#${esc(d.orderNumber)}</strong></div>
  </td></tr>
  <tr><td style="padding:24px 30px 30px;">
    ${
      isAdmin
        ? `<p style="font-size:15px;margin:0 0 4px">New registration from <strong>${esc(name || d.email)}</strong>${d.when ? ` · ${esc(d.when)} (Toronto)` : ''}</p>`
        : `<p style="font-size:16px;line-height:1.55;margin:0 0 6px;font-weight:bold;">Thank you${d.firstName ? `, ${esc(d.firstName)}` : ''}, for enrolling in the ${esc(d.courseName)}!</p>
           <p style="font-size:15px;line-height:1.55;margin:0;">Your payment has been received. Here is your receipt — our team will be in touch with onboarding details shortly.</p>`
    }

    ${section('Order summary')}
    ${box(
      kv('Order number', `#${esc(d.orderNumber)}`, true) +
        kv('Course', esc(d.courseName)) +
        (d.courseStart ? kv('Course start', esc(d.courseStart)) : '') +
        kv('Original price (before tax)', `${money(d.originalPrice)} ${esc(d.currency)}`) +
        kv(`Sales tax on full course · ${esc(d.taxLabel)}`, money(d.courseTaxTotal)) +
        kv('Payment plan', esc(d.planLabel)) +
        (ship ? kv('Shipping option', esc(d.shippingLabel)) : '') +
        (d.discount > 0 ? kv('Discount (promo code)', `−${money(d.discount)}`) : '') +
        kv('Total paid now', `${money(d.paidNow)} ${esc(d.currency)}`, true),
    )}

    ${section(ship ? 'Payments — amount, tax and shipping on each payment' : 'Payments — amount and tax on each payment')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6e9ee;border-radius:8px;border-collapse:separate">
      <tr>${th('Payment', 'left')}${th('Amount')}${th('Tax')}${ship ? th('Shipping') : ''}${th('Total')}${th('Status', 'center')}</tr>
      ${payRows}
    </table>
    <p style="font-size:12px;color:${MUTED};margin:8px 0 0;line-height:1.5">Tax: ${esc(d.taxLabel)}.${ship ? ' Shipping is charged once, with the first payment.' : ''}${
      d.payments.length > 1 ? ' The remaining payment is collected by a secure Stripe link we email you before its due date.' : ''
    }${d.discount > 0 ? ' Amounts shown before the promo-code discount.' : ''}</p>

    ${section('Customer details')}
    ${box(
      kv('Name', esc(name) || '—') +
        kv('Email', esc(d.email) || '—') +
        kv('Phone', esc(d.phone) || '—') +
        kv('Postal code', esc(d.postalCode) || '—') +
        (isAdmin ? kv('SIN', esc(d.sin || '') || '—') : ''),
    )}

    ${section('Billing address')}
    <p style="font-size:14px;line-height:1.6;margin:0">${d.billingLines.filter(Boolean).map(esc).join('<br />') || '—'}</p>

    ${ship ? `${section('Shipping address')}
    <p style="font-size:14px;line-height:1.6;margin:0">${
      d.shippingLines.filter(Boolean).map(esc).join('<br />') || d.billingLines.filter(Boolean).map(esc).join('<br />') || '—'
    }</p>` : ''}

    ${isAdmin ? '' : `<p style="font-size:13px;line-height:1.55;color:${MUTED};margin:26px 0 0;">Questions about your enrollment? Just reply to this email.</p>`}
  </td></tr>
  <tr><td style="background:#f4f6f8;padding:16px 30px;font-size:12px;color:#8a97a6;text-align:center;">Confidentist &middot; confidentist.ca &middot; GST/HST 821980398RT0001</td></tr>
</table>
</td></tr></table>
</body></html>`

  const lines: string[] = []
  lines.push(isAdmin ? `New order #${d.orderNumber}` : `Enrollment confirmed — ${d.courseName}`)
  lines.push(`Order number: #${d.orderNumber}`, '')
  lines.push(`Course: ${d.courseName}`)
  if (d.courseStart) lines.push(`Course start: ${d.courseStart}`)
  lines.push(`Original price (before tax): ${money(d.originalPrice)} ${d.currency}`)
  lines.push(`Sales tax on full course (${d.taxLabel}): ${money(d.courseTaxTotal)}`)
  lines.push(`Payment plan: ${d.planLabel}`)
  if (ship) lines.push(`Shipping option: ${d.shippingLabel}`)
  if (d.discount > 0) lines.push(`Discount (promo code): -${money(d.discount)}`)
  lines.push(`Total paid now: ${money(d.paidNow)} ${d.currency}`, '', 'Payments:')
  for (const p of d.payments) {
    lines.push(
      `- ${p.label} (${p.when}): ${money(p.base)} + tax ${money(p.tax)}${p.shipping ? ` + shipping ${money(p.shipping)}` : ''} = ${money(p.base + p.tax + p.shipping)} [${p.status}]`,
    )
  }
  lines.push('', `Name: ${name}`, `Email: ${d.email}`, `Phone: ${d.phone}`, `Postal code: ${d.postalCode}`)
  if (isAdmin) lines.push(`SIN: ${d.sin || ''}`)
  lines.push('', 'Billing address:', ...d.billingLines.filter(Boolean))
  if (ship) lines.push('', 'Shipping address:', ...(d.shippingLines.filter(Boolean).length ? d.shippingLines : d.billingLines).filter(Boolean))

  const subject = isAdmin
    ? `New order #${d.orderNumber} — ${name || d.email} — ${d.courseName}`
    : `Your ConfiDentist order #${d.orderNumber} — ${d.courseName}`

  return { subject, html, text: lines.join('\n') }
}
