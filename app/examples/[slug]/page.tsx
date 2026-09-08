// Read-only render of a finished house (/examples/[slug]). Mirrors the post-login
// Build workspace layer by layer (see components/build/layers/*), minus the edit
// controls. Server component over static fixtures (lib/examples/data.ts). The
// AI-in-schools house renders verbatim from the stored Build content.

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import MarketingHeader from '@/components/marketing/Header'
import MarketingFooter from '@/components/marketing/Footer'
import MarketingCTASection from '@/components/marketing/CTASection'
import { examples, getExample } from '@/lib/examples/data'
import { absoluteUrl } from '@/lib/site'
import { ReadOnlyHouse, monoLabel } from '@/components/house-detail/ReadOnlyHouse'

export function generateStaticParams() {
  return examples.map((e) => ({ slug: e.slug }))
}

// Per-example metadata (seo #2, aeo C3). These are the richest pages on the
// site — a full rendered house each — and previously all shared the site-wide
// title, so they were invisible to search as distinct documents.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const example = getExample(slug)
  if (!example) return {}
  const title = example.house.title || 'Example house'
  return {
    title,
    description: `A worked example: ${example.summary} See the perspectives, cited evidence, assumptions, and House Strength behind the conclusion.`,
    alternates: { canonical: `/examples/${slug}` },
    openGraph: {
      type: 'article',
      title,
      description: example.summary,
      url: `/examples/${slug}`,
    },
  }
}

const jumpLinks = [
  { id: 'frame', label: 'Frame' },
  { id: 'perspectives', label: 'Perspectives' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'assumptions', label: 'Assumptions' },
  { id: 'conclusion', label: 'Conclusion' },
  { id: 'implications', label: 'Implications' },
  { id: 'strength', label: 'House strength' },
]

export default async function ExampleDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const example = getExample(slug)
  if (!example) notFound()

  const h = example.house

  // BreadcrumbList JSON-LD (seo #9): Examples → this house.
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Examples', item: absoluteUrl('/examples') },
      { '@type': 'ListItem', position: 2, name: h.title, item: absoluteUrl(`/examples/${slug}`) },
    ],
  }

  return (
    <div style={{ background: '#fff', color: '#000' }}>
      <MarketingHeader variant="subpage" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <main id="main">
        <section style={{ paddingBlock: 'clamp(28px, 4vw, 48px)' }}>
          <div className="container">
            <Link
              href="/examples"
              style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              ← All examples
            </Link>

            {/* Title band */}
            <div style={{ marginTop: 18 }}>
              <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 5, padding: '3px 9px' }}>
                {example.domain}
              </span>
              <h1
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontWeight: 400,
                  fontSize: 'clamp(28px, 4vw, 44px)',
                  letterSpacing: '-0.015em',
                  color: '#000',
                  lineHeight: 1.15,
                  marginTop: 14,
                }}
              >
                {h.title}
              </h1>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 17, color: 'rgba(0,0,0,0.5)', marginTop: 12, lineHeight: 1.5, maxWidth: '60ch' }}>
                {example.summary}
              </p>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 40, alignItems: 'flex-start', marginTop: 32 }}>
              {/* Sticky jump-link sidebar (wraps above the content on narrow,
                  where .mk-example-aside makes it static so it can't slide
                  over the article) */}
              <aside className="mk-example-aside" style={{ flex: '1 1 190px', maxWidth: 220, position: 'sticky', top: 84 }}>
                <p style={{ ...monoLabel, color: 'rgba(0,0,0,0.35)' }}>On this house</p>
                <nav style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 12 }}>
                  {jumpLinks.map((l) => (
                    <a key={l.id} href={`#${l.id}`} style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'rgba(0,0,0,0.5)', padding: '4px 0' }}>
                      {l.label}
                    </a>
                  ))}
                </nav>
                <Link
                  href="/try"
                  style={{
                    marginTop: 22,
                    display: 'inline-flex',
                    width: '100%',
                    justifyContent: 'center',
                    alignItems: 'center',
                    height: 48,
                    background: '#000',
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: 15,
                    borderRadius: 8,
                  }}
                >
                  Try it free
                </Link>
              </aside>

              {/* House. ReadOnlyHouse (components/house-detail/ReadOnlyHouse.tsx) is
                  shared with /shared/[token], so it renders in the unmodified
                  --ink/--white/--rule palette rather than being recolored here —
                  that palette already reads cleanly on this page's white
                  background. The border below is only a light visual separator
                  from the sidebar, not a "lit card on a dark page" treatment. */}
              <div style={{ flex: '999 1 540px', minWidth: 0, padding: 'clamp(24px, 4vw, 40px)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 'var(--radius-card)' }}>
                <ReadOnlyHouse
                  house={h}
                  purpose={example.purpose}
                  conclusion={example.conclusion}
                  reasoning={example.reasoning}
                  detail={example.detail}
                />
              </div>
            </div>
          </div>
        </section>

        <MarketingCTASection
          eyebrow="Start"
          heading="Build a house like this one."
          primaryLabel="Try it free"
          primaryHref="/try"
          secondaryLabel="Browse more examples"
          secondaryHref="/examples"
          note="No sign-up needed to try it. Create a free account when you want to build and save full houses."
        />
      </main>
      <MarketingFooter />
    </div>
  )
}
