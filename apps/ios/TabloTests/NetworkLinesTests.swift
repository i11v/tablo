import XCTest
@testable import Tablo

final class NetworkLinesTests: XCTestCase {
    private let a = LngLat(14.419, 50.081), b = LngLat(14.420, 50.080)

    private func line(_ kinds: [VehicleKind]) -> NetworkLine {
        NetworkLine(kinds: kinds, path: [a, b])
    }

    func testAStretchShowsWhileAnyOfItsModesDoes() {
        let lines = [line([.tram]), line([.tram, .bus]), line([.bus]), line([.metro])]
        let buses = NetworkLines.visible(lines, modes: [.bus])
        XCTAssertEqual(buses.surface.map(\.kinds), [[.tram, .bus], [.bus]])
        XCTAssertTrue(buses.metro.isEmpty)

        let all = NetworkLines.visible(lines, modes: [.tram, .bus, .metro])
        XCTAssertEqual(all.surface.count, 3)
        XCTAssertEqual(all.metro.map(\.kinds), [[.metro]])
        XCTAssertTrue(NetworkLines.visible(lines, modes: []).surface.isEmpty)
    }

    func testAStretchTooShortToDrawIsLeftOut() {
        let dot = NetworkLine(kinds: [.tram], path: [a])
        XCTAssertTrue(NetworkLines.visible([dot], modes: [.tram]).surface.isEmpty)
    }
}
