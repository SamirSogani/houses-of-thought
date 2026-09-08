'use client'

// Home hero: headline + the try-it box, front and center. Submitting routes
// to /try with the question attached.

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MINI_HOUSE_EXAMPLES } from '@/lib/ai/mini-house'

const ROTATE_MS = 3200

export default function Hero() {
  const router = useRouter()
  const [question, setQuestion] = useState('')
  const [placeholderIndex, setPlaceholderIndex] = useState(0)
  const inputFocused = useRef(false)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = setInterval(() => {
      if (inputFocused.current || question) return
      setPlaceholderIndex((i) => (i + 1) % MINI_HOUSE_EXAMPLES.length)
    }, ROTATE_MS)
    return () => clearInterval(id)
  }, [question])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const q = question.trim()
    router.push(q ? `/try?q=${encodeURIComponent(q)}` : '/try')
  }

  return (
    <section style={{ paddingTop: 64, paddingBottom: 80, background: 'var(--hp-bg, #fff)' }}>
      <div style={{ maxWidth: 1024, margin: '0 auto', padding: '0 24px', textAlign: 'center' }}>
        <span
          style={{
            display: 'inline-block',
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: '2.4px',
            textTransform: 'uppercase',
            color: 'rgba(0,0,0,0.3)',
          }}
        >
          Free forever &middot; No paid tier
        </span>

        <h1
          className="hp-hero-heading"
          style={{
            fontFamily: 'var(--font-serif, "Instrument Serif", Georgia, serif)',
            fontWeight: 400,
            fontSize: 48,
            lineHeight: 1.1,
            letterSpacing: '-0.02em',
            maxWidth: 600,
            margin: '20px auto 0',
            color: '#000',
          }}
        >
          Reason through it, don&rsquo;t just ask.
        </h1>

        <p
          style={{
            fontSize: 17,
            lineHeight: 1.65,
            color: 'rgba(0,0,0,0.5)',
            maxWidth: 520,
            margin: '20px auto 0',
          }}
        >
          Ask a real question. Houses of Thought frames it, builds independent
          perspectives, stress-tests the evidence, and reaches a conclusion —
          with every step checked.
        </p>

        <form
          onSubmit={submit}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            maxWidth: 480,
            margin: '36px auto 0',
            border: '2px solid #000',
            borderRadius: 999,
            padding: '4px 4px 4px 20px',
          }}
        >
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value.slice(0, 600))}
            onFocus={() => (inputFocused.current = true)}
            onBlur={() => (inputFocused.current = false)}
            placeholder={MINI_HOUSE_EXAMPLES[placeholderIndex]}
            aria-label="What decision are you facing?"
            style={{
              flex: 1,
              minWidth: 0,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 15,
              color: '#000',
              padding: '10px 0',
            }}
          />
          <button
            type="submit"
            style={{
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              height: 40,
              padding: '0 20px',
              background: '#000',
              color: '#fff',
              border: 'none',
              borderRadius: 999,
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Try it &rarr;
          </button>
        </form>

        <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', marginTop: 14 }}>
          No account needed. Instant results.
        </p>
      </div>

      <style>{`
        @media (max-width: 640px) {
          .hp-hero-heading { font-size: 32px !important; }
        }
      `}</style>
    </section>
  )
}
