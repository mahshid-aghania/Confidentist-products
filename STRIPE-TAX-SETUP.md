# Stripe Tax — setup & outstanding work

_Last updated: 2026-11-13_

Automatic sales tax (GST/HST/PST/QST) at checkout is handled by **Stripe Tax**
(`automatic_tax[enabled]=true`). No tax rates are hard-coded anywhere. Prices are
shown "+ applicable tax" and created with `tax_behavior: 'exclusive'`.

## ✅ Code status — `app/api/afk-programs/checkout/route.ts`
- `automatic_tax[enabled]=true` — set (full **and** installment first payment)
- `billing_address_collection=required` — set
- `tax_behavior=exclusive` — set on the line item and every shipping rate
- `product_data[tax_code]=txcd_20060045` ("Training Services – Live Virtual") — set
  - Alternative if preferred: `txcd_20060044` ("Training services", generic)
- No `customer` is passed, so `customer_update` is intentionally **not** set
  (Stripe computes tax from the address typed at checkout). If we ever pass a saved
  customer (e.g. logged-in users), add `customer_update: { address:'auto', name:'auto' }`.
- A free **Pickup — collect in person** shipping option ($0) is offered.

## ⚠️ MUST be done in the Stripe Dashboard (not via API) — tax is $0 until then
Even with correct code, Stripe returns **$0 tax** unless all of these are configured:
1. **Stripe Tax is turned on** (Dashboard → Tax).
2. **Origin / head-office address** is set (Tax → Settings).
3. **Tax registrations** are added (Tax → Registrations):
   - **GST/HST** (federal) — required.
   - **QST** (Quebec) and **PST** (e.g. BC) — only for provinces where we're registered.
   - Stripe only charges tax in jurisdictions we've registered. No registration = $0.
4. A **default product tax category** set as a safety net (Tax → Settings).

## ⚠️ Outstanding code work (not yet done)
- **Other checkout routes are missing tax config** — apply the same
  `automatic_tax` + `billing_address_collection` + `tax_behavior` + `tax_code`:
  - `app/api/osce-mock/checkout/route.ts` — has **none**
  - `app/api/afk-subjects/checkout/route.ts` — has **none**
  - `app/api/acj-programs/checkout/route.ts` — has **none**
  - `app/api/ce-courses/checkout/route.ts` — has `automatic_tax`/`tax_behavior` but **no `tax_code`**
- **Installment future payments** — the 6 later installment charges are manual
  **Stripe Payment Links** (external `make_links.py`, not in this repo). Each of those
  links must also set `automatic_tax` + `billing_address_collection`, or the future
  payments are taxed **$0** (webhook `app/api/stripe/webhook/route.ts` reads
  `total_details.amount_tax`, which is 0 when the link has no Stripe Tax).

## Testing (test mode only)
No Stripe key is stored locally (`.env.local` has only Supabase/Vercel vars; the
Stripe key lives in Vercel). To test, add a `sk_test_...` key to the environment and
create sessions with Canadian billing addresses in **ON** (13% HST), **BC**
(5% GST + 7% PST if registered), **QC** (5% GST + 9.975% QST), and **AB** (5% GST);
confirm `total_details.amount_tax` updates as the postal code/province is entered.
Never use the live key for test checkouts.
