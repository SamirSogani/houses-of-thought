import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/site'
import MarketingHeader from '@/components/marketing/Header'
import MarketingFooter from '@/components/marketing/Footer'
import MarketingCTASection from '@/components/marketing/CTASection'
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
    <div style={{ background: '#fff', color: '#000' }}>
      <ScrollRevealInit />
      <MarketingHeader variant="subpage" />
      <main id="main">
        <StoryIntroSection />
        <StoryChaptersSection />
        <MarketingCTASection
          eyebrow="Your turn"
          heading="Build your first house."
          primaryLabel="Try it free"
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
