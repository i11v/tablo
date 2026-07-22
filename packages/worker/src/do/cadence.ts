export const VEHICLE_POLL_MS = 5_000
export const BOARD_POLL_MS = 15_000

export interface TickInput {
  readonly now: number
  readonly hasSelectors: boolean
  readonly hasRoutes: boolean
  readonly hasSockets: boolean
  readonly boardsDueAt: number // 0 = never polled
}
export interface TickPlan {
  readonly alarmAt: number | null // null = stop polling
  readonly fetchVehicles: boolean
  readonly fetchBoards: boolean
  readonly boardsDueAt: number // persisted for the next tick
}

export const planTick = (input: TickInput): TickPlan => {
  const active = input.hasSockets && (input.hasSelectors || input.hasRoutes)
  if (!active) return { alarmAt: null, fetchVehicles: false, fetchBoards: false, boardsDueAt: 0 }
  const fetchVehicles = input.hasRoutes
  const fetchBoards = input.hasSelectors && (!input.hasRoutes || input.now >= input.boardsDueAt)
  return {
    alarmAt: input.now + (input.hasRoutes ? VEHICLE_POLL_MS : BOARD_POLL_MS),
    fetchVehicles,
    fetchBoards,
    boardsDueAt: fetchBoards ? input.now + BOARD_POLL_MS : input.boardsDueAt,
  }
}
