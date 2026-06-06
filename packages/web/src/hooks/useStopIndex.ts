import { useEffect, useState } from "react"
import { Schema } from "effect"
import { StopIndex, StopsManifest, type StopIndexEntry } from "@app/contract"

export type IndexState =
  | { _tag: "loading" }
  | { _tag: "ready"; stops: ReadonlyArray<StopIndexEntry> }
  | { _tag: "failed"; message: string }

/** IndexSource (spec §5.5): v1 loads the bundled artifact via its manifest. */
export const useStopIndex = (): IndexState => {
  const [state, setState] = useState<IndexState>({ _tag: "loading" })
  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      const manifest = Schema.decodeUnknownSync(StopsManifest)(
        await (await fetch("/data/stops-manifest.json")).json(),
      )
      const index = Schema.decodeUnknownSync(StopIndex)(
        await (await fetch(manifest.path)).json(),
      )
      if (!cancelled) setState({ _tag: "ready", stops: index.stops })
    }
    load().catch((e: unknown) => {
      if (!cancelled) setState({ _tag: "failed", message: String(e) })
    })
    return () => {
      cancelled = true
    }
  }, [])
  return state
}
