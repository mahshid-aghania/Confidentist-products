// Single source of truth for the "From Associate to Owner" event.
export const EVENT = {
  slug: 'from-associate-to-owner',
  name: 'From Associate to Owner: Building Your Successful Dental Clinic',
  depositAmount: 50,
  currency: 'CAD',
  // Stripe Price for the $50 seat deposit. The registration API creates a
  // Checkout Session from this (with promotion codes enabled).
  priceId: 'price_1UJGiLJeZKIZa8CDbYA9ZYrH',
  baseUrl: 'https://product.confidentist.ca/events/from-associate-to-owner/',
} as const

// Promotion codes handled on OUR side (before Stripe). Key = lowercased code,
// value = percent off. A 100% code fully waives the deposit and skips Stripe.
export const PROMO_CODES: Record<string, number> = {
  'confi-100': 100, // 100% off — free registration
}

// Resolve a user-entered code to a percent-off. Returns null if the (non-empty)
// code is not recognized, 0 if no code was entered.
export function resolvePromo(code: string | undefined | null): number | null {
  const c = (code ?? '').trim().toLowerCase()
  if (!c) return 0
  return c in PROMO_CODES ? PROMO_CODES[c] : null
}
