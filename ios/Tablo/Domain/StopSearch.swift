import Foundation

/// Stop search over the full index — the web's `matcher.ts` + `ranker.ts`.
enum StopSearch {
    /// Diacritics-insensitive lowercase form shared with the index's `norm`:
    /// NFD, combining marks stripped, lowercased ("Národní Třída" → "narodni trida").
    static func fold(_ text: String) -> String {
        let scalars = text.decomposedStringWithCanonicalMapping.unicodeScalars.filter { scalar in
            switch scalar.properties.generalCategory {
            case .nonspacingMark, .spacingMark, .enclosingMark: false
            default: true
            }
        }
        return String(String.UnicodeScalarView(scalars)).lowercased()
    }

    /// Something a query can hit: a whole stop, or one of its platforms ("narodni trida a").
    struct Searchable {
        let entry: IndexStop
        let platform: String?
        let norm: [UInt8]
        /// UTF-16 length, as the web's `norm.length` tiebreak counts it.
        let length: Int
        let normText: String
    }

    /// The index expanded for matching, built once per index load.
    struct Index {
        let entries: [IndexStop]
        let searchables: [Searchable]

        init(_ entries: [IndexStop]) {
            self.entries = entries
            var out: [Searchable] = []
            out.reserveCapacity(entries.count * 2)
            for entry in entries {
                out.append(Searchable(entry: entry, platform: nil, norm: Array(entry.norm.utf8), length: entry.norm.utf16.count, normText: entry.norm))
                guard entry.platforms.count > 1 else { continue }
                for p in entry.platforms {
                    let norm = entry.norm + " " + StopSearch.fold(p.code)
                    out.append(Searchable(entry: entry, platform: p.code, norm: Array(norm.utf8), length: norm.utf16.count, normText: norm))
                }
            }
            searchables = out
        }
    }

    struct Candidate {
        let entry: IndexStop
        let platform: String?
        let score: Double
    }

    /// exact prefix (100) > word-boundary prefix (80) > substring (60), then
    /// shorter names, then alphabetical; the best `limit`.
    static func match(_ index: Index, query: String, limit: Int = 10) -> [Candidate] {
        let q = Array(fold(query.trimmingCharacters(in: .whitespacesAndNewlines)).utf8)
        guard !q.isEmpty else { return [] }
        var hits: [(s: Searchable, score: Double)] = []
        for s in index.searchables {
            let score = textScore(s.norm, q)
            if score > 0 { hits.append((s, score)) }
        }
        hits.sort { a, b in
            if a.score != b.score { return a.score > b.score }
            if a.s.length != b.s.length { return a.s.length < b.s.length }
            return a.s.normText < b.s.normText
        }
        return hits.prefix(limit).map { Candidate(entry: $0.s.entry, platform: $0.s.platform, score: $0.score) }
    }

    /// The matcher's score for one folded name (byte-level; UTF-8 is self-synchronising).
    static func textScore(_ norm: [UInt8], _ q: [UInt8]) -> Double {
        guard q.count <= norm.count else { return 0 }
        if norm.starts(with: q) { return 100 }
        // first occurrence only, as String.indexOf
        let last = norm.count - q.count
        guard last >= 1 else { return 0 }
        for at in 1 ... last where norm[at] == q[0] {
            var i = 1
            while i < q.count, norm[at + i] == q[i] { i += 1 }
            guard i == q.count else { continue }
            return isWordByte(norm[at - 1]) ? 60 : 80
        }
        return 0
    }

    private static func isWordByte(_ b: UInt8) -> Bool {
        (b >= 0x61 && b <= 0x7A) || (b >= 0x30 && b <= 0x39)
    }

    /// Peak boost for a stop at your feet, decaying e-fold per km — orders stops
    /// within a relevance tier without beating a clearly better text match.
    static let proximityMaxBoost = 30.0
    static let proximityScaleMetres = 1000.0
    static let recentBoost = 25.0

    /// Text relevance + recents boost + proximity (when a location is known).
    static func rank(_ candidates: [Candidate], recents: [String], origin: LngLat?) -> [Candidate] {
        candidates.enumerated().map { i, c in
            var score = c.score
            if recents.contains(c.entry.key) { score += recentBoost }
            if let origin {
                score += proximityMaxBoost * exp(-Geo.haversineMetres(origin, c.entry.coord) / proximityScaleMetres)
            }
            return (i, Candidate(entry: c.entry, platform: c.platform, score: score))
        }
        .sorted { ($0.1.score, -$0.0) > ($1.1.score, -$1.0) }
        .map(\.1)
    }

    /// Distinct matching stops, best first.
    static func search(_ index: Index, query: String, recents: [String], origin: LngLat?, limit: Int = 20) -> [IndexStop] {
        var seen = Set<String>()
        var out: [IndexStop] = []
        for c in rank(match(index, query: query, limit: limit * 2), recents: recents, origin: origin) where seen.insert(c.entry.key).inserted {
            out.append(c.entry)
            if out.count == limit { break }
        }
        return out
    }

    /// The closest stops to `origin`, nearest first, with their distances.
    static func nearest(_ entries: [IndexStop], to origin: LngLat, limit: Int) -> [(stop: IndexStop, metres: Double)] {
        // cheap planar prefilter, exact distance for the survivors
        let cosLat = cos(origin.lat * .pi / 180)
        func planar(_ e: IndexStop) -> Double {
            let dx = (e.lon - origin.lng) * cosLat, dy = e.lat - origin.lat
            return dx * dx + dy * dy
        }
        var best: [(e: IndexStop, d: Double)] = []
        for e in entries {
            let d = planar(e)
            if best.count < limit * 2 || d < best[best.count - 1].d {
                best.append((e, d))
                best.sort { $0.d < $1.d }
                if best.count > limit * 2 { best.removeLast() }
            }
        }
        return best
            .map { (stop: $0.e, metres: Geo.haversineMetres(origin, $0.e.coord)) }
            .sorted { $0.metres < $1.metres }
            .prefix(limit)
            .map { $0 }
    }
}
