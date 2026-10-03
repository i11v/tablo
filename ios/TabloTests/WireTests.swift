import XCTest
@testable import Tablo

final class WireTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try Wire.decode(type, from: Data(json.utf8))
    }

    // MARK: Stop index

    func testManifest() throws {
        let m = try decode(StopsManifest.self, #"{"path":"/data/stop-index-b9cfa9fa.json","generatedAt":"2026-07-19T13:19:10.993Z","count":8455}"#)
        XCTAssertEqual(m.path, "/data/stop-index-b9cfa9fa.json")
        XCTAssertEqual(m.count, 8455)
    }

    func testIndexWithoutPlatformCoordinates() throws {
        // production today: platforms carry only code + stop
        let file = try decode(StopIndexFile.self, #"""
        {"version":1,"generatedAt":"2026-07-19T13:19:10.993Z","stops":[
          {"name":"Národní třída","norm":"narodni trida","node":539,"stops":null,"lat":50.08069,"lon":14.41992,"zone":"P","modes":[],"disambig":null,
           "platforms":[{"code":"1","stop":101},{"code":"A","stop":1}]},
          {"name":"Bečváry","norm":"becvary","node":2154,"stops":[301],"lat":49.95565,"lon":15.07087,"zone":"5","modes":[],"disambig":"5","platforms":[]},
          {"name":"broken"}
        ]}
        """#)
        XCTAssertEqual(file.stops.count, 2)  // the malformed entry is skipped
        let nt = file.stops[0]
        XCTAssertEqual(nt.key, "539")
        XCTAssertEqual(nt.platforms.map(\.code), ["1", "A"])
        XCTAssertNil(nt.platforms[0].coord)
        XCTAssertEqual(file.stops[1].key, "2154:301")
        XCTAssertEqual(file.stops[1].disambig, "5")
    }

    func testIndexWithPlatformCoordinates() throws {
        let file = try decode(StopIndexFile.self, #"""
        {"version":1,"generatedAt":"x","stops":[
          {"name":"Národní třída","norm":"narodni trida","node":539,"stops":null,"lat":50.08069,"lon":14.41992,"zone":"P","modes":[],"disambig":null,
           "platforms":[{"code":"A","stop":1,"lat":50.0813,"lon":14.4189}]}
        ]}
        """#)
        XCTAssertEqual(file.stops[0].platforms[0].coord, LngLat(14.4189, 50.0813))
    }

    func testIndexStopRoundTripsForPersistence() throws {
        let stop = IndexStop(
            name: "Anděl", norm: "andel", node: 1040, stops: [1, 2], lat: 50.07, lon: 14.40, zone: "P", disambig: nil,
            platforms: [IndexPlatform(code: "A", stop: 1, lat: 50.07, lon: 14.40), IndexPlatform(code: "B", stop: 2, lat: nil, lon: nil)]
        )
        let back = try JSONDecoder().decode(IndexStop.self, from: JSONEncoder().encode(stop))
        XCTAssertEqual(back, stop)
    }

    // MARK: WebSocket

    func testSelectorKeys() {
        XCTAssertEqual(StopSelector(node: 539, stops: nil).key, "539")
        XCTAssertEqual(StopSelector(node: 539, stops: [2, 1]).key, "539:1,2")
    }

    func testClientMessages() {
        XCTAssertEqual(
            ClientMessage.subscribe([StopSelector(node: 539, stops: nil)]).json,
            #"{"_tag":"Subscribe","selectors":[{"node":539,"stops":null}]}"#
        )
        XCTAssertEqual(
            ClientMessage.subscribe([StopSelector(node: 539, stops: [1, 2])]).json,
            #"{"_tag":"Subscribe","selectors":[{"node":539,"stops":[1,2]}]}"#
        )
        XCTAssertEqual(ClientMessage.unsubscribe.json, #"{"_tag":"Unsubscribe"}"#)
    }

    private let update = #"""
    {"_tag":"DeparturesUpdate","generatedAt":"2026-10-03T09:10:45.141Z","degraded":false,"reason":null,"boards":[{"key":"539","departures":[
      {"route":"22","kind":"tram","headsign":"Zahradní Město","scheduled":"2026-10-03T11:11:00+02:00","predicted":"2026-10-03T11:12:20+02:00","delaySeconds":80,"isCanceled":false,"isAtStop":false,"platform":"A"},
      {"route":"B","kind":"metro","headsign":"Zličín","scheduled":"2026-10-03T11:13:00+02:00","predicted":null,"delaySeconds":null,"isCanceled":false,"isAtStop":true,"platform":"1","tripId":"991_1_261003"},
      {"route":"X","kind":"ferry","headsign":"Somewhere","scheduled":"2026-10-03T11:14:00+02:00","predicted":null,"delaySeconds":null,"isCanceled":false,"isAtStop":false,"platform":null,"tripId":null},
      {"route":"bad","kind":"tram","headsign":"No time","scheduled":"soon","predicted":null,"delaySeconds":null,"isCanceled":false,"isAtStop":false,"platform":null}
    ]}]}
    """#

    func testDeparturesUpdateWithAndWithoutTripIds() throws {
        guard case let .departures(u) = try decode(ServerMessage.self, update) else { return XCTFail("not an update") }
        XCTAssertFalse(u.degraded)
        XCTAssertNil(u.reason)
        let deps = try XCTUnwrap(u.boards.first?.departures)
        XCTAssertEqual(deps.count, 3)  // the undated one is skipped, not fatal
        XCTAssertNil(deps[0].tripId)  // production today
        XCTAssertEqual(deps[0].scheduled, ISODate.parse("2026-10-03T09:11:00Z"))
        XCTAssertEqual(deps[0].predicted, ISODate.parse("2026-10-03T09:12:20Z"))
        XCTAssertEqual(deps[0].delaySeconds, 80)
        XCTAssertEqual(deps[1].tripId, "991_1_261003")
        XCTAssertEqual(deps[1].kind, .metro)
        XCTAssertTrue(deps[1].isAtStop)
        XCTAssertEqual(deps[2].kind, .other)
    }

    func testServerError() throws {
        guard case let .serverError(text) = try decode(ServerMessage.self, #"{"_tag":"ServerError","message":"too many selectors"}"#) else {
            return XCTFail("not an error")
        }
        XCTAssertEqual(text, "too many selectors")
        XCTAssertThrowsError(try decode(ServerMessage.self, #"{"_tag":"Pong"}"#))
    }

    func testISODates() {
        XCTAssertEqual(ISODate.parse("2026-10-03T11:11:00+02:00"), ISODate.parse("2026-10-03T09:11:00Z"))
        XCTAssertNotNil(ISODate.parse("2026-10-03T09:10:45.141Z"))
        XCTAssertNil(ISODate.parse("11:11"))
    }

    // MARK: REST

    func testTrip() throws {
        let trip = try decode(Trip.self, #"""
        {"tripId":"22_1234_261003","headsign":"Bílá Hora","stops":[
          {"name":"Národní třída","lat":50.0813,"lon":14.4189,"node":539,"stop":1,"platform":"A","sequence":12,"arrival":87000,"departure":87020,"distance":5.123},
          {"name":"Rail waypoint","lat":50.1,"lon":14.5,"node":null,"stop":null,"platform":null,"sequence":13.0,"arrival":87100,"departure":87100,"distance":null}
        ],"shape":[[14.4189,50.0813,5.1],[14.4176,50.0811,5.2]]}
        """#)
        XCTAssertEqual(trip.stops.count, 2)
        XCTAssertEqual(trip.stops[0].node, 539)
        XCTAssertEqual(trip.stops[0].departure, 87020)
        XCTAssertNil(trip.stops[1].node)
        XCTAssertEqual(trip.stops[1].sequence, 13)
        XCTAssertNil(trip.stops[1].distance)
        XCTAssertEqual(trip.shape[1], ShapePoint(lon: 14.4176, lat: 50.0811, km: 5.2))
    }

    func testTripVehicle() throws {
        let v = try decode(TripVehicle.self, #"""
        {"tripId":"22_1","lat":50.08,"lon":14.42,"bearing":250,"delaySeconds":45,"lastStopSequence":11,"nextStopSequence":12,"distance":4.9,"state":"on_track","updatedAt":"2026-10-03T09:10:45.000Z"}
        """#)
        XCTAssertEqual(v.lastStopSequence, 11)
        XCTAssertEqual(v.distance, 4.9)
        XCTAssertEqual(v.state, "on_track")
        XCTAssertNotNil(v.updatedAt)

        let bare = try decode(TripVehicle.self, #"{"tripId":"22_1","lat":50.08,"lon":14.42,"bearing":null,"delaySeconds":null,"lastStopSequence":null,"nextStopSequence":null,"distance":null,"state":"before_track","updatedAt":"x"}"#)
        XCTAssertNil(bare.lastStopSequence)
        XCTAssertNil(bare.updatedAt)
        XCTAssertEqual(bare.state, "before_track")
    }

    func testLiveVehicles() throws {
        let list = try decode(LiveVehicles.self, #"""
        {"vehicles":[
          {"tripId":"9_1","route":"9","kind":"tram","lat":50.08,"lon":14.42,"bearing":90,"delaySeconds":30},
          {"tripId":"58_1","route":"58","kind":"trolleybus","lat":50.1,"lon":14.4,"bearing":null,"delaySeconds":null},
          {"route":"no trip"}
        ],"generatedAt":"2026-10-03T09:10:45.000Z"}
        """#)
        XCTAssertEqual(list.vehicles.map(\.tripId), ["9_1", "58_1"])
        XCTAssertEqual(list.vehicles[1].kind, .other)
    }

    func testErrorBody() throws {
        let body = try decode(APIErrorBody.self, #"{"_tag":"UpstreamUnavailable","reason":"rate limited"}"#)
        XCTAssertEqual(body.tag, "UpstreamUnavailable")
        XCTAssertEqual(body.reason, "rate limited")
        XCTAssertEqual(try decode(APIErrorBody.self, #"{"_tag":"TripNotFound","tripId":"x"}"#).tag, "TripNotFound")
    }

    // MARK: Config

    func testWebSocketURLFollowsTheBase() throws {
        let id = try XCTUnwrap(UUID(uuidString: "6F9619FF-8B86-D011-B42D-00C04FC964FF"))
        XCTAssertEqual(
            APIConfig.webSocketURL(base: APIConfig.production, session: id).absoluteString,
            "wss://tablo.run/api/ws?session=6f9619ff-8b86-d011-b42d-00c04fc964ff"
        )
        XCTAssertEqual(
            APIConfig.webSocketURL(base: try XCTUnwrap(URL(string: "http://localhost:1337")), session: id).absoluteString,
            "ws://localhost:1337/api/ws?session=6f9619ff-8b86-d011-b42d-00c04fc964ff"
        )
    }
}

@MainActor
final class FeedTests: XCTestCase {
    func testReconnectDelayBackoffWithJitter() {
        XCTAssertEqual(DeparturesFeed.reconnectDelay(attempt: 0, random: 0), 0.5)
        XCTAssertEqual(DeparturesFeed.reconnectDelay(attempt: 0, random: 1), 1)
        XCTAssertEqual(DeparturesFeed.reconnectDelay(attempt: 3, random: 0.5), 6)
        XCTAssertEqual(DeparturesFeed.reconnectDelay(attempt: 10, random: 1), 30)  // capped
        XCTAssertEqual(DeparturesFeed.reconnectDelay(attempt: 100, random: 0), 15)
    }

    func testServerFramesDriveStatus() throws {
        let feed = DeparturesFeed(base: APIConfig.production)
        let update = try Wire.decode(ServerMessage.self, from: Data(#"""
        {"_tag":"DeparturesUpdate","generatedAt":"x","degraded":true,"reason":"upstream slow","boards":[{"key":"539","departures":[]}]}
        """#.utf8))
        feed.apply(update)
        XCTAssertEqual(feed.status, .degraded)
        XCTAssertEqual(feed.reason, "upstream slow")
        XCTAssertEqual(feed.boards["539"]?.count, 0)

        feed.apply(.serverError("boom"))
        XCTAssertEqual(feed.status, .degraded)
        XCTAssertEqual(feed.reason, "boom")
        XCTAssertNotNil(feed.boards["539"])  // an error keeps the last boards
    }
}
