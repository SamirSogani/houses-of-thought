// Examples gallery (/examples). Pre-login proof surface: a filterable grid of
// completed houses, each linking into the read-only detail render. Data is
// static (lib/examples/data.ts); strength is computed from the house content so
// the badges match what the detail page shows.
//
// Server component: the filter state lives in <ExampleGrid> (a client child) so
// this page can export metadata, which a 'use client' page cannot (seo #6).

import type { Metadata } from 'next'
import MarketingHeader from '@/components/marketing/Header'
import MarketingFooter from '@/components/marketing/Footer'
import MarketingCTASection from '@/components/marketing/CTASection'
import { ExampleGrid } from '@/components/examples/ExampleGrid'
import { pageMetadata } from '@/lib/site'

export const metadata: Metadata = pageMetadata({
  title: 'Examples: finished houses you can inspect',
  description:
    'Complete worked examples of structured reasoning: classroom debates, career decisions, ethics and policy questions. Open any to read the perspectives, cited evidence, assumptions, and House Strength.',
  path: '/examples',
  ogTitle: 'Worked examples of structured reasoning',
})

export default function ExamplesPage() {
  return (
    <div style={{ background: '#fff', color: '#000' }}>
      <MarketingHeader variant="subpage" />
      <main id="main">
        <section style={{ paddingBlock: 'clamp(40px, 6vw, 72px)' }}>
          <div className="container">
            {/* Header */}
            <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: '2.4px', textTransform: 'uppercase', color: 'rgba(0,0,0,0.3)' }}>
              Examples
            </p>
            <h1
              style={{
                fontFamily: 'var(--font-serif)',
                fontWeight: 400,
                fontSize: 'clamp(30px, 4vw, 48px)',
                lineHeight: 1.1,
                letterSpacing: '-0.01em',
                color: '#000',
                marginTop: 16,
                maxWidth: '18ch',
              }}
            >
              Reasoning you can actually inspect.
            </h1>
            <p
              style={{
                fontFamily: 'var(--font-body)',
                fontSize: 17,
                color: 'rgba(0,0,0,0.5)',
                marginTop: 14,
                maxWidth: '60ch',
              }}
            >
              Browse finished Houses of Thought across decisions, debates, and classroom
              topics. Open any of them to read the perspectives, check the cited evidence,
              and see how the conclusion holds up.
            </p>

            <ExampleGrid />
          </div>
        </section>

        <MarketingCTASection
          eyebrow="Start"
          heading="Start your own house."
          primaryLabel="Try it free"
          primaryHref="/try"
          secondaryLabel="How it works"
          secondaryHref="/how-it-works"
          note="No sign-up needed to try it. Create a free account when you want to build and save full houses."
        />
      </main>
      <MarketingFooter />
    </div>
  )
}
