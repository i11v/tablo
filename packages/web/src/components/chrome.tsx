import type { ReactNode } from "react"
import type { WsStatus } from "../hooks/useDepartures.ts"
import type { Geo } from "../hooks/useGeo.ts"
import { TIER, type Tier } from "../lib/tier.ts"
import { SearchIcon, StopGlyph } from "./icons.tsx"

/* The canonical mark: lowercase "tablo" in Doto, closed by a square full stop
   that doubles as the live connection signal — green (make) = feed connected,
   amber (run) = degraded, red (miss) = connecting/disconnected. The stop is a
   square (not Doto's native period, which reads as a "+") sized ~0.16em so it
   matches a lit letter-dot, with a static glow — never a pulse. */
const SIGNAL_HUE: Record<WsStatus, string> = {
  live: "var(--color-make)",
  degraded: "var(--color-run)",
  connecting: "var(--color-miss)",
  reconnecting: "var(--color-miss)",
}

export const Wordmark = ({ status }: { status: WsStatus }) => {
  const hue = SIGNAL_HUE[status]
  return (
    <span className="font-accent text-[27px] font-black leading-none tracking-[0.04em] text-ink sm:text-[34px]">
      tablo
      <span
        role="img"
        aria-label={`feed ${status}`}
        className="inline-block align-baseline"
        style={{
          width: "0.16em",
          height: "0.16em",
          marginLeft: "0.05em",
          background: hue,
          boxShadow: `0 0 0.18em color-mix(in srgb, ${hue} 65%, transparent)`,
        }}
      />
    </span>
  )
}

const LegendDot = ({ tier }: { tier: Tier }) => {
  const t = TIER[tier]
  return (
    <span className="inline-flex items-center gap-[6px] font-ui text-[11.5px] font-semibold tracking-[0.02em] text-ctl-ink">
      <span className="rounded-full" style={{ width: 8, height: 8, background: t.color, boxShadow: `0 0 6px ${t.color}` }} />
      {t.label}
    </span>
  )
}

const LocationChip = ({ geo, label }: { geo: Geo; label: string | null }) => {
  const text =
    geo.tag === "active" ? (label ?? "Near you") : geo.tag === "locating" ? "Locating…" : "Location off"
  return (
    <span className="hidden items-center gap-[7px] rounded-[10px] border border-edge bg-sunken px-[12px] py-[8px] font-ui text-[13px] font-semibold text-ctl-ink sm:flex">
      <span style={{ color: geo.tag === "active" ? "var(--color-make)" : "var(--color-meta)" }}>⌖</span>
      {text}
    </span>
  )
}

const DesktopSearchTrigger = ({ open, onOpen, children }: { open: boolean; onOpen: () => void; children: ReactNode }) => (
  <span className="relative hidden sm:block">
    <button
      type="button"
      onClick={onOpen}
      aria-expanded={open}
      aria-haspopup="dialog"
      className={[
        "flex w-[260px] cursor-pointer items-center gap-[9px] rounded-[10px] border bg-sunken px-[13px] py-[9px]",
        open ? "border-edge-hover" : "border-edge",
      ].join(" ")}
    >
      <SearchIcon />
      <span className="font-ui text-[13.5px] font-medium text-faint">Add a stop…</span>
    </button>
    {children}
  </span>
)

export function AppBar({
  status,
  clock,
  geo,
  locationLabel,
  searchOpen,
  onOpenSearch,
  searchPanel,
}: {
  status: WsStatus
  clock: string
  geo: Geo
  locationLabel: string | null
  searchOpen: boolean
  onOpenSearch: () => void
  searchPanel: ReactNode
}) {
  return (
    <div className="flex shrink-0 items-center justify-between px-[16px] pt-[10px] sm:px-[28px] sm:pt-[18px]">
      <Wordmark status={status} />
      <span className="flex items-center gap-[14px] sm:gap-[16px]">
        <DesktopSearchTrigger open={searchOpen} onOpen={onOpenSearch}>
          {searchOpen && searchPanel}
        </DesktopSearchTrigger>
        <LocationChip geo={geo} label={locationLabel} />
        <span className="font-accent text-[20px] font-bold tracking-[0.06em] text-clock-dim sm:text-[28px] sm:text-clock">
          {clock}
        </span>
      </span>
    </div>
  )
}

export function SubBar({ status, count }: { status: WsStatus; count: number }) {
  const live =
    status === "live"
      ? "live"
      : status === "degraded"
        ? "degraded"
        : status === "reconnecting"
          ? "reconnecting…"
          : "connecting…"
  const lead =
    count === 0 ? "No stops yet · search to add your first" : `${count} saved ${count === 1 ? "stop" : "stops"} · pick a platform on any card`
  return (
    <div className="hidden shrink-0 items-center justify-between px-[28px] pt-[12px] pb-[16px] sm:flex">
      <span className="font-ui text-[13px] font-medium text-meta">
        {lead} · {live}
      </span>
      <span className="flex gap-[16px]">
        <LegendDot tier="make" />
        <LegendDot tier="run" />
        <LegendDot tier="miss" />
      </span>
    </div>
  )
}

/** Mobile full-width search trigger, sits inline in the scroll area. */
export function MobileSearchTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-[9px] rounded-[11px] border border-edge bg-sunken px-[14px] py-[12px] sm:hidden"
    >
      <SearchIcon />
      <span className="whitespace-nowrap font-ui text-[14.5px] font-medium text-faint">Add a stop…</span>
    </button>
  )
}

/** Desktop dashed "next slot" tile in the board grid. */
export function AddTile({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[300px] cursor-pointer flex-col items-center justify-center gap-[12px] rounded-[13px] border-[1.5px] border-dashed border-edge-2 bg-white/[0.012]"
    >
      <span className="flex h-[46px] w-[46px] items-center justify-center rounded-[12px] border-[1.5px] border-dashed border-edge-hover font-accent text-[28px] font-bold text-ghost">
        +
      </span>
      <span className="font-ui text-[14px] font-semibold text-ghost-label">Add a stop</span>
      <span className="font-ui text-[12px] font-medium text-ghost">stop or single platform</span>
    </button>
  )
}

export function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center px-[28px] py-[40px]">
      <div className="max-w-[440px] text-center">
        <div className="mb-[20px] flex justify-center">
          <StopGlyph size={68} color="var(--color-ghost-icon)" />
        </div>
        <div className="mb-[8px] font-ui text-[22px] font-extrabold text-neutral">Your board is empty</div>
        <div className="mb-[22px] font-ui text-[14.5px] font-medium leading-[1.55] text-meta">
          Add a stop — or a single platform you use every day — and tablo shows live departures with how
          likely you are to catch each one.
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex cursor-pointer items-center gap-[8px] whitespace-nowrap rounded-[11px] border-none bg-paper px-[20px] py-[11px] font-ui text-[14.5px] font-bold text-paper-ink"
        >
          <SearchIcon size={15} color="var(--color-paper-ink)" /> Add a stop
        </button>
      </div>
    </div>
  )
}
