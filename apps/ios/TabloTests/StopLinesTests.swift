import XCTest
@testable import Tablo

final class StopLinesTests: XCTestCase {
    /// `metres` east and north of Národní třída.
    private func at(_ east: Double, _ north: Double) -> LngLat {
        LngLat(14.4194 + east / (111_320 * cos(50.0817 * .pi / 180)), 50.0817 + north / 111_320)
    }

    func testKeepsTheEndsAndShortPaths() {
        let path = [at(0, 0), at(100, 0), at(100, 100)]
        let smooth = StopLines.smooth(path)
        XCTAssertEqual(smooth.first, path.first)
        XCTAssertEqual(smooth.last, path.last)
        XCTAssertEqual(StopLines.smooth([at(0, 0), at(50, 0)]), [at(0, 0), at(50, 0)])
    }

    func testDropsJitterAlongAStraightRun() {
        let path = (0 ... 20).map { at(Double($0) * 10, $0 % 2 == 0 ? 0 : 1) }
        XCTAssertEqual(StopLines.smooth(path).count, 2)
    }

    func testRoundsACornerWithoutCuttingTheBlock() {
        let corner = at(200, 0)
        let smooth = StopLines.smooth([at(0, 0), corner, at(200, 200)])
        XCTAssertGreaterThan(smooth.count, 6)
        XCTAssertFalse(smooth.contains(corner))
        // the curve stays within a few metres of the corner
        let nearest = smooth.map { Geo.haversineMetres($0, corner) }.min() ?? .infinity
        XCTAssertLessThan(nearest, 9)
    }

    private func line(_ route: String, _ path: [LngLat], kind: VehicleKind = .tram) -> StopLine {
        StopLine(route: route, kind: kind, path: path)
    }

    func testTheOtherTrackIsDrawnOnTheFirst() {
        // two tracks 4 m apart, run in opposite directions
        let up = line("22", [at(0, 0), at(300, 0)])
        let down = line("9", [at(300, 4), at(0, 4)])
        let merged = StopLines.merge([up, down])
        XCTAssertEqual(merged[0], up)
        for p in merged[1].path {
            // on the first line: 0 m north
            XCTAssertLessThan(Geo.haversineMetres(p, LngLat(p.lng, at(0, 0).lat)), 0.05)
        }
    }

    func testACrossingLineKeepsItsCourse() {
        let east = line("22", [at(-200, 0), at(200, 0)])
        let north = line("9", [at(0, -200), at(0, 200)])
        let merged = StopLines.merge([east, north])
        // every point of the crossing line stays on its own street
        for p in merged[1].path {
            XCTAssertLessThan(Geo.haversineMetres(p, LngLat(at(0, 0).lng, p.lat)), 0.05)
        }
    }

    func testLinesFarApartAndMetroStayApart() {
        let tram = line("22", [at(0, 0), at(300, 0)])
        let far = line("9", [at(0, 30), at(300, 30)])
        let metro = line("B", [at(0, 3), at(300, 3)], kind: .metro)
        let merged = StopLines.merge([tram, far, metro])
        XCTAssertEqual(merged[1].path.first, far.path.first)
        XCTAssertEqual(merged[1].path.last, far.path.last)
        XCTAssertTrue(merged[1].path.allSatisfy { Geo.haversineMetres($0, LngLat($0.lng, at(0, 30).lat)) < 0.05 })
        XCTAssertTrue(merged[2].path.allSatisfy { Geo.haversineMetres($0, LngLat($0.lng, at(0, 3).lat)) < 0.05 })
    }
}
