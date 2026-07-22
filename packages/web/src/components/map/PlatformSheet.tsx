import type { StopBoard, StopIndexEntry, StopPlatform } from "@app/contract"
import { useNow } from "../../hooks/useNow.ts"
import { boardToDepartures, type DepartureVM } from "../../lib/departureVM.ts"
import { selectionStore } from "../../store.ts"
import { VehicleIcon } from "../icons.tsx"
import { RouteChip } from "../primitives.tsx"

function DepRow({ d }: { d: DepartureVM }) {
  const late = d.delayMinutes > 0
  return (
    <div className="grid grid-cols-[20px_38px_1fr_auto] items-center gap-[10px] border-b border-white/[0.05] py-[9px]">
      <VehicleIcon kind={d.kind} size={20} />
      <RouteChip route={d.route} />
      <div className="min-w-0">
        <div className="truncate font-ui text-[15px] font-semibold leading-[1.2] text-ink-dim">
          {d.headsign}
        </div>
      </div>
      <div className="flex items-baseline gap-[6px] whitespace-nowrap">
        <span className="font-accent text-[19px] font-bold leading-none text-ink">
          {d.atStop ? "NOW" : d.inMinutes === 0 ? "<1" : d.inMinutes}
        </span>
        {!d.atStop && d.inMinutes !== 0 && (
          <span className="font-ui text-[11px] font-bold text-meta">min</span>
        )}
        {late && (
          <span className="font-ui text-[11px] font-medium text-late">+{d.delayMinutes}</span>
        )}
      </div>
    </div>
  )
}

/** Fixed bottom sheet showing the tapped platform's live departures. */
export function PlatformSheet({
  entry,
  platform,
  board,
  onClose,
}: {
  entry: StopIndexEntry
  platform: StopPlatform
  board: StopBoard | undefined
  onClose: () => void
}) {
  const now = useNow()
  const departures = board === undefined ? [] : boardToDepartures(board, now)

  const pin = (): void => {
    selectionStore.actions.add({ node: entry.node, stops: [platform.stop] }, entry.name)
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 max-h-[45vh] overflow-y-auto rounded-t-[16px] border-t border-edge bg-card px-[16px] pt-[13px] pb-[18px] shadow-[0_-8px_24px_rgba(0,0,0,0.5)]">
      <div className="mb-[10px] flex items-center justify-between">
        <span className="flex min-w-0 items-baseline gap-[8px]">
          <span className="truncate font-ui text-[16px] font-extrabold tracking-[0.01em] text-ink">
            {entry.name}
          </span>
          <span className="whitespace-nowrap rounded-[6px] bg-paper px-[7px] py-[2px] font-ui text-[12px] font-bold text-paper-ink">
            nást. {platform.code}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-[12px]">
          <button
            type="button"
            onClick={pin}
            className="cursor-pointer whitespace-nowrap rounded-[9px] border-none bg-paper px-[12px] py-[6px] font-ui text-[12.5px] font-bold text-paper-ink"
          >
            Pin to board
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer border-none bg-transparent p-0 text-[16px] text-ghost"
          >
            ✕
          </button>
        </span>
      </div>

      {departures.length === 0 ? (
        <div className="py-[16px] text-center font-ui text-[13px] text-meta">
          waiting for live data…
        </div>
      ) : (
        departures.map((d, i) => <DepRow key={i} d={d} />)
      )}
    </div>
  )
}
