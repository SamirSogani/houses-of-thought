// /how-it-works — the sole methodology explainer (redesign brief: reconcile
// with the old /framework, which described a different feature — the
// post-login House Builder's own layer model — and is now a permanent
// redirect here, see next.config.ts). This page explains the automated
// reasoning pipeline instead: ground truth is lib/ai/reasoning/steps.ts and
// standards.ts, read but never edited (hard constraint).
//
// Page order (deliberate, per review): diagram + why-a-panel context first,
// then the comparison table, then the standards glossary, then a full
// in-depth write-up per layer — each table row and each diagram click links
// down to its matching write-up. Standards content (both the generic
// definitions and the per-layer nuance) lives ONLY in "Meet the nine
// standards" — it is not duplicated into the diagram's click panel or into
// each layer's own write-up.

import type { Metadata } from 'next'
import Link from 'next/link'
import { pageMetadata } from '@/lib/site'
import MarketingHeader from '@/components/marketing/Header'
import MarketingFooter from '@/components/marketing/Footer'
import MarketingCTASection from '@/components/marketing/CTASection'
import Constellation from '@/components/marketing/Constellation'
import DemoVideo from '@/components/marketing/DemoVideo'
import { CONSTELLATION_LAYERS, CONSTELLATION_STANDARDS } from '@/lib/marketing/constellation'

export const metadata: Metadata = pageMetadata({
  title: 'How It Works: the seven-layer reasoning model',
  description:
    'How a Houses of Thought run works, layer by layer: Frame, Breadth Scoping, Perspectives, Global Assumptions, Global Evidence, Conclusions, and Implications. Six of them are checked by a nine-standard independent review panel.',
  path: '/how-it-works',
})

const FAILURE_MODE: Record<string, { label: string; body: string }> = {
  'hard-block': { label: 'Hard-blocks', body: 'Loops until it passes; the run cannot continue on a failed version of this layer.' },
  degrade: { label: 'Drops the failing stance', body: 'The other independent perspectives already provide redundancy, so only the one that failed is dropped.' },
  none: { label: 'No panel', body: 'A single judgment call, made once.' },
}

// Failure mode per layer — paired with CONSTELLATION_LAYERS by id in both the
// comparison table and the in-depth write-ups below, so the two never drift.
const FAILURE_MODE_BY_LAYER: Record<string, keyof typeof FAILURE_MODE> = {
  frame: 'hard-block',
  'breadth-scoping': 'none',
  perspectives: 'degrade',
  'global-assumptions': 'hard-block',
  'global-evidence': 'hard-block',
  conclusions: 'hard-block',
  implications: 'hard-block',
}

const PANELED_LAYERS = CONSTELLATION_LAYERS.filter((l) => l.hasPanel)

// DefinedTermSet JSON-LD (aeo H1) — carries forward the citation surface the
// old /framework page provided, now describing the model this page actually
// explains.
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'DefinedTermSet',
  name: 'Houses of Thought reasoning model',
  description:
    'The seven-layer reasoning model behind Houses of Thought, based on John Trapasso’s classroom model, derived from the Paul–Elder framework for critical thinking.',
  hasDefinedTerm: CONSTELLATION_LAYERS.map((l) => ({
    '@type': 'DefinedTerm',
    name: l.name,
    description: l.job,
  })),
}

