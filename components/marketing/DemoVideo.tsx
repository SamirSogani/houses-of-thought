// Reusable demo-video embed. Accepts a video URL (YouTube/Vimeo embed or
// self-hosted mp4) and shows a thumbnail with a play overlay; clicking expands
// it to play inline. When no URL is provided, renders a placeholder state with
// a "coming soon" message.

'use client'

import { useState } from 'react'

interface DemoVideoProps {
  /** YouTube/Vimeo embed URL or self-hosted mp4. Omit for "coming soon" placeholder. */
  videoUrl?: string
  /** Optional custom placeholder text. */
  placeholderText?: string
  /** Optional thumbnail image URL. Without one, a styled placeholder is shown. */
  thumbnailUrl?: string
}

function PlayIcon() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="32" cy="32" r="32" fill="rgba(0,0,0,0.55)" />
      <path d="M26 20L46 32L26 44V20Z" fill="white" />
    </svg>
  )
}

/** Returns an embeddable iframe URL from a YouTube or Vimeo watch/share URL. */
function toEmbedUrl(url: string): string | null {
  // YouTube: youtube.com/watch?v=ID or youtu.be/ID
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]+)/)
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}?autoplay=1&rel=0`

  // Already an embed URL
  if (url.includes('youtube.com/embed/')) return url + (url.includes('?') ? '&' : '?') + 'autoplay=1'

  // Vimeo: vimeo.com/ID
  const vmMatch = url.match(/vimeo\.com\/(\d+)/)
  if (vmMatch) return `https://player.vimeo.com/video/${vmMatch[1]}?autoplay=1`

  // Already a Vimeo embed
  if (url.includes('player.vimeo.com/')) return url + (url.includes('?') ? '&' : '?') + 'autoplay=1'

  // Self-hosted mp4 — handled by <video>, not iframe
  return null
}

function isMp4(url: string): boolean {
  return /\.mp4(\?|$)/i.test(url)
}

export default function DemoVideo({
  videoUrl,
  placeholderText = 'Demo video coming soon — 60-second walkthrough of building a house',
  thumbnailUrl,
}: DemoVideoProps) {
  const [playing, setPlaying] = useState(false)

  // Placeholder state: no video URL provided yet.
  if (!videoUrl) {
    return (
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '16 / 9',
          borderRadius: 12,
          overflow: 'hidden',
          background: 'rgba(0,0,0,0.03)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          border: '1px solid rgba(0,0,0,0.08)',
        }}
      >
        <div style={{ opacity: 0.35 }}>
          <PlayIcon />
        </div>
        <p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 15,
            color: 'rgba(0,0,0,0.35)',
            textAlign: 'center',
            maxWidth: '36ch',
            lineHeight: 1.5,
          }}
        >
          {placeholderText}
        </p>
      </div>
    )
  }

  const embedUrl = toEmbedUrl(videoUrl)
  const mp4 = isMp4(videoUrl)

  // Playing state: show the embedded player.
  if (playing) {
    return (
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '16 / 9',
          borderRadius: 12,
          overflow: 'hidden',
          background: '#000',
        }}
      >
        {mp4 ? (
          <video
            src={videoUrl}
            autoPlay
            controls
            playsInline
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        ) : embedUrl ? (
          <iframe
            src={embedUrl}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            style={{ width: '100%', height: '100%', border: 'none' }}
            title="Demo video"
          />
        ) : (
          // Fallback for unknown URL shapes: open in a basic video tag
          <video
            src={videoUrl}
            autoPlay
            controls
            playsInline
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          />
        )}
      </div>
    )
  }

  // Thumbnail state: show the play button overlay.
  return (
    <button
      onClick={() => setPlaying(true)}
      aria-label="Play demo video"
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '16 / 9',
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid rgba(0,0,0,0.08)',
        background: thumbnailUrl ? `url(${thumbnailUrl}) center / cover no-repeat` : 'rgba(0,0,0,0.03)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 0,
      }}
    >
      {!thumbnailUrl && (
        <p
          style={{
            position: 'absolute',
            bottom: 20,
            left: 0,
            right: 0,
            fontFamily: 'var(--font-body)',
            fontSize: 14,
            color: 'rgba(0,0,0,0.35)',
            textAlign: 'center',
          }}
        >
          Click to play
        </p>
      )}
      <div
        style={{
          transition: 'transform 0.2s',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1.1)' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)' }}
      >
        <PlayIcon />
      </div>
    </button>
  )
}
