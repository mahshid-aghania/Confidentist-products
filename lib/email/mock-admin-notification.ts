// Admin notification for AFK Mock Exam purchases — sent to the team with the
// buyer's FULL details captured at Stripe Checkout (name, email, phone, billing
// address, postal code, SIN) so the record is complete on our side.

export type MockAdminNotification = {
  name: string
  email: string
  phone: string
  sin: string
  addressLines: string[] // formatted billing address lines (may be empty)
  selectionLabel: string
  amountLabel: string
  reference: string
  when: string
  productName?: string // header/subject label, e.g. "OSCE Mock Exam" (defaults to "AFK Mock Exam")
  firstName?: string // when set, shown as its own row (and splits the Name row)
  lastName?: string // when set, shown as its own row
  postalCode?: string // when set, shown as its own row (in addition to the full address block)
}

export function renderMockAdminNotification(d: MockAdminNotification): {
  subject: string
  html: string
  text: string
} {
  const product = d.productName || 'AFK Mock Exam'
  const addr = d.addressLines.filter(Boolean).join('\n') || '—'
  const hasSplitName = Boolean(d.firstName || d.lastName)
  const rows: [string, string][] = [
    // Prefer explicit first/last name when provided; otherwise the single full name.
    ...(hasSplitName
      ? ([
          ['First name', d.firstName || '—'],
          ['Last name', d.lastName || '—'],
        ] as [string, string][])
      : ([['Name', d.name || '—']] as [string, string][])),
    ['Email', d.email || '—'],
    ['Phone', d.phone || '—'],
    ['SIN', d.sin || '—'],
    ['Billing address', addr],
    // Call out the postal code on its own line so it's never buried in the block.
    ...(d.postalCode ? ([['Postal code', d.postalCode]] as [string, string][]) : []),
    ['Purchase', d.selectionLabel],
    ['Amount', d.amountLabel],
    ['Reference', d.reference],
    ['When', d.when],
  ]

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1a2b3c;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e6e9ee;">
        <tr><td style="background:#0b2a5b;padding:22px 28px;color:#fff;">
          <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;opacity:.8;">ConfiDentist · Ops</div>
          <div style="font-size:20px;font-weight:bold;margin-top:4px;">New ${escapeHtml(product)} purchase</div>
        </td></tr>
        <tr><td style="padding:22px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6e9ee;border-radius:8px;">
            ${rows
              .map(
                ([k, v], i) =>
                  `<tr><td style="padding:12px 16px;${i < rows.length - 1 ? 'border-bottom:1px solid #eef1f5;' : ''}font-size:14px;color:#5b6b7c;width:140px;vertical-align:top;">${k}</td><td style="padding:12px 16px;${i < rows.length - 1 ? 'border-bottom:1px solid #eef1f5;' : ''}font-size:14px;text-align:right;font-weight:bold;white-space:pre-line;">${escapeHtml(v)}</td></tr>`,
              )
              .join('')}
          </table>
          <p style="font-size:12px;color:#8a97a8;margin:16px 0 0;">Contains sensitive personal information (SIN). Handle per your privacy policy.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const text = `New ${product} purchase\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}`
  const subject = `New ${product} purchase — ${d.name || d.email}`
  return { subject, html, text }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
