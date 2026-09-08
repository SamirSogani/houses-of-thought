import type { Metadata } from 'next'
import { pageMetadata } from '@/lib/site'
import Header from '@/components/marketing/Header'
import ScrollRevealInit from '@/components/ScrollReveal'
import EducatorHeroSection from '@/components/sections/EducatorHeroSection'
import EducatorProblemSection from '@/components/sections/EducatorProblemSection'
import EducatorClassroomSection from '@/components/sections/EducatorClassroomSection'
import EducatorDifferenceSection from '@/components/sections/EducatorDifferenceSection'
import EducatorCollabSection from '@/components/sections/EducatorCollabSection'
import EducatorTrustSection from '@/components/sections/EducatorTrustSection'
import CTASection from '@/components/marketing/CTASection'
import Footer from '@/components/marketing/Footer'

export const metadata: Metadata = pageMetadata({
  title: 'Critical Thinking for Classrooms',
  description:
    'A critical-thinking tool built for teachers: assign a question, watch students build structured reasoning, and grade the thinking rather than the answer. Students run the AI in Learn mode only.',
  path: '/educators',
  ogTitle: 'Houses of Thought for Classrooms',
})

export default function EducatorsPage() {
  return (
    <div style={{ background: '#fff', color: '#000' }}>
      <ScrollRevealInit />
      <Header variant="subpage" />
      <main id="main">
        <EducatorHeroSection />
        <EducatorProblemSection />
        <EducatorClassroomSection />
        <EducatorDifferenceSection />
        <EducatorCollabSection />
        <EducatorTrustSection />
        <CTASection
          eyebrow="Get started"
          heading="Bring reasoning into your classroom."
          primaryLabel="Create a classroom"
          primaryHref="/login?mode=signup&role=educator"
          secondaryLabel="Talk to us"
          secondaryHref="/contact"
          note="Free to start. Set up a class and invite your students in minutes."
        />
      </main>
      <Footer />
    </div>
  )
}
