/**
 * PID's ASW stop ids, as GTFS and Golemio spell them: "U539Z1P" → node 539,
 * stop 1. Rail waypoints and other non-ASW ids → null.
 */
export const parseAswStopId = (stopId: string): { node: number; stop: number } | null => {
  const m = /^U(\d+)Z(\d+)/.exec(stopId)
  return m === null ? null : { node: Number(m[1]), stop: Number(m[2]) }
}
