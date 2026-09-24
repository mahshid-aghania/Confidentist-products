import 'server-only'

// Minimal Resend transport (no SDK dependency). Reads the Resend API key from
// process.env.confi (the project's chosen env var name). Server-only.

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const DEFAULT_FROM = 'Confidentist <noreply@confidentist.ca>'

// Internal recipients for admin/ops notifications.
export const ADMIN_EMAILS = [
  'admin@confidentist.ca',
  'shirin@confidentist.ca',
  'mahshid@confidentist.ca',
]

export type SendEmailInput = {
  to: string | string[]
  subject: string
  html: string
  text?: string
  bcc?: string | string[]
  from?: string
  replyTo?: string
}

export async function sendEmail(input: SendEmailInput): Promise<{ id: string }> {
  const apiKey = process.env.confi
  if (!apiKey) throw new Error('Missing Resend API key (env "confi")')

  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: input.from ?? DEFAULT_FROM,
      to: Array.isArray(input.to) ? input.to : [input.to],
      bcc: input.bcc ? (Array.isArray(input.bcc) ? input.bcc : [input.bcc]) : undefined,
      reply_to: input.replyTo,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Resend send failed (${res.status}): ${body}`)
  }
  return (await res.json()) as { id: string }
}
