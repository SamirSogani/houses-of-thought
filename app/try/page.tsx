import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/site'
import MarketingHeader from '@/components/marketing/Header'
import MarketingFooter from '@/components/marketing/Footer'
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
    <div style={{ background: '#fff', color: '#000' }}>
      <MarketingHeader variant="subpage" />
      {/* The real Mini House flow (components/try/TryItFlow.tsx +
          MiniHouseResult.tsx) already uses light --ink/--parchment tokens
          that read cleanly on white, so it sits directly on the page here
          rather than needing a "lit island" wrapper. */}
      <main id="main">
        <TryItFlow initialQuestion={q ?? ''} />
      </main>
      <MarketingFooter />
    </div>
  )
}
