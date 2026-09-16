'use client'

// One-click "save to project context" (Phase 3, decision 021, plans/active/
// business-mode/03-accumulating-context.md). Explicit user action, never
// automatic scraping — same spirit as every other AI-adjacent write in this
// app (e.g. ReasoningConclusionSuggestion's "Use as my conclusion").
// Shared by ReviewLayer (Collab's Review layer) and ReasoningConclusionSuggestion
// (the reasoning pipeline reaching a conclusion) — same action, two surfaces.

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { appendProjectContextFacts } from '@/lib/projects/data'

export function SaveFactsToProjectButton({
  projectId,
  facts,
  onSaved,
}: {
  projectId: string
  facts: string[]
  // Optional (Phase 4, plans/active/project-deep-dives/04-save-to-project.md):
  // fires right after appendProjectContextFacts resolves, so a caller that
  // needs to know "the save happened" (a Deep Dive result marking its own
  // source row saved_to_project) can react without this component knowing
  // anything about who's calling it. Every pre-existing caller (ReviewLayer,
  // ReasoningConclusionSuggestion) omits it and keeps working unchanged.
  onSaved?: () => void
}) {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  // Nothing durable to offer — render nothing rather than a button that does
  // nothing useful (e.g. no interview ever ran, or the pipeline reached no
  // conclusion yet).
  if (facts.length === 0) return null

  async function handleClick() {
    setState('saving')
    try {
      await appendProjectContextFacts(createClient(), projectId, facts)
      onSaved?.()
      setState('saved')
    } catch {
      setState('error')
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state === 'saving' || state === 'saved'}
      className="mono"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        fontSize: 11,
        color: state === 'error' ? 'var(--warning-text)' : state === 'saved' ? 'var(--green-text)' : 'var(--ink)',
        background: 'var(--white)',
        border: `1px solid ${state === 'error' ? 'var(--warning)' : state === 'saved' ? 'var(--green-strong)' : 'var(--ink)'}`,
        borderRadius: 7,
        padding: '6px 11px',
        cursor: state === 'saving' || state === 'saved' ? 'default' : 'pointer',
        opacity: state === 'saving' ? 0.7 : 1,
      }}
    >
      {state === 'saved'
        ? 'Saved to project ✓'
        : state === 'saving'
          ? 'Saving…'
          : state === 'error'
            ? 'Could not save — retry'
            : `Save ${facts.length === 1 ? 'this fact' : `these ${facts.length} facts`} to the project`}
    </button>
  )
}
