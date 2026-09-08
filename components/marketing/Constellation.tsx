'use client'

// The seven-node "constellation" diagram: the centerpiece of the pre-login
// redesign's visual system. Three variants share one geometry + one CSS
// animation grammar (app/styles/dusk-theme.css) so "pass" and "loop-back"
// read the same way everywhere a visitor sees them:
//   - 'compressed'  — Home teaser. Plays once on mount, then rests lit. No
//                     interaction; links out to /how-it-works.
//   - 'interactive' — How It Works. Plays once on mount, then every node is
//                     clickable (keyboard-operable, same toggle-button
//                     pattern as InteractiveHouseSection) and opens a detail
//                     panel below.
//   - 'sweep'       — /try's pre-confirmation beat. Plays once, faster, then
//                     calls onSweepComplete. No labels, no interaction.
//
// Animation approach: CSS keyframes with a per-element animationDelay
// computed in JS, frozen to a static end state after the sequence finishes.
//
// The sequence is gated behind an IntersectionObserver (same mechanism as
// components/ScrollReveal.tsx), NOT mount time. It used to key off mount
// directly, which raced page load: by the time hydration + fonts + the rest
// of the route finished, most of a ~2.8s mount-timed sequence had already
// played out off-screen, so a visitor only ever caught the tail end — one
// mark still mid-retry-pulse on the first node — and it read as stalled.
// Starting the clock only once the diagram is actually visible removes that
// race entirely.
//
// A small comet travels the connecting path over the same window (an
// SVG <animateMotion>, mounted fresh exactly when the sequence starts), so
// "the reasoning moving through the sequence" has one unambiguous, literal
// visual instead of relying on a viewer to track nine tiny marks per node.

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { CONSTELLATION_LAYERS, type LayerId } from '@/lib/marketing/constellation'
import { ArrowIcon } from '@/components/icons'

// Node centers along a gentle arc — a sequence, not a scattered cloud (design
// brief). viewBox is fixed; the SVG scales to its container at any width.
const VIEW_W = 1040
const VIEW_H = 300
const NODE_Y = [176, 108, 190, 96, 190, 108, 168]
const NODE_X = CONSTELLATION_LAYERS.map((_, i) => 70 + i * ((VIEW_W - 140) / (CONSTELLATION_LAYERS.length - 1)))

const PANEL_R = 22
const BREADTH_R = 12
const RING_R = 35
const MARK_R = 2.6

function nodePath(): string {
  let d = `M ${NODE_X[0]} ${NODE_Y[0]}`
  for (let i = 1; i < NODE_X.length; i++) {
    const prevX = NODE_X[i - 1]
    const prevY = NODE_Y[i - 1]
    const x = NODE_X[i]
    const y = NODE_Y[i]
    const midX = (prevX + x) / 2
    d += ` C ${midX} ${prevY}, ${midX} ${y}, ${x} ${y}`
  }
  return d
}

// Nine mark positions evenly spaced on the ring, starting at the top.
function markPositions(cx: number, cy: number) {
  return Array.from({ length: 9 }, (_, i) => {
    const angle = -Math.PI / 2 + (i / 9) * Math.PI * 2
    return { x: cx + RING_R * Math.cos(angle), y: cy + RING_R * Math.sin(angle) }
  })
}

// Deterministic (not random per render) — one mark per paneled node is shown
// mid-retry rather than already resolved, so the diagram always demonstrates
// the real loop-and-retry mechanic instead of only ever showing clean passes.
function retryMarkIndex(layerIndex: number): number {
  return (layerIndex * 3 + 2) % 9
}

const SWEEP_STAGGER_MS = 130
const NORMAL_STAGGER_MS = 260
const MARK_STAGGER_MS = 45
// The slowest possible mark animation (a retry pulse) — used as the buffer
// before freezing on the end state. Keep in sync with .constellation-mark-
// retry's duration in app/styles/dusk-theme.css.
const RETRY_DURATION_MS = 900

interface ConstellationProps {
  variant: 'compressed' | 'interactive' | 'sweep'
  onSweepComplete?: () => void
}

