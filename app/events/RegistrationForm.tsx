'use client'

import { useEffect, useState } from 'react'

type Props = {
  eventSlug: string
  amountLabel: string // e.g. "$50 deposit" or "$395.50 course fee ($350 + HST)"
  confirmLine: string // e.g. "Sunday, October 18, 2026"
}

export default function RegistrationForm({ eventSlug, amountLabel, confirmLine }: Props) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [promoCode, setPromoCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  // After Stripe (or a free registration) redirects back with ?status=confirmed.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('status') === 'confirmed') setConfirmed(true)
  }, [])

  if (confirmed) {
    return (
      <div className="evreg-card evreg-thanks">
        <style>{CSS}</style>
        <div className="evreg-check">✓</div>
        <h3>You&rsquo;re registered!</h3>
        <p>
          Thank you &mdash; your spot is confirmed. We&rsquo;ll email you the event details for
          <strong> {confirmLine}</strong>. See you there!
        </p>
      </div>
    )
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/events/register/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventSlug, fullName, email, phone, promoCode }),
      })
      const data = (await res.json()) as { url?: string; error?: string }
      if (!res.ok || !data.url) {
        setError(data.error || 'Something went wrong. Please try again.')
        setLoading(false)
        return
      }
      window.location.href = data.url
    } catch {
      setError('Network error. Please try again.')
      setLoading(false)
    }
  }

  return (
    <form className="evreg-card evreg-form" onSubmit={onSubmit} noValidate>
      <style>{CSS}</style>
      <h3>Reserve your seat</h3>
      <p className="evreg-sub">
        Register with a <strong>{amountLabel}</strong>. Enter your details and you&rsquo;ll be taken to a
        secure Stripe checkout.
      </p>

      <label>
        Full name
        <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)}
          placeholder="Dr. Jane Smith" autoComplete="name" required />
      </label>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com" autoComplete="email" required />
      </label>
      <label>
        Phone
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
          placeholder="(555) 123-4567" autoComplete="tel" required />
      </label>
      <label>
        Promotion code <span className="evreg-optional">(optional)</span>
        <input type="text" value={promoCode} onChange={(e) => setPromoCode(e.target.value)}
          placeholder="Enter code" autoComplete="off" autoCapitalize="none" />
      </label>

      {error && <div className="evreg-error">{error}</div>}

      <button type="submit" disabled={loading}>
        {loading ? 'Processing…' : 'Continue →'}
      </button>
      <p className="evreg-secure">🔒 Secure payment by Stripe</p>
    </form>
  )
}

const CSS = `
.evreg-card{background:#fff;color:#0a1a3c;border-radius:14px;padding:26px;box-shadow:0 16px 50px rgba(0,0,0,.4);}
.evreg-form h3{margin:0 0 6px;font-size:20px;}
.evreg-sub{margin:0 0 18px;font-size:14px;color:#5b6b7c;}
.evreg-form label{display:block;font-size:13px;font-weight:bold;color:#33465a;margin-bottom:14px;}
.evreg-optional{font-weight:normal;color:#8a97a6;}
.evreg-form input{width:100%;margin-top:6px;padding:12px 13px;border:1px solid #cfd8e3;border-radius:8px;font-size:15px;font-weight:normal;color:#0a1a3c;box-sizing:border-box;}
.evreg-form input:focus{outline:none;border-color:#2f6df6;box-shadow:0 0 0 3px rgba(47,109,246,.18);}
.evreg-form button{width:100%;margin-top:6px;background:#0a1a3c;color:#fff;border:0;border-radius:9px;padding:15px;font-size:16px;font-weight:bold;cursor:pointer;transition:background .15s;}
.evreg-form button:hover:not(:disabled){background:#12305f;}
.evreg-form button:disabled{opacity:.6;cursor:default;}
.evreg-error{background:#fdeaea;color:#a11;border:1px solid #f3c4c4;border-radius:8px;padding:10px 12px;font-size:14px;margin-bottom:14px;}
.evreg-secure{text-align:center;font-size:12px;color:#8a97a6;margin:12px 0 0;}
.evreg-thanks{text-align:center;}
.evreg-check{width:56px;height:56px;border-radius:50%;background:#0b8a3b;color:#fff;font-size:30px;line-height:56px;margin:0 auto 14px;}
.evreg-thanks h3{margin:0 0 8px;font-size:22px;}
.evreg-thanks p{color:#5b6b7c;font-size:15px;margin:0;}
`
