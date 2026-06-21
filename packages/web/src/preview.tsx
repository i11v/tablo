import type { ReactNode } from "react"
import { createRoot } from "react-dom/client"
import type { VehicleKind } from "@app/contract"
import { AddTile, AppBar, EmptyState, SubBar } from "./components/chrome.tsx"
import { StopCard } from "./components/StopCard.tsx"
import type { DepartureVM } from "./lib/departureVM.ts"
import type { StopVM } from "./lib/stop.ts"
import "./styles.css"

const d = (
  route: string,
  kind: VehicleKind,
  headsign: string,
  platform: string | null,
  inMinutes: number,
  delayMinutes = 0,
  atStop = false,
): DepartureVM => ({
  route,
  kind,
  headsign,
  platform,
  inMinutes,
  atStop,
  delayMinutes,
  sortKey: inMinutes,
})

// walk=3 → the first catchable departure is a comfortable "make" (green lead),
// with the two imminent ones shown as misses.
const andel: StopVM = {
  node: 1040,
  name: "Anděl",
  walkMinutes: 3,
  pin: null,
  departures: [
    d("20", "tram", "Dědina", "J", 1),
    d("137", "bus", "U Waltrovky", "O", 2),
    d("15", "tram", "Sídliště Barrandov", "D", 5),
    d("B", "metro", "Černý Most", "–", 6),
    d("5", "tram", "Vozovna Žižkov", "J", 7, 1),
    d("167", "bus", "Nemocnice Na Homolce", "B", 9),
  ],
}

// two busy platforms (A, B) → platform filter chips.
const mustek: StopVM = {
  node: 1072,
  name: "Můstek",
  walkMinutes: 2,
  pin: null,
  departures: [
    d("3", "tram", "Nádraží Braník", "A", 0),
    d("24", "tram", "Vozovna Kobylisy", "B", 1, 3),
    d("9", "tram", "Spojovací", "B", 2, 2),
    d("3", "tram", "Kobylisy", "B", 3, 1),
    d("24", "tram", "Spořilov", "A", 4),
    d("9", "tram", "Sídliště Řepy", "A", 6, 1),
  ],
}

// a tram boarding now + a mix of run/make.
const pavlova: StopVM = {
  node: 190,
  name: "I. P. Pavlova",
  walkMinutes: 1,
  pin: null,
  departures: [
    d("16", "tram", "Lehovec", "B", 0, 1, true),
    d("4", "tram", "Radlická", "A", 1, 1),
    d("C", "metro", "Háje", "2", 1),
    d("23", "tram", "Zvonařka", "B", 2),
    d("C", "metro", "Letňany", "1", 3),
    d("10", "tram", "Sídliště Řepy", "A", 4, -1),
  ],
}

// pinned to a single platform → pin badge, no filter bar.
const namesti: StopVM = {
  node: 476,
  name: "Náměstí Míru",
  walkMinutes: 1,
  pin: "A",
  departures: [
    d("22", "tram", "Vypich", "A", 1, 1),
    d("10", "tram", "Sídliště Řepy", "A", 2, -1),
    d("21", "tram", "Slivenec", "A", 3, 1),
    d("4", "tram", "Čechovo náměstí", "A", 5, 1),
  ],
}

const SEED = [andel, mustek, pavlova, namesti]

function Scene({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-white/[0.05]">
      <div className="px-[16px] pt-[18px] font-ui text-[11px] font-bold uppercase tracking-[0.12em] text-faint sm:px-[28px]">
        {title}
      </div>
      {children}
    </div>
  )
}

function Preview() {
  const geo = { tag: "active" as const, lat: 50.0755, lon: 14.4378 }
  return (
    <div className="flex min-h-full flex-col">
      <Scene title="Board · live data, mixed reachability">
        <AppBar
          status="live"
          clock="13:29"
          geo={geo}
          locationLabel="Karlovo náměstí"
          onOpenSearch={() => {}}
        />
        <SubBar status="live" count={SEED.length} />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] items-start gap-[16px] px-[16px] pb-[28px] sm:px-[28px]">
          {SEED.map((s) => (
            <StopCard key={s.node} s={s} onClose={() => {}} />
          ))}
          <AddTile onClick={() => {}} />
        </div>
      </Scene>

      <Scene title="Empty state">
        <AppBar
          status="connecting"
          clock="13:29"
          geo={{ tag: "denied" }}
          locationLabel={null}
          onOpenSearch={() => {}}
        />
        <SubBar status="connecting" count={0} />
        <EmptyState onAdd={() => {}} />
      </Scene>
    </div>
  )
}

createRoot(document.getElementById("root")!).render(<Preview />)
