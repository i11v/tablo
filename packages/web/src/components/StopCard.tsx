import { type CSSProperties, type ReactNode, useEffect, useState } from "react"
import type { DepartureVM } from "../lib/departureVM.ts"
import { reachTier } from "../lib/reach.ts"
import { platformKey, platformsOf, type StopVM } from "../lib/stop.ts"
import { TIER } from "../lib/tier.ts"
import { VehicleIcon, WalkIcon } from "./icons.tsx"
import { Count, Meta, PlatChip, RouteChip } from "./primitives.tsx"

const tierVars = (color: string): CSSProperties => ({ "--tier": color }) as CSSProperties
const railGlow = "0 0 9px color-mix(in srgb, var(--tier) 67%, transparent)"

// Verdict-pill ink per tier (the DS TierPill's on-make/run/miss contrast inks).
// Kept as literal class strings so Tailwind emits the utilities + their tokens.
const ON_INK: Record<string, string> = {
  make: "text-on-make",
  run: "text-on-run",
  miss: "text-on-miss",
}

function LeadRow({
  d,
  walk,
  trailing,
  showPlatMeta,
}: {
  d: DepartureVM
  walk: number | null
  trailing?: ReactNode
  showPlatMeta: boolean
}) {
  const tier = reachTier(d.inMinutes, walk)
  const info = TIER[tier]
  const glow = tier !== "neutral"
  return (
    <div
      className="grid grid-cols-[3px_22px_46px_1fr_auto] items-center gap-[10px] border-b border-white/[0.07] pt-[11px] pb-[12px]"
      style={tierVars(info.color)}
    >
      <span
        className="self-stretch rounded-[3px] bg-[var(--tier)]"
        style={{ boxShadow: glow ? railGlow : undefined }}
      />
      <VehicleIcon kind={d.kind} />
      <RouteChip route={d.route} big />
      <div className="min-w-0">
        <div className="truncate font-ui text-[17px] font-bold leading-[1.15] text-ink">
          {d.headsign}
        </div>
        <div className="mt-[3px] flex items-center gap-[8px] overflow-hidden whitespace-nowrap">
          {info.label !== "" && (
            <span
              className={`shrink-0 rounded-[4px] bg-[var(--tier)] px-[6px] py-[2px] font-ui text-[11px] font-bold tracking-[0.06em] ${ON_INK[tier]}`}
            >
              {info.label}
            </span>
          )}
          {trailing}
          {trailing === undefined && (
            <span className="min-w-0 flex-1 overflow-hidden text-ellipsis">
              <Meta delayMinutes={d.delayMinutes} platform={d.platform} showPlat={showPlatMeta} />
            </span>
          )}
        </div>
      </div>
      <Count inMinutes={d.inMinutes} atStop={d.atStop} size={38} glow={glow} />
    </div>
  )
}

function Row({
  d,
  walk,
  showPlatMeta,
  trailing,
  last,
}: {
  d: DepartureVM
  walk: number | null
  showPlatMeta: boolean
  trailing?: ReactNode
  last: boolean
}) {
  const tier = reachTier(d.inMinutes, walk)
  const glow = tier !== "neutral"
  return (
    <div
      className={[
        "grid items-center gap-[10px] py-[9px]",
        trailing ? "grid-cols-[20px_38px_1fr_auto_auto]" : "grid-cols-[20px_38px_1fr_auto]",
        last ? "" : "border-b border-white/[0.05]",
      ].join(" ")}
      style={tierVars(TIER[tier].color)}
    >
      <VehicleIcon kind={d.kind} size={20} />
      <RouteChip route={d.route} />
      <div className="min-w-0">
        <div className="truncate font-ui text-[15px] font-semibold leading-[1.2] text-ink-dim">
          {d.headsign}
        </div>
        <Meta delayMinutes={d.delayMinutes} platform={d.platform} showPlat={showPlatMeta} />
      </div>
      {trailing}
      <Count inMinutes={d.inMinutes} atStop={d.atStop} size={21} glow={glow} />
    </div>
  )
}

