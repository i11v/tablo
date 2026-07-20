/** Linear interpolation between `a` and `b` at `t` ∈ [0, 1]. */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** Interpolate bearings along the shortest arc, result normalized to [0, 360). */
export const lerpAngle = (a: number, b: number, t: number): number => {
  const diff = ((b - a + 540) % 360) - 180
  return (a + diff * t + 360) % 360
}
