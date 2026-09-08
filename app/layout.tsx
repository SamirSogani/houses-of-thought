import type { Metadata, Viewport } from 'next'
import { Fraunces, Inter_Tight, Geist_Mono, Instrument_Serif } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { SITE_URL, SITE_NAME, SITE_DESCRIPTION, FOUNDER } from '@/lib/site'
import './globals.css'
import './styles/build-responsive.css'
import './styles/marketing-responsive.css'
import './styles/account-responsive.css'
import './styles/dusk-theme.css'

const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-fraunces',
  axes: ['opsz'],
})

const interTight = Inter_Tight({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--font-inter-tight',
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-geist-mono',
})

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: ['400'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-instrument-serif',
})

// Site-wide metadata (seo #2/#3, aeo C3). `title.template` lets every page
// export a short `title` and still render "<Page> — Houses of Thought";
// `metadataBase` makes the relative canonical/OG URLs below resolve absolutely.
// Six of eight indexable routes previously shared one identical title.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Houses of Thought — Critical Thinking, Structured',
    template: `%s — ${SITE_NAME}`,
  },
  description:
    'A critical-thinking tool for classrooms. Turn a hard question into structured, defensible reasoning — perspectives, cited evidence, and assumptions — with AI that guides instead of deciding.',
  applicationName: SITE_NAME,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    url: '/',
    title: 'Houses of Thought — Critical Thinking, Structured',
    description:
      'Turn a hard question into structured, defensible reasoning. Built for students and teachers.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Houses of Thought — Critical Thinking, Structured',
    description:
      'Turn a hard question into structured, defensible reasoning. Built for students and teachers.',
  },
}

export const viewport: Viewport = {
  themeColor: '#F7F6F2', // parchment — matches the page background, no flash
}

// Organization + WebSite JSON-LD (seo #9, aeo H2/M2). Gives answer engines a
// stable entity for "Houses of Thought" — otherwise ambiguous with the generic
// phrase — and records the founder and the Paul–Elder lineage as structured
// data rather than prose buried on /story.
const orgJsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/icon.svg`,
      description: SITE_DESCRIPTION,
      founder: { '@type': 'Person', name: FOUNDER },
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      name: SITE_NAME,
      url: SITE_URL,
      description: SITE_DESCRIPTION,
      publisher: { '@id': `${SITE_URL}/#organization` },
      inLanguage: 'en',
    },
  ],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${interTight.variable} ${geistMono.variable} ${instrumentSerif.variable}`}
    >
      <body>
        {/* Bypass the repeated sticky header + sheet strip (a11y M1, WCAG 2.4.1).
            Every page renders exactly one <main id="main">, which this targets. */}
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
        />
        {children}
        <Analytics />
      </body>
    </html>
  )
}
