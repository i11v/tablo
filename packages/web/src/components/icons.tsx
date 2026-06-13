import type { VehicleKind } from "@app/contract"

export const SearchIcon = ({ size = 15, color = "var(--color-faint)" }: { size?: number; color?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 15 15"
    fill="none"
    stroke={color}
    strokeWidth="1.5"
    strokeLinecap="round"
  >
    <circle cx="6.5" cy="6.5" r="5" />
    <path d="M10.5 10.5 L14 14" />
  </svg>
)

export const WalkIcon = () => (
  <svg
    width="10"
    height="14"
    viewBox="0 0 10 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.3"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="5.4" cy="2" r="1.5" fill="currentColor" stroke="none" />
    <path d="M5.4 4.6 V8.2 M5.4 8.2 L3.4 12.6 M5.4 8.2 L7.4 12 M5.4 6 L7.6 7" />
  </svg>
)

export const StopGlyph = ({ size = 30, color = "var(--color-icon)" }: { size?: number; color?: string }) => (
  <span
    className="inline-flex shrink-0 items-center justify-center bg-ctl border border-white/[0.08]"
    style={{ width: size, height: size, borderRadius: size * 0.3 }}
  >
    <svg
      width={size * 0.5}
      height={size * 0.5}
      viewBox="0 0 16 16"
      fill="none"
      stroke={color}
      strokeWidth="1.6"
    >
      <rect x="4" y="2.5" width="8" height="9" rx="2" />
      <path d="M5 13 L4 14.5 M11 13 L12 14.5 M4.5 9 H11.5" />
    </svg>
  </span>
)

// Folded paper-map glyph — opens the spatial platform picker.
export const MapIcon = ({ size = 18, color = "var(--color-icon)" }: { size?: number; color?: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M9 4 L3 6 V20 L9 18 L15 20 L21 18 V4 L15 6 L9 4 Z" />
    <path d="M9 4 V18 M15 6 V20" />
  </svg>
)

// Vehicle pictogram — mode by shape (tram has a pantograph pole, bus/train
// don't, metro is an M roundel). Monochrome so the reachability color stays
// unambiguous.
export const VehicleIcon = ({ kind, size = 22 }: { kind: VehicleKind; size?: number }) => {
  const col = "var(--color-icon)"
  if (kind === "metro") {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-[6px] font-ui font-extrabold leading-none"
        style={{ width: size, height: size, border: `1.6px solid ${col}`, color: col, fontSize: size * 0.6 }}
      >
        M
      </span>
    )
  }
  const tram = kind === "tram"
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={col}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      {tram && <path d="M12 1.5 V4" />}
      <rect x={tram ? 4.5 : 3.5} y="4" width={tram ? 15 : 17} height="14" rx="3.2" />
      <line x1={tram ? 5 : 4} y1="9.6" x2={tram ? 19 : 20} y2="9.6" />
      <circle cx={tram ? 8.5 : 8} cy="20" r="1.25" fill={col} stroke="none" />
      <circle cx={tram ? 15.5 : 16} cy="20" r="1.25" fill={col} stroke="none" />
    </svg>
  )
}
