import XCTest
@testable import Tablo

final class JourneyTests: XCTestCase {
    /// 10:04:20 Prague (CEST) on 3 Oct 2026 — the tapped departure from Národní třída.
    private let scheduled = ISODate.parse("2026-10-03T10:04:20+02:00")!

    /// Five stops due east along 50.08° N; Národní třída is the third.
    private let stops = [
        TripStop(name: "Alfa", lat: 50.08, lon: 14.40, node: 100, sequence: 1, arrival: 36000, departure: 36000, distance: 0),
        TripStop(name: "Beta", lat: 50.08, lon: 14.41, node: 101, sequence: 2, arrival: 36100, departure: 36120, distance: 0.7),
        TripStop(name: "Národní třída", lat: 50.08, lon: 14.42, node: 539, stop: 2, platform: "B", sequence: 3, arrival: 36240, departure: 36260, distance: 1.4),
        TripStop(name: "Delta", lat: 50.08, lon: 14.43, node: 103, sequence: 4, arrival: 36380, departure: 36400, distance: 2.1),
        TripStop(name: "Epsilon", lat: 50.08, lon: 14.44, node: 104, sequence: 5, arrival: 36500, departure: 36500, distance: 2.8),
    ]

    private var trip: Trip {
        let shape = stride(from: 0.0, through: 2.8, by: 0.35).map { km in
            ShapePoint(lon: 14.40 + km / 0.7 * 0.01, lat: 50.08, km: km)
        }
        return Trip(tripId: "22_1", headsign: "Epsilon", stops: stops, shape: shape)
    }

    private let here = IndexStop(
        name: "Národní třída", norm: "narodni trida", node: 539, stops: nil, lat: 50.08, lon: 14.42,
        zone: "P", disambig: nil, platforms: []
    )

    private func departure(delay: Double? = nil, atStop: Bool = false) -> WireDeparture {
        WireDeparture(
            route: "22", kind: .tram, headsign: "Epsilon", scheduled: scheduled,
            predicted: delay.map { scheduled.addingTimeInterval($0) }, delaySeconds: delay,
            isAtStop: atStop, platform: "B", tripId: "22_1"
        )
    }

    private var anchor: Date { JourneyBuilder.anchor(scheduled: scheduled, mineSeconds: 36260) }

    // MARK: Anchoring

    func testAnchorIsServiceDayMidnight() {
        XCTAssertEqual(anchor, ISODate.parse("2026-10-03T00:00:00+02:00"))
        let times = JourneyBuilder.scheduledTimes(stops, mine: 2, anchor: anchor)
        XCTAssertEqual(times.map(JourneyBuilder.clock), ["10:00", "10:02", "10:04", "10:06", "10:08"])
        // up to mine: departure seconds; after it: arrival seconds
        XCTAssertEqual(times[1], anchor.addingTimeInterval(36120))
        XCTAssertEqual(times[3], anchor.addingTimeInterval(36380))
    }

    func testAnchorAcrossMidnight() throws {
        // 24:10:00 on the 3 Oct service day is 00:10 on the 4th
        let late = try XCTUnwrap(ISODate.parse("2026-10-04T00:10:00+02:00"))
        let midnight = JourneyBuilder.anchor(scheduled: late, mineSeconds: 87000)
        XCTAssertEqual(midnight, ISODate.parse("2026-10-03T00:00:00+02:00"))
        XCTAssertEqual(JourneyBuilder.clock(midnight.addingTimeInterval(86000)), "23:53")
        XCTAssertEqual(JourneyBuilder.clock(midnight.addingTimeInterval(88200)), "00:30")
    }

    func testClockIsPragueWallTime() throws {
        XCTAssertEqual(JourneyBuilder.clock(try XCTUnwrap(ISODate.parse("2026-01-15T12:00:00Z"))), "13:00")  // CET
        XCTAssertEqual(JourneyBuilder.clock(try XCTUnwrap(ISODate.parse("2026-07-15T12:00:00Z"))), "14:00")  // CEST
    }

    // MARK: Mine

    func testMineIsFirstStopAtTheNode() {
        XCTAssertEqual(JourneyBuilder.mineIndex(stops, node: 539, scope: nil, platform: nil, near: here.coord), 2)
    }

