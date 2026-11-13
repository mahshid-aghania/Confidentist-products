import { NextResponse } from 'next/server'
import { sendEmail } from '@/lib/email/send'

// POST /api/contact  — contact-form submissions from /contact-us/.
// Delivers the message to info@confidentist.ca, with reply-to set to the sender
// so the team can reply directly. No data is stored.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CONTACT_TO = 'info@confidentist.ca'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

export async function POST(req: Request) {
  let body: { name?: string; phone?: string; email?: string; message?: string; company?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  // Honeypot: real users never fill this hidden field.
  if ((body.company ?? '').trim()) return NextResponse.json({ ok: true })

  const name = (body.name ?? '').trim()
  const phone = (body.phone ?? '').trim()
  const email = (body.email ?? '').trim()
  const message = (body.message ?? '').trim()

  if (!name) return NextResponse.json({ error: 'Please enter your name.' }, { status: 400 })
  if (!phone) return NextResponse.json({ error: 'Please enter your phone number.' }, { status: 400 })
  if (!EMAIL_RE.test(email))
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  if (!message) return NextResponse.json({ error: 'Please enter a message.' }, { status: 400 })

  const when = new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' })
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;max-width:580px;color:#1a1f2e">` +
    `<h2 style="color:#072C5E;margin:0 0 12px">New contact form message</h2>` +
    `<p style="margin:0 0 4px"><strong>Name:</strong> ${esc(name)}</p>` +
    `<p style="margin:0 0 4px"><strong>Phone:</strong> ${esc(phone)}</p>` +
    `<p style="margin:0 0 12px"><strong>Email:</strong> ${esc(email)}</p>` +
    `<p style="margin:0 0 6px"><strong>Message:</strong></p>` +
    `<p style="white-space:pre-wrap;border-left:3px solid #0f7ae5;padding:4px 0 4px 12px;color:#1a1f2e;margin:0">${esc(message)}</p>` +
    `<p style="font-size:12px;color:#586175;margin-top:16px">Sent ${when} from the product.confidentist.ca contact form.</p></div>`
  const text = `New contact form message\n\nName: ${name}\nPhone: ${phone}\nEmail: ${email}\n\nMessage:\n${message}\n\nSent ${when} from the product.confidentist.ca contact form.`

  try {
    await sendEmail({ to: CONTACT_TO, replyTo: email, subject: `Contact form — ${name}`, html, text })
  } catch (e) {
    console.error('contact form send failed', e)
    return NextResponse.json(
      { error: 'Could not send your message. Please email info@confidentist.ca directly.' },
      { status: 502 },
    )
  }
  return NextResponse.json({ ok: true })
}
