// Admin notification email — sent to the team whenever someone registers for
// an event (free comped registration, or a paid seat deposit).

export type EventRegistrationNotification = {
  eventName: string
  fullName: string
  email: string
  phone: string
  amountLabel: string // e.g. "$50.00 CAD" or "$0.00 CAD (100% off · confi-100)"
  status: string // 'paid' | 'pending'
  when: string // human-readable timestamp
}

export function renderEventRegistrationNotification(data: EventRegistrationNotification): {
  subject: string
  html: string
  text: string
} {
  const { eventName, fullName, email, phone, amountLabel, status, when } = data

  const rows: [string, string][] = [
    ['Name', fullName],
    ['Email', email],
    ['Phone', phone],
    ['Event', eventName],
    ['Deposit', amountLabel],
    ['Status', status],
    ['Registered', when],
  ]

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1a2b3c;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="540" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:10px;overflow:hidden;border:1px solid #e6e9ee;">
        <tr><td style="background:#0b2a5b;padding:22px 28px;color:#fff;">
          <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;opacity:.8;">ConfiDentist · Ops</div>
          <div style="font-size:20px;font-weight:bold;margin-top:4px;">New event registration</div>
        </td></tr>
        <tr><td style="padding:22px 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6e9ee;border-radius:8px;">
            ${rows
              .map(
                ([k, v], i) =>
                  `<tr><td style="padding:12px 16px;${i < rows.length - 1 ? 'border-bottom:1px solid #eef1f5;' : ''}font-size:14px;color:#5b6b7c;width:120px;">${k}</td><td style="padding:12px 16px;${i < rows.length - 1 ? 'border-bottom:1px solid #eef1f5;' : ''}font-size:14px;text-align:right;font-weight:bold;">${escapeHtml(v)}</td></tr>`,
              )
              .join('')}
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const text = `New event registration

${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}`

  const subject = `New registration: ${fullName} — ${eventName}`
  return { subject, html, text }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