    func testMineRespectsScopeAndPlatform() {
        let loop = stops + [
            TripStop(name: "Národní třída", lat: 50.08, lon: 14.42, node: 539, stop: 1, platform: "A", sequence: 6, arrival: 36600, departure: 36620),
        ]
        XCTAssertEqual(JourneyBuilder.mineIndex(loop, node: 539, scope: [1], platform: nil, near: here.coord), 5)
        XCTAssertEqual(JourneyBuilder.mineIndex(loop, node: 539, scope: nil, platform: "A", near: here.coord), 5)
        XCTAssertEqual(JourneyBuilder.mineIndex(loop, node: 539, scope: nil, platform: "Z", near: here.coord), 2)
        // a scope that matches nothing falls back to the node
        XCTAssertEqual(JourneyBuilder.mineIndex(loop, node: 539, scope: [77], platform: nil, near: here.coord), 2)
    }

    func testMineFallsBackToANearbyStop() {
        XCTAssertEqual(JourneyBuilder.mineIndex(stops, node: 9999, scope: nil, platform: nil, near: LngLat(14.4301, 50.0801)), 3)
        XCTAssertNil(JourneyBuilder.mineIndex(stops, node: 9999, scope: nil, platform: nil, near: LngLat(15, 50)))
    }

    // MARK: Segment

    private func position(now offset: Double, delay: Double = 0, atStop: Bool = false, vehicle: TripVehicle? = nil, km: Double? = nil) -> TripPosition {
        let plan = TripPlan(trip)
        let predicted = JourneyBuilder.scheduledTimes(stops, mine: 2, anchor: anchor).map { $0.addingTimeInterval(delay) }
        return JourneyBuilder.position(
            stops: stops, stopKm: plan.stopKm, predicted: predicted, mine: 2, departureAtStop: atStop,
            vehicle: vehicle, vehicleKm: km ?? vehicle?.distance, now: anchor.addingTimeInterval(offset)
        )
    }

    func testUntrackedSegmentFromTimes() {
        let p = position(now: 36190)
        XCTAssertEqual(p.seg, 1)
        XCTAssertEqual(p.frac, 70.0 / 140.0, accuracy: 1e-9)
        XCTAssertFalse(p.atStop)
        // the departure's delay shifts the estimate back a segment
        XCTAssertEqual(position(now: 36190, delay: 120).seg, 0)
        XCTAssertEqual(position(now: 35000), TripPosition(seg: 0, frac: 0, atStop: false))
        XCTAssertEqual(position(now: 40000), TripPosition(seg: 4, frac: 0, atStop: true))
        XCTAssertEqual(position(now: 36190, atStop: true), TripPosition(seg: 2, frac: 0, atStop: true))
    }

    func testTrackedSegmentFromSequences() {
        let moving = TripVehicle(tripId: "22_1", lat: 50.08, lon: 14.415, lastStopSequence: 2, nextStopSequence: 3, distance: 1.05, state: "on_track")
        let p = position(now: 36000, vehicle: moving)
        XCTAssertEqual(p.seg, 1)
        XCTAssertEqual(p.frac, 0.5, accuracy: 1e-9)
        XCTAssertFalse(p.atStop)

        let onlyNext = TripVehicle(tripId: "22_1", lat: 50.08, lon: 14.425, nextStopSequence: 4, distance: 1.75)
        XCTAssertEqual(position(now: 36000, vehicle: onlyNext).seg, 2)

        let standing = TripVehicle(tripId: "22_1", lat: 50.08, lon: 14.41, lastStopSequence: 2, nextStopSequence: 3, distance: 0.7, state: "at_stop")
        XCTAssertEqual(position(now: 36000, vehicle: standing), TripPosition(seg: 1, frac: 0, atStop: true))

        let waiting = TripVehicle(tripId: "22_1", lat: 50.08, lon: 14.40, state: "before_track")
        XCTAssertEqual(position(now: 36000, vehicle: waiting), TripPosition(seg: 0, frac: 0, atStop: false))
        let done = TripVehicle(tripId: "22_1", lat: 50.08, lon: 14.44, state: "after_track")
        XCTAssertEqual(position(now: 36000, vehicle: done), TripPosition(seg: 4, frac: 0, atStop: true))
    }

    func testTrackedWithoutSequencesUsesDistance() {
        let v = TripVehicle(tripId: "22_1", lat: 50.08, lon: 14.435, distance: 2.45)
        let p = position(now: 36000, vehicle: v)
        XCTAssertEqual(p.seg, 3)
        XCTAssertEqual(p.frac, 0.5, accuracy: 1e-9)
    }

