import { useState, useEffect, useRef } from 'react'
import { Locale, locales, translations } from './i18n'

const ACCENT = '#00d4ff'
const ACCENT2 = '#7c3aed'

// ─── Reveal hook ─────────────────────────────────────────────────────────────
function useReveal() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { el.classList.add('visible'); obs.disconnect() } },
      { threshold: 0.12 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return ref
}

function Reveal({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useReveal()
  return (
    <div ref={ref as any} className={`reveal ${className}`}>
      {children}
    </div>
  )
}

// ─── Line animation ─────────────────────────────────────────────────────────
function LineSim({ t }: { t: typeof translations['zh-CN'] }) {
  return (
    <div style={{ textAlign: 'center', padding: '4rem 0' }}>
      <div style={{ fontSize: '0.8rem', fontWeight: 700, color: ACCENT, letterSpacing: 2, marginBottom: '2rem' }}>
        {t.aboutVisual}
      </div>
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', justifyContent: 'center' }}>
        {['SPI','SMT','AOI','ICT','FCT','FQC','PACK'].map((s, i) => (
          <div key={s} style={{
            width: 52, borderRadius: 8,
            background: 'var(--surface2)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.65rem', color: 'var(--muted)', fontWeight: 600,
            height: [56,72,48,80,64,52,76][i],
            animation: `stationPulse 2s ease-in-out ${i * 0.2}s infinite`,
          }}>{s}</div>
        ))}
      </div>
      <div style={{ fontSize: '0.7rem', color: 'var(--muted)', marginTop: '1.5rem' }}>{t.aboutVisual2}</div>
    </div>
  )
}

// ─── Job data ────────────────────────────────────────────────────────────────
const JOBS = [
  { id: 1, titleKey: 'job1Title' as const, salaryKey: 'job1Salary' as const, tags: ['SMT','AOI','Process'], type: 'jobEngineer', loc: 'jobLocation' },
  { id: 2, titleKey: 'job2Title' as const, salaryKey: 'job2Salary' as const, tags: ['AOI','SPI','Equipment'], type: 'jobEngineer', loc: 'jobLocation' },
  { id: 3, titleKey: 'job3Title' as const, salaryKey: 'job3Salary' as const, tags: ['WMS','Warehouse','Logistics'], type: 'jobAdmin', loc: 'jobLocation' },
  { id: 4, titleKey: 'job4Title' as const, salaryKey: 'job4Salary' as const, tags: ['Production','Line','Operator'], type: 'jobOperator', loc: 'jobLocation' },
  { id: 5, titleKey: 'job5Title' as const, salaryKey: 'job5Salary' as const, tags: ['QC','IQC','IPQC'], type: 'jobEngineer', loc: 'jobLocation' },
  { id: 6, titleKey: 'job6Title' as const, salaryKey: 'job6Salary' as const, tags: ['MES','IT','Maintenance'], type: 'jobEngineer', loc: 'jobLocation' },
]

// ─── Nav ─────────────────────────────────────────────────────────────────────
function Nav({ locale, onLang }: { locale: Locale; onLang: (l: Locale) => void }) {
  const t = translations[locale]
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', h)
    return () => window.removeEventListener('scroll', h)
  }, [])

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <>
      {/* Lang bar */}
      <div style={{
        position: 'fixed', top: 0, right: 0, zIndex: 200,
        display: 'flex', padding: '0.5rem 0.75rem',
      }}>
        {(Object.keys(locales) as Locale[]).map(l => (
          <button key={l} onClick={() => onLang(l)}
            style={{
              background: locale === l ? ACCENT : 'transparent',
              border: `1px solid ${locale === l ? ACCENT : 'var(--border)'}`,
              color: locale === l ? '#000' : 'var(--muted)',
              padding: '0.3rem 0.75rem', fontSize: '0.75rem', fontWeight: 600,
              cursor: 'pointer', transition: 'all 0.2s', fontFamily: 'inherit',
              borderLeft: l !== 'zh-CN' ? 'none' : undefined,
              borderRadius: l === 'zh-CN' ? '6px 0 0 6px' : l === 'en-US' ? '0 6px 6px 0' : '0',
            }}>
            {locales[l]}
          </button>
        ))}
      </div>

      {/* Nav */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        background: scrolled ? 'rgba(10,10,15,0.95)' : 'rgba(10,10,15,0.85)',
        backdropFilter: 'blur(20px)', borderBottom: '1px solid var(--border)',
        padding: '0 2rem', transition: 'all 0.3s',
      }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64 }}>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: -0.5 }}>
            <span style={{ background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT2})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{t.logo}</span>
            <span style={{ color: 'var(--muted)', fontWeight: 400 }}> {t.logoSub}</span>
          </div>
          <div style={{ display: 'flex', gap: '2rem', listStyle: 'none', alignItems: 'center' }} className="nav-links">
            {(['about','jobs','benefits','culture','contact'] as const).map((id, i) => (
              <a key={id} onClick={() => scrollTo(id)} style={{
                color: 'var(--muted)', textDecoration: 'none', fontSize: '0.875rem',
                fontWeight: 500, cursor: 'pointer', transition: 'color 0.2s',
              }}
                onMouseOver={e => (e.currentTarget.style.color = ACCENT)}
                onMouseOut={e => (e.currentTarget.style.color = 'var(--muted)')}>
                {[t.navAbout, t.navJobs, t.navBenefits, t.navCulture, t.navContact][i]}
              </a>
            ))}
          </div>
          <button onClick={() => scrollTo('contact')} style={{
            background: ACCENT, color: '#000', padding: '0.5rem 1.25rem',
            borderRadius: 8, fontWeight: 600, fontSize: '0.875rem',
            border: 'none', cursor: 'pointer', transition: 'all 0.2s',
          }}
            onMouseOver={e => { (e.currentTarget as HTMLButtonElement).style.background = '#fff' }}
            onMouseOut={e => { (e.currentTarget as HTMLButtonElement).style.background = ACCENT }}>
            {t.navApply}
          </button>
        </div>
      </nav>
    </>
  )
}

