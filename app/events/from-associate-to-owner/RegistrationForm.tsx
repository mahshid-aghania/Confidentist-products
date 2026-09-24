'use client'

import { useEffect, useState } from 'react'

export default function RegistrationForm() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  // After Stripe redirects back with ?status=confirmed, show a thank-you state.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('status') === 'confirmed') setConfirmed(true)
  }, [])

  if (confirmed) {
    return (
      <div className="fa2o-card fa2o-thanks">
        <div className="fa2o-thanks-check">✓</div>
        <h3>You&rsquo;re registered!</h3>
        <p>
          Thank you &mdash; your seat deposit is confirmed. We&rsquo;ll email you the event details for
          <strong> Sunday, September 27, 2026</strong>. See you there!
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
        body: JSON.stringify({ fullName, email, phone }),
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
    <form className="fa2o-card fa2o-form" onSubmit={onSubmit} noValidate>
      <h3>Reserve your seat</h3>
      <p className="fa2o-form-sub">
        Secure your spot with a <strong>$50 deposit</strong>. Enter your details and you&rsquo;ll be taken to
        a secure Stripe checkout.
      </p>

      <label>
        Full name
        <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Dr. Jane Smith"
          autoComplete="name"
          required
        />
      </label>

      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          required
        />
      </label>

      <label>
        Phone
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(555) 123-4567"
          autoComplete="tel"
          required
        />
      </label>

      {error && <div className="fa2o-error">{error}</div>}

      <button type="submit" disabled={loading}>
        {loading ? 'Redirecting to checkout…' : 'Continue to $50 deposit →'}
      </button>
      <p className="fa2o-promo-note">🎟️ Have a promotion code? You can apply it on the next step.</p>
      <p className="fa2o-secure">🔒 Secure payment by Stripe</p>
    </form>
  )
}
