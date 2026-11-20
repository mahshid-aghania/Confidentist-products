import { createServerClient } from '@/lib/supabase/server'

// Single source of truth for product.confidentist.ca order numbers.
//
// Returns the next plain-numeric order number (e.g. "71001") from the
// confi_order_number_seq Postgres sequence. That sequence is seeded ABOVE
// WooCommerce's live order-id range (WooCommerce is ~59k; the sequence starts at
// 71001), so a generated number can never equal a real WooCommerce order number.
//
// RULE: this sequence must ALWAYS stay above WooCommerce's current max order id.
// If WooCommerce ever climbs toward this range, reseed the sequence higher
// (ALTER SEQUENCE confi_order_number_seq RESTART WITH <new, higher start>).
// Never let order numbers fall inside the WooCommerce range — a shared number
// once got assigned to both a buyer here and a real WooCommerce order (#59020).
//
// Minted at checkout and carried in Stripe metadata so the admin notification,
// the recorded order row, and the installment payment links all show the SAME
// number. Abandoned checkouts simply leave a gap, which is fine.
export async function nextOrderNumber(): Promise<string> {
  const supabase = createServerClient()
  const { data, error } = await supabase.rpc('next_confi_order_number')
  const n = typeof data === 'number' ? data : Number(data)
  if (error || !Number.isFinite(n)) {
    throw new Error(`next_confi_order_number: ${error?.message ?? 'no value'}`)
  }
  return String(n)
}
