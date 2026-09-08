// /contact — the working contact channel both legal documents depend on
// (content review C1: account deletion is "contact us", so this page must
// exist and must work). Direct email instead of a form: there is no form
// backend yet, and a submit button that goes nowhere is exactly the kind of
// theater the 2026-07-19 audit had us remove.

import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/site'
import MarketingHeader from '@/components/marketing/DuskHeader'
import MarketingFooter from '@/components/marketing/DuskFooter'
import MarketingCTASection from '@/components/marketing/DuskCTASection'

export const metadata: Metadata = pageMetadata({
  title: 'Contact',
  description:
    'Get in touch with Houses of Thought: questions, bug reports, account and data requests, or classroom pilots for your school.',
  path: '/contact',
})

const CONTACT_EMAIL = 'samir.sogani@gmail.com'

const cards = [
  {
    label: 'Questions & feedback',
    body: 'Anything about the product, the framework, or where it is heading. Short questions welcome.',
    subject: 'Houses of Thought: question',
  },
  {
    label: 'Educators & classrooms',
    body: 'Interested in running Houses of Thought with a class? Tell us your subject, grade level, and class size.',
    subject: 'Houses of Thought: classroom pilot',
  },
  {
    label: 'Bugs & account requests',
    body: 'Something broken, or an account or data-deletion request (see the Privacy Policy). Include the email on the account.',
    subject: 'Houses of Thought: support',
  },
]

export default function ContactPage() {
  return (
    <div className="dusk-page">
      <MarketingHeader />
      <main id="main">
        <section style={{ paddingBlock: 'clamp(40px, 6vw, 80px)' }}>
          <div className="container">
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--amber)' }}>Contact</p>
            <h1
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 500,
                fontSize: 'clamp(32px, 5vw, 52px)',
                letterSpacing: '-0.015em',
                lineHeight: 1.12,
                color: 'var(--dusk-ink)',
                marginTop: 16,
                maxWidth: '22ch',
              }}
            >
              Talk to the person who builds it.
            </h1>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 17, lineHeight: 1.6, color: 'var(--dusk-ink-mid)', marginTop: 16, maxWidth: '52ch' }}>
              Houses of Thought is independently built, so mail lands with the
              founder, not a ticket queue. Every message gets read.
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginTop: 44 }}>
              {cards.map((c) => (
                <div key={c.label} className="dusk-card" style={{ flex: '1 1 280px', padding: 24 }}>
                  <p
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      textTransform: 'uppercase',
                      letterSpacing: '0.1em',
                      color: 'var(--dusk-ink-subtle)',
                      marginBottom: 8,
                    }}
                  >
                    {c.label}
                  </p>
                  <p style={{ fontFamily: 'var(--font-body)', fontSize: 15, lineHeight: 1.6, color: 'var(--dusk-ink-mid)' }}>{c.body}</p>
                  <a
                    style={{ display: 'inline-block', marginTop: 14, fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14, color: 'var(--amber)', borderBottom: '1px solid var(--amber)', paddingBottom: 2 }}
                    href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(c.subject)}`}
                  >
                    Email us →
                  </a>
                </div>
              ))}
            </div>

            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--dusk-ink-subtle)', marginTop: 28 }}>
              Direct address:{' '}
              <a style={{ color: 'var(--amber)', borderBottom: '1px solid var(--amber)', paddingBottom: 2 }} href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL}
              </a>
            </p>
          </div>
        </section>

        <MarketingCTASection
          eyebrow="Or just try it"
          heading="The product answers most questions."
          primaryLabel="Try it instantly"
          primaryHref="/try"
          secondaryLabel="How it works"
          secondaryHref="/how-it-works"
          note="No sign-up needed to try it."
        />
      </main>
      <MarketingFooter />
    </div>
  )
}
