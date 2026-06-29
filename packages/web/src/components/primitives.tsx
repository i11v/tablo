import { formatClock } from "../lib/time.ts"

/** Route badge — e.g. "9", "B", "S7". */
export const RouteChip = ({ route, big }: { route: string; big?: boolean }) => (
  <span
    className={[
      "inline-flex shrink-0 items-center justify-center rounded-chip bg-chip font-ui font-extrabold text-chip-ink border border-white/[0.06]",
      big ? "w-[46px] h-[36px] text-[19px]" : "w-[38px] h-[28px] text-[15px]",
    ].join(" ")}
  >
    {route}
  </span>
)

/**
 * The countdown number. Color + glow come from the inherited `--tier` variable
 * (set on the row); `glow` is off for the neutral tier (location unknown).
 */
export const Count = ({
  inMinutes,
  atStop,
  size,
  glow,
}: {
  inMinutes: number
  atStop: boolean
  size: number
  glow: boolean
}) => {
  const txt = atStop ? "NOW" : inMinutes === 0 ? "<1" : String(inMinutes)
  return (
    <span className="inline-flex items-baseline gap-[2px] text-[var(--tier)]">
      <span
        className="font-accent font-bold leading-[0.8] tracking-[0.02em]"
        style={{
          fontSize: size,
          textShadow: glow
            ? "0 0 14px color-mix(in srgb, var(--tier) 47%, transparent)"
            : undefined,
        }}
      >
        {txt}
      </span>
      {size >= 30 && !atStop && inMinutes !== 0 && (
        <span className="font-ui font-bold" style={{ fontSize: size * 0.34 }}>
          min
        </span>
      )}
    </span>
  )
}

/** Platform ("nást. A") note under a headsign. */
export const Meta = ({
  platform,
  showPlat = true,
}: {
  platform: string | null
  showPlat?: boolean
}) => {
  const plat = showPlat && platform && platform !== "–" ? `nást. ${platform}` : ""
  if (!plat) return null
  return <span className="font-ui text-[12px] font-medium text-meta">{plat}</span>
}

/**
 * Absolute wall-clock arrival time — secondary to the countdown, shown beneath
 * it. The realtime delay (signed minutes vs schedule) sits next to it.
 */
export const ArrivalTime = ({
  arrivalMs,
  delayMinutes,
  big,
}: {
  arrivalMs: number
  delayMinutes: number
  big?: boolean
}) => {
  const late = delayMinutes > 0
  const early = delayMinutes < 0
  return (
    <span
      className={[
        "inline-flex items-baseline gap-[5px] whitespace-nowrap font-ui font-medium",
        big ? "text-[12px]" : "text-[11px]",
      ].join(" ")}
    >
      <span className="text-meta">{formatClock(arrivalMs)}</span>
      {(late || early) && (
        <span className={late ? "text-late" : "text-early"}>
          {late ? "+" : ""}
          {delayMinutes} min
        </span>
      )}
    </span>
  )
}

/** Platform filter / selector pill. Light when active. */
export const PlatChip = ({
  label,
  active,
  onClick,
  small,
}: {
  label: string
  active?: boolean
  onClick?: () => void
  small?: boolean
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={[
      "shrink-0 select-none whitespace-nowrap border font-ui font-bold transition-all duration-100",
      small
        ? "rounded-[7px] px-[9px] py-[3px] text-[11.5px]"
        : "rounded-[9px] px-[12px] py-[6px] text-[12.5px]",
      active
        ? "border-paper bg-paper text-paper-ink"
        : "border-white/[0.08] bg-ctl text-chip-muted",
      onClick ? "cursor-pointer" : "cursor-default",
    ].join(" ")}
  >
    {label}
  </button>
)
