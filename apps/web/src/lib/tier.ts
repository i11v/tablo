/** Reachability tier — whether you can catch a departure given your walk time. */
export type Tier = "make" | "run" | "miss" | "neutral"

export interface TierInfo {
  /** Design-system token reference, fed to the `--tier` CSS variable on each
   * row (always consumed in a CSS context — see styles.css `--color-*`). */
  readonly color: string
  /** Short label chip on the lead row; "" hides the chip (neutral). */
  readonly label: string
}

export const TIER: Record<Tier, TierInfo> = {
  make: { color: "var(--color-make)", label: "CATCH" },
  run: { color: "var(--color-run)", label: "RUN" },
  miss: { color: "var(--color-miss)", label: "MISSED" },
  neutral: { color: "var(--color-neutral)", label: "" }, // location unknown → no urgency coloring
}

export const tierColor = (tier: Tier): string => TIER[tier].color
