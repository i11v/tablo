import XCTest
@testable import Tablo

final class BoardTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_790_000_000)

    private func dep(
        _ route: String = "9", at offset: TimeInterval, predicted: TimeInterval? = nil, delay: Double? = nil,
        canceled: Bool = false, platform: String? = "A", kind: VehicleKind = .tram, tripId: String? = nil
    ) -> WireDeparture {
        WireDeparture(
            route: route, kind: kind, headsign: "Spojovací", scheduled: now.addingTimeInterval(offset),
            predicted: predicted.map { now.addingTimeInterval($0) }, delaySeconds: delay,
            isCanceled: canceled, platform: platform, tripId: tripId
        )
    }

    func testDropsCanceledAndGoneDepartures() {
        let rows = Board.departures([
            dep("1", at: 120, canceled: true),
            dep("2", at: -31),  // gone
            dep("3", at: -29),  // still on the board, "<1"
            dep("4", at: -120, predicted: 60),  // late: its prediction is what counts
        ], now: now)
        XCTAssertEqual(rows.map(\.route), ["3", "4"])
        XCTAssertEqual(rows[0].inMinutes, 0)
    }

    func testMinutesAreFlooredAndClamped() {
        XCTAssertEqual(Board.resolve(dep(at: 89), now: now).inMinutes, 1)
        XCTAssertEqual(Board.resolve(dep(at: 59), now: now).inMinutes, 0)
        XCTAssertEqual(Board.resolve(dep(at: 600), now: now).inMinutes, 10)
        XCTAssertEqual(Board.resolve(dep(at: -20), now: now).inMinutes, 0)
    }

    func testSortsByPredictedElseScheduledStably() {
        let rows = Board.departures([
            dep("a", at: 300),
            dep("b", at: 100, predicted: 400),
            dep("c", at: 200),
            dep("d", at: 200),
        ], now: now)
        XCTAssertEqual(rows.map(\.route), ["c", "d", "a", "b"])
    }

    func testDelayMinutesRoundLikeJavaScript() {
        XCTAssertEqual(Board.resolve(dep(at: 0, delay: 80), now: now).delayMinutes, 1)
        XCTAssertEqual(Board.resolve(dep(at: 0, delay: 29), now: now).delayMinutes, 0)
        XCTAssertEqual(Board.resolve(dep(at: 0, delay: 90), now: now).delayMinutes, 2)
        XCTAssertEqual(Board.resolve(dep(at: 0, delay: -90), now: now).delayMinutes, -1)
        XCTAssertEqual(Board.resolve(dep(at: 0, delay: nil), now: now).delayMinutes, 0)
    }

    func testDelayText() {
        XCTAssertEqual(Board.delayText(2), "+2 min")
        XCTAssertEqual(Board.delayText(-1), "-1 min")
        XCTAssertEqual(Board.delayText(0), "")
    }

    func testPlatformKeys() {
        let rows = Board.departures([
            dep("B", at: 60, platform: "1", kind: .metro),
            dep("22", at: 70, platform: "B"),
            dep("9", at: 80, platform: "A"),
            dep("176", at: 90, platform: nil, kind: .bus),
            dep("B", at: 100, platform: "2", kind: .metro),
            dep("18", at: 110, platform: "10"),
            dep("17", at: 120, platform: "2"),
        ], now: now)
        XCTAssertEqual(Board.platformKey(rows[0]), "Metro")
        XCTAssertNil(Board.platformKey(rows[3]))
        XCTAssertEqual(Board.platformKeys(rows), ["2", "10", "A", "B", "Metro"])
        XCTAssertEqual(Board.platformLabel("A"), "nást. A")
        XCTAssertEqual(Board.platformLabel("Metro"), "Metro")
    }

    func testBlankPlatformIsNone() {
        XCTAssertNil(Board.resolve(dep(at: 0, platform: ""), now: now).platform)
        XCTAssertNil(Board.resolve(dep(at: 0, platform: "–"), now: now).platform)
    }

    func testLeadIsFirstCatchable() {
        let rows = Board.departures([dep("1", at: 60), dep("2", at: 240), dep("3", at: 600)], now: now)
        XCTAssertEqual(Board.lead(rows, walk: 3)?.route, "2")
        XCTAssertEqual(Board.lead(rows, walk: 30)?.route, "1")  // nothing catchable: first
        XCTAssertEqual(Board.lead(rows, walk: nil)?.route, "1")  // neutral is never a miss
        XCTAssertNil(Board.lead([], walk: 1))
    }

    func testDepartureIdentity() {
        let a = Board.resolve(dep(at: 60, tripId: "9_1_261003"), now: now)
        XCTAssertEqual(a.id, "9_1_261003")
        let b = Board.resolve(dep(at: 60), now: now)
        let c = Board.resolve(dep(at: 120), now: now)
        XCTAssertNotEqual(b.id, c.id)
    }
}