    func testDepartureAtStopWinsNextToMine() {
        let arriving = TripVehicle(tripId: "22_1", lat: 50.08, lon: 14.419, lastStopSequence: 2, nextStopSequence: 3, distance: 1.38)
        XCTAssertEqual(position(now: 36250, atStop: true, vehicle: arriving), TripPosition(seg: 2, frac: 0, atStop: true))
    }

    // MARK: Build

    func testBuildAddsLiveDelayAheadOnly() throws {
        let now = anchor.addingTimeInterval(36190 + 120)  // halfway Beta → mine, two minutes late
        let j = try XCTUnwrap(JourneyBuilder.build(plan: TripPlan(trip), departure: departure(delay: 120), vehicle: nil, stop: here, walk: 1, now: now))
        XCTAssertEqual(j.mine, 2)
        XCTAssertEqual(j.seg, 1)
        XCTAssertEqual(j.delay, 2)
        XCTAssertEqual(j.stops.map { JourneyBuilder.clock($0.time) }, ["10:00", "10:02", "10:06", "10:08", "10:10"])
        XCTAssertEqual(j.departure.inMinutes, 1)
        XCTAssertEqual(j.tier, .run)
        XCTAssertFalse(j.hasDeparted)
        XCTAssertEqual(j.vehicleKm, 1.05, accuracy: 1e-6)
    }

    func testBuildPrefersTheVehicleDelayAndPosition() throws {
        let v = TripVehicle(tripId: "22_1", lat: 50.08, lon: 14.425, delaySeconds: 60, lastStopSequence: 3, nextStopSequence: 4, distance: 1.75)
        let j = try XCTUnwrap(JourneyBuilder.build(plan: TripPlan(trip), departure: departure(delay: 120), vehicle: v, stop: here, walk: nil, now: anchor.addingTimeInterval(36330)))
        XCTAssertEqual(j.delay, 1)
        XCTAssertEqual(j.seg, 2)
        XCTAssertTrue(j.hasDeparted)
        XCTAssertEqual(j.tier, .neutral)
        XCTAssertEqual(j.vehicleKm, 1.75, accuracy: 1e-6)
        // passed stops keep their timetable; the rest move by the vehicle's delay
        XCTAssertEqual(j.stops.map { JourneyBuilder.clock($0.time) }, ["10:00", "10:02", "10:04", "10:07", "10:09"])
    }

    func testBuildFailsWithoutMine() {
        let elsewhere = IndexStop(name: "Far", norm: "far", node: 1, stops: nil, lat: 49, lon: 15, zone: nil, disambig: nil, platforms: [])
        XCTAssertNil(JourneyBuilder.build(plan: TripPlan(trip), departure: departure(), vehicle: nil, stop: elsewhere, walk: nil, now: anchor))
    }

    // MARK: Plan

    func testPlanUsesShapeDistances() {
        let plan = TripPlan(trip)
        XCTAssertTrue(plan.usesShapeKm)
        XCTAssertEqual(plan.stopKm, [0, 0.7, 1.4, 2.1, 2.8])
        XCTAssertEqual(plan.path.count, 9)
    }

    func testPlanWithoutShapeJoinsTheStops() {
        let plan = TripPlan(Trip(tripId: "x", headsign: "", stops: stops, shape: []))
        XCTAssertFalse(plan.usesShapeKm)
        XCTAssertEqual(plan.path.count, 5)
        XCTAssertEqual(plan.stopKm, plan.path.map(\.km))
        XCTAssertEqual(plan.stopKm[1], 0.715, accuracy: 0.01)  // 0.01° of longitude at 50° N
    }

    func testPlanMeasuresAShapeWithoutKm() {
        let flat = trip.shape.map { ShapePoint(lon: $0.lon, lat: $0.lat, km: 0) }
        let plan = TripPlan(Trip(tripId: "x", headsign: "", stops: stops, shape: flat))
        XCTAssertFalse(plan.usesShapeKm)
        XCTAssertEqual(plan.stopKm, plan.stopKm.sorted())
        XCTAssertEqual(plan.stopKm[4], plan.path.last?.km ?? 0, accuracy: 1e-6)
    }
}
