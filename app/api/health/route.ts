import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

// End-to-end connectivity check: GET /api/health
// Confirms env vars are wired and that the SECRET key can reach the
// dedicated Confidentist Supabase project (lists Storage buckets).
export async function GET() {
  const env = {
    url: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    publishableKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    serviceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  }

  if (!env.url || !env.serviceRoleKey) {
    return NextResponse.json(
      { ok: false, env, error: 'Missing Supabase env vars in .env.local' },
      { status: 500 }
    )
  }

  try {
    const supabase = createServerClient()
    const { data, error } = await supabase.storage.listBuckets()
    if (error) {
      return NextResponse.json({ ok: false, env, supabaseError: error.message }, { status: 502 })
    }
    return NextResponse.json({
      ok: true,
      project: process.env.NEXT_PUBLIC_SUPABASE_URL,
      env,
      buckets: data.map((b) => b.name),
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, env, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}