// ─── Hero ────────────────────────────────────────────────────────────────────
function Hero({ t }: { t: typeof translations['zh-CN'] }) {
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  return (
    <section style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      textAlign: 'center', padding: '8rem 2rem 4rem', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.03,
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)',
        backgroundSize: '60px 60px',
      }} />
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none',
        background: `radial-gradient(ellipse 80% 50% at 50% -10%, rgba(0,212,255,0.15), transparent), radial-gradient(ellipse 60% 40% at 80% 60%, rgba(124,58,237,0.08), transparent)`,
      }} />
      <div style={{ position: 'relative', zIndex: 2, maxWidth: 800 }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
          background: 'var(--surface2)', border: '1px solid var(--border)',
          padding: '0.375rem 1rem', borderRadius: 100, fontSize: '0.8rem',
          color: ACCENT, fontWeight: 500, marginBottom: '1.5rem',
        }}>
          <div style={{ width: 8, height: 8, background: '#22c55e', borderRadius: '50%', animation: 'pulse 2s infinite' }} />
          {t.heroBadge}
        </div>
        <h1 style={{ fontSize: 'clamp(2.5rem, 6vw, 4.5rem)', fontWeight: 900, letterSpacing: -2, lineHeight: 1.05, marginBottom: '1.5rem' }}>
          <span style={{ display: 'block' }}>{t.heroTitle1}</span>
          <span style={{
            display: 'block', background: `linear-gradient(135deg, ${ACCENT} 0%, #a855f7 50%, ${ACCENT} 100%)`,
            backgroundSize: '200% auto', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            animation: 'shimmer 3s linear infinite',
          }}>{t.heroTitle2}</span>
        </h1>
        <p style={{ fontSize: '1.2rem', color: 'var(--muted)', maxWidth: 560, margin: '0 auto 2.5rem', lineHeight: 1.7 }}>
          {t.heroDesc}
        </p>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => scrollTo('jobs')} style={{
            background: ACCENT, color: '#000', padding: '0.875rem 2rem', borderRadius: 10,
            fontWeight: 700, fontSize: '1rem', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '0.5rem', transition: 'all 0.2s',
          }}
            onMouseOver={e => { const b = e.currentTarget; b.style.background = '#fff'; b.style.transform = 'translateY(-2px)'; b.style.boxShadow = `0 8px 30px rgba(0,212,255,0.3)` }}
            onMouseOut={e => { const b = e.currentTarget; b.style.background = ACCENT; b.style.transform = ''; b.style.boxShadow = '' }}>
            {t.heroCta1}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </button>
          <button onClick={() => scrollTo('about')} style={{
            background: 'transparent', color: 'var(--text)', padding: '0.875rem 2rem', borderRadius: 10,
            fontWeight: 600, fontSize: '1rem', border: '1px solid var(--border)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '0.5rem', transition: 'all 0.2s',
          }}
            onMouseOver={e => { const b = e.currentTarget; b.style.borderColor = ACCENT; b.style.color = ACCENT }}
            onMouseOut={e => { const b = e.currentTarget; b.style.borderColor = 'var(--border)'; b.style.color = 'var(--text)' }}>
            {t.heroCta2}
          </button>
        </div>
      </div>
    </section>
  )
}

