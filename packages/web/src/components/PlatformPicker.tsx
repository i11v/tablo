import { lazy, Suspense } from "react"
import type { CSSProperties } from "react"
import { reachTier } from "../lib/reach.ts"
import type { PlatformPick } from "../lib/platforms.ts"
import type { Origin } from "../lib/ranker.ts"
import { TIER } from "../lib/tier.ts"
import { VehicleIcon } from "./icons.tsx"
import { Count, RouteChip } from "./primitives.tsx"

const RealMap = lazy(() => import("./RealMap.tsx"))

const MAP_HEIGHT = { sheet: 220, inline: 150 } as const

const MODE_LABEL: Record<string, string> = {
  tram: "tram",
  metro: "metro",
  bus: "bus",
  train: "rail",
}

/**
 * Shared platform picker: a dark map (one pin per platform) above a walk-sorted
 * list, the two kept in sync. `sheet` (stop card) shows live countdowns and a
 * confirm bar; `inline` (search) has no live data and adds per-row.
 */
export function PlatformPicker({
  picks,
  sel,
  onSelect,
  variant,
  origin,
  center,
  onConfirm,
  onAddPlatform,
  onAddWhole,
}: {
  picks: ReadonlyArray<PlatformPick>
  sel: string | null
  onSelect: (code: string) => void
  variant: "sheet" | "inline"
  origin: Origin | null
  center: { lat: number; lon: number }
  onConfirm?: (code: string) => void
  onAddPlatform?: (code: string) => void
  onAddWhole?: () => void
}) {
  const selPick = picks.find((p) => p.code === sel)
  const selIsMetro = selPick?.kind === "metro"
  return (
    <div className="flex flex-col gap-[10px]">
      <div
        className="overflow-hidden rounded-[10px] border border-edge-2 bg-sunken"
        style={{ height: MAP_HEIGHT[variant] }}
      >
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center font-ui text-[12px] text-faint">
              loading map…
            </div>
          }
        >
          <RealMap picks={picks} sel={sel} onSelect={onSelect} origin={origin} center={center} />
        </Suspense>
      </div>

      <div className="flex flex-col">
        {picks.map((p) => (
          <PickRow
            key={p.code}
            p={p}
            active={p.code === sel}
            onSelect={() => onSelect(p.code)}
            onAdd={variant === "inline" && onAddPlatform ? () => onAddPlatform(p.code) : undefined}
          />
        ))}
      </div>

      {variant === "sheet" && onConfirm && sel !== null && (
        <button
          type="button"
          onClick={() => onConfirm(sel)}
          className="cursor-pointer rounded-[10px] border border-paper bg-paper py-[10px] font-ui text-[14px] font-bold text-paper-ink"
        >
          {selIsMetro ? "Use the metro" : `Use platform ${sel}`}
        </button>
      )}
      {variant === "inline" && onAddWhole && (
        <button
          type="button"
          onClick={onAddWhole}
          className="cursor-pointer rounded-[10px] border border-edge-2 bg-ctl py-[9px] font-ui text-[13px] font-semibold text-ctl-ink"
        >
          Add whole stop
        </button>
      )}
    </div>
  )
}

const tierVars = (color: string): CSSProperties => ({ "--tier": color }) as CSSProperties

function PickRow({
  p,
  active,
  onSelect,
  onAdd,
}: {
  p: PlatformPick
  active: boolean
  onSelect: () => void
  onAdd: (() => void) | undefined
}) {
  const tier = p.lead ? reachTier(p.lead.inMinutes, p.walkMinutes) : "neutral"
  const glow = tier !== "neutral"
  const walk = p.walkMinutes === null ? "—" : `${p.walkMinutes} min walk`
  const mode = p.kind ? MODE_LABEL[p.kind] : undefined
  return (
    <div
      className={[
        "flex items-center gap-[10px] border-b border-white/[0.05] py-[8px] last:border-b-0",
        active ? "rounded-[8px] bg-white/[0.04]" : "",
      ].join(" ")}
      style={tierVars(TIER[tier].color)}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={active}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-[10px] border-none bg-transparent p-0 text-left"
      >
        <span
          className={[
            "inline-flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-[9px] font-ui text-[13px] font-extrabold",
            active ? "bg-paper text-paper-ink" : "border border-white/[0.16] bg-ctl text-chip-muted",
          ].join(" ")}
        >
          {p.code}
        </span>
        {p.lead ? (
          <>
            <RouteChip route={p.lead.route} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-ui text-[14px] font-semibold leading-[1.2] text-ink-dim">
                {p.lead.headsign}
              </span>
              <span className="flex items-center gap-[5px] font-ui text-[12px] font-medium text-meta">
                {p.kind && <VehicleIcon kind={p.kind} size={13} />}
                {walk}
                {mode && ` · ${mode}`}
              </span>
            </span>
          </>
        ) : (
          <span className="min-w-0 flex-1 font-ui text-[12.5px] font-medium text-meta">{walk}</span>
        )}
      </button>
      {p.lead && (
        <Count inMinutes={p.lead.inMinutes} atStop={p.lead.atStop} size={21} glow={glow} />
      )}
      {onAdd && (
        <button
          type="button"
          onClick={onAdd}
          aria-label={`Add platform ${p.code}`}
          className="shrink-0 cursor-pointer rounded-[8px] border border-white/[0.12] bg-ctl px-[10px] py-[5px] font-ui text-[12px] font-bold text-ctl-ink"
        >
          Add
        </button>
      )}
    </div>
  )
}