export default function HowItWorksPage() {
  return (
    <div style={{ background: '#fff', color: '#000' }}>
      <MarketingHeader variant="subpage" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <main id="main">
        {/* TL;DR callout — the three-sentence summary a scanning visitor reads
            before deciding whether to scroll (September 2026 UX audit, item 4). */}
        <section style={{ paddingBlock: 'clamp(40px, 7vw, 72px) 0' }}>
          <div className="container">
            <div
              style={{
                background: 'rgba(0,0,0,0.03)',
                borderLeft: '4px solid #000',
                borderRadius: '0 14px 14px 0',
                padding: 'clamp(24px, 4vw, 36px)',
                maxWidth: '56ch',
              }}
            >
              <p
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontWeight: 400,
                  fontSize: 'clamp(20px, 2.8vw, 26px)',
                  lineHeight: 1.4,
                  letterSpacing: '-0.01em',
                  color: '#000',
                  margin: 0,
                }}
              >
                You ask a question. The system builds perspectives, gathers
                evidence, and stress-tests the reasoning. You own the conclusion.
              </p>
            </div>
          </div>
        </section>

        <section style={{ paddingBlock: 'clamp(56px, 9vw, 100px)' }}>
          <div className="container">
            <div style={{ maxWidth: '62ch' }}>
              <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: '2.4px', textTransform: 'uppercase', color: 'rgba(0,0,0,0.3)' }}>
                How it works
              </p>
              <h1 style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 'clamp(34px, 5.4vw, 58px)', lineHeight: 1.08, letterSpacing: '-0.015em', color: '#000', marginTop: 16 }}>
                Seven layers. One at a time. Nothing skipped.
              </h1>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 17, lineHeight: 1.6, color: 'rgba(0,0,0,0.5)', marginTop: 18 }}>
                A Houses of Thought run walks the same seven layers every time, based on
                John Trapasso&rsquo;s classroom model, derived from the Paul&ndash;Elder
                framework for critical thinking. Six of the seven are checked by a panel
                of nine independent reviewers, one per standard, each blind to the
                others, before the run is allowed to move on. Select a layer below for a
                quick summary, or jump straight to the full write-up further down the page.
              </p>
            </div>

            <div style={{ marginTop: 48 }}>
              <Constellation variant="interactive" />
            </div>
          </div>
        </section>

        {/* Demo video — placeholder until a real recording is ready */}
        <section style={{ paddingBlock: 'var(--section-py)', borderTop: '1px solid rgba(0,0,0,0.08)' }}>
          <div className="container">
            <div style={{ maxWidth: '52ch' }}>
              <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: '2.4px', textTransform: 'uppercase', color: 'rgba(0,0,0,0.3)' }}>
                Watch it work
              </p>
              <h2 style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 'clamp(24px, 3vw, 32px)', color: '#000', marginTop: 10 }}>
                A full house, built start to finish.
              </h2>
            </div>
            <div style={{ marginTop: 24, maxWidth: 800 }}>
              <DemoVideo />
            </div>
          </div>
        </section>

        <section style={{ paddingBlock: 'var(--section-py)', borderTop: '1px solid rgba(0,0,0,0.08)' }}>
          <div className="container" style={{ maxWidth: '68ch' }}>
            <h2 style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 'clamp(24px, 3vw, 32px)', color: '#000' }}>
              Why a panel, and why nine standards?
            </h2>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 16, lineHeight: 1.65, color: 'rgba(0,0,0,0.5)', marginTop: 14 }}>
              The nine standards are Paul and Elder&rsquo;s Universal Intellectual
              Standards, the same nine a critical-thinking classroom would apply by hand.
              Each one is graded by its own independent reviewer, seeing only its own
              question, so a strong score on one standard can never paper over a weak
              one on another. What each standard actually means changes by layer, since a
              layer can only fairly be graded against what it is actually trying to do.
              The full glossary, including that per-layer nuance, is below.
            </p>
            <p style={{ fontFamily: 'var(--font-body)', fontSize: 16, lineHeight: 1.65, color: 'rgba(0,0,0,0.5)', marginTop: 14 }}>
              A layer that fails a standard doesn&rsquo;t quietly pass anyway. It loops and
              redoes the work. Frame, Global Assumptions, Global Evidence, Conclusions,
              and Implications hold the whole run until they pass, since nothing else
              backs them up. Perspectives instead drops just the one stance that failed,
              since the other independent perspectives already provide redundancy.
              Breadth Scoping is the one layer with no panel at all: a single judgment
              call about how many perspectives the question deserves, made once.
            </p>
          </div>
        </section>

        {/* The comparison table — every layer name links to its own in-depth
            write-up further down the page. */}
        <section id="layer-table" style={{ paddingBlock: '0 var(--section-py)', scrollMarginTop: 84 }}>
          <div className="container">
            <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'rgba(0,0,0,0.35)', marginBottom: 16 }}>
              The seven layers, compared
            </p>
            <div className="table-scroll">
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                <thead>
                  <tr>
                    <th style={howThStyle}>Layer</th>
                    <th style={howThStyle}>Review panel</th>
                    <th style={howThStyle}>If it fails a standard</th>
                  </tr>
                </thead>
                <tbody>
                  {CONSTELLATION_LAYERS.map((layer, i) => {
                    const mode = FAILURE_MODE[FAILURE_MODE_BY_LAYER[layer.id]]
                    return (
                      <tr key={layer.id}>
                        <td style={{ ...howTdStyle, whiteSpace: 'nowrap' }}>
                          <a href={`#layer-${layer.id}`} style={{ color: '#000', fontWeight: 600, borderBottom: '1px solid rgba(0,0,0,0.2)' }}>
                            {i + 1}. {layer.name}
                          </a>
                        </td>
                        <td style={howTdStyle}>{layer.hasPanel ? 'Nine independent standards' : 'None'}</td>
                        <td style={howTdStyle}>
                          <strong style={{ color: '#000', fontWeight: 600 }}>{mode.label}.</strong> {mode.body}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Meet the nine standards — the SOLE home for standards content on
            this page, both the generic definition (standards.ts's own
            documentation gloss) and the per-layer nuance (LAYER_STANDARD_
            CRITERIA, paraphrased) — neither is repeated in the diagram's
            click panel or in the in-depth layer write-ups below. */}
        <section id="standards" style={{ paddingBlock: '0 var(--section-py)', borderTop: '1px solid rgba(0,0,0,0.08)', scrollMarginTop: 84 }}>
          <div className="container">
            <div style={{ maxWidth: '62ch' }}>
              <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'rgba(0,0,0,0.35)' }}>
                The review panel
              </p>
              <h2 style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 'clamp(24px, 3vw, 32px)', color: '#000', marginTop: 10 }}>
                Meet the nine standards.
              </h2>
              <p style={{ fontFamily: 'var(--font-body)', fontSize: 16, lineHeight: 1.6, color: 'rgba(0,0,0,0.5)', marginTop: 12 }}>
                Paul and Elder&rsquo;s Universal Intellectual Standards. Six of the seven
                layers get graded against all nine. Open a standard below to see what it
                specifically means at each of those six layers.
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 28 }}>
              {CONSTELLATION_STANDARDS.map((s) => (
                <details key={s.id} style={{ padding: '16px 18px', background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 'var(--radius-card)' }}>
                  <summary style={{ cursor: 'pointer', listStyle: 'none' }}>
                    <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.09em', color: '#000' }}>
                      {s.name}
                    </span>
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: 14.5, lineHeight: 1.5, color: 'rgba(0,0,0,0.5)' }}>
                      : {s.definition}
                    </span>
                  </summary>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10, marginTop: 16 }}>
                    {PANELED_LAYERS.map((layer) => (
                      <div key={layer.id} style={{ borderLeft: '2px solid rgba(0,0,0,0.15)', paddingLeft: 12 }}>
                        <a href={`#layer-${layer.id}`} style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(0,0,0,0.35)' }}>
                          {layer.name}
                        </a>
                        <p style={{ fontFamily: 'var(--font-body)', fontSize: 13.5, lineHeight: 1.5, color: 'rgba(0,0,0,0.5)', marginTop: 4 }}>
                          {layer.standardMeanings?.[s.id]}
                        </p>
                      </div>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* In-depth, one section per layer — anchors matched by the table
            above and by the diagram's click panel. No standards content here
            by design (it lives solely in "Meet the nine standards" above). */}
        <section style={{ paddingBlock: 'var(--section-py)', borderTop: '1px solid rgba(0,0,0,0.08)' }}>
          <div className="container">
            <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'rgba(0,0,0,0.35)', marginBottom: 8 }}>
              In depth
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>
              {CONSTELLATION_LAYERS.map((layer, i) => {
                const mode = FAILURE_MODE[FAILURE_MODE_BY_LAYER[layer.id]]
                return (
                  <article key={layer.id} id={`layer-${layer.id}`} style={{ scrollMarginTop: 84, maxWidth: '68ch' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(0,0,0,0.25)' }}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(0,0,0,0.35)' }}>
                        Layer {i + 1} of 7
                      </span>
                    </div>
                    <h3 style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 26, color: '#000', marginTop: 12 }}>
                      {layer.name}
                    </h3>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: 16, lineHeight: 1.65, color: 'rgba(0,0,0,0.5)', marginTop: 10 }}>
                      {layer.job}
                    </p>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: 16, lineHeight: 1.65, color: 'rgba(0,0,0,0.5)', marginTop: 12 }}>
                      {layer.detail}
                    </p>
                    <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, lineHeight: 1.55, color: 'rgba(0,0,0,0.35)', marginTop: 14 }}>
                      {layer.hasPanel ? (
                        <>
                          Checked by the nine-standard panel (see{' '}
                          <a href="#standards" style={{ color: '#000', borderBottom: '1px solid rgba(0,0,0,0.3)' }}>Meet the nine standards</a>). <strong style={{ color: 'rgba(0,0,0,0.5)' }}>{mode.label}.</strong> {mode.body}
                        </>
                      ) : (
                        <>No review panel. {mode.body}</>
                      )}
                    </p>
                  </article>
                )
              })}
            </div>
            <a href="#main" style={{ display: 'inline-flex', marginTop: 32, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(0,0,0,0.35)' }}>
              ↑ Back to top
            </a>
          </div>
        </section>

        {/* Credit — the deepest methodology content on the site should say
            plainly where the method comes from (redesign brief). */}
        <section style={{ paddingBlock: '0 var(--section-py)', borderTop: '1px solid rgba(0,0,0,0.08)' }}>
          <div className="container">
            <div style={{ padding: 'clamp(24px, 4vw, 40px)', display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center', justifyContent: 'space-between', background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 'var(--radius-card)' }}>
              <div style={{ maxWidth: '52ch' }}>
                <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.09em', color: 'rgba(0,0,0,0.3)' }}>
                  Where this comes from
                </p>
                <p style={{ fontFamily: 'var(--font-serif)', fontStyle: 'italic', fontWeight: 400, fontSize: 'clamp(19px, 2.2vw, 24px)', lineHeight: 1.35, color: '#000', marginTop: 10 }}>
                  This isn&rsquo;t a house style invented for an app. It&rsquo;s a real
                  classroom model, taught by a real teacher, built into software
                  because it worked on paper first.
                </p>
                <p style={{ fontFamily: 'var(--font-body)', fontSize: 15, lineHeight: 1.6, color: 'rgba(0,0,0,0.5)', marginTop: 14 }}>
                  The seven layers are John Trapasso&rsquo;s classroom framework; the nine
                  standards each layer is checked against are Richard Paul and Linda
                  Elder&rsquo;s Universal Intellectual Standards for critical thinking.
                  Houses of Thought is one particular implementation of both, not the
                  other way around.
                </p>
              </div>
              <Link href="/story" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 15, color: '#000', borderBottom: '1px solid rgba(0,0,0,0.3)', whiteSpace: 'nowrap' }}>
                Read the full story →
              </Link>
            </div>
          </div>
        </section>

        <MarketingCTASection
          eyebrow="See it for yourself"
          heading="Pick a question you can't crack."
          primaryLabel="Try it free"
          primaryHref="/try"
          secondaryLabel="Browse examples"
          secondaryHref="/examples"
          note="No sign-up needed to try it."
        />
      </main>
      <MarketingFooter />
    </div>
  )
}

const howThStyle: React.CSSProperties = {
  textAlign: 'left',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'rgba(0,0,0,0.35)',
  padding: '10px 16px',
  borderBottom: '1px solid rgba(0,0,0,0.08)',
}

const howTdStyle: React.CSSProperties = {
  fontFamily: 'var(--font-body)',
  fontSize: 14.5,
  lineHeight: 1.5,
  color: 'rgba(0,0,0,0.5)',
  padding: '14px 16px',
  borderBottom: '1px solid rgba(0,0,0,0.06)',
  verticalAlign: 'top',
}
