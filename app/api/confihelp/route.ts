import { NextResponse } from 'next/server'
import { sendEmail } from '@/lib/email/send'

// ConfiHelp session requests are routed to the admin inbox.
const CONFIHELP_INBOX = 'admin@confidentist.ca'

// POST /api/confihelp/  — capture a free ConfiHelp session request (no payment)
// and notify the team by email. The lead's details come from the booking form
// on /ndecc-confihelp/.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  )
}

export async function POST(req: Request) {
  let body: {
    firstName?: string
    lastName?: string
    email?: string
    phone?: string
    details?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const firstName = (body.firstName ?? '').trim()
  const lastName = (body.lastName ?? '').trim()
  const email = (body.email ?? '').trim()
  const phone = (body.phone ?? '').trim()
  const details = (body.details ?? '').trim()

  if (!firstName) return NextResponse.json({ error: 'Please enter your first name.' }, { status: 400 })
  if (!lastName) return NextResponse.json({ error: 'Please enter your last name.' }, { status: 400 })
  if (!EMAIL_RE.test(email))
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  if (!phone) return NextResponse.json({ error: 'Please enter your phone number.' }, { status: 400 })
  if (!details)
    return NextResponse.json({ error: 'Please provide details about your preparation status.' }, { status: 400 })

  const fullName = `${firstName} ${lastName}`
  const when = new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' })

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#1a1f2e">
      <h2 style="color:#072C5E;margin:0 0 .5rem">New ConfiHelp session request</h2>
      <p style="color:#586175;margin:0 0 1.25rem">Submitted ${esc(when)} (Toronto)</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:8px 0;color:#586175;width:140px">Name</td><td style="padding:8px 0;font-weight:600">${esc(fullName)}</td></tr>
        <tr><td style="padding:8px 0;color:#586175">Email</td><td style="padding:8px 0"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
        <tr><td style="padding:8px 0;color:#586175">Phone</td><td style="padding:8px 0">${esc(phone)}</td></tr>
        <tr><td style="padding:8px 0;color:#586175;vertical-align:top">Preparation status</td><td style="padding:8px 0;white-space:pre-wrap">${esc(details)}</td></tr>
      </table>
    </div>`

  const text = `New ConfiHelp session request (${when} Toronto)

Name:  ${fullName}
Email: ${email}
Phone: ${phone}

Preparation status:
${details}
`

  try {
    await sendEmail({
      to: CONFIHELP_INBOX,
      replyTo: email,
      subject: `New ConfiHelp request — ${fullName}`,
      html,
      text,
    })
  } catch (e) {
    console.error('confihelp notification failed', e)
    return NextResponse.json(
      { error: 'Sorry, we could not submit your request right now. Please email info@confidentist.ca.' },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true })
}
