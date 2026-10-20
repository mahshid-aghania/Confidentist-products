import { NextResponse } from 'next/server'
import { renderMockExamReceipt, selectionFromRef } from '@/lib/email/mock-exam-receipt'
import { sendEmail } from '@/lib/email/send'

// TEMPORARY test-only route — delivers the real AFK mock-exam confirmation
// email using the production Resend key (process.env.confi). Token-guarded and
// locked to a single recipient. Remove after verifying delivery.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TOKEN = '083e294f50266b497f52e384fe9dba78'
const RECIPIENT = 'mahshidc.aghania@gmail.com'

export async function GET(req: Request) {
  const url = new URL(req.url)
  if (url.searchParams.get('token') !== TOKEN) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const ref = 'mocks-1234-mini-0' // mirrors a live /afk-mock-exams/ button
  const rendered = renderMockExamReceipt({
    customerEmail: RECIPIENT,
    customerPhone: '+1 647 555 0123',
    amountLabel: '$1,700.00 CAD',
    selectionLabel: selectionFromRef(ref),
    reference: 'cs_test_PREVIEW_' + ref,
  })
  try {
    const r = await sendEmail({
      to: RECIPIENT,
      subject: '[TEST] ' + rendered.subject,
      html: rendered.html,
      text: rendered.text,
    })
    return NextResponse.json({ sent: true, id: r.id, to: RECIPIENT, selection: selectionFromRef(ref) })
  } catch (e) {
    return NextResponse.json({ sent: false, error: (e as Error).message }, { status: 500 })
  }
}
