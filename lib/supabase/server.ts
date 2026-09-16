import 'server-only'
import { createClient } from '@supabase/supabase-js'

// Server-side Supabase client for use in Server Components, Route Handlers,
// and Server Actions ONLY. Uses the SECRET (service-role) key, which bypasses
// RLS — it must never be imported into client components.
export function createServerClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
}
