import { useEffect, useState } from "react"

/**
 * The given value, updated only once it has been stable for `ms`. The initial
 * value passes through immediately (state starts from it), so only *changes*
 * pay the delay — a list that is right on first render isn't held back.
 */
export const useDebounced = <T>(value: T, ms: number): T => {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    if (Object.is(value, debounced)) return
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms, debounced])
  return debounced
}
