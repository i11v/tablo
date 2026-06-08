import { useEffect, useState } from "react"

export type Geo =
  | { tag: "locating" }
  | { tag: "denied" } // denied, unsupported, or errored — same neutral behavior
  | { tag: "active"; lat: number; lon: number }

const supported = (): boolean =>
  typeof navigator !== "undefined" && "geolocation" in navigator

/** Watches device location; drives walk-time + the location chip. Never throws. */
export const useGeo = (): Geo => {
  const [geo, setGeo] = useState<Geo>(() => (supported() ? { tag: "locating" } : { tag: "denied" }))

  useEffect(() => {
    if (!supported()) {
      setGeo({ tag: "denied" })
      return
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => setGeo({ tag: "active", lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => setGeo({ tag: "denied" }),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 15_000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  return geo
}
