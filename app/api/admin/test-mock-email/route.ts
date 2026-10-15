import { NextResponse } from 'next/server'
import { sendEmail, ADMIN_EMAILS } from '@/lib/email/send'
import { renderMockAdminNotification } from '@/lib/email/mock-admin-notification'
import { renderMockExamReceipt } from '@/lib/email/mock-exam-receipt'

// TEMPORARY — sends the AFK Mock Exam emails filled with SAMPLE data so the team
// can preview them. Guarded by ADMIN_SEND_TOKEN. Safe to delete after use.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  if (!process.env.ADMIN_SEND_TOKEN || req.headers.get('x-admin-token') !== process.env.ADMIN_SEND_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!process.env.confi) return NextResponse.json({ error: 'Missing Resend key' }, { status: 500 })

  const sample = {
    name: 'Jane Doe (TEST)',
    email: 'mahshid@confidentist.ca', // acts as the test "student" inbox
    phone: '+1 437 555 0123',
    sin: '123 456 789',
    addressLines: ['123 Rimrock Rd', 'Suite 209', 'North York, ON, M3J 3A6', 'CA'],
    selectionLabel: 'AFK Mock Exams — 4 Full Mocks + Mini-Mock Bundle',
    amountLabel: '$600.00 CAD',
    reference: 'TEST-mocks-1234-mini-1',
    when: new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' }),
  }

  const results: Record<string, unknown> = {}

  // 1) Full-info admin notification → the team
  try {
    const note = renderMockAdminNotification(sample)
    const r = await sendEmail({ to: ADMIN_EMAILS, ...note })
    results.adminNotification = { ok: true, id: r.id, to: ADMIN_EMAILS }
  } catch (e) {
    results.adminNotification = { ok: false, error: String(e) }
  }

  // 2) Customer confirmation → the (test) student, BCC the team
  try {
    const rendered = renderMockExamReceipt({
      customerEmail: sample.email,
      customerPhone: sample.phone,
      amountLabel: sample.amountLabel,
      selectionLabel: sample.selectionLabel,
      reference: sample.reference,
    })
    const r = await sendEmail({ to: sample.email, bcc: ADMIN_EMAILS, ...rendered })
    results.customerConfirmation = { ok: true, id: r.id, to: sample.email, bcc: ADMIN_EMAILS }
  } catch (e) {
    results.customerConfirmation = { ok: false, error: String(e) }
  }

  return NextResponse.json({ sent: true, results })
}
