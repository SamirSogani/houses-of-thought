import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/site'
import MarketingHeader from '@/components/marketing/DuskHeader'
import MarketingFooter from '@/components/marketing/DuskFooter'
import TryItFlow from '@/components/try/TryItFlow'

export const metadata: Metadata = pageMetadata({
  title: 'Try It Instantly: no account needed',
  description:
    'Run a free Mini House on any real question. Structured, sourced, and surprisingly clarifying. No account required.',
  path: '/try',
  ogTitle: 'Try Houses of Thought instantly: no account needed',
})

export default async function TryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  return (
    <div className="dusk-page">
      <MarketingHeader />
      {/* The real Mini House flow (components/try/TryItFlow.tsx +
          MiniHouseResult.tsx) is restored here as the working /try
          experience — its light, "paper" styling is left exactly as
          designed rather than recolored piecemeal, so it sits inside the
          new dusk chrome as a lit page rather than a source of subtle
          color-contrast bugs. */}
      <main id="main" style={{ background: 'var(--parchment)' }}>
        <TryItFlow initialQuestion={q ?? ''} />
      </main>
      <MarketingFooter />
    </div>
  )
}
