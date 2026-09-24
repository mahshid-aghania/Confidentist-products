import type { Metadata } from 'next'
import RegistrationForm from './RegistrationForm'

export const metadata: Metadata = {
  title: 'From Associate to Owner — Building Your Successful Dental Clinic | ConfiDentist',
  description:
    'A free educational event for dentists ready to open or buy their own practice. Sunday, September 27, 2026 · Medline Sinclair Branch, Mississauga · 4 CE Credits. Reserve your seat with a $50 deposit.',
}

const AGENDA = [
  'Accounting & financial planning',
  'Financing & banking',
  'Insurance & risk management',
  'Legal considerations',
  'Commercial real estate & site selection',
  'Dental office design & equipment',
  'Construction & build-out',
  'Practice operations',
  'Expert Panel & Q&A',
]

const FACTS = [
  { icon: '📅', label: 'Date', value: 'Sunday, September 27, 2026' },
  { icon: '🕚', label: 'Time', value: '11:00 AM – 3:00 PM' },
  { icon: '📍', label: 'Location', value: 'Medline Sinclair Branch · 90 Skyway Drive, Mississauga, ON L5W 0H2' },
  { icon: '🎓', label: 'Credits', value: '4 CE Credits · Category 3' },
]

export default function Page() {
  return (
    <main className="fa2o">
      <style>{CSS}</style>

      {/* Brand bar */}
      <div className="fa2o-brandbar">
        <span className="fa2o-brand">MEDLINE&nbsp;SINCLAIR</span>
        <span className="fa2o-brand-x">×</span>
        <span className="fa2o-brand fa2o-brand-gold">ConfiDentist</span>
      </div>

      {/* Hero */}
      <section className="fa2o-hero">
        <div className="fa2o-hero-media">
          <img
            src="/images/events/from-associate-to-owner.png"
            alt="From Associate to Owner — Building Your Successful Dental Clinic"
          />
        </div>
        <div className="fa2o-hero-copy">
          <div className="fa2o-badge">FREE FOR DENTISTS</div>
          <h1>
            From Associate to Owner
            <span>Building Your Successful Dental Clinic</span>
          </h1>
          <p className="fa2o-lede">
            Thinking about opening or purchasing your own dental practice? Join us for an exclusive
            educational event designed for dentists ready to take the next step toward ownership.
          </p>
          <ul className="fa2o-facts">
            {FACTS.map((f) => (
              <li key={f.label}>
                <span className="fa2o-fact-icon">{f.icon}</span>
                <span>
                  <strong>{f.label}</strong>
                  {f.value}
                </span>
              </li>
            ))}
          </ul>
          <a href="#register" className="fa2o-cta">
            Reserve your seat — $50 deposit →
          </a>
        </div>
      </section>

      {/* About + agenda */}
      <section className="fa2o-section">
        <h2>What you&rsquo;ll learn</h2>
        <p className="fa2o-section-lede">
          Hear directly from industry professionals covering the essential areas of building and owning a
          successful dental clinic:
        </p>
        <ul className="fa2o-agenda">
          {AGENDA.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="fa2o-included">
          🥂 Brunch, networking &amp; certificate presentation included.
        </p>
      </section>

      {/* Register */}
      <section id="register" className="fa2o-section fa2o-register">
        <div className="fa2o-register-inner">
          <div className="fa2o-register-copy">
            <h2>Reserve your seat</h2>
            <p>
              This event is <strong>free for dentists</strong>. A refundable <strong>$50 deposit</strong>{' '}
              holds your seat and is confirmed instantly through secure Stripe checkout. Enter your details
              to continue.
            </p>
            <ul className="fa2o-register-points">
              <li>✓ 4 CE Credits (Category 3)</li>
              <li>✓ Brunch &amp; networking</li>
              <li>✓ Certificate presentation</li>
            </ul>
          </div>
          <RegistrationForm />
        </div>
      </section>

      <footer className="fa2o-footer">
        Medline Sinclair × ConfiDentist &nbsp;·&nbsp; confidentist.ca
      </footer>
    </main>
  )
}

const CSS = `
.fa2o{--navy:#0a1a3c;--navy2:#0b2350;--gold:#d6b25e;--gold2:#c79a3f;--ink:#0a1a3c;
  margin:0;background:var(--navy);color:#eef2f8;font-family:Arial,Helvetica,sans-serif;line-height:1.55;}
.fa2o *{box-sizing:border-box;}
.fa2o img{max-width:100%;display:block;}
.fa2o-brandbar{display:flex;align-items:center;gap:12px;justify-content:center;padding:16px;
  background:#06122b;font-size:13px;letter-spacing:2px;color:#cbd5e6;border-bottom:1px solid #16294d;}
.fa2o-brand-gold{color:var(--gold);}
.fa2o-brand-x{opacity:.5;}
.fa2o-hero{display:grid;grid-template-columns:1fr 1fr;gap:36px;max-width:1080px;margin:0 auto;padding:44px 24px;align-items:center;}
.fa2o-hero-media img{border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.45);width:100%;}
.fa2o-badge{display:inline-block;background:var(--gold);color:#1a1205;font-weight:bold;font-size:12px;
  letter-spacing:1.5px;padding:7px 14px;border-radius:6px;margin-bottom:16px;}
.fa2o-hero-copy h1{font-size:40px;line-height:1.08;margin:0 0 16px;color:#fff;text-transform:uppercase;letter-spacing:.5px;}
.fa2o-hero-copy h1 span{display:block;font-size:22px;color:var(--gold);text-transform:none;letter-spacing:0;margin-top:8px;font-weight:bold;}
.fa2o-lede{font-size:16px;color:#cdd6e6;margin:0 0 22px;}
.fa2o-facts{list-style:none;padding:0;margin:0 0 26px;display:grid;gap:12px;}
.fa2o-facts li{display:flex;gap:12px;align-items:flex-start;font-size:15px;}
.fa2o-fact-icon{font-size:18px;line-height:1.4;}
.fa2o-facts strong{display:block;color:var(--gold);font-size:12px;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px;}
.fa2o-cta{display:inline-block;background:var(--gold);color:#1a1205;text-decoration:none;font-weight:bold;
  font-size:16px;padding:15px 30px;border-radius:9px;transition:background .15s;}
.fa2o-cta:hover{background:#e7c982;}
.fa2o-section{max-width:1080px;margin:0 auto;padding:28px 24px 44px;}
.fa2o-section h2{font-size:26px;color:#fff;margin:0 0 10px;}
.fa2o-section-lede{color:#cdd6e6;margin:0 0 20px;max-width:720px;}
.fa2o-agenda{list-style:none;padding:0;margin:0 0 22px;display:grid;grid-template-columns:repeat(2,1fr);gap:12px;}
.fa2o-agenda li{background:var(--navy2);border:1px solid #1c355f;border-radius:9px;
  padding:14px 16px;font-size:15px;position:relative;padding-left:40px;}
.fa2o-agenda li:before{content:"✓";position:absolute;left:15px;color:var(--gold);font-weight:bold;}
.fa2o-included{font-size:15px;color:#e9dcbb;}
.fa2o-register{background:#06122b;border-top:1px solid #16294d;border-bottom:1px solid #16294d;max-width:none;}
.fa2o-register-inner{max-width:1080px;margin:0 auto;padding:44px 24px;display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:start;}
.fa2o-register-copy h2{font-size:28px;color:#fff;margin:0 0 12px;}
.fa2o-register-copy p{color:#cdd6e6;margin:0 0 18px;}
.fa2o-register-points{list-style:none;padding:0;margin:0;display:grid;gap:9px;color:#e9dcbb;font-size:15px;}
.fa2o-card{background:#fff;color:var(--ink);border-radius:14px;padding:26px;box-shadow:0 16px 50px rgba(0,0,0,.4);}
.fa2o-form h3{margin:0 0 6px;font-size:20px;}
.fa2o-form-sub{margin:0 0 18px;font-size:14px;color:#5b6b7c;}
.fa2o-form label{display:block;font-size:13px;font-weight:bold;color:#33465a;margin-bottom:14px;}
.fa2o-form input{width:100%;margin-top:6px;padding:12px 13px;border:1px solid #cfd8e3;border-radius:8px;
  font-size:15px;font-weight:normal;color:#0a1a3c;}
.fa2o-form input:focus{outline:none;border-color:var(--gold2);box-shadow:0 0 0 3px rgba(199,154,63,.18);}
.fa2o-form button{width:100%;margin-top:6px;background:var(--navy);color:#fff;border:0;border-radius:9px;
  padding:15px;font-size:16px;font-weight:bold;cursor:pointer;transition:background .15s;}
.fa2o-form button:hover:not(:disabled){background:#12305f;}
.fa2o-form button:disabled{opacity:.6;cursor:default;}
.fa2o-error{background:#fdeaea;color:#a11;border:1px solid #f3c4c4;border-radius:8px;padding:10px 12px;font-size:14px;margin-bottom:14px;}
.fa2o-secure{text-align:center;font-size:12px;color:#8a97a6;margin:12px 0 0;}
.fa2o-thanks{text-align:center;}
.fa2o-thanks-check{width:56px;height:56px;border-radius:50%;background:#0b8a3b;color:#fff;font-size:30px;
  line-height:56px;margin:0 auto 14px;}
.fa2o-thanks h3{margin:0 0 8px;font-size:22px;color:#0a1a3c;}
.fa2o-thanks p{color:#5b6b7c;font-size:15px;margin:0;}
.fa2o-footer{text-align:center;padding:26px;font-size:13px;color:#8fa0bd;background:#06122b;}
@media (max-width:820px){
  .fa2o-hero{grid-template-columns:1fr;}
  .fa2o-hero-copy h1{font-size:32px;}
  .fa2o-agenda{grid-template-columns:1fr;}
  .fa2o-register-inner{grid-template-columns:1fr;}
}
`
