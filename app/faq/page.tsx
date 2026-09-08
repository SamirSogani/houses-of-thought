import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/site'
import MarketingHeader from '@/components/marketing/DuskHeader'
import MarketingFooter from '@/components/marketing/DuskFooter'
import MarketingCTASection from '@/components/marketing/DuskCTASection'
import ScrollRevealInit from '@/components/ScrollReveal'
import FaqIntroSection from '@/components/sections/FaqIntroSection'
import FaqGroupsSection from '@/components/sections/FaqGroupsSection'
import { faqGroups } from '@/lib/faq/data'

export const metadata: Metadata = {
  ...pageMetadata({
    title: 'FAQ',
    description:
      'Answers about Houses of Thought: what a house is, how House Strength is scored, how Research Mode prevents hallucinated sources, how classrooms and student accounts work, and what it costs.',
    path: '/faq',
    ogTitle: 'What is Houses of Thought?',
  }),
  // Question-shaped for answer engines (aeo C3); `absolute` opts out of the
  // layout's "%s — Houses of Thought" template because the brand name is
  // already inside the question.
  title: { absolute: 'What is Houses of Thought? · FAQ' },
}

// FAQPage JSON-LD (seo #9, aeo H2) built from the same array the accordion
// renders, so the structured data can never drift from the visible answers.
// This is the most answer-shaped content on the site and the highest-ROI markup
// for answer engines.
const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqGroups.flatMap((g) =>
    g.items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    }))
  ),
}

export default function FaqPage() {
  return (
    <div className="dusk-page">
      <ScrollRevealInit />
      <MarketingHeader />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <main id="main">
        <FaqIntroSection />
        <FaqGroupsSection />
        <MarketingCTASection
          eyebrow="Still curious?"
          heading="The fastest answer is to build one."
          primaryLabel="Try it instantly"
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
