import type { Departure } from "@app/contract"

export interface Countdown {
  readonly label: string
  readonly imminent: boolean // under a minute
  readonly gone: boolean     // departed > 30s ago, drop from display
}

export const countdown = (dep: Departure, nowMs: number): Countdown => {
  const t = Date.parse(dep.predicted ?? dep.scheduled)
  const diff = t - nowMs
  if (diff < -30_000) return { label: "", imminent: true, gone: true }
  if (diff < 15_000) return { label: "now", imminent: true, gone: false }
  if (diff < 60_000) return { label: Math.round(diff / 1000) + " s", imminent: true, gone: false }
  return { label: Math.floor(diff / 60_000) + " min", imminent: false, gone: false }
}
