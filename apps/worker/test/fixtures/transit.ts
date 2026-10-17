// Trimmed real Golemio responses captured 2026-10-03 (Prague, around
// Národní třída). Unknown upstream fields are kept on purpose: decoding must
// ignore them. Deviations from the raw capture are marked inline.

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

/** GET /v2/vehiclepositions?limit=10000 — 4 of the 443 real features (a tram
 * and a metro inside 50.07,14.40 → 50.10,14.44; a bus and a train outside),
 * plus two SYNTHETIC ones appended to cover edge cases: a trolleybus with no
 * route name / bearing / delay / stops / distance, and a malformed vehicle
 * with no trip id. */
export const vehiclePositionsFixture = {
  type: "FeatureCollection",
  features: [
    {
      geometry: {
        type: "Point",
        coordinates: [14.43988, 50.09144],
      },
      properties: {
        last_position: {
          bearing: 247,
          delay: {
            actual: -16,
            last_stop_arrival: -16,
            last_stop_departure: null,
          },
          is_canceled: null,
          last_stop: {
            arrival_time: "2026-10-04T23:42:00+02:00",
            departure_time: "2026-10-04T23:42:00+02:00",
            id: "U689Z1P",
            sequence: 19,
          },
          next_stop: {
            arrival_time: "2026-10-04T23:44:00+02:00",
            departure_time: "2026-10-04T23:44:00+02:00",
            id: "U32Z1P",
            sequence: 20,
          },
          origin_timestamp: "2026-10-04T23:41:44+02:00",
          shape_dist_traveled: "7.421801",
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
            route_id: "L24",
            route_short_name: "24",
            route_type: 0,
            trip_headsign: "Spořilov",
            trip_id: "24_8789_260829",
            trip_short_name: null,
          },
          origin_route_name: "24",
          sequence_id: 5,
          start_timestamp: "2026-10-04T23:22:00+02:00",
          vehicle_registration_number: 9244,
          vehicle_type: {
            description_cs: "tramvaj",
            description_en: "tram",
            id: 2,
          },
          wheelchair_accessible: true,
        },
      },
      type: "Feature",
    },
    {
      geometry: {
        type: "Point",
        coordinates: [14.407196, 50.095915],
      },
      properties: {
        last_position: {
          bearing: 320,
          delay: {
            actual: -15,
            last_stop_arrival: 0,
            last_stop_departure: 0,
          },
          is_canceled: null,
          last_stop: {
            arrival_time: "2026-10-04T23:41:10+02:00",
            departure_time: "2026-10-04T23:41:30+02:00",
            id: "U360Z102P",
            sequence: 10,
          },
          next_stop: {
            arrival_time: "2026-10-04T23:42:45+02:00",
            departure_time: "2026-10-04T23:43:05+02:00",
            id: "U163Z102P",
            sequence: 11,
          },
          origin_timestamp: "2026-10-04T23:42:02+02:00",
          shape_dist_traveled: "9.881",
          speed: null,
          state_position: "on_track",
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
            route_id: "L991",
            route_short_name: "A",
            route_type: 1,
            trip_headsign: "Nemocnice Motol",
            trip_id: "991_11748_260202",
            trip_short_name: null,
          },
          origin_route_name: "991",
          sequence_id: 16,
          start_timestamp: "2026-10-04T23:23:35+02:00",
          vehicle_registration_number: null,
          vehicle_type: {
            description_cs: "metro",
            description_en: "metro",
            id: 1,
          },
          wheelchair_accessible: true,
        },
      },
      type: "Feature",
    },
    {
      geometry: {
        type: "Point",
        coordinates: [14.56723, 50.04451],
      },
      properties: {
        last_position: {
          bearing: 2,
          delay: {
            actual: 43,
            last_stop_arrival: 9,
            last_stop_departure: 32,
          },
          is_canceled: null,
          last_stop: {
            arrival_time: "2026-10-04T23:41:00+02:00",
            departure_time: "2026-10-04T23:41:00+02:00",
            id: "U1001Z2P",
            sequence: 6,
          },
          next_stop: {
            arrival_time: "2026-10-04T23:42:00+02:00",
            departure_time: "2026-10-04T23:42:00+02:00",
            id: "U2982Z2P",
            sequence: 7,
          },
          origin_timestamp: "2026-10-04T23:41:43+02:00",
          shape_dist_traveled: "3.990276",
          speed: null,
          state_position: "on_track",
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
            route_id: "L175",
            route_short_name: "175",
            route_type: 3,
            trip_headsign: "Florenc",
            trip_id: "175_2073_260901",
            trip_short_name: null,
          },
          origin_route_name: "175",
          sequence_id: 3,
          start_timestamp: "2026-10-04T23:34:00+02:00",
          vehicle_registration_number: 3953,
          vehicle_type: {
            description_cs: "autobus",
            description_en: "bus",
            id: 3,
          },
          wheelchair_accessible: true,
        },
      },
      type: "Feature",
    },
    {
      geometry: {
        type: "Point",
        coordinates: [14.6754866, 50.1306953],
      },
      properties: {
        last_position: {
          bearing: 262,
          delay: {
            actual: 25,
            last_stop_arrival: 60,
            last_stop_departure: 60,
          },
          is_canceled: false,
          last_stop: {
            arrival_time: "2026-10-04T23:39:30+02:00",
            departure_time: "2026-10-04T23:40:00+02:00",
            id: "U2281Z301",
            sequence: 11,
          },
          next_stop: {
            arrival_time: "2026-10-04T23:42:00+02:00",
            departure_time: "2026-10-04T23:42:30+02:00",
            id: "U1093Z301",
            sequence: 12,
          },
          origin_timestamp: "2026-10-04T23:41:43+02:00",
          shape_dist_traveled: "29.999",
          speed: null,
          state_position: "on_track",
          tracking: true,
        },
        trip: {
          agency_name: {
            real: null,
            scheduled: "ČESKÉ DRÁHY",
          },
          cis: {
            line_id: "none",
            trip_number: 5860,
          },
          gtfs: {
            route_id: "L1002",
            route_short_name: "S2",
            route_type: 2,
            trip_headsign: "Praha hl.n.",
            trip_id: "1002_5860_251214",
            trip_short_name: "Os 5860",
          },
          origin_route_name: null,
          sequence_id: null,
          start_timestamp: "2026-10-04T23:07:00+02:00",
          vehicle_registration_number: null,
          vehicle_type: null,
          wheelchair_accessible: true,
        },
      },
      type: "Feature",
    },
    {
      geometry: {
        type: "Point",
        coordinates: [14.42, 50.08],
      },
      properties: {
        last_position: {
          bearing: null,
          delay: null,
          is_canceled: null,
          last_stop: null,
          next_stop: null,
          origin_timestamp: "2026-10-04T23:41:43+02:00",
          shape_dist_traveled: null,
          speed: null,
          state_position: "on_track",
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
            route_id: "L58",
            route_short_name: null,
            route_type: 11,
            trip_headsign: "Florenc",
            trip_id: "58_100_260901",
            trip_short_name: null,
          },
          origin_route_name: "175",
          sequence_id: 3,
          start_timestamp: "2026-10-04T23:34:00+02:00",
          vehicle_registration_number: 3953,
          vehicle_type: {
            description_cs: "autobus",
            description_en: "bus",
            id: 3,
          },
          wheelchair_accessible: true,
        },
      },
      type: "Feature",
    },
    {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [14.42, 50.08],
      },
      properties: {
        last_position: {
          bearing: null,
          delay: null,
          is_canceled: null,
          last_stop: null,
          next_stop: null,
          origin_timestamp: "2026-10-04T23:41:43+02:00",
          shape_dist_traveled: null,
          speed: null,
          state_position: "on_track",
          tracking: true,
        },
        trip: {
          gtfs: {
            route_type: 3,
          },
        },
      },
    },
  ],
}
