import type { CSSProperties } from "react"

export interface AppIconProps {
  /** Square size in px. */
  size?: number
  /**
   * `true` (default) previews the installed (on-device) rounded look.
   * Export the master with `rounded={false}` — full-bleed square; iOS/Android
   * apply their own corner mask, so never bake rounded corners into the asset.
   */
  rounded?: boolean
  style?: CSSProperties
}

/**
 * tablo — AppIcon. The mark reduced to its initial: a Doto "t" + the brand full
 * stop (green `--make` square, ~1.6 letter-dots, on the baseline) on the warm
 * board ground. Same signal language as the Wordmark, scaled to a single glyph.
 * The icon represents the app — which is "live" by definition — so the full stop
 * stays green here.
 */
export function AppIcon({ size = 200, rounded = true, style }: AppIconProps) {
  const fs = Math.round(size * 0.6) // glyph size
  const sq = Math.round(fs * 0.16) // brand full stop (option-D proportion)
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: rounded ? Math.round(size * 0.2237) : 0, // iOS superellipse approx
        background: "var(--bg)",
        backgroundImage: "radial-gradient(125% 95% at 50% 0%, #17171d, #08080a 70%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        ...style,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-accent)",
          fontWeight: 900, // --fw-black
          fontSize: fs,
          letterSpacing: "var(--track-led)",
          lineHeight: 1,
          /* optical centring — the baseline full stop pulls visual weight down */
          transform: `translateY(${-Math.round(size * 0.035)}px)`,
        }}
      >
        <span style={{ color: "var(--ink)" }}>t</span>
        <span
          aria-hidden
          style={{
            display: "inline-block",
            verticalAlign: "baseline",
            width: sq,
            height: sq,
            marginLeft: Math.round(fs * 0.05),
            background: "var(--make)",
            boxShadow: `0 0 ${Math.round(sq * 1.1)}px color-mix(in srgb, var(--make) 70%, transparent)`,
          }}
        />
      </span>
    </div>
  )
}