export default function Constellation({ variant, onSweepComplete }: ConstellationProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [settled, setSettled] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [selected, setSelected] = useState<LayerId>('frame')

  const stagger = variant === 'sweep' ? SWEEP_STAGGER_MS : NORMAL_STAGGER_MS
  const lastNodeDelay = (CONSTELLATION_LAYERS.length - 1) * stagger
  const totalMs = useMemo(
    () => lastNodeDelay + 260 + 8 * MARK_STAGGER_MS + RETRY_DURATION_MS + 250,
    [lastNodeDelay]
  )
  // The comet's own travel time — arrives at the last node right around when
  // that node's entrance fires, so its motion and the nodes lighting up read
  // as the same event.
  const travelMs = lastNodeDelay + 500

  // Reduced motion: OS preference OR the explicit in-app toggle. Resolved
  // immediately — no observer, no timer, straight to the settled end state.
  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const savedToggle = window.localStorage.getItem('hot-reduced-motion') === '1'
    const reduced = prefersReduced || savedToggle
    setReducedMotion(reduced)
    if (reduced) setSettled(true)
  }, [])

  // Start the sequence only once the diagram is actually on screen.
  useEffect(() => {
    if (reducedMotion) return
    const el = wrapRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible(true)
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.35 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [reducedMotion])

  // Freeze on the resolved end state once the sequence has actually run its
  // course, measured from when it actually started (visible), not from mount.
  useEffect(() => {
    if (!visible || reducedMotion) return
    const t = setTimeout(() => {
      setSettled(true)
      if (variant === 'sweep') onSweepComplete?.()
    }, totalMs)
    return () => clearTimeout(t)
  }, [visible, reducedMotion, totalMs, variant, onSweepComplete])

  function toggleReducedMotion() {
    setReducedMotion((prev) => {
      const next = !prev
      window.localStorage.setItem('hot-reduced-motion', next ? '1' : '0')
      if (next) setSettled(true)
      return next
    })
  }

  const activeLayer = CONSTELLATION_LAYERS.find((l) => l.id === selected) ?? CONSTELLATION_LAYERS[0]
  const interactive = variant === 'interactive'

  // 'pending' = on screen but not yet visible / not yet started — renders the
  // same dim look the animations' own 0% keyframe starts from, so there's no
  // flash when 'animating' begins. 'animating' only exists in the render
  // between visible and settled, so a CSS animation-delay is always counted
  // from a real, on-screen start. 'resolved' is the permanent end state.
  const phase: 'pending' | 'animating' | 'resolved' = settled ? 'resolved' : visible ? 'animating' : 'pending'

  return (
    <div ref={wrapRef} data-motion={reducedMotion ? 'reduced' : undefined}>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        style={{ width: '100%', height: 'auto', overflow: 'visible' }}
        role={interactive ? 'group' : 'img'}
        aria-label={
          interactive
            ? 'The seven layers of a reasoning run: select one to read what it does'
            : 'The seven layers of a Houses of Thought reasoning run: Frame, Breadth Scoping, Perspectives, Global Assumptions, Global Evidence, Conclusions, Implications'
        }
      >
        <path
          d={nodePath()}
          fill="none"
          stroke="rgba(0,0,0,0.15)"
          strokeWidth={1.6}
          strokeLinecap="round"
          pathLength={1}
          className={phase === 'animating' ? 'constellation-path' : undefined}
          style={{
            strokeDasharray: 1,
            strokeDashoffset: phase === 'pending' ? 1 : 0,
          }}
        />

        {/* The comet: a literal traveling light for "reasoning moving through
            the sequence" — mounted fresh only once animating starts, so its
            SMIL timing is never subject to the same page-load race the CSS
            delays used to fall into. */}
        {phase === 'animating' && (
          <circle r={5.5} fill="#000" style={{ filter: 'drop-shadow(0 0 4px rgba(0,0,0,0.35))' }}>
            <animateMotion dur={`${travelMs}ms`} path={nodePath()} fill="freeze" calcMode="linear" />
            <animate
              attributeName="opacity"
              values="0;1;1;0"
              keyTimes="0;0.06;0.92;1"
              dur={`${travelMs}ms`}
              fill="freeze"
            />
          </circle>
        )}

        {CONSTELLATION_LAYERS.map((layer, i) => {
          const cx = NODE_X[i]
          const cy = NODE_Y[i]
          const r = layer.hasPanel ? PANEL_R : BREADTH_R
          const nodeDelay = i * stagger
          const isSelected = interactive && selected === layer.id
          const nodeProps = interactive
            ? {
                role: 'button' as const,
                tabIndex: 0,
                'aria-pressed': isSelected,
                'aria-label': `${layer.name}, layer ${i + 1} of 7${layer.hasPanel ? ', reviewed by the nine-standard panel' : ', no review panel'}`,
                style: { cursor: 'pointer' as const },
                onClick: () => setSelected(layer.id),
                onKeyDown: (e: React.KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setSelected(layer.id)
                  }
                },
              }
            : {}

          return (
            <g key={layer.id} {...nodeProps}>
              {/* Standards ring — nine marks, one per Paul–Elder standard, only
                  for the six panel-gated layers (design brief: Breadth Scoping
                  has none, visually teaching that it skips the panel). */}
              {layer.hasPanel &&
                markPositions(cx, cy).map((m, mi) => {
                  const isRetry = mi === retryMarkIndex(i)
                  const markDelay = nodeDelay + 260 + mi * MARK_STAGGER_MS
                  const resolvedFill = '#000'
                  return (
                    <circle
                      key={mi}
                      cx={m.x}
                      cy={m.y}
                      r={MARK_R}
                      fill={phase === 'resolved' ? resolvedFill : 'rgba(0,0,0,0.15)'}
                      className={
                        phase === 'animating' ? (isRetry ? 'constellation-mark-retry' : 'constellation-mark-resolve') : undefined
                      }
                      style={{ animationDelay: `${markDelay}ms` }}
                    />
                  )
                })}

              {/* Node body */}
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill={isSelected ? 'rgba(0,0,0,0.08)' : 'rgba(0,0,0,0.04)'}
                stroke={isSelected ? '#000' : 'rgba(0,0,0,0.35)'}
                strokeWidth={isSelected ? 2.4 : 1.8}
                className={
                  phase === 'resolved' && !layer.hasPanel
                    ? 'constellation-breadth-pulse'
                    : phase === 'animating'
                      ? 'constellation-node'
                      : undefined
                }
                style={{
                  animationDelay: phase === 'animating' ? `${nodeDelay}ms` : undefined,
                  transition: 'fill 0.2s, stroke 0.2s',
                  ...( { '--node-glow': 'rgba(0,0,0,0.3)' } as React.CSSProperties),
                }}
              />
              <text
                x={cx}
                y={cy + 4}
                textAnchor="middle"
                fontFamily="var(--font-mono)"
                fontSize={layer.hasPanel ? 12 : 10}
                fill="#000"
                style={{ pointerEvents: 'none' }}
              >
                {i + 1}
              </text>
            </g>
          )
        })}
      </svg>

      {variant === 'compressed' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginTop: 20 }}>
          <p style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'rgba(0,0,0,0.35)' }}>
            Seven layers · six reviewed by nine independent standards each · one plain judgment call.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* Same toggle as the interactive diagram, and same localStorage key
                (app/styles/dusk-theme.css / this component's own effect above):
                "reduce motion" is a sitewide preference, so a visitor who set it
                on How It Works needs to be able to see and undo it here too,
                rather than finding a silently non-animating diagram with no
                explanation. */}
            <ReducedMotionToggle reducedMotion={reducedMotion} onToggle={toggleReducedMotion} />
            <Link
              href="/how-it-works"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 15, color: '#000', whiteSpace: 'nowrap' }}
            >
              See how it works <ArrowIcon />
            </Link>
          </div>
        </div>
      )}

      {interactive && (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
            <ReducedMotionToggle reducedMotion={reducedMotion} onToggle={toggleReducedMotion} />
          </div>

          <LayerDetail layer={activeLayer} index={CONSTELLATION_LAYERS.indexOf(activeLayer)} />
        </>
      )}
    </div>
  )
}

