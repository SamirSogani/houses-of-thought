// Quiet single-column renderer for the legal documents in legal/*.md
// (pre-login-ux/pages-content.md: "keep them visually quiet — no marketing
// flourish"). A deliberately small markdown subset — headings, paragraphs,
// bullets, hr, **bold**, `code`, [links](…) — because the two legal docs use
// nothing else. HTML comments (counsel TODOs) are stripped before rendering.

import Link from 'next/link'
import { safeHttpUrl } from '@/lib/safeUrl'

// ── Inline markdown: **bold**, `code`, [text](href) ─────────────────────────
function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  // Tokenize on links first, then bold/code inside the remaining runs.
  const parts = text.split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|`[^`]+`)/g)
  parts.forEach((part, i) => {
    const key = `${keyBase}-${i}`
    if (!part) return
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (link) {
      const [, label, href] = link
      const linkStyle: React.CSSProperties = { color: '#000', borderBottom: '1px solid rgba(0,0,0,0.3)', paddingBottom: 1 }
      if (href.startsWith('/')) {
        out.push(
          <Link key={key} href={href} style={linkStyle}>
            {label}
          </Link>
        )
      } else {
        const safe = safeHttpUrl(href)
        out.push(
          safe ? (
            <a key={key} href={safe} style={linkStyle} target="_blank" rel="noopener noreferrer">
              {label}
            </a>
          ) : (
            <span key={key}>{label}</span>
          )
        )
      }
      return
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      out.push(
        <strong key={key} style={{ color: '#000', fontWeight: 600 }}>
          {renderInline(part.slice(2, -2), key)}
        </strong>
      )
      return
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      out.push(
        <code key={key} className="mono" style={{ fontSize: '0.88em', background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 4, padding: '1px 5px' }}>
          {part.slice(1, -1)}
        </code>
      )
      return
    }
    out.push(part)
  })
  return out
}

type Block =
  | { kind: 'h1' | 'h2' | 'h3' | 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'hr' }

function parseBlocks(markdown: string): Block[] {
  const src = markdown.replace(/<!--[\s\S]*?-->/g, '') // strip counsel TODOs
  const lines = src.split('\n')
  const blocks: Block[] = []
  let para: string[] = []
  let list: string[] | null = null

  const flush = () => {
    if (para.length) {
      blocks.push({ kind: 'p', text: para.join(' ') })
      para = []
    }
    if (list) {
      blocks.push({ kind: 'ul', items: list })
      list = null
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      flush()
      continue
    }
    if (line === '---') {
      flush()
      blocks.push({ kind: 'hr' })
      continue
    }
    const h = line.match(/^(#{1,3}) (.*)$/)
    if (h) {
      flush()
      blocks.push({ kind: h[1].length === 1 ? 'h1' : h[1].length === 2 ? 'h2' : 'h3', text: h[2] })
      continue
    }
    if (/^- /.test(line)) {
      if (para.length) flush()
      list ??= []
      list.push(line.slice(2))
      continue
    }
    // Continuation of a wrapped bullet (indented text while a list is open).
    if (list && /^\s{2,}/.test(raw)) {
      list[list.length - 1] += ' ' + line.trim()
      continue
    }
    if (list) flush()
    para.push(line.trim())
  }
  flush()
  return blocks
}

export function LegalArticle({ markdown }: { markdown: string }) {
  const blocks = parseBlocks(markdown)
  return (
    <article style={{ maxWidth: '68ch' }}>
      {blocks.map((b, i) => {
        const key = `b-${i}`
        switch (b.kind) {
          case 'h1':
            return (
              <h1 key={key} style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 'clamp(30px, 4.5vw, 44px)', letterSpacing: '-0.015em', lineHeight: 1.15, color: '#000' }}>
                {renderInline(b.text, key)}
              </h1>
            )
          case 'h2':
            return (
              <h2 key={key} style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 24, letterSpacing: '-0.01em', color: '#000', marginTop: 40 }}>
                {renderInline(b.text, key)}
              </h2>
            )
          case 'h3':
            return (
              <h3 key={key} style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 18, color: '#000', marginTop: 28 }}>
                {renderInline(b.text, key)}
              </h3>
            )
          case 'ul':
            return (
              <ul key={key} style={{ margin: '14px 0 0 2px', padding: '0 0 0 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {b.items.map((item, j) => (
                  <li key={`${key}-${j}`} style={{ fontFamily: 'var(--font-body)', fontSize: 15, lineHeight: 1.65, color: 'rgba(0,0,0,0.5)' }}>
                    {renderInline(item, `${key}-${j}`)}
                  </li>
                ))}
              </ul>
            )
          case 'hr':
            return <hr key={key} style={{ border: 'none', borderTop: '1px solid rgba(0,0,0,0.08)', margin: '36px 0' }} />
          case 'p':
            return (
              <p key={key} style={{ fontFamily: 'var(--font-body)', fontSize: 15, lineHeight: 1.65, color: 'rgba(0,0,0,0.5)', marginTop: 14 }}>
                {renderInline(b.text, key)}
              </p>
            )
        }
      })}
    </article>
  )
}

// Shared draft notice: both documents are drafts pending review; say so
// visibly rather than presenting them as final (they used to 404 outright).
export function DraftNotice() {
  return (
    <div
      role="note"
      style={{
        maxWidth: '68ch',
        margin: '22px 0 6px',
        border: '1px dashed rgba(0,0,0,0.2)',
        borderRadius: 10,
        padding: '12px 16px',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        lineHeight: 1.6,
        letterSpacing: '0.04em',
        color: 'rgba(0,0,0,0.5)',
        background: 'rgba(0,0,0,0.03)',
      }}
    >
      WORKING DRAFT · This document is under legal review. Its substance
      reflects how the product works today; entity, jurisdiction, and effective
      date will be finalized before launch.
    </div>
  )
}
