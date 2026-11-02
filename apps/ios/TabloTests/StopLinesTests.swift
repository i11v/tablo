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
}