final class ReachTests: XCTestCase {
    func testReachTiers() {
        XCTAssertEqual(Tier.reach(margin: -1), .miss)
        XCTAssertEqual(Tier.reach(margin: 0), .run)
        XCTAssertEqual(Tier.reach(margin: 1), .run)
        XCTAssertEqual(Tier.reach(margin: 2), .make)
    }

    func testNoLocationIsNeutral() {
        XCTAssertEqual(Tier.reach(inMinutes: 0, walk: nil), .neutral)
        XCTAssertEqual(Tier.reach(inMinutes: 12, walk: nil), .neutral)
        XCTAssertEqual(Tier.neutral.verdict, "")
        XCTAssertFalse(Tier.neutral.glows)
    }

    func testReachAgainstWalk() {
        XCTAssertEqual(Tier.reach(inMinutes: 4, walk: 5), .miss)
        XCTAssertEqual(Tier.reach(inMinutes: 5, walk: 5), .run)
        XCTAssertEqual(Tier.reach(inMinutes: 7, walk: 5), .make)
    }

    func testModesFilterOnlyTheTogglableKinds() {
        XCTAssertTrue(VehicleKind.tram.isShown(in: [.tram]))
        XCTAssertFalse(VehicleKind.metro.isShown(in: [.tram, .bus]))
        XCTAssertTrue(VehicleKind.train.isShown(in: []))
        XCTAssertTrue(VehicleKind.other.isShown(in: []))
        XCTAssertEqual(VehicleKind(wire: "trolleybus"), .other)
        XCTAssertEqual(VehicleKind(wire: "metro"), .metro)
    }
}

final class GeoTests: XCTestCase {
    func testHaversine() {
        // Národní třída → Můstek, about 440 m
        let d = Geo.haversineMetres(LngLat(14.41992, 50.08069), LngLat(14.4237, 50.0838))
        XCTAssertEqual(d, 440, accuracy: 10)
        XCTAssertEqual(Geo.haversineMetres(LngLat(14, 50), LngLat(14, 50)), 0)
    }

    func testWalkMinutes() {
        XCTAssertEqual(Geo.walkMinutes(metres: 0), 0)
        XCTAssertEqual(Geo.walkMinutes(metres: 80), 1)  // 1.3
        XCTAssertEqual(Geo.walkMinutes(metres: 400), 7)  // 6.5 rounds up
        XCTAssertEqual(Geo.walkMinutes(metres: 1000), 16)  // 16.25
    }

    func testJsRound() {
        XCTAssertEqual(Geo.jsRound(1.5), 2)
        XCTAssertEqual(Geo.jsRound(-1.5), -1)
        XCTAssertEqual(Geo.jsRound(-1.6), -2)
        XCTAssertEqual(Geo.jsRound(0.49), 0)
    }

    func testBBoxAroundStop() {
        let box = BBox.around(LngLat(14.41992, 50.08069))
        XCTAssertEqual(box.minLat, 50.07469, accuracy: 1e-9)
        XCTAssertEqual(box.maxLat, 50.08669, accuracy: 1e-9)
        XCTAssertEqual(box.minLon, 14.41092, accuracy: 1e-9)
        XCTAssertEqual(box.maxLon, 14.42892, accuracy: 1e-9)
        XCTAssertEqual(box.query, "50.07469,14.41092,50.08669,14.42892")
        XCTAssertLessThanOrEqual(box.maxLat - box.minLat, 0.05)
        XCTAssertLessThanOrEqual(box.maxLon - box.minLon, 0.05)
    }

    private let path = [
        PathPoint(coord: LngLat(0, 0), km: 0),
        PathPoint(coord: LngLat(1, 0), km: 1),
        PathPoint(coord: LngLat(1, 1), km: 2),
    ]

    func testPointOnPath() {
        XCTAssertEqual(Geo.point(on: path, atKm: -1), LngLat(0, 0))
        XCTAssertEqual(Geo.point(on: path, atKm: 0.5), LngLat(0.5, 0))
        XCTAssertEqual(Geo.point(on: path, atKm: 1.5), LngLat(1, 0.5))
        XCTAssertEqual(Geo.point(on: path, atKm: 9), LngLat(1, 1))
        XCTAssertNil(Geo.point(on: [], atKm: 0))
    }

    func testLastVertexBeforeKm() {
        XCTAssertEqual(Geo.lastIndex(in: path, atOrBefore: 0), 0)
        XCTAssertEqual(Geo.lastIndex(in: path, atOrBefore: 1.5), 1)
        XCTAssertEqual(Geo.lastIndex(in: path, atOrBefore: 2), 2)
    }

    func testProjectOntoPath() throws {
        let km = try XCTUnwrap(Geo.project(LngLat(0.4, 0.01), onto: path))
        XCTAssertEqual(km, 0.4, accuracy: 0.01)
        // searching from 1 km on skips the first leg
        let later = try XCTUnwrap(Geo.project(LngLat(0.4, 0.01), onto: path, fromKm: 1))
        XCTAssertGreaterThanOrEqual(later, 1)
    }
}
