import type { ReactNode } from "react"
import type { WsStatus } from "../hooks/useDepartures.ts"
import type { Geo } from "../hooks/useGeo.ts"
import { TIER, type Tier } from "../lib/tier.ts"
import { SearchIcon, StopGlyph } from "./icons.tsx"

const STATUS: Record<WsStatus, { color: string; pulse: boolean }> = {
  live: { color: "#22e06b", pulse: false },
  degraded: { color: "#ffb02e", pulse: false },
  connecting: { color: "#ff3b4e", pulse: true },
  reconnecting: { color: "#ff3b4e", pulse: true },
}

export const StatusDot = ({ status }: { status: WsStatus }) => {
  const s = STATUS[status]
  return (
    <span
      role="img"
      aria-label={`feed ${status}`}
      className={["inline-block rounded-full", s.pulse ? "animate-pulse" : ""].join(" ")}
      style={{ width: 9, height: 9, background: s.color, boxShadow: `0 0 10px ${s.color}` }}
    />
  )
}

const LegendDot = ({ tier }: { tier: Tier }) => {
  const t = TIER[tier]
  return (
    <span className="inline-flex items-center gap-[6px] font-ui text-[11.5px] font-semibold tracking-[0.02em] text-[#9a9aa2]">
      <span className="rounded-full" style={{ width: 8, height: 8, background: t.color, boxShadow: `0 0 6px ${t.color}` }} />
      {t.label}
    </span>
  )
}

const LocationChip = ({ geo, label }: { geo: Geo; label: string | null }) => {
  const text =
    geo.tag === "active" ? (label ?? "Near you") : geo.tag === "locating" ? "Locating…" : "Location off"
  return (
    <span className="hidden items-center gap-[7px] rounded-[10px] border border-edge bg-[#0d0d11] px-[12px] py-[8px] font-ui text-[13px] font-semibold text-[#a7a7af] sm:flex">
      <span style={{ color: geo.tag === "active" ? "#22e06b" : "#76767e" }}>⌖</span>
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
        "flex w-[260px] cursor-pointer items-center gap-[9px] rounded-[10px] border bg-[#0d0d11] px-[13px] py-[9px]",
        open ? "border-[#3a3a44]" : "border-edge",
      ].join(" ")}
    >
      <SearchIcon />
      <span className="font-ui text-[13.5px] font-medium text-[#5e5e66]">Add a stop…</span>
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
      <span className="flex items-center gap-[10px]">
        <span className="font-accent text-[27px] font-black tracking-[0.04em] text-ink sm:text-[34px]">tablo</span>
        <StatusDot status={status} />
      </span>
      <span className="flex items-center gap-[14px] sm:gap-[16px]">
        <DesktopSearchTrigger open={searchOpen} onOpen={onOpenSearch}>
          {searchOpen && searchPanel}
        </DesktopSearchTrigger>
        <LocationChip geo={geo} label={locationLabel} />
        <span className="font-accent text-[20px] font-bold tracking-[0.06em] text-[#85858d] sm:text-[28px] sm:text-[#b9b9c0]">
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
      className="flex w-full cursor-pointer items-center gap-[9px] rounded-[11px] border border-edge bg-[#0c0c0f] px-[14px] py-[12px] sm:hidden"
    >
      <SearchIcon />
      <span className="whitespace-nowrap font-ui text-[14.5px] font-medium text-[#5e5e66]">Add a stop…</span>
    </button>
  )
}

/** Desktop dashed "next slot" tile in the board grid. */
export function AddTile({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[300px] cursor-pointer flex-col items-center justify-center gap-[12px] rounded-[13px] border-[1.5px] border-dashed border-[#2c2c34] bg-white/[0.012]"
    >
      <span className="flex h-[46px] w-[46px] items-center justify-center rounded-[12px] border-[1.5px] border-dashed border-[#3a3a44] font-accent text-[28px] font-bold text-[#54545c]">
        +
      </span>
      <span className="font-ui text-[14px] font-semibold text-[#6b6b73]">Add a stop</span>
      <span className="font-ui text-[12px] font-medium text-[#4a4a52]">stop or single platform</span>
    </button>
  )
}

export function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center px-[28px] py-[40px]">
      <div className="max-w-[440px] text-center">
        <div className="mb-[20px] flex justify-center">
          <StopGlyph size={68} color="#3f3f47" />
        </div>
        <div className="mb-[8px] font-ui text-[22px] font-extrabold text-[#c9c7c0]">Your board is empty</div>
        <div className="mb-[22px] font-ui text-[14.5px] font-medium leading-[1.55] text-[#76767e]">
          Add a stop — or a single platform you use every day — and tablo shows live departures with how
          likely you are to catch each one.
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex cursor-pointer items-center gap-[8px] whitespace-nowrap rounded-[11px] border-none bg-paper px-[20px] py-[11px] font-ui text-[14.5px] font-bold text-[#0a0a0a]"
        >
          <SearchIcon size={15} color="#0a0a0a" /> Add a stop
        </button>
      </div>
    </div>
  )
}
