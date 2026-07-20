import type { VehicleKind } from "@app/contract"

/** Kinds shown as chips. `other` is not a chip — it rides the `bus` toggle. */
const CHIP_KINDS: ReadonlyArray<VehicleKind> = ["tram", "bus", "metro", "train"]

const LABEL: Record<string, string> = {
  tram: "Tram",
  bus: "Bus",
  metro: "Metro",
  train: "Train",
}

/** Horizontal chip row (top-center overlay). Checked = solid, unchecked = outline. */
export function FilterChips({
  kinds,
  onToggle,
}: {
  kinds: ReadonlySet<VehicleKind>
  onToggle: (kind: VehicleKind) => void
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[10px] z-10 flex justify-center">
      <div className="pointer-events-auto flex gap-[7px] rounded-[12px] border border-edge bg-card/90 px-[8px] py-[7px] shadow-lg backdrop-blur">
        {CHIP_KINDS.map((k) => {
          const on = kinds.has(k)
          return (
            <button
              key={k}
              type="button"
              onClick={() => onToggle(k)}
              aria-pressed={on}
              className={[
                "cursor-pointer select-none whitespace-nowrap rounded-[9px] border px-[12px] py-[6px] font-ui text-[12.5px] font-bold transition-all duration-100",
                on
                  ? "border-paper bg-paper text-paper-ink"
                  : "border-white/[0.08] bg-ctl text-chip-muted",
              ].join(" ")}
            >
              {LABEL[k]}
            </button>
          )
        })}
      </div>
    </div>
  )
}
