export const fixture = {
  stops: [
    { stop_id: "U1040Z1P", stop_name: "Anděl", asw_id: { node: 1040, stop: 1 }, zone_id: "P" },
    { stop_id: "U81Z2P", stop_name: "Tusarova", asw_id: { node: 81, stop: 2 } },
    { stop_id: "T99", stop_name: "Depo", asw_id: null },
  ],
  departures: [
    {
      departure_timestamp: {
        predicted: "2026-06-06T12:05:30.000Z",
        scheduled: "2026-06-06T12:04:00.000Z",
        minutes: "5",
      },
      delay: { is_available: true, minutes: 1, seconds: 90 },
      route: { short_name: "9", type: 0, is_night: false, extra_field: "ignore me" },
      trip: { headsign: "Sídliště Řepy", id: "t1", is_canceled: false, is_at_stop: false },
      stop: { id: "U1040Z1P", platform_code: "A" },
    },
    {
      departure_timestamp: { predicted: null, scheduled: "2026-06-06T12:10:00.000Z" },
      delay: { is_available: false, minutes: null, seconds: null },
      route: { short_name: "B", type: 1, is_night: false },
      trip: { headsign: "Zličín", id: "t2", is_canceled: false, is_at_stop: true },
      stop: { id: "U1040Z1P", platform_code: null },
    },
    {
      departure_timestamp: {
        predicted: "2026-06-06T12:07:00.000Z",
        scheduled: "2026-06-06T12:06:00.000Z",
      },
      delay: { is_available: true, minutes: 1, seconds: 60 },
      route: { short_name: "1", type: 0, is_night: false },
      trip: { headsign: "Vozovna Kobylisy", id: "t3", is_canceled: true, is_at_stop: false },
      stop: { id: "U81Z2P", platform_code: "B" },
    },
    {
      departure_timestamp: { predicted: null, scheduled: null },
      delay: { is_available: false, minutes: null, seconds: null },
      route: { short_name: null, type: null, is_night: false },
      trip: { headsign: "Ghost", id: "t4", is_canceled: false, is_at_stop: false },
      stop: { id: "U1040Z1P", platform_code: null },
    },
  ],
}
