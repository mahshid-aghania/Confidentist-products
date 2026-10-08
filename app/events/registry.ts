// Registry of registrable events. The register API and the event pages both
// read from here so adding an event is a single entry.
export type EventApiConfig = {
  slug: string
  name: string
  priceId: string
  priceCents: number
  currency: string
  baseUrl: string
  // Promotion codes handled on OUR side (before Stripe). key = lowercased code,
  // value = percent off. A 100% code fully waives the fee and skips Stripe.
  promoCodes: Record<string, number>
}

// Site-wide promotion codes valid for ANY course. Keys MUST be lowercase —
// resolvePromo lowercases user input before matching. value = percent off.
export const SITE_PROMO_CODES: Record<string, number> = {
  'confi-10': 10,
  'confi-20': 20,
  'confi-30': 30,
  'confi-50': 50,
  'confi-100': 100,
}

export const EVENTS: Record<string, EventApiConfig> = {
  'from-associate-to-owner': {
    slug: 'from-associate-to-owner',
    name: 'From Associate to Owner: Building Your Successful Dental Clinic',
    priceId: 'price_1UJGiLJeZKIZa8CDbYA9ZYrH',
    priceCents: 5000, // $50 seat deposit
    currency: 'CAD',
    baseUrl: 'https://product.confidentist.ca/events/from-associate-to-owner/',
    promoCodes: SITE_PROMO_CODES,
  },
  'orthodontics-clear-aligners': {
    slug: 'orthodontics-clear-aligners',
    name: 'Orthodontics & Clear Aligners: Supercharge Your Practice',
    priceId: 'price_1UKIRBJeZKIZa8CDwIQF1BwR',
    priceCents: 39437, // $349 + 13% HST (Ontario) = $394.37 course fee
    currency: 'CAD',
    baseUrl: 'https://product.confidentist.ca/events/orthodontics-clear-aligners/',
    promoCodes: SITE_PROMO_CODES,
  },
}

export function getEvent(slug: string): EventApiConfig | null {
  return EVENTS[slug] ?? null
}

// Resolve a user-entered code to a percent-off for this event. Returns null if
// the (non-empty) code is not recognized, 0 if no code was entered.
export function resolvePromo(ev: EventApiConfig, code: string | null | undefined): number | null {
  const c = (code ?? '').trim().toLowerCase()
  if (!c) return 0
  return c in ev.promoCodes ? ev.promoCodes[c] : null
}