export function StopCard({
  s,
  max = 6,
  filterable = true,
  onClose,
}: {
  s: StopVM
  max?: number
  filterable?: boolean
  onClose?: () => void
}) {
  const plats = platformsOf(s.departures)
  const barPlats = plats.filter((p) => p.count >= 2)
  const forced = s.pin !== null && plats.some((p) => p.key === s.pin)
  const hasFilter = filterable && !forced && plats.length > 1 && barPlats.length >= 1
  const storeKey = "tablo.pf." + s.node

  const [filter, setFilter] = useState<string>(() => {
    try {
      return localStorage.getItem(storeKey) ?? "all"
    } catch {
      return "all"
    }
  })
  useEffect(() => {
    try {
      // Only persist a real choice — writing the default would leave a
      // tablo.pf.<node> key behind for every card ever rendered.
      if (filter === "all") localStorage.removeItem(storeKey)
      else localStorage.setItem(storeKey, filter)
    } catch {
      /* private mode — ignore */
    }
  }, [filter, storeKey])

  const valid = filter === "all" || plats.some((p) => p.key === filter)
  const active = forced ? s.pin! : hasFilter && valid ? filter : "all"
  const isAll = active === "all"
  const list = isAll ? s.departures : s.departures.filter((d) => platformKey(d) === active)
  const leadIdx = list.findIndex((d) => reachTier(d.inMinutes, s.walkMinutes) !== "miss")
  const lead = list[leadIdx < 0 ? 0 : leadIdx]
  const rest = list.filter((d) => d !== lead).slice(0, max)
  const sel = plats.find((p) => p.key === active)
  const chipFor = (d: DepartureVM): ReactNode =>
    hasFilter && isAll ? (
      <PlatChip
        small
        label={platformKey(d) === "Metro" ? "Metro" : `nást. ${platformKey(d)}`}
        onClick={() => setFilter(platformKey(d))}
      />
    ) : undefined

  return (
    <div className="rounded-card border border-edge bg-card px-[15px] pt-[13px] pb-[7px]">
      <div
        className={["flex items-center justify-between", hasFilter ? "mb-[9px]" : "mb-[7px]"].join(
          " ",
        )}
      >
        <span className="flex min-w-0 items-baseline gap-[8px]">
          <span className="font-ui text-[16px] font-extrabold tracking-[0.01em] text-ink">
            {s.name}
          </span>
          {forced && (
            <span className="whitespace-nowrap rounded-[6px] bg-paper px-[7px] py-[2px] font-ui text-[12px] font-bold text-paper-ink">
              {plats.find((p) => p.key === s.pin)?.label ?? `nást. ${s.pin}`}
            </span>
          )}
        </span>
        <span className="flex items-center gap-[12px] font-ui text-[12.5px] font-medium text-meta">
          {s.walkMinutes !== null && (
            <span className="inline-flex items-center gap-[5px] whitespace-nowrap">
              <WalkIcon /> {s.walkMinutes} min walk
            </span>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={`Remove ${s.name}`}
              className="cursor-pointer border-none bg-transparent p-0 text-[15px] text-ghost"
            >
              ✕
            </button>
          )}
        </span>
      </div>

      {hasFilter && (
        <div className="flex gap-[7px] overflow-x-auto pb-[11px]">
          <PlatChip label="All" active={isAll} onClick={() => setFilter("all")} />
          {barPlats.map((p) => (
            <PlatChip
              key={p.key}
              label={p.label}
              active={active === p.key}
              onClick={() => setFilter(p.key)}
            />
          ))}
        </div>
      )}

      {s.departures.length === 0 && (
        <div className="py-[16px] text-center font-ui text-[13px] text-meta">
          waiting for live data…
        </div>
      )}
      {lead && (
        <LeadRow
          d={lead}
          walk={s.walkMinutes}
          trailing={chipFor(lead)}
          showPlatMeta={!hasFilter && !forced}
        />
      )}
      {rest.map((d, i) => (
        <Row
          key={i}
          d={d}
          walk={s.walkMinutes}
          trailing={chipFor(d)}
          showPlatMeta={!hasFilter && !forced}
          last={i === rest.length - 1}
        />
      ))}

      {hasFilter && !isAll && sel && (
        <div className="py-[10px] text-center font-ui text-[11.5px] font-medium text-faint">
          {sel.label} only · {sel.dir}
        </div>
      )}
    </div>
  )
}
