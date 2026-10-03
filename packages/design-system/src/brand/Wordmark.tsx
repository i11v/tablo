import type { CSSProperties } from "react"

export type WordmarkSignal = "fullstop" | "pip"

export interface WordmarkProps {
  /** Glyph size in px — also drives the signal square + letter tracking. */
  size?: number
  /** Render the connection signal at all. Drop (`false`) for static / print. */
  live?: boolean
  /** Live backend-feed state: `true` → green (`--make`), `false` → red (`--miss`). */
  connected?: boolean
  /**
   * `"fullstop"` (default, canonical) — the green period **is** the signal: `tablo.`
   * `"pip"` — legacy floating round status dot to the right of the word.
   */
  signal?: WordmarkSignal
  /** Word color (the signal hue is always make/miss). */
  color?: string
  style?: CSSProperties
}

/**
 * tablo — Wordmark. The brand lockup: lowercase "tablo" set in Doto (the LED
 * accent face) with the live connection signal. The signal is NOT decoration —
 * it reports the live backend feed: green (`--make`) connected, red (`--miss`)
 * disconnected. Never capitalise the wordmark.
 *
 * The full-stop (`signal="fullstop"`) is the canonical mark — a green square the
 * size of ~1.6 letter-dots, resting on the baseline. Use `signal="pip"` only
 * where a detached round dot is wanted (legacy app-bar).
 */
export function Wordmark({
  size = 34,
  live = true,
  connected = true,
  signal = "fullstop",
  color = "var(--ink)",
  style,
}: WordmarkProps) {
  const hue = connected ? "var(--make)" : "var(--miss)"
  const word: CSSProperties = {
    fontFamily: "var(--font-accent)",
    fontWeight: 900, // --fw-black
    fontSize: size,
    letterSpacing: "var(--track-led)",
    lineHeight: 1,
    color,
  }

  /* ── full stop — the green period doubles as the live signal ───────────── */
  if (signal === "fullstop") {
    const sq = Math.round(size * 0.16) // ~1.6 letter-dots, baseline-aligned
    return (
      <span style={{ ...word, ...style }}>
        tablo
        {live && (
          <span
            role="img"
            aria-label={connected ? "Connected" : "Disconnected"}
            style={{
              display: "inline-block",
              verticalAlign: "baseline",
              width: sq,
              height: sq,
              marginLeft: Math.round(size * 0.05),
              background: hue,
              boxShadow: `0 0 ${Math.round(sq * 1.1)}px color-mix(in srgb, ${hue} 65%, transparent)`,
            }}
          />
        )}
      </span>
    )
  }

  /* ── pip — round status dot to the right of the word ───────────────────── */
  const dot = Math.max(7, Math.round(size * 0.26))
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size * 0.32,
        lineHeight: 1,
        ...style,
      }}
    >
      <span style={word}>tablo</span>
      {live && (
        <span
          role="img"
          aria-label={connected ? "Connected" : "Disconnected"}
          style={{
            flex: "0 0 auto",
            width: dot,
            height: dot,
            borderRadius: dot,
            background: hue,
            boxShadow: `0 0 10px ${hue}`,
            /* Doto sits low in its line box — nudge the pip to the glyph's optical centre. */
            transform: `translateY(${size * 0.06}px)`,
          }}
        />
      )}
    </span>
  )
}
