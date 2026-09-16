import { createClient } from '@supabase/supabase-js'

// Browser / client-side Supabase client.
// Uses the PUBLISHABLE (public) key — safe to expose. Access is governed by RLS.
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
)
