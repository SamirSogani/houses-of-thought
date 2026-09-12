// Authenticated-app / auth surface: never indexed (seo #5). robots.txt already
// disallows these paths; this layout adds the per-page meta signal for anything
// that reaches them directly (the pages themselves are client components and
// cannot export metadata).

import type { Metadata } from 'next'

export const metadata: Metadata = { robots: { index: false, follow: false } }

export default function NoIndexLayout({ children }: { children: React.ReactNode }) {
  return children
}
