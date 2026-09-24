// Single source of truth for the "From Associate to Owner" event.
export const EVENT = {
  slug: 'from-associate-to-owner',
  name: 'From Associate to Owner: Building Your Successful Dental Clinic',
  depositAmount: 50,
  currency: 'CAD',
  // Stripe Payment Link for the $50 seat deposit (see /api/events/register).
  paymentLink: 'https://buy.stripe.com/bJe4gA6y66oPc9cafg8bS0r',
  paymentLinkId: 'plink_1UJGiMJeZKIZa8CDd8vzO7ZM',
} as const
