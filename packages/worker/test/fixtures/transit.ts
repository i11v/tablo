// Trimmed real Golemio responses captured 2026-10-03 (Prague, around
// Národní třída). Unknown upstream fields are kept on purpose: decoding must
// ignore them. Deviations from the raw capture are marked inline.

/** GET /v2/gtfs/trips/9_29806_261003?includeStops&includeStopTimes&includeShapes
 * — 4 of 33 stop_times and 5 of 414 shape points, both deliberately out of
 * order (upstream order is not guaranteed). */
export const tripFixture = {
  bikes_allowed: 0,
  block_id: null,
  direction_id: 0,
  route_id: "L9",
  service_id: "0000010-2",
  shape_id: "L9V1",
  trip_headsign: "Spojovací",
  trip_id: "9_29806_261003",
  wheelchair_accessible: 1,
  stop_times: [
    {
      arrival_time: "11:05:00",
      departure_time: "11:05:00",
      drop_off_type: "0",
      pickup_type: "0",
      shape_dist_traveled: 6.381883,
      stop_headsign: null,
      stop_id: "U539Z1P",
      stop_sequence: 13,
      trip_id: "9_29806_261003",
      computed_dwell_time_seconds: 0,
      headsign_icons: null,
      stop_icons: "Mb",
      stop: {
        geometry: {
          coordinates: [14.419593, 50.081158],
          type: "Point",
        },
        properties: {
          location_type: 0,
          parent_station: null,
          platform_code: "A",
          stop_id: "U539Z1P",
          stop_name: "Národní třída",
          wheelchair_boarding: 1,
          zone_id: "P",
          level_id: null,
        },
        type: "Feature",
      },
    },
    {
      arrival_time: "10:46:00",
      departure_time: "10:46:00",
      drop_off_type: "3",
      pickup_type: "3",
      shape_dist_traveled: 0,
      stop_headsign: null,
      stop_id: "U567Z1P",
      stop_sequence: 1,
      trip_id: "9_29806_261003",
      computed_dwell_time_seconds: 0,
      headsign_icons: null,
      stop_icons: null,
      stop: {
        geometry: {
          coordinates: [14.346667, 50.068031],
          type: "Point",
        },
        properties: {
          location_type: 0,
          parent_station: null,
          platform_code: "A",
          stop_id: "U567Z1P",
          stop_name: "Hotel Golf",
          wheelchair_boarding: 1,
          zone_id: "P",
          level_id: null,
        },
        type: "Feature",
      },
    },
    {
      arrival_time: "11:39:00",
      departure_time: "11:39:00",
      drop_off_type: "0",
      pickup_type: "0",
      shape_dist_traveled: 14.9523,
      stop_headsign: null,
      stop_id: "U694Z2P",
      stop_sequence: 33,
      trip_id: "9_29806_261003",
      computed_dwell_time_seconds: 0,
      headsign_icons: null,
      stop_icons: null,
      stop: {
        geometry: {
          coordinates: [14.499409, 50.091507],
          type: "Point",
        },
        properties: {
          location_type: 0,
          parent_station: null,
          platform_code: "B",
          stop_id: "U694Z2P",
          stop_name: "Spojovací",
          wheelchair_boarding: 1,
          zone_id: "P",
          level_id: null,
        },
        type: "Feature",
      },
    },
    {
      arrival_time: "11:03:00",
      departure_time: "11:03:00",
      drop_off_type: "0",
      pickup_type: "0",
      shape_dist_traveled: 5.932476,
      stop_headsign: null,
      stop_id: "U483Z1P",
      stop_sequence: 12,
      trip_id: "9_29806_261003",
      computed_dwell_time_seconds: 0,
      headsign_icons: null,
      stop_icons: null,
      stop: {
        geometry: {
          coordinates: [14.414886, 50.081413],
          type: "Point",
        },
        properties: {
          location_type: 0,
          parent_station: null,
          platform_code: "A",
          stop_id: "U483Z1P",
          stop_name: "Národní divadlo",
          wheelchair_boarding: 1,
          zone_id: "P",
          level_id: null,
        },
        type: "Feature",
      },
    },
  ],
  shapes: [
    {
      geometry: {
        coordinates: [14.346783, 50.06807],
        type: "Point",
      },
      properties: {
        shape_dist_traveled: 0.00837,
        shape_id: "L9V1",
        shape_pt_sequence: 2,
      },
      type: "Feature",
    },
    {
      geometry: {
        coordinates: [14.346666, 50.068066],
        type: "Point",
      },
      properties: {
        shape_dist_traveled: 0,
        shape_id: "L9V1",
        shape_pt_sequence: 1,
      },
      type: "Feature",
    },
    {
      geometry: {
        coordinates: [14.49942, 50.091535],
        type: "Point",
      },
      properties: {
        shape_dist_traveled: 14.9523,
        shape_id: "L9V1",
        shape_pt_sequence: 414,
      },
      type: "Feature",
    },
    {
      geometry: {
        coordinates: [14.351854, 50.068242],
        type: "Point",
      },
      properties: {
        shape_dist_traveled: 0.372326,
        shape_id: "L9V1",
        shape_pt_sequence: 3,
      },
      type: "Feature",
    },
    {
      geometry: {
        coordinates: [14.499291, 50.091588],
        type: "Point",
      },
      properties: {
        shape_dist_traveled: 14.941364,
        shape_id: "L9V1",
        shape_pt_sequence: 413,
      },
      type: "Feature",
    },
  ],
}

