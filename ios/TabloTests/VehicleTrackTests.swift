import XCTest
@testable import Tablo

final class VehicleTrackTests: XCTestCase {
    /// Five stops 0.7 km apart due east along 50.08° N: two minutes' ride
    /// between stops (100 s for the first), 20 s standing at each.
    private let stops = [
        TripStop(name: "Alfa", lat: 50.08, lon: 14.40, node: 100, sequence: 1, arrival: 36000, departure: 36000, distance: 0),
        TripStop(name: "Beta", lat: 50.08, lon: 14.41, node: 101, sequence: 2, arrival: 36100, departure: 36120, distance: 0.7),
        TripStop(name: "Gama", lat: 50.08, lon: 14.42, node: 102, sequence: 3, arrival: 36240, departure: 36260, distance: 1.4),
        TripStop(name: "Delta", lat: 50.08, lon: 14.43, node: 103, sequence: 4, arrival: 36380, departure: 36400, distance: 2.1),
        TripStop(name: "Epsilon", lat: 50.08, lon: 14.44, node: 104, sequence: 5, arrival: 36500, departure: 36500, distance: 2.8),
    ]

    private var plan: TripPlan {
        let shape = stride(from: 0.0, through: 2.8, by: 0.35).map { km in
            ShapePoint(lon: 14.40 + km / 0.7 * 0.01, lat: 50.08, km: km)
        }
        return TripPlan(Trip(tripId: "22_1", headsign: "Epsilon", stops: stops, shape: shape))
    }

    private let t0 = Date(timeIntervalSince1970: 1_790_000_000)

    private func at(_ seconds: TimeInterval) -> Date { t0.addingTimeInterval(seconds) }

    private func report(km: Double, at seconds: TimeInterval, state: String = "on_track") -> VehicleReport {
        VehicleReport(coord: LngLat(14.40 + km / 0.7 * 0.01, 50.08), distance: km, state: state, at: at(seconds))
    }

    private func track(_ r: VehicleReport, shownKm: Double? = nil, now: TimeInterval) throws -> VehicleTrack {
        try XCTUnwrap(VehicleTrack(plan: plan, report: r, shownKm: shownKm, now: at(now)))
    }

    // MARK: Timetable

    func testScheduleMovesBetweenStopsAndStandsAtThem() throws {
        let s = try XCTUnwrap(TripSchedule(plan))
        XCTAssertEqual(s.seconds(atKm: 0.35), 36050, accuracy: 1e-9)
        XCTAssertEqual(s.seconds(atKm: 0.7), 36120, accuracy: 1e-9) // leaving Beta
        XCTAssertEqual(s.seconds(atKm: -1), 36000)
        XCTAssertEqual(s.seconds(atKm: 9), 36500)
        XCTAssertEqual(s.km(atSeconds: 36050), 0.35, accuracy: 1e-9)
        XCTAssertEqual(s.km(atSeconds: 36110), 0.7, accuracy: 1e-9) // standing at Beta
        XCTAssertEqual(s.km(atSeconds: 36180), 1.05, accuracy: 1e-9)
        XCTAssertEqual(s.km(atSeconds: 0), 0)
        XCTAssertEqual(s.km(atSeconds: 99999), 2.8)
    }

    // MARK: Projection

    func testProjectsOnFromTheReportAtTheTimetablesPace() throws {
        // reported halfway to Beta: on the timetable that's 36050, whatever the clock says
        let tr = try track(report(km: 0.35, at: 0), now: 0)
        XCTAssertEqual(tr.km(at: at(0)), 0.35, accuracy: 1e-9)
        XCTAssertEqual(tr.km(at: at(25)), 0.525, accuracy: 1e-9)
        XCTAssertEqual(tr.km(at: at(60)), 0.7, accuracy: 1e-9)  // standing at Beta
        XCTAssertEqual(tr.km(at: at(130)), 1.05, accuracy: 1e-9)
    }

    func testStopsProjectingWhenTheFeedGoesQuiet() throws {
        let tr = try track(report(km: 0.35, at: 0), now: 0)
        XCTAssertEqual(tr.km(at: at(1000)), tr.km(at: at(VehicleTrack.maxAhead)), accuracy: 1e-9)
    }

    func testAReportFromTheFutureDoesNotRunBackwards() throws {
        let tr = try track(report(km: 0.35, at: 10), now: 0)
        XCTAssertEqual(tr.km(at: at(0)), 0.35, accuracy: 1e-9)
    }

    func testStandsAtAStopBeforeGoingOn() throws {
        let tr = try track(report(km: 0.7, at: 0, state: "at_stop"), now: 0)
        XCTAssertEqual(tr.km(at: at(VehicleTrack.dwell)), 0.7, accuracy: 1e-9)
        // then on at the timetable's pace from Beta's departure
        XCTAssertEqual(tr.km(at: at(VehicleTrack.dwell + 60)), 1.05, accuracy: 1e-9)
    }

    // MARK: Halting

    func testHaltsWhereAReportShowsNoProgressThenMovesOn() throws {
        var tr = try track(report(km: 0.35, at: 0), now: 0)
        XCTAssertEqual(tr.km(at: at(60)), 0.7, accuracy: 1e-9)  // projected on to Beta
        // held at a signal: the next report is 10 m on
        XCTAssertTrue(tr.update(report(km: 0.36, at: 60), plan: plan, now: at(60)))
        XCTAssertTrue(tr.halted)
        XCTAssertEqual(tr.km(at: at(60)), 0.7, accuracy: 1e-9)  // eases back from where it was drawn…
        XCTAssertEqual(tr.km(at: at(60 + VehicleTrack.ease)), 0.36, accuracy: 1e-9)  // …to the report
        XCTAssertEqual(tr.km(at: at(60 + VehicleTrack.haltHold)), 0.36, accuracy: 1e-9)  // held there…
        XCTAssertGreaterThan(tr.km(at: at(60 + VehicleTrack.haltHold + 10)), 0.36)  // …then on
        // a report showing it moving lifts the halt
        XCTAssertTrue(tr.update(report(km: 0.5, at: 120), plan: plan, now: at(120)))
        XCTAssertFalse(tr.halted)
        XCTAssertGreaterThan(tr.km(at: at(130)), 0.5)
    }

