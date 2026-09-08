import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/site'
import MarketingHeader from '@/components/marketing/DuskHeader'
import MarketingFooter from '@/components/marketing/DuskFooter'
import MarketingCTASection from '@/components/marketing/DuskCTASection'
import ScrollRevealInit from '@/components/ScrollReveal'
import StoryIntroSection from '@/components/sections/StoryIntroSection'
import StoryChaptersSection from '@/components/sections/StoryChaptersSection'

export const metadata: Metadata = pageMetadata({
  title: 'Our Story',
  description:
    'Why Houses of Thought exists: a student watching smart people make messy decisions, and a teacher, John Trapasso, whose classroom model, derived from Paul–Elder, gave the missing structure.',
  path: '/story',
  ogTitle: 'The story behind Houses of Thought',
  type: 'article',
})

export default function StoryPage() {
  return (
    <div className="dusk-page">
      <ScrollRevealInit />
      <MarketingHeader />
      <main id="main">
        <StoryIntroSection />
        <StoryChaptersSection />
        <MarketingCTASection
          eyebrow="Your turn"
          heading="Build your first house."
          primaryLabel="Try it instantly"
          primaryHref="/try"
          secondaryLabel="How it works"
          secondaryHref="/how-it-works"
          note="Try it on a real decision you've been putting off."
        />
      </main>
      <MarketingFooter />
    </div>
  )
}
