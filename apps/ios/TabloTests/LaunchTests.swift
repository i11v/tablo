import XCTest
@testable import Tablo

/// What makes a launch show moving vehicles sooner: the trip-plan disk cache
/// and the order plans are fetched in.
final class LaunchTests: XCTestCase {
    private var root: URL!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent("TripPlanStoreTests-\(UUID().uuidString)")
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    /// 2026-10-17 in Prague (CEST, UTC+2) at `hour`:`minute`.
    private func prague(day: Int = 17, hour: Int, minute: Int = 0) -> Date {
        var c = DateComponents(year: 2026, month: 10, day: day, hour: hour, minute: minute)
        c.timeZone = TimeZone(identifier: "Europe/Prague")
        return Calendar(identifier: .gregorian).date(from: c)!
    }

    private func tripJSON(_ id: String) -> Data {
        Data("""
        {"tripId":"\(id)","headsign":"Sídliště Barrandov","stops":[
          {"name":"Alfa","lat":50.08,"lon":14.40,"sequence":1,"arrival":36000,"departure":36000},
          {"name":"Beta","lat":50.08,"lon":14.41,"sequence":2,"arrival":36100,"departure":36120}
        ],"shape":[[14.40,50.08,0],[14.41,50.08,0.7]]}
        """.utf8)
    }

    // MARK: Service day

    func testServiceDayRunsFromFourInTheMorningPragueTime() {
        XCTAssertEqual(TripPlanStore.serviceDay(prague(hour: 12)), "2026-10-17")
        XCTAssertEqual(TripPlanStore.serviceDay(prague(hour: 4)), "2026-10-17")
        // night trams after midnight still belong to the day before
        XCTAssertEqual(TripPlanStore.serviceDay(prague(hour: 3, minute: 59)), "2026-10-16")
        XCTAssertEqual(TripPlanStore.serviceDay(prague(day: 18, hour: 1)), "2026-10-17")
        XCTAssertEqual(TripPlanStore.serviceDay(prague(day: 18, hour: 4)), "2026-10-18")
    }

    // MARK: Store

    func testStoredPlansComeBackTheSameServiceDay() {
        let morning = TripPlanStore(root: root, now: prague(hour: 8))
        morning.write(tripJSON("22_101_251001"), for: "22_101_251001")
        let evening = TripPlanStore(root: root, now: prague(hour: 23))
        let plans = evening.plans(["22_101_251001", "22_999_251001"])
        XCTAssertEqual(Array(plans.keys), ["22_101_251001"])
        XCTAssertEqual(plans["22_101_251001"]?.trip.stops.count, 2)
        XCTAssertEqual(plans["22_101_251001"]?.trip.shape.count, 2)
    }

    func testNextServiceDayStartsEmptyAndPrunesTheOldOne() throws {
        TripPlanStore(root: root, now: prague(hour: 8)).write(tripJSON("22_101_251001"), for: "22_101_251001")
        let tomorrow = TripPlanStore(root: root, now: prague(day: 18, hour: 8))
        XCTAssertTrue(tomorrow.plans(["22_101_251001"]).isEmpty)
        tomorrow.write(tripJSON("22_102_251001"), for: "22_102_251001")
        tomorrow.prune()
        let days = try FileManager.default.contentsOfDirectory(atPath: root.path)
        XCTAssertEqual(days, ["2026-10-18"])
    }

    func testOddTripIdsAndCorruptFilesAreHandled() {
        let store = TripPlanStore(root: root, now: prague(hour: 8))
        let odd = "115_7/A:2 ü"
        store.write(tripJSON(odd), for: odd)
        XCTAssertNotNil(store.plans([odd])[odd])
        store.write(Data("not json".utf8), for: "broken")
        XCTAssertTrue(store.plans(["broken"]).isEmpty)
        // a file holding another trip isn't served for this id
        store.write(tripJSON("22_1"), for: "22_2")
        XCTAssertTrue(store.plans(["22_2"]).isEmpty)
    }

    // MARK: Plan order

    func testBoardTripsFirstThenNearestTheStop() {
        let stop = LngLat(14.42, 50.08)
        let vehicles = [
            LiveVehicle(tripId: "far", route: "9", kind: .tram, lat: 50.09, lon: 14.44),
            LiveVehicle(tripId: "near", route: "22", kind: .tram, lat: 50.0801, lon: 14.4201),
            LiveVehicle(tripId: "board-far", route: "18", kind: .tram, lat: 50.10, lon: 14.45),
            LiveVehicle(tripId: "mid", route: "176", kind: .bus, lat: 50.083, lon: 14.425),
            LiveVehicle(tripId: "board-near", route: "2", kind: .tram, lat: 50.081, lon: 14.421),
        ]
        XCTAssertEqual(
            StopModel.planOrder(vehicles, onBoard: ["board-far", "board-near"], near: stop),
            ["board-near", "board-far", "near", "mid", "far"]
        )
    }
}
