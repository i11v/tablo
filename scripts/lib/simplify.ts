type Pt = [number, number]

const perpDist = (p: Pt, a: Pt, b: Pt): number => {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/** Douglas-Peucker, iterative. Tolerance is in the input's units (degrees). */
export const simplify = (points: Pt[], tolerance: number): Pt[] => {
  if (points.length <= 2) return points
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!
    let maxDist = 0
    let maxIdx = -1
    for (let i = lo + 1; i < hi; i++) {
      const d = perpDist(points[i], points[lo], points[hi])
      if (d > maxDist) {
        maxDist = d
        maxIdx = i
      }
    }
    if (maxDist > tolerance) {
      keep[maxIdx] = 1
      stack.push([lo, maxIdx], [maxIdx, hi])
    }
  }
  return points.filter((_, i) => keep[i] === 1)
}