/** GET /v2/vehiclepositions/9_29806_261003 — verbatim. */
export const tripPositionFixture = {
  geometry: {
    type: "Point",
    coordinates: [14.41406, 50.08141],
  },
  properties: {
    last_position: {
      bearing: 88,
      delay: {
        actual: 64,
        last_stop_arrival: 41,
        last_stop_departure: null,
      },
      is_canceled: null,
      last_stop: {
        arrival_time: "2026-10-03T11:03:00+02:00",
        departure_time: "2026-10-03T11:03:00+02:00",
        id: "U483Z1P",
        sequence: 12,
      },
      next_stop: {
        arrival_time: "2026-10-03T11:05:00+02:00",
        departure_time: "2026-10-03T11:05:00+02:00",
        id: "U539Z1P",
        sequence: 13,
      },
      origin_timestamp: "2026-10-03T11:03:41+02:00",
      shape_dist_traveled: "5.831",
      speed: null,
      state_position: "at_stop",
      tracking: true,
    },
    trip: {
      agency_name: {
        real: "DP PRAHA",
        scheduled: "DP PRAHA",
      },
      cis: {
        line_id: null,
        trip_number: null,
      },
      gtfs: {
        route_id: "L9",
        route_short_name: "9",
        route_type: 0,
        trip_headsign: "Spojovací",
        trip_id: "9_29806_261003",
        trip_short_name: null,
      },
      origin_route_name: "9",
      sequence_id: 14,
      start_timestamp: "2026-10-03T10:46:00+02:00",
      vehicle_registration_number: 9445,
      vehicle_type: {
        description_cs: "tramvaj",
        description_en: "tram",
        id: 2,
      },
      wheelchair_accessible: true,
      air_conditioned: true,
      usb_chargers: false,
    },
  },
  type: "Feature",
}

/** GET /v2/public/vehiclepositions?boundingBox=50.085,14.412,50.077,14.428 —
 * 3 of the 13 real features, plus two SYNTHETIC ones appended to cover edge
 * cases: a trolleybus with no route name / bearing / delay, and a vehicle
 * with no trip id. */
export const publicVehiclesFixture = {
  type: "FeatureCollection",
  features: [
    {
      geometry: {
        coordinates: [14.41971, 50.08107],
        type: "Point",
      },
      properties: {
        gtfs_trip_id: "23_9755_260926",
        route_type: "tram",
        gtfs_route_short_name: "23",
        bearing: 174,
        delay: 242,
        state_position: "on_track",
        vehicle_id: "service-0-6312",
      },
      type: "Feature",
    },
    {
      geometry: {
        coordinates: [14.422264, 50.082784],
        type: "Point",
      },
      properties: {
        gtfs_trip_id: "992_1421_260829",
        route_type: "metro",
        gtfs_route_short_name: "B",
        bearing: 52,
        delay: -7,
        state_position: "on_track",
        vehicle_id: "metro-B-3-3",
      },
      type: "Feature",
    },
    {
      geometry: {
        coordinates: [14.41406, 50.08141],
        type: "Point",
      },
      properties: {
        gtfs_trip_id: "9_29806_261003",
        route_type: "tram",
        gtfs_route_short_name: "9",
        bearing: 88,
        delay: 64,
        state_position: "at_stop",
        vehicle_id: "service-0-9445",
      },
      type: "Feature",
    },
    {
      geometry: {
        coordinates: [14.4201, 50.0802],
        type: "Point",
      },
      properties: {
        gtfs_trip_id: "58_101_261003",
        route_type: "trolleybus",
        gtfs_route_short_name: null,
        bearing: null,
        delay: null,
        state_position: "on_track",
        vehicle_id: "synthetic-1",
      },
      type: "Feature",
    },
    {
      geometry: {
        coordinates: [14.4211, 50.0812],
        type: "Point",
      },
      properties: {
        gtfs_trip_id: null,
        route_type: "ferry",
        gtfs_route_short_name: "P1",
        bearing: 10,
        delay: 0,
        state_position: "off_track",
        vehicle_id: "synthetic-2",
      },
      type: "Feature",
    },
  ],
}
