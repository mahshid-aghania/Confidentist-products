import 'server-only'
import crypto from 'node:crypto'

// Verifies a Stripe webhook signature WITHOUT the Stripe SDK.
// Mirrors stripe.webhooks.constructEvent:
//   signed_payload = `${t}.${rawBody}`
//   expected       = HMAC-SHA256(signed_payload, webhookSecret) as hex
// The `Stripe-Signature` header looks like: `t=<ts>,v1=<sig>[,v1=<sig>...]`.
// Multiple v1 signatures can be present during secret rotation — any match passes.
export function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  toleranceSeconds = 300,
): boolean {
  if (!header) return false

  let timestamp = ''
  const signatures: string[] = []
  for (const part of header.split(',')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const key = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (key === 't') timestamp = value
    else if (key === 'v1') signatures.push(value)
  }
  if (!timestamp || signatures.length === 0) return false

  // Reject stale timestamps (replay protection).
  const now = Math.floor(Date.now() / 1000)
  if (!Number.isFinite(Number(timestamp)) || Math.abs(now - Number(timestamp)) > toleranceSeconds) {
    return false
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`, 'utf8')
    .digest('hex')
  const expectedBuf = Buffer.from(expected)

  return signatures.some((sig) => {
    const sigBuf = Buffer.from(sig)
    return sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)
  })
}
