'use client'

import { useState } from 'react'
import { ChevronIcon } from '@/components/icons'
import { faqGroups as groups, type FaqItem } from '@/lib/faq/data'

function AccordionItem({
  item,
  isLast,
  defaultOpen,
}: {
  item: FaqItem
  isLast: boolean
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div
      style={{
        borderTop: '1px solid rgba(0,0,0,0.08)',
        borderBottom: isLast ? '1px solid rgba(0,0,0,0.08)' : undefined,
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 16,
          padding: '20px 0',
          textAlign: 'left',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-serif)',
            fontWeight: 400,
            fontSize: 20,
            color: '#000',
          }}
        >
          {item.question}
        </span>
        <span
          style={{
            color: 'rgba(0,0,0,0.35)',
            flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.24s',
          }}
        >
          <ChevronIcon />
        </span>
      </button>
      <div
        style={{
          display: open ? 'block' : 'none',
          padding: '0 0 22px',
        }}
      >
        <p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 16,
            lineHeight: 1.65,
            color: 'rgba(0,0,0,0.5)',
            maxWidth: '64ch',
          }}
        >
          {item.richAnswer ?? item.answer}
        </p>
      </div>
    </div>
  )
}

export default function FaqGroupsSection() {
  return (
    <section style={{ paddingBlock: 0 }}>
      <div
        className="container"
        style={{
          maxWidth: 820,
          borderTop: '1px solid rgba(0,0,0,0.08)',
          paddingTop: 'clamp(40px, 6vw, 64px)',
          paddingBottom: 'clamp(56px, 9vw, 96px)',
          display: 'flex',
          flexDirection: 'column',
          gap: 56,
        }}
      >
        {groups.map((group) => (
          <div key={group.label} data-reveal>
            <p
              style={{
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'rgba(0,0,0,0.35)',
                marginBottom: 8,
              }}
            >
              {group.label}
            </p>
            <div>
              {group.items.map((item, i) => (
                <AccordionItem
                  key={item.question}
                  item={item}
                  isLast={i === group.items.length - 1}
                  defaultOpen={i === 0}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
