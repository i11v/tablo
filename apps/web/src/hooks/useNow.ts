import { useEffect, useState } from "react"

/** Ticks once per second — drives all countdowns with zero network traffic. */
export const useNow = (): number => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}