// ─── Stats ───────────────────────────────────────────────────────────────────
function Stats({ t }: { t: typeof translations['zh-CN'] }) {
  return (
    <div style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', padding: '2rem' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '2rem', textAlign: 'center' }}>
        {[
          { n: '4', l: t.statLines },
          { n: '32', l: t.statStations },
          { n: '500+', l: t.statEmployees },
          { n: '24/7', l: t.statMonitor },
        ].map(s => (
          <div key={s.l}>
            <div style={{ fontSize: '2.5rem', fontWeight: 800, letterSpacing: -1, background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT2})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{s.n}</div>
            <div style={{ fontSize: '0.875rem', color: 'var(--muted)', marginTop: '0.25rem' }}>{s.l}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── About ───────────────────────────────────────────────────────────────────
function About({ t }: { t: typeof translations['zh-CN'] }) {
  return (
    <section id="about" style={{ padding: '6rem 2rem' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <Reveal>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4rem', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', color: ACCENT, marginBottom: '0.75rem' }}>{t.aboutLabel}</div>
              <h2 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 800, letterSpacing: -1, lineHeight: 1.15, marginBottom: '1.5rem', whiteSpace: 'pre-line' }}>{t.aboutTitle}</h2>
              <p style={{ color: 'var(--muted)', fontSize: '1.05rem', lineHeight: 1.7, marginBottom: '1rem' }}>{t.aboutDesc1}</p>
              <p style={{ color: 'var(--muted)', fontSize: '1.05rem', lineHeight: 1.7 }}>{t.aboutDesc2}</p>
            </div>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
              <LineSim t={t} />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

// ─── Jobs ────────────────────────────────────────────────────────────────────
function Jobs({ t }: { t: typeof translations['zh-CN'] }) {
  return (
    <section id="jobs" style={{ padding: '6rem 2rem', background: 'var(--surface)' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <Reveal>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', color: ACCENT, marginBottom: '0.75rem' }}>{t.jobsLabel}</div>
          <h2 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 800, letterSpacing: -1, lineHeight: 1.15, marginBottom: '1rem' }}>{t.jobsTitle}</h2>
          <p style={{ color: 'var(--muted)', fontSize: '1.05rem', maxWidth: 560, lineHeight: 1.7 }}>{t.jobsDesc}</p>
        </Reveal>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1.25rem', marginTop: '3rem' }}>
          {JOBS.map((job, i) => (
            <Reveal key={job.id}>
              <div style={{
                background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 14,
                padding: '1.75rem', cursor: 'pointer', transition: 'all 0.25s', position: 'relative', overflow: 'hidden',
              }}
                onMouseOver={e => { const d = e.currentTarget as HTMLDivElement; d.style.borderColor = 'rgba(0,212,255,0.3)'; d.style.transform = 'translateY(-3px)'; const b = d.querySelector('.job-top') as HTMLElement; if(b) b.style.opacity = '1' }}
                onMouseOut={e => { const d = e.currentTarget as HTMLDivElement; d.style.borderColor = 'var(--border)'; d.style.transform = ''; const b = d.querySelector('.job-top') as HTMLElement; if(b) b.style.opacity = '0' }}>
                <div className="job-top" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${ACCENT}, ${ACCENT2})`, opacity: 0, transition: 'opacity 0.25s' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', gap: '1rem' }}>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{t[job.titleKey]}</div>
                  <div style={{ background: 'rgba(0,212,255,0.1)', color: ACCENT, padding: '0.25rem 0.75rem', borderRadius: 6, fontSize: '0.8rem', fontWeight: 700, whiteSpace: 'nowrap' }}>{t[job.salaryKey]}</div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.25rem' }}>
                  {job.tags.map(tag => (
                    <span key={tag} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', padding: '0.25rem 0.625rem', borderRadius: 6, fontSize: '0.75rem', color: 'var(--muted)' }}>{tag}</span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: 'var(--muted)', flexWrap: 'wrap' }}>
                  <span>📍 {t[job.loc]}</span>
                  <span>👔 {t[job.type]}</span>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Benefits ────────────────────────────────────────────────────────────────
function Benefits({ t }: { t: typeof translations['zh-CN'] }) {
  const cards = [
    { icon: '💰', title: t.benefit1Title, desc: t.benefit1Desc },
    { icon: '📈', title: t.benefit2Title, desc: t.benefit2Desc },
    { icon: '🔧', title: t.benefit3Title, desc: t.benefit3Desc },
    { icon: '🏢', title: t.benefit4Title, desc: t.benefit4Desc },
    { icon: '🏥', title: t.benefit5Title, desc: t.benefit5Desc },
    { icon: '🤝', title: t.benefit6Title, desc: t.benefit6Desc },
  ]
  return (
    <section id="benefits" style={{ padding: '6rem 2rem' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <Reveal>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', color: ACCENT, marginBottom: '0.75rem' }}>{t.benefitsLabel}</div>
          <h2 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 800, letterSpacing: -1, lineHeight: 1.15 }}>{t.benefitsTitle}</h2>
        </Reveal>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem', marginTop: '3rem' }}>
          {cards.map((c, i) => (
            <Reveal key={i}>
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '1.5rem', transition: 'all 0.2s' }}
                onMouseOver={e => { const d = e.currentTarget as HTMLDivElement; d.style.borderColor = 'rgba(0,212,255,0.3)'; d.style.transform = 'translateY(-2px)' }}
                onMouseOut={e => { const d = e.currentTarget as HTMLDivElement; d.style.borderColor = 'var(--border)'; d.style.transform = '' }}>
                <div style={{ width: 48, height: 48, borderRadius: 10, background: `linear-gradient(135deg, rgba(0,212,255,0.15), rgba(124,58,237,0.1))`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1rem', fontSize: '1.4rem' }}>{c.icon}</div>
                <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.5rem' }}>{c.title}</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--muted)', lineHeight: 1.6 }}>{c.desc}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Culture ─────────────────────────────────────────────────────────────────
function Culture({ t }: { t: typeof translations['zh-CN'] }) {
  const cards = [
    { num: '01', title: t.culture1Title, desc: t.culture1Desc },
    { num: '02', title: t.culture2Title, desc: t.culture2Desc },
    { num: '03', title: t.culture3Title, desc: t.culture3Desc },
  ]
  return (
    <section id="culture" style={{ padding: '6rem 2rem', background: 'var(--surface)' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <Reveal>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', color: ACCENT, marginBottom: '0.75rem' }}>{t.cultureLabel}</div>
          <h2 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 800, letterSpacing: -1, lineHeight: 1.15 }}>{t.cultureTitle}</h2>
        </Reveal>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem', marginTop: '3rem' }}>
          {cards.map((c, i) => (
            <Reveal key={i}>
              <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: '2rem', position: 'relative', overflow: 'hidden', transition: 'all 0.25s' }}
                onMouseOver={e => { const d = e.currentTarget as HTMLDivElement; d.style.borderColor = 'rgba(0,212,255,0.3)'; d.style.transform = 'translateY(-2px)' }}
                onMouseOut={e => { const d = e.currentTarget as HTMLDivElement; d.style.borderColor = 'var(--border)'; d.style.transform = '' }}>
                <div style={{ fontSize: '4rem', fontWeight: 900, opacity: 0.04, position: 'absolute', top: '-0.5rem', right: '1rem', lineHeight: 1 }}>{c.num}</div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 700, marginBottom: '0.75rem' }}>{c.title}</h3>
                <p style={{ fontSize: '0.875rem', color: 'var(--muted)', lineHeight: 1.7 }}>{c.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Contact ─────────────────────────────────────────────────────────────────
function Contact({ t }: { t: typeof translations['zh-CN'] }) {
  const [submitted, setSubmitted] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', phone: '', position: '', message: '' })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    setTimeout(() => setSubmitted(false), 5000)
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8,
    padding: '0.75rem 1rem', color: 'var(--text)', fontSize: '0.9rem', fontFamily: 'inherit',
    transition: 'border-color 0.2s', width: '100%',
  }

  return (
    <section id="contact" style={{ padding: '6rem 2rem' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <Reveal>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', color: ACCENT, marginBottom: '0.75rem' }}>{t.contactLabel}</div>
          <h2 style={{ fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 800, letterSpacing: -1, lineHeight: 1.15, marginBottom: '1rem' }}>{t.contactTitle}</h2>
          <p style={{ color: 'var(--muted)', fontSize: '1.05rem', maxWidth: 560, lineHeight: 1.7, marginBottom: '3rem' }}>{t.contactDesc}</p>
        </Reveal>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4rem' }}>
          <Reveal>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--muted)' }}>{t.formName}</label>
                  <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required style={inputStyle}
                    onFocus={e => (e.target.style.borderColor = ACCENT)} onBlur={e => (e.target.style.borderColor = 'var(--border)')} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--muted)' }}>{t.formEmail}</label>
                  <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required style={inputStyle}
                    onFocus={e => (e.target.style.borderColor = ACCENT)} onBlur={e => (e.target.style.borderColor = 'var(--border)')} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--muted)' }}>{t.formPhone}</label>
                  <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} style={inputStyle}
                    onFocus={e => (e.target.style.borderColor = ACCENT)} onBlur={e => (e.target.style.borderColor = 'var(--border)')} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--muted)' }}>{t.formPosition}</label>
                  <select value={form.position} onChange={e => setForm({ ...form, position: e.target.value })} style={{ ...inputStyle, cursor: 'pointer' }}
                    onFocus={e => (e.target.style.borderColor = ACCENT)} onBlur={e => (e.target.style.borderColor = 'var(--border)')}>
                    <option value="" style={{ background: 'var(--surface)', color: 'var(--text)' }}>—</option>
                    {JOBS.map(j => <option key={j.id} value={j.titleKey} style={{ background: 'var(--surface)', color: 'var(--text)' }}>{t[j.titleKey]}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--muted)' }}>{t.formMessage}</label>
                <textarea value={form.message} onChange={e => setForm({ ...form, message: e.target.value })} rows={4} style={{ ...inputStyle, resize: 'vertical', minHeight: 120 }}
                  onFocus={e => (e.target.style.borderColor = ACCENT)} onBlur={e => (e.target.style.borderColor = 'var(--border)')} />
              </div>
              <button type="submit" style={{
                background: ACCENT, color: '#000', padding: '0.875rem 2rem', borderRadius: 10,
                fontWeight: 700, fontSize: '1rem', border: 'none', cursor: 'pointer', transition: 'all 0.2s',
                marginTop: '0.5rem',
              }}
                onMouseOver={e => { const b = e.currentTarget; b.style.background = '#fff' }}
                onMouseOut={e => { const b = e.currentTarget; b.style.background = ACCENT }}>
                {t.formSubmit}
              </button>
              {submitted && (
                <div style={{ padding: '1rem', borderRadius: 10, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e', textAlign: 'center', fontWeight: 600 }}>
                  {t.formSuccess}
                </div>
              )}
            </form>
          </Reveal>

          <Reveal>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', justifyContent: 'center' }}>
              {[
                { icon: '📍', label: t.contactAddr, val: t.contactAddrVal },
                { icon: '📞', label: t.contactPhone, val: '+84-222-888-999' },
                { icon: '✉️', label: t.contactEmail, val: 'hr@ruijing-vietnam.com' },
                { icon: '🕐', label: t.contactHours, val: t.contactHoursVal },
              ].map(c => (
                <div key={c.label} style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                  <div style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--surface2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem', flexShrink: 0 }}>{c.icon}</div>
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: '0.25rem' }}>{c.label}</div>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{c.val}</div>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

// ─── Footer ──────────────────────────────────────────────────────────────────
function Footer({ t }: { t: typeof translations['zh-CN'] }) {
  return (
    <footer style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)', padding: '2rem' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{t.footerCopy}</div>
        <div style={{ fontSize: '0.85rem', color: 'var(--muted)' }}>{t.footerBrand}</div>
      </div>
    </footer>
  )
}

// ─── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [locale, setLocale] = useState<Locale>('zh-CN')
  const t = translations[locale]

  return (
    <>
      <style>{`
        :root {
          --bg: #0a0a0f; --surface: #111118; --surface2: #1a1a25;
          --border: #2a2a3a; --accent: #00d4ff; --accent2: #7c3aed;
          --text: #e2e8f0; --muted: #64748b; --success: #22c55e;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html { scroll-behavior: smooth; }
        body { font-family: 'Inter', -apple-system, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; overflow-x: hidden; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes shimmer { to { background-position: 200% center; } }
        @keyframes stationPulse { 0%, 100% { border-color: var(--border); } 50% { border-color: var(--accent); box-shadow: 0 0 12px rgba(0,212,255,0.2); } }
        .reveal { opacity: 0; transform: translateY(24px); transition: opacity 0.6s ease, transform 0.6s ease; }
        .reveal.visible { opacity: 1; transform: translateY(0); }
        @media (max-width: 768px) {
          .nav-links { display: none !important; }
          .stats-inner { grid-template-columns: repeat(2, 1fr) !important; }
          .about-grid, .contact-grid { grid-template-columns: 1fr !important; }
          .culture-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
      <Nav locale={locale} onLang={setLocale} />
      <Hero t={t} />
      <Stats t={t} />
      <About t={t} />
      <Jobs t={t} />
      <Benefits t={t} />
      <Culture t={t} />
      <Contact t={t} />
      <Footer t={t} />
    </>
  )
}
