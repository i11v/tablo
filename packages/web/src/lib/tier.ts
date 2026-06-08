/** Reachability tier — whether you can catch a departure given your walk time. */
export type Tier = "make" | "run" | "miss" | "neutral"

export interface TierInfo {
  /** Hex color, fed to the `--tier` CSS variable on each row. */
  readonly color: string
  /** Short label chip on the lead row; "" hides the chip (neutral). */
  readonly label: string
}

export const TIER: Record<Tier, TierInfo> = {
  make: { color: "#22e06b", label: "CATCH" },
  run: { color: "#ffb02e", label: "RUN" },
  miss: { color: "#ff3b4e", label: "MISSED" },
  neutral: { color: "#c9c7c0", label: "" }, // location unknown → no urgency coloring
}

export const tierColor = (tier: Tier): string => TIER[tier].color