function ReducedMotionToggle({ reducedMotion, onToggle }: { reducedMotion: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={reducedMotion}
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'rgba(0,0,0,0.35)',
        border: '1px solid rgba(0,0,0,0.15)',
        borderRadius: 999,
        padding: '6px 12px',
        whiteSpace: 'nowrap',
      }}
    >
      {reducedMotion ? 'Motion: reduced' : 'Reduce motion'}
    </button>
  )
}

// The diagram's click panel is deliberately a summary, not a duplicate of the
// in-depth write-up: it names what the layer does and whether it has a panel,
// then links to the full section. What each of the nine standards means —
// including the per-layer nuance — lives ONLY in How It Works's "Meet the
// nine standards" section (app/how-it-works/page.tsx), never repeated here.
function LayerDetail({ layer, index }: { layer: (typeof CONSTELLATION_LAYERS)[number]; index: number }) {
  return (
    <div
      aria-live="polite"
      style={{
        padding: 'clamp(22px, 3vw, 32px)',
        marginTop: 24,
        background: '#fff',
        border: '1px solid rgba(0,0,0,0.08)',
        borderRadius: 'var(--radius-card)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 500, color: 'rgba(0,0,0,0.25)' }}>
          {String(index + 1).padStart(2, '0')}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(0,0,0,0.35)' }}>
          Layer {index + 1} of 7 · {layer.hasPanel ? 'Nine-standard review panel' : 'No review panel'}
        </span>
      </div>

      <h3 style={{ fontFamily: 'var(--font-serif)', fontWeight: 400, fontSize: 26, marginTop: 14, color: '#000' }}>
        {layer.name}
      </h3>
      <p style={{ fontFamily: 'var(--font-body)', fontSize: 16, lineHeight: 1.6, color: 'rgba(0,0,0,0.5)', marginTop: 10, maxWidth: '68ch' }}>
        {layer.job}
      </p>

      <a
        href={`#layer-${layer.id}`}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 16, fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: 14, color: '#000', borderBottom: '1px solid rgba(0,0,0,0.3)' }}
      >
        Read the full write-up ↓
      </a>
    </div>
  )
}
