import { useMemo } from "react"
import { queryOptions, useQueries, useQuery } from "@tanstack/react-query"
import { Schema } from "effect"
import {
  type RouteInfo,
  RoutesAsset,
  ShapeAsset,
  type ShapeAsset as Shape,
  StopsManifest,
} from "@app/contract"

// All assets here are content-hashed and immutable, so every query is
// staleTime/gcTime Infinity — fetch once per session, never refetch.
const manifestQuery = queryOptions({
  queryKey: ["stops-manifest"],
  queryFn: async () =>
    Schema.decodeUnknownSync(StopsManifest)(
      await (await fetch("/data/stops-manifest.json")).json(),
    ),
  staleTime: Infinity,
  gcTime: Infinity,
})

/** routeId -> RouteInfo for the whole network (one small hashed file). */
export const useRoutesTable = (): ReadonlyMap<string, RouteInfo> | null => {
  const manifest = useQuery(manifestQuery)
  const routes = useQuery(
    queryOptions({
      queryKey: ["routes", manifest.data?.routesPath ?? ""],
      enabled: manifest.data !== undefined,
      queryFn: async () =>
        Schema.decodeUnknownSync(RoutesAsset)(
          await (await fetch(manifest.data!.routesPath)).json(),
        ),
      staleTime: Infinity,
      gcTime: Infinity,
    }),
  )
  return useMemo(
    () => (routes.data === undefined ? null : new Map(routes.data.map((r) => [r.id, r]))),
    [routes.data],
  )
}

/** Shapes for the focused stop's routes, fetched individually and cached. */
export const useShapes = (infos: ReadonlyArray<RouteInfo>): ReadonlyArray<Shape> =>
  useQueries({
    queries: infos.map((r) => ({
      queryKey: ["shape", r.shapePath],
      queryFn: async (): Promise<Shape> =>
        Schema.decodeUnknownSync(ShapeAsset)(await (await fetch(r.shapePath)).json()),
      staleTime: Infinity,
      gcTime: Infinity,
    })),
    combine: (results) => results.flatMap((q) => (q.data === undefined ? [] : [q.data])),
  })
