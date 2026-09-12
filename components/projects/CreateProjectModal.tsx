'use client'

// Create-project dialog. Mirrors the overlay + dialog structure of
// BulkDeleteModal (focus trap, Escape/backdrop close) but collects name +
// description instead of confirming a destructive action.

import { useState } from 'react'
import { XIcon } from '@/components/icons'
import { useFocusTrap } from '@/components/useFocusTrap'
import { TextInput, TextArea } from '@/components/profile/primitives'

export function CreateProjectModal({
  onCreate,
  onClose,
}: {
  onCreate: (input: { name: string; description: string }) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useFocusTrap<HTMLFormElement>()

  const trimmedName = name.trim()
  const canSubmit = trimmedName.length > 0 && !saving

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setSaving(true)
    setError(null)
    try {
      await onCreate({ name: trimmedName, description: description.trim() })
    } catch {
      setError('Could not create the project. Please try again.')
      setSaving(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(20,33,58,0.42)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="New project"
        className="acct-modal"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        style={{
          width: 460,
          maxWidth: '100%',
          background: 'var(--white)',
          borderRadius: 16,
          padding: 26,
          boxShadow: '0 24px 60px rgba(20,33,58,0.28)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 22, color: 'var(--ink)' }}>
            New project
          </span>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              border: '1px solid var(--rule)',
              borderRadius: 8,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 18 }}>
          <div>
            {/* TextInput/TextArea (components/profile/primitives.tsx) don't expose an
                id, so the visible label is decorative here — aria-label below is
                what actually names the field for assistive tech. */}
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mid)', display: 'block', marginBottom: 6 }}>
              Name
            </span>
            <TextInput value={name} onChange={setName} placeholder="e.g. Q4 launch" ariaLabel="Project name" />
          </div>
          <div>
            <span className="mono" style={{ fontSize: 11, color: 'var(--ink-mid)', display: 'block', marginBottom: 6 }}>
              Description (optional)
            </span>
            <TextArea value={description} onChange={setDescription} placeholder="What is this project about?" ariaLabel="Project description" rows={3} />
          </div>
          {error && (
            <p className="mono" style={{ fontSize: 11, color: 'var(--warning-text)' }}>{error}</p>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              height: 42,
              padding: '0 16px',
              border: '1px solid var(--ink)',
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 14,
              color: 'var(--ink)',
              background: 'var(--white)',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              height: 42,
              padding: '0 16px',
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 14,
              color: '#fff',
              background: 'var(--ink)',
              opacity: canSubmit ? 1 : 0.55,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {saving ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </form>
    </div>
  )
}