    func testHoldsAtAStopWhileReportsShowItStanding() throws {
        var tr = try track(report(km: 0.7, at: 0, state: "at_stop"), now: 0)
        XCTAssertTrue(tr.update(report(km: 0.7, at: 45, state: "at_stop"), plan: plan, now: at(45)))
        XCTAssertTrue(tr.halted)
        XCTAssertEqual(tr.km(at: at(45 + VehicleTrack.haltHold)), 0.7, accuracy: 1e-9)
        XCTAssertEqual(tr.km(at: at(45 + VehicleTrack.haltHold + 60)), 1.05, accuracy: 1e-9)
    }

    func testARepeatedReportChangesNothing() throws {
        var tr = try track(report(km: 0.35, at: 0), now: 0)
        XCTAssertTrue(tr.update(report(km: 0.35, at: 0), plan: plan, now: at(40)))
        XCTAssertFalse(tr.halted)
        XCTAssertEqual(tr.km(at: at(25)), 0.525, accuracy: 1e-9)
    }

    // MARK: Corrections

    func testWaitsForTheProjectionWhenSlightlyAhead() throws {
        var tr = try track(report(km: 0.35, at: 0), now: 0)
        let shown = tr.km(at: at(40))  // 0.63
        // the new report is 70 m behind the marker: it waits instead of sliding back
        XCTAssertTrue(tr.update(report(km: 0.56, at: 40), plan: plan, now: at(40)))
        XCTAssertFalse(tr.halted)
        XCTAssertEqual(tr.km(at: at(40)), shown, accuracy: 1e-9)
        XCTAssertEqual(tr.km(at: at(45)), shown, accuracy: 1e-9)
        XCTAssertEqual(tr.km(at: at(55)), 0.665, accuracy: 1e-9)  // the projection passed it
    }

    func testEasesForwardWhenBehind() throws {
        var tr = try track(report(km: 0.35, at: 0), now: 0)
        XCTAssertTrue(tr.update(report(km: 1.05, at: 30), plan: plan, now: at(30)))
        let start = tr.km(at: at(30))
        XCTAssertEqual(start, 0.56, accuracy: 1e-9)  // still where it was drawn
        XCTAssertGreaterThan(tr.km(at: at(30.75)), start)
        XCTAssertEqual(tr.km(at: at(30 + VehicleTrack.ease)), 1.05 + 0.7 * VehicleTrack.ease / 120, accuracy: 1e-9)
    }

    func testStartsFromWhereTheMarkerIsDrawn() throws {
        let tr = try track(report(km: 0.35, at: 0), shownKm: 0.2, now: 0)
        XCTAssertEqual(tr.km(at: at(0)), 0.2, accuracy: 1e-9)
        XCTAssertEqual(tr.km(at: at(VehicleTrack.ease)), 0.35 + 0.7 * VehicleTrack.ease / 100, accuracy: 1e-9)
    }

    // MARK: What it follows

    func testFollowsOnlyReportsOnTheTrip() {
        XCTAssertNil(VehicleTrack(plan: plan, report: report(km: 0.35, at: 0, state: "off_track"), now: at(0)))
        XCTAssertNil(VehicleTrack(plan: plan, report: report(km: 0, at: 0, state: "before_track"), now: at(0)))
    }

    func testAnOffTrackReportDropsTheTrack() throws {
        var tr = try track(report(km: 0.35, at: 0), now: 0)
        XCTAssertFalse(tr.update(report(km: 0.5, at: 30, state: "off_track"), plan: plan, now: at(30)))
    }

    func testPlacesAReportWithoutDistanceByItsPosition() throws {
        let r = VehicleReport(coord: LngLat(14.405, 50.0801), distance: nil, state: "on_track", at: at(0))
        let tr = try XCTUnwrap(VehicleTrack(plan: plan, report: r, now: at(0)))
        XCTAssertEqual(tr.km(at: at(0)), 0.35, accuracy: 0.005)
        let far = VehicleReport(coord: LngLat(14.405, 50.09), distance: nil, state: "on_track", at: at(0))
        XCTAssertNil(VehicleTrack(plan: plan, report: far, now: at(0)))
    }

    // MARK: Journey

    func testJourneyPositionFromTheTrack() {
        let km = plan.stopKm
        let between = JourneyBuilder.position(stopKm: km, mine: 2, departureAtStop: false, km: 1.05)
        XCTAssertEqual(between.seg, 1)
        XCTAssertEqual(between.frac, 0.5, accuracy: 1e-9)
        XCTAssertFalse(between.atStop)
        XCTAssertEqual(JourneyBuilder.position(stopKm: km, mine: 2, departureAtStop: false, km: 1.41), TripPosition(seg: 2, frac: 0, atStop: true))
        XCTAssertEqual(JourneyBuilder.position(stopKm: km, mine: 2, departureAtStop: false, km: 3), TripPosition(seg: 4, frac: 0, atStop: true))
        // the board says it's at my stop: that wins next to it
        XCTAssertEqual(JourneyBuilder.position(stopKm: km, mine: 2, departureAtStop: true, km: 1.2), TripPosition(seg: 2, frac: 0, atStop: true))
    }
}
