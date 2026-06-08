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
          textShadow: glow ? "0 0 14px color-mix(in srgb, var(--tier) 47%, transparent)" : undefined,
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

/** Platform ("nást. A") and/or realtime delay note under a headsign. */
export const Meta = ({
  delayMinutes,
  platform,
  showPlat = true,
}: {
  delayMinutes: number
  platform: string | null
  showPlat?: boolean
}) => {
  const late = delayMinutes > 0
  const early = delayMinutes < 0
  const plat = showPlat && platform && platform !== "–" ? `nást. ${platform}` : ""
  if (!plat && !late && !early) return null
  return (
    <span className="font-ui text-[12px] font-medium text-meta">
      {plat}
      {(late || early) && (
        <span style={{ color: late ? "#e7a13a" : "#5fae7a" }}>
          {plat ? " · " : ""}
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
  <span
    onClick={onClick}
    className={[
      "shrink-0 select-none whitespace-nowrap border font-ui font-bold transition-all duration-100",
      small ? "rounded-[7px] px-[9px] py-[3px] text-[11.5px]" : "rounded-[9px] px-[12px] py-[6px] text-[12.5px]",
      active ? "border-paper bg-paper text-[#0a0a0a]" : "border-white/[0.08] bg-[#191920] text-[#b7b5ad]",
      onClick ? "cursor-pointer" : "cursor-default",
    ].join(" ")}
  >
    {label}
  </span>
)
