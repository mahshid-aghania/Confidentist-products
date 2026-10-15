// Registrant-facing confirmation email — sent to the attendee once their event
// registration is confirmed (paid seat, or a 100%-comped registration).
// Data-driven from the event registry so it works for ANY event; detail rows
// (date/location/credits/speaker) render only when provided.

export type EventConfirmationData = {
  firstName: string
  eventName: string
  tagline?: string
  date?: string
  location?: string
  ceCredits?: string
  speaker?: string
  presenters?: string
}

export function renderEventConfirmation(data: EventConfirmationData): {
  subject: string
  html: string
  text: string
} {
  const { firstName, eventName, tagline, date, location, ceCredits, speaker, presenters } = data

  const detailRows: [string, string, string][] = []
  if (date) detailRows.push(['&#128197;', 'Date', date])
  if (location) detailRows.push(['&#128205;', 'Location', location])
  if (ceCredits) detailRows.push(['&#127891;', 'Credits', ceCredits])
  if (speaker) detailRows.push(['&#128104;&#8205;&#127979;', 'Speaker', speaker])

  const detailsBlock = detailRows.length
    ? `<tr><td style="padding:0 40px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7fafc;border:1px solid #e3eaf0;border-radius:10px;"><tr><td style="padding:22px 24px;">
          <p style="margin:0 0 14px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#6b7c8e;font-weight:600;">Event Details</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;line-height:1.5;">
            ${detailRows
              .map(
                ([icon, k, v]) =>
                  `<tr><td style="padding:4px 0;color:#6b7c8e;width:120px;">${icon} ${k}</td><td style="padding:4px 0;font-weight:600;">${escapeHtml(v)}</td></tr>`,
              )
              .join('')}
          </table>
        </td></tr></table>
      </td></tr>`
    : ''

  const footerLine = presenters ? `Presented by ${escapeHtml(presenters)}` : 'ConfiDentist Continuing Education'

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f6f8;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#1a2b3c;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f8;padding:24px 0;"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
      <tr><td style="background:linear-gradient(135deg,#0d3b66 0%,#1b6ca8 100%);padding:40px 40px 32px;text-align:center;">
        <p style="margin:0 0 6px;color:#aed5f0;font-size:13px;letter-spacing:2px;text-transform:uppercase;">ConfiDentist Continuing Education</p>
        <h1 style="margin:0;color:#ffffff;font-size:24px;line-height:1.3;font-weight:700;">${escapeHtml(eventName)}</h1>
        ${tagline ? `<p style="margin:8px 0 0;color:#e6f1fb;font-size:15px;">${escapeHtml(tagline)}</p>` : ''}
      </td></tr>
      <tr><td style="padding:36px 40px 8px;text-align:center;">
        <div style="display:inline-block;background-color:#e8f7ee;color:#1e9e5a;font-size:14px;font-weight:600;padding:10px 20px;border-radius:999px;">&#10003; Registration Confirmed</div>
      </td></tr>
      <tr><td style="padding:20px 40px 8px;">
        <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Dear ${escapeHtml(firstName)},</p>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Thank you for registering for <strong>${escapeHtml(eventName)}</strong>. We're delighted to confirm that <strong>your seat is secured</strong>.</p>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.6;">You'll <strong>soon receive a separate introduction email</strong> with everything you need to prepare &mdash; course materials, the agenda, and your access details. Keep an eye on your inbox.</p>
      </td></tr>
      ${detailsBlock}
      <tr><td style="padding:0 40px 36px;">
        <p style="margin:0 0 4px;font-size:16px;line-height:1.6;">We look forward to welcoming you.</p>
        <p style="margin:0;font-size:16px;line-height:1.6;">Warm regards,<br><strong>The ConfiDentist Team</strong></p>
      </td></tr>
      <tr><td style="background-color:#0d3b66;padding:24px 40px;text-align:center;">
        <p style="margin:0 0 6px;color:#aed5f0;font-size:13px;">${footerLine}</p>
        <p style="margin:0;color:#7fa8cc;font-size:12px;"><a href="https://product.confidentist.ca" style="color:#aed5f0;text-decoration:none;">confidentist.ca</a> &middot; Questions? Reply to this email.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`

  const textDetails = detailRows.map(([, k, v]) => `  ${k}:`.padEnd(13) + v).join('\n')
  const text = `Dear ${firstName},

Thank you for registering for ${eventName}. We're delighted to confirm that your seat is secured.

You'll soon receive a separate introduction email with everything you need to prepare — course materials, the agenda, and your access details. Keep an eye on your inbox.
${detailRows.length ? `\nEVENT DETAILS\n${textDetails}\n` : ''}
We look forward to welcoming you.

Warm regards,
The ConfiDentist Team
${footerLine}
confidentist.ca`

  const subject = `✓ You're confirmed — ${eventName}`
  return { subject, html, text }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
