import type { Metadata } from 'next'
import RegistrationForm from '../RegistrationForm'

export const metadata: Metadata = {
  title: 'Orthodontics & Clear Aligners — Supercharge Your Practice | ConfiDentist',
  description:
    'A hands-on CE course with Dr. Hossein Arbabezadeh (MSc in Orthodontics). Sunday, October 18, 2026 · North York, ON · 5 CE Credits. Course fee $350 + HST.',
}

const TOPICS = [
  { icon: '👥', title: 'Case Selection & Patient Assessment' },
  { icon: '🦷', title: 'Treatment Planning' },
  { icon: '📈', title: 'Clinical Implementation & Case Management' },
  { icon: '💡', title: 'Latest Innovations in Aligner Therapy' },
]

const FACTS = [
  { icon: '🎓', label: 'Credits', value: '5 CE Credits' },
  { icon: '📅', label: 'Date', value: 'Sunday, October 18, 2026' },
  { icon: '🕘', label: 'Time', value: '9:30 AM – 3:30 PM' },
  { icon: '📍', label: 'Location', value: '265 Rimrock Road, Unit 204, North York, ON M3J 3A6' },
  { icon: '💳', label: 'Course fee', value: '$350 + HST ($395.50)' },
]

export default function Page() {
  return (
    <main className="orth">
      <style>{CSS}</style>

      {/* Brand bar */}
      <div className="orth-brandbar">
        <span className="orth-brand orth-brand-blue">ConfiDentist</span>
        <span className="orth-brand-x">×</span>
        <span className="orth-brand">i-VISTA MED</span>
        <span className="orth-brand-x">×</span>
        <span className="orth-brand">EverSmiles</span>
      </div>

      {/* Hero */}
      <section className="orth-hero">
        <div className="orth-hero-media">
          <img
            src="/images/events/orthodontics-clear-aligners.jpeg"
            alt="Orthodontics & Clear Aligners — Supercharge Your Practice with Clear Aligners"
          />
        </div>
        <div className="orth-hero-copy">
          <div className="orth-badge">5 CE CREDITS</div>
          <h1>
            Orthodontics &amp; Clear Aligners
            <span>Supercharge Your Practice with Clear Aligners</span>
          </h1>
          <div className="orth-speaker">
            <strong>Dr. Hossein Arbabezadeh</strong>
            MSc in Orthodontics
          </div>
          <ul className="orth-facts">
            {FACTS.map((f) => (
              <li key={f.label}>
                <span className="orth-fact-icon">{f.icon}</span>
                <span>
                  <strong>{f.label}</strong>
                  {f.value}
                </span>
              </li>
            ))}
          </ul>
          <a href="#register" className="orth-cta">
            Register — $395.50 →
          </a>
        </div>
      </section>

      {/* Topics */}
      <section className="orth-section">
        <h2>What you&rsquo;ll learn</h2>
        <p className="orth-section-lede">
          A practical, full-day course covering everything you need to confidently add clear aligner therapy
          to your practice:
        </p>
        <ul className="orth-topics">
          {TOPICS.map((t) => (
            <li key={t.title}>
              <span className="orth-topic-icon">{t.icon}</span>
              {t.title}
            </li>
          ))}
        </ul>
      </section>

      {/* Register */}
      <section id="register" className="orth-section orth-register">
        <div className="orth-register-inner">
          <div className="orth-register-copy">
            <h2>Reserve your seat</h2>
            <p>
              Course fee is <strong>$350 + HST ($395.50)</strong>, paid securely through Stripe. Enter your
              details to continue.
            </p>
            <ul className="orth-register-points">
              <li>✓ 5 CE Credits</li>
              <li>✓ Led by Dr. Hossein Arbabezadeh, MSc (Orthodontics)</li>
              <li>✓ PACE-approved (EverSmiles · Provider ID# 390645)</li>
            </ul>
          </div>
          <RegistrationForm
            eventSlug="orthodontics-clear-aligners"
            amountLabel="$395.50 course fee ($350 + HST)"
            confirmLine="Sunday, October 18, 2026"
          />
        </div>
      </section>

      <footer className="orth-footer">
        ConfiDentist × i-VISTA MED × EverSmiles &nbsp;·&nbsp; confidentist.ca
      </footer>
    </main>
  )
}

const CSS = `
.orth{--navy:#0a1a3c;--navy2:#0e2452;--blue:#2f6df6;--sky:#59b0ff;--gold:#e0b64d;
  margin:0;background:var(--navy);color:#eef2f8;font-family:Arial,Helvetica,sans-serif;line-height:1.55;}
.orth *{box-sizing:border-box;}
.orth img{max-width:100%;display:block;}
.orth-brandbar{display:flex;align-items:center;gap:12px;justify-content:center;padding:16px;
  background:#06122b;font-size:13px;letter-spacing:1.5px;color:#cbd5e6;border-bottom:1px solid #16294d;flex-wrap:wrap;}
.orth-brand-blue{color:var(--sky);font-weight:bold;}
.orth-brand-x{opacity:.5;}
.orth-hero{display:grid;grid-template-columns:1fr 1fr;gap:36px;max-width:1080px;margin:0 auto;padding:44px 24px;align-items:center;}
.orth-hero-media img{border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.45);width:100%;}
.orth-badge{display:inline-block;background:var(--blue);color:#fff;font-weight:bold;font-size:12px;
  letter-spacing:1.5px;padding:7px 14px;border-radius:6px;margin-bottom:16px;}
.orth-hero-copy h1{font-size:40px;line-height:1.08;margin:0 0 14px;color:#fff;text-transform:uppercase;letter-spacing:.5px;}
.orth-hero-copy h1 span{display:block;font-size:20px;color:var(--sky);text-transform:none;letter-spacing:0;margin-top:8px;font-weight:bold;}
.orth-speaker{margin:0 0 22px;font-size:15px;color:#cdd6e6;border-left:3px solid var(--blue);padding-left:12px;}
.orth-speaker strong{display:block;color:#fff;font-size:17px;}
.orth-facts{list-style:none;padding:0;margin:0 0 26px;display:grid;gap:12px;}
.orth-facts li{display:flex;gap:12px;align-items:flex-start;font-size:15px;}
.orth-fact-icon{font-size:18px;line-height:1.4;}
.orth-facts strong{display:block;color:var(--sky);font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;}
.orth-cta{display:inline-block;background:var(--blue);color:#fff;text-decoration:none;font-weight:bold;
  font-size:16px;padding:15px 30px;border-radius:9px;transition:background .15s;}
.orth-cta:hover{background:#1f5be0;}
.orth-section{max-width:1080px;margin:0 auto;padding:28px 24px 44px;}
.orth-section h2{font-size:26px;color:#fff;margin:0 0 10px;}
.orth-section-lede{color:#cdd6e6;margin:0 0 20px;max-width:720px;}
.orth-topics{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(2,1fr);gap:12px;}
.orth-topics li{background:var(--navy2);border:1px solid #1c355f;border-radius:9px;padding:16px 18px;font-size:15px;
  display:flex;gap:12px;align-items:center;font-weight:bold;}
.orth-topic-icon{font-size:20px;}
.orth-register{background:#06122b;border-top:1px solid #16294d;border-bottom:1px solid #16294d;max-width:none;}
.orth-register-inner{max-width:1080px;margin:0 auto;padding:44px 24px;display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:start;}
.orth-register-copy h2{font-size:28px;color:#fff;margin:0 0 12px;}
.orth-register-copy p{color:#cdd6e6;margin:0 0 18px;}
.orth-register-points{list-style:none;padding:0;margin:0;display:grid;gap:9px;color:#cfe0ff;font-size:15px;}
.orth-footer{text-align:center;padding:26px;font-size:13px;color:#8fa0bd;background:#06122b;}
@media (max-width:820px){
  .orth-hero{grid-template-columns:1fr;}
  .orth-hero-copy h1{font-size:32px;}
  .orth-topics{grid-template-columns:1fr;}
  .orth-register-inner{grid-template-columns:1fr;}
}
`
