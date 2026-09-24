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
