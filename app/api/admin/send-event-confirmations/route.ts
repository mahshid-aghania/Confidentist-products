import { NextResponse } from 'next/server'

// TEMPORARY admin endpoint — one-off registration-confirmation blast for the
// "Orthodontics & Clear Aligners" event. Guarded by ADMIN_SEND_TOKEN.
// Recipients + cc are passed in the request body so no PII lives in the repo.
// Safe to delete after use.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const FROM = 'Confidentist <noreply@confidentist.ca>'
const SUBJECT = "✓ You're confirmed — Orthodontics & Clear Aligners (Oct 18)"

function renderHtml(firstName: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f6f8;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#1a2b3c;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f8;padding:24px 0;"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
      <tr><td style="background:linear-gradient(135deg,#0d3b66 0%,#1b6ca8 100%);padding:40px 40px 32px;text-align:center;">
        <p style="margin:0 0 6px;color:#aed5f0;font-size:13px;letter-spacing:2px;text-transform:uppercase;">ConfiDentist Continuing Education</p>
        <h1 style="margin:0;color:#ffffff;font-size:24px;line-height:1.3;font-weight:700;">Orthodontics &amp; Clear Aligners</h1>
        <p style="margin:8px 0 0;color:#e6f1fb;font-size:15px;">Supercharge Your Practice</p>
      </td></tr>
      <tr><td style="padding:36px 40px 8px;text-align:center;">
        <div style="display:inline-block;background-color:#e8f7ee;color:#1e9e5a;font-size:14px;font-weight:600;padding:10px 20px;border-radius:999px;">&#10003; Registration Confirmed</div>
      </td></tr>
      <tr><td style="padding:20px 40px 8px;">
        <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Dear ${firstName},</p>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">Thank you for registering for <strong>Orthodontics &amp; Clear Aligners: Supercharge Your Practice</strong>. We're delighted to confirm that <strong>your seat is secured</strong>.</p>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.6;">You'll <strong>soon receive a separate introduction email</strong> with everything you need to prepare &mdash; course materials, the agenda, and your access details. Keep an eye on your inbox.</p>
      </td></tr>
      <tr><td style="padding:0 40px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f7fafc;border:1px solid #e3eaf0;border-radius:10px;"><tr><td style="padding:22px 24px;">
          <p style="margin:0 0 14px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#6b7c8e;font-weight:600;">Event Details</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;line-height:1.5;">
            <tr><td style="padding:4px 0;color:#6b7c8e;width:120px;">&#128197; Date</td><td style="padding:4px 0;font-weight:600;">Sunday, October 18, 2026</td></tr>
            <tr><td style="padding:4px 0;color:#6b7c8e;">&#128205; Location</td><td style="padding:4px 0;font-weight:600;">North York, Toronto</td></tr>
            <tr><td style="padding:4px 0;color:#6b7c8e;">&#127891; Credits</td><td style="padding:4px 0;font-weight:600;">5 CE Credits</td></tr>
            <tr><td style="padding:4px 0;color:#6b7c8e;">&#128104;&#8205;&#127979; Speaker</td><td style="padding:4px 0;font-weight:600;">Dr. Hossein Arbabezadeh, MSc</td></tr>
          </table>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:0 40px 36px;">
        <p style="margin:0 0 4px;font-size:16px;line-height:1.6;">We look forward to welcoming you.</p>
        <p style="margin:0;font-size:16px;line-height:1.6;">Warm regards,<br><strong>The ConfiDentist Team</strong></p>
      </td></tr>
      <tr><td style="background-color:#0d3b66;padding:24px 40px;text-align:center;">
        <p style="margin:0 0 6px;color:#aed5f0;font-size:13px;">Presented by ConfiDentist &middot; i-VISTA MED &middot; EverSmiles</p>
        <p style="margin:0;color:#7fa8cc;font-size:12px;"><a href="https://product.confidentist.ca" style="color:#aed5f0;text-decoration:none;">confidentist.ca</a> &middot; Questions? Reply to this email.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`
}

function renderText(firstName: string): string {
  return `Dear ${firstName},

Thank you for registering for Orthodontics & Clear Aligners: Supercharge Your Practice. We're delighted to confirm that your seat is secured.

You'll soon receive a separate introduction email with everything you need to prepare — course materials, the agenda, and your access details. Keep an eye on your inbox.

EVENT DETAILS
  Date:     Sunday, October 18, 2026
  Location: North York, Toronto
  Credits:  5 CE Credits
  Speaker:  Dr. Hossein Arbabezadeh, MSc

We look forward to welcoming you.

Warm regards,
The ConfiDentist Team
Presented by ConfiDentist · i-VISTA MED · EverSmiles
confidentist.ca`
}

type Recipient = { name: string; email: string }

export async function POST(req: Request) {
  const token = req.headers.get('x-admin-token')
  const expected = process.env.ADMIN_SEND_TOKEN
  if (!expected || token !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.confi
  if (!apiKey) return NextResponse.json({ error: 'Missing Resend key' }, { status: 500 })

  let body: { recipients?: Recipient[]; cc?: string[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Bad JSON' }, { status: 400 })
  }
  const recipients = body.recipients ?? []
  const cc = body.cc ?? []
  if (!recipients.length) return NextResponse.json({ error: 'No recipients' }, { status: 400 })

  const results: Array<{ email: string; ok: boolean; id?: string; error?: string }> = []
  for (const r of recipients) {
    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM,
          to: [r.email],
          cc: cc.length ? cc : undefined,
          subject: SUBJECT,
          html: renderHtml(r.name),
          text: renderText(r.name),
        }),
      })
      const data = (await res.json()) as { id?: string; message?: string }
      if (!res.ok) results.push({ email: r.email, ok: false, error: `${res.status}: ${data.message ?? ''}` })
      else results.push({ email: r.email, ok: true, id: data.id })
    } catch (e) {
      results.push({ email: r.email, ok: false, error: String(e) })
    }
  }
  return NextResponse.json({ sent: results.filter((x) => x.ok).length, results })
}
