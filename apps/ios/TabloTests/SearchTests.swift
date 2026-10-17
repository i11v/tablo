import XCTest
@testable import Tablo

final class SearchTests: XCTestCase {
    private func stop(_ name: String, node: Int, lat: Double = 50.08, lon: Double = 14.42, codes: [String] = [], disambig: String? = nil) -> IndexStop {
        IndexStop(
            name: name, norm: StopSearch.fold(name), node: node, stops: nil, lat: lat, lon: lon, zone: "P", disambig: disambig,
            platforms: codes.enumerated().map { IndexPlatform(code: $1, stop: $0 + 1, lat: nil, lon: nil) }
        )
    }

    private lazy var entries: [IndexStop] = [
        stop("Anděl", node: 1040, lat: 50.0706, lon: 14.4035, codes: ["A", "B"]),
        stop("Andělská Hora,rozc.", node: 2001, lat: 50.2, lon: 12.95),
        stop("Na Knížecí", node: 1050, lat: 50.0700, lon: 14.4040),
        stop("Národní třída", node: 539, lat: 50.08069, lon: 14.41992, codes: ["1", "2", "A", "B"]),
        stop("Národní divadlo", node: 540, lat: 50.0812, lon: 14.4135),
        stop("Staré Národní", node: 9001, lat: 49.9, lon: 14.9),
        stop("Kanárek", node: 9002, lat: 50.1, lon: 14.5),
    ]

    func testFoldStripsDiacritics() {
        XCTAssertEqual(StopSearch.fold("Národní Třída"), "narodni trida")
        XCTAssertEqual(StopSearch.fold("Sídliště Řepy"), "sidliste repy")
        XCTAssertEqual(StopSearch.fold("Anděl"), "andel")
    }

    func testTextScoreTiers() {
        func score(_ norm: String, _ q: String) -> Double { StopSearch.textScore(Array(norm.utf8), Array(q.utf8)) }
        XCTAssertEqual(score("narodni trida", "narodni"), 100)  // prefix
        XCTAssertEqual(score("stare narodni", "narodni"), 80)  // word-boundary prefix
        XCTAssertEqual(score("kanarek", "nar"), 60)  // substring
        XCTAssertEqual(score("andel", "zlicin"), 0)
        XCTAssertEqual(score("na knizeci", "na knizeci x"), 0)  // longer than the name
    }

    func testMatchOrdersByScoreThenLengthThenName() {
        let index = StopSearch.Index(entries)
        let hits = StopSearch.match(index, query: "nar", limit: 10)
        // prefix (shortest first, then alphabetical), then word-boundary, then substring
        XCTAssertEqual(hits.map(\.entry.name).prefix(2), ["Národní třída", "Národní divadlo"])
        let names = hits.map(\.entry.name)
        XCTAssertLessThan(try XCTUnwrap(names.firstIndex(of: "Staré Národní")), try XCTUnwrap(names.firstIndex(of: "Kanárek")))
        XCTAssertTrue(StopSearch.match(index, query: "   ", limit: 10).isEmpty)
    }

    func testPlatformsAreSearchable() {
        let index = StopSearch.Index(entries)
        let hits = StopSearch.match(index, query: "narodni trida a", limit: 10)
        XCTAssertEqual(hits.first?.entry.node, 539)
        XCTAssertEqual(hits.first?.platform, "A")
    }

    func testRecentsAndProximityBoost() {
        let index = StopSearch.Index(entries)
        // both are prefix hits; the shorter name wins on text alone
        XCTAssertEqual(StopSearch.search(index, query: "andel", recents: [], origin: nil).first?.name, "Anděl")
        // a recent stop gets +25
        XCTAssertEqual(StopSearch.search(index, query: "andel", recents: ["2001"], origin: nil).first?.name, "Andělská Hora,rozc.")
        // proximity orders within a tier: standing at Národní divadlo, it beats the shorter Národní třída
        let atDivadlo = LngLat(14.4135, 50.0812)
        XCTAssertEqual(StopSearch.search(index, query: "narodni", recents: [], origin: atDivadlo).first?.name, "Národní divadlo")
        // …but never lifts a substring hit over a prefix one (peak 30 < the 40-point gap)
        let atKanarek = LngLat(14.5, 50.1)
        XCTAssertEqual(StopSearch.search(index, query: "nar", recents: [], origin: atKanarek).first?.name, "Národní třída")
    }

    func testSearchDedupesStops() {
        let index = StopSearch.Index(entries)
        let found = StopSearch.search(index, query: "narodni trida", recents: [], origin: nil)
        XCTAssertEqual(found.filter { $0.node == 539 }.count, 1)
    }

    func testNearest() {
        let near = StopSearch.nearest(entries, to: LngLat(14.4194, 50.0817), limit: 3)
        XCTAssertEqual(near.map(\.stop.name), ["Národní třída", "Národní divadlo", "Anděl"])
        XCTAssertEqual(near.map(\.metres), near.map(\.metres).sorted())
    }

    func testResultDetail() {
        XCTAssertEqual(StopModel.detail(entries[3]), "1 · 2 · A · B")
        XCTAssertEqual(StopModel.detail(entries[2]), "Zone P")
    }
}
