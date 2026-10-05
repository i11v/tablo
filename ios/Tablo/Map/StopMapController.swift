import MapKit
import SwiftUI
import UIKit

/// An annotation that carries its own pre-rendered artwork.
final class Marker: MKPointAnnotation {
    enum Role {
        case platform(String), vehicle(String), journeyStop, journeyVehicle, stop
    }

    let role: Role
    var art: MarkerImage
    var zPriority: MKAnnotationViewZPriority
    var tappable: Bool
    var scale: CGFloat = 1
    var opacity: CGFloat = 1
    /// Screen heading in degrees (0 = up, clockwise) for art with a `head`; nil hides it.
    var heading: Double?
    fileprivate(set) var isOnMap = false

    init(role: Role, at coord: LngLat, art: MarkerImage, zPriority: MKAnnotationViewZPriority, tappable: Bool = false) {
        self.role = role
        self.art = art
        self.zPriority = zPriority
        self.tappable = tappable
        super.init()
        coordinate = coord.coordinate
    }
}

final class TabloMapView: MKMapView {
    var onFirstLayout: (() -> Void)?

    override func layoutSubviews() {
        super.layoutSubviews()
        if bounds.width > 0, let first = onFirstLayout {
            onFirstLayout = nil
            first()
        }
    }
}

/// A live vehicle easing from where it's drawn toward its latest fix, fading
/// in when it appears and out when it leaves the feed. Once its trip's path is
/// known it glides along it by km, so it follows its line instead of cutting
/// straight across blocks; fixes too far off the path (a diversion) glide straight.
/// With timed reports and the trip's timetable it follows a `VehicleTrack`
/// instead: moving on between reports, halting where they show it stopped.
private final class Glide {
    let marker: Marker
    var route: String
    var kind: VehicleKind
    var from: LngLat
    var to: LngLat
    var start: CFTimeInterval
    var duration: CFTimeInterval = 0
    var fadeFrom: CGFloat = 0
    var fadeTo: CGFloat = 1
    var fadeStart: CFTimeInterval
    var leaving = false
    /// The trip's path; `onPath` while the latest fix lies on it.
    private(set) var path: [PathPoint]?
    private var plan: TripPlan?
    /// The latest timed report, and the track it's followed on while one exists.
    private var report: VehicleReport?
    private var track: VehicleTrack?
    private var onPath = false
    private var kmFrom = 0.0
    private var kmTo = 0.0

    static let fade: CFTimeInterval = 0.5
    /// A jump too long to glide: fade in at the new place instead.
    static let jumpMetres = 800.0
    /// Farther than this from its path, a fix counts as off it.
    static let offPathMetres = 60.0
    /// How far behind the drawn km a fix may project (GPS jitter, a glide that overshot a stop).
    static let backtrackKm = 0.15

    init(_ v: MapVehicle, marker: Marker, at t: CFTimeInterval) {
        self.marker = marker
        route = v.route
        kind = v.kind
        from = v.coord
        to = v.coord
        report = v.report
        start = t
        fadeStart = t
    }

    private func progress(at t: CFTimeInterval) -> Double {
        duration > 0 ? max(0, min(1, (t - start) / duration)) : 1
    }

    private func km(at t: CFTimeInterval) -> Double {
        kmFrom + (kmTo - kmFrom) * progress(at: t)
    }

    func position(at t: CFTimeInterval, now: Date) -> LngLat {
        if let track, let path, let p = Geo.point(on: path, atKm: track.km(at: now)) { return p }
        if onPath, let path, let p = Geo.point(on: path, atKm: km(at: t)) { return p }
        return Geo.lerp(from, to, progress(at: t))
    }

    /// Which way it's heading: along its line when on it, else toward its fix.
    func heading(at t: CFTimeInterval, now: Date) -> Double? {
        if let track, let path { return pathHeading(path, atKm: track.km(at: now)) }
        if onPath, let path { return pathHeading(path, atKm: km(at: t)) }
        return screenHeading(from, to)
    }

    /// `fix` on the path, when it's close enough to count.
    private func snap(_ fix: LngLat, fromKm: Double = -.infinity) -> Double? {
        guard let path, let s = Geo.snap(fix, onto: path, fromKm: fromKm), s.metres <= Self.offPathMetres else { return nil }
        return s.km
    }

    /// Take the latest fix: on its track when it can be followed there, else
    /// head for it over `glide` seconds.
    func retarget(to v: MapVehicle, glide: TimeInterval, at t: CFTimeInterval, now: Date) {
        let here = position(at: t, now: now)
        if follow(v, from: here, at: t, now: now) { return }
        if track != nil {
            // lost its track (off it, or no report times): glide on from where it's drawn
            track = nil
            onPath = false
            from = here
        }
        let fix = v.coord
        if leaving || Geo.haversineMetres(here, fix) > Self.jumpMetres {
            // back from leaving, or a jump too long to glide: fade in at the new place
            from = fix
            to = fix
            duration = 0
            fadeIn(at: t)
            if let k = snap(fix) {
                onPath = true
                kmFrom = k
                kmTo = k
            } else {
                onPath = false
            }
            return
        }
        let shown = onPath ? km(at: t) : nil
        if let k = snap(fix, fromKm: (shown ?? -.infinity) - Self.backtrackKm) {
            let fromKm = shown ?? min(snap(here) ?? k, k)
            kmFrom = fromKm
            // vehicles don't reverse: hold through jitter rather than slide back
            kmTo = max(fromKm, k)
            to = fix
            onPath = true
        } else {
            from = here
            to = fix
            onPath = false
        }
        start = t
        duration = glide
    }

    /// Follow `v`'s report on the trip's track, easing from `here`; false when
    /// it can't be (no plan yet, no report time, or off its track).
    private func follow(_ v: MapVehicle, from here: LngLat, at t: CFTimeInterval, now: Date) -> Bool {
        report = v.report
        to = v.coord
        guard let plan, let report = v.report else { return false }
        if !leaving, var current = track, current.update(report, plan: plan, now: now) {
            track = current
        } else {
            track = VehicleTrack(plan: plan, report: report, shownKm: leaving ? nil : Geo.project(here, onto: plan.path), now: now)
        }
        guard track != nil else { return false }
        if leaving || Geo.haversineMetres(here, position(at: t, now: now)) > Self.jumpMetres {
            // back from leaving, or too far to ease: fade in where the track has it
            track = VehicleTrack(plan: plan, report: report, now: now)
            fadeIn(at: t)
        }
        return true
    }

    private func fadeIn(at t: CFTimeInterval) {
        leaving = false
        fadeFrom = 0
        fadeTo = 1
        fadeStart = t
    }

    /// The trip's plan arrived: follow its track when the reports allow, else
    /// carry on toward the latest fix along its path.
    func attach(_ plan: TripPlan, at t: CFTimeInterval, now: Date) {
        guard self.plan == nil, plan.path.count > 1 else { return }
        let here = position(at: t, now: now)
        self.plan = plan
        path = plan.path
        if let report, let track = VehicleTrack(plan: plan, report: report, shownKm: Geo.project(here, onto: plan.path), now: now) {
            self.track = track
            return
        }
        guard let target = snap(to) else { return }
        kmFrom = min(snap(here) ?? target, target)
        kmTo = target
        onPath = true
        duration = max(0, start + duration - t)
        start = t
    }

    func opacity(at t: CFTimeInterval) -> CGFloat {
        let f = max(0, min(1, (t - fadeStart) / Self.fade))
        return fadeFrom + (fadeTo - fadeFrom) * f
    }

    func fade(to target: CGFloat, at t: CFTimeInterval) {
        fadeFrom = opacity(at: t)
        fadeTo = target
        fadeStart = t
    }
}

/// Screen heading (degrees, 0 = up, clockwise) from `a` to `b` on the north-up map.
private func screenHeading(_ a: LngLat, _ b: LngLat) -> Double? {
    let p = MKMapPoint(a.coordinate), q = MKMapPoint(b.coordinate)
    let dx = q.x - p.x, dy = q.y - p.y
    guard dx != 0 || dy != 0 else { return nil }
    return atan2(dx, -dy) * 180 / .pi
}

/// Heading of `path` at `km`, over a short span (looking back at the end of the line).
private func pathHeading(_ path: [PathPoint], atKm km: Double) -> Double? {
    let span = 0.01
    let end = path.last?.km ?? km
    let a = min(km, end - span), b = a + span
    guard let p = Geo.point(on: path, atKm: a), let q = Geo.point(on: path, atKm: b) else { return nil }
    return screenHeading(p, q)
}

/// Imperative map controller — a port of the prototype's `map-proto.js`.
/// Stop mode: the current stop's platform pins and live vehicles. Journey
/// mode: one trip's path as an overlay with its vehicle.
@MainActor
final class StopMapController: NSObject, MKMapViewDelegate {
    let mapView = TabloMapView()

    var onSelectPlatform: ((String) -> Void)?
    /// A tappable vehicle was tapped: its trip id.
    var onVehicle: ((String) -> Void)?

    private var activeModes: [VehicleKind]
    private var selected: String?
    private var center: LngLat
    private var stopName = ""

    private var platforms: [Platform] = []
    private var platformMarkers: [String: Marker] = [:]
    private var stopMarker: Marker?
    private var vehicles: [String: Glide] = [:]
    private var vehicleTiers: [String: Tier] = [:]

    private var journey: Journey?
    private var journeyID: String?
    private var journeyFocus = -1
    private var journeyMarkers: [Marker] = []
    private var journeyVehicle: Marker?
    private var journeyMine: Marker?
    private var journeyTier: Tier = .neutral
    private var journeyPath: [MKMapPoint] = []
    private var journeyPathKm: [Double] = []
    /// The journey vehicle glides along the path by km.
    private var kmFrom = 0.0
    private var kmTo = 0.0
    private var kmStart: CFTimeInterval = 0
    private var kmDuration: CFTimeInterval = 0

    private let groundScrim = GroundScrim()
    private let journeyOverlay = JourneyOverlay()
    private var journeyRenderer: JourneyRenderer?
    private var displayLink: CADisplayLink?
    private var frame = 0

    static let homeZoom = 16.4

    init(activeModes: [VehicleKind], center: LngLat) {
        self.activeModes = activeModes
        self.center = center
        super.init()
        configureMap()
        addOverlays()

        let link = CADisplayLink(target: DisplayLinkProxy(self), selector: #selector(DisplayLinkProxy.tick))
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    private func configureMap() {
        mapView.delegate = self
        mapView.backgroundColor = UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: 0x0B0B0E) : UIColor(hex: 0xF2F0EA) }
        mapView.registerForTraitChanges([UITraitUserInterfaceStyle.self]) { [weak self] (_: TabloMapView, _: UITraitCollection) in
            self?.appearanceChanged()
        }
        let config = MKStandardMapConfiguration(elevationStyle: .flat, emphasisStyle: .muted)
        config.pointOfInterestFilter = .excludingAll
        config.showsTraffic = false
        mapView.preferredConfiguration = config
        mapView.isRotateEnabled = false
        mapView.isPitchEnabled = false
        mapView.showsCompass = false
        mapView.showsScale = false
        mapView.insetsLayoutMarginsFromSafeArea = false
        mapView.register(MKAnnotationView.self, forAnnotationViewWithReuseIdentifier: "marker")
        mapView.onFirstLayout = { [weak self] in
            guard let self else { return }
            appearanceChanged()
            setCamera(center: rectCenter(for: center, zoom: Self.homeZoom), zoom: Self.homeZoom, duration: 0)
            calibrateZoomRange()
        }
    }

    // MARK: - Appearance

    private var isDark: Bool { MarkerArt.scheme == .dark }

    private func addOverlays() {
        mapView.addOverlay(groundScrim, level: .aboveRoads)
        mapView.addOverlay(journeyOverlay, level: .aboveLabels)
    }

    /// Light ↔ dark: re-rasterise every marker and redraw the overlays in the new palette.
    private func appearanceChanged() {
        let scheme: ColorScheme
        switch mapView.traitCollection.userInterfaceStyle {
        case .dark: scheme = .dark
        case .light: scheme = .light
        default: return
        }
        guard scheme != MarkerArt.scheme else { return }
        MarkerArt.scheme = scheme

        if let stopMarker {
            stopMarker.art = MarkerArt.stopPin(name: stopName)
            if let view = mapView.view(for: stopMarker) { configure(view, with: stopMarker) }
        }
        restylePlatforms(animated: false)
        vehicles.values.forEach(restyle)
        if let j = journey {
            journeyMine?.art = MarkerArt.journeyStop(name: j.stops[j.mine].name, tier: journeyTier)
            journeyVehicle?.art = MarkerArt.vehicle(route: j.route, tier: journeyTier, big: true)
            for m in [journeyMine, journeyVehicle].compactMap({ $0 }) {
                if let view = mapView.view(for: m) { configure(view, with: m) }
            }
        }
        // renderers are fixed to one palette: re-adding the overlays asks for fresh ones
        mapView.removeOverlays([groundScrim, journeyOverlay])
        addOverlays()
    }

    // MARK: - Stop mode

    /// Make `coord` the current stop (the camera's home). Doesn't move the camera.
    func setStop(_ coord: LngLat, name: String) {
        center = coord
        if stopName != name || stopMarker == nil {
            stopName = name
            if let stopMarker { show(stopMarker, false) }
            stopMarker = Marker(role: .stop, at: coord, art: MarkerArt.stopPin(name: name), zPriority: .init(rawValue: 500))
        } else {
            stopMarker?.coordinate = coord.coordinate
        }
        applyVisibility()
    }

    /// Frame the current stop at the home zoom (unless following a journey).
    func flyToStop(duration: TimeInterval) {
        guard journey == nil else { return }
        fly(to: center, zoom: Self.homeZoom, duration: duration)
    }

    func setModes(_ modes: [VehicleKind]) {
        activeModes = modes
        applyVisibility()
    }

    /// The current stop's platform pins (empty when none can be placed — the stop pin stands in).
    func setPlatforms(_ next: [Platform]) {
        let keys = Set(next.map(\.key))
        for (key, marker) in platformMarkers where !keys.contains(key) {
            show(marker, false)
            platformMarkers[key] = nil
        }
        platforms = next
        for p in next {
            if let m = platformMarkers[p.key] {
                if m.coordinate.latitude != p.coord.lat || m.coordinate.longitude != p.coord.lng {
                    m.coordinate = p.coord.coordinate
                }
            } else {
                platformMarkers[p.key] = Marker(
                    role: .platform(p.key), at: p.coord, art: MarkerArt.platform(p, dimmed: false),
                    zPriority: .init(rawValue: 300), tappable: true
                )
            }
        }
        if let selected, !keys.contains(selected) { self.selected = nil }
        restylePlatforms(animated: false)
        applyVisibility()
    }

    func setSelected(_ key: String?) {
        selected = key
        restylePlatforms(animated: true)
    }

    private func restylePlatforms(animated: Bool) {
        for p in platforms {
            guard let m = platformMarkers[p.key] else { continue }
            let on = selected == p.key
            let art = MarkerArt.platform(p, dimmed: selected != nil && !on)
            let scale: CGFloat = on ? 1.18 : 1
            guard art.image !== m.art.image || m.scale != scale else { continue }
            m.art = art
            m.scale = scale
            m.zPriority = .init(rawValue: on ? 350 : 300)
            if let view = mapView.view(for: m) {
                if animated {
                    UIView.animate(withDuration: 0.12) { self.configure(view, with: m) }
                } else {
                    configure(view, with: m)
                }
            }
        }
    }

    /// Live vehicles around the stop; each glides to its new fix over `glide` seconds.
    func setVehicles(_ list: [MapVehicle], glide: TimeInterval) {
        let t = CACurrentMediaTime()
        let now = Date()
        var seen = Set<String>()
        for v in list {
            seen.insert(v.tripId)
            if let g = vehicles[v.tripId] {
                g.retarget(to: v, glide: glide, at: t, now: now)
                if g.route != v.route {
                    g.route = v.route
                    restyle(g)
                }
                g.kind = v.kind
            } else {
                let marker = Marker(
                    role: .vehicle(v.tripId), at: v.coord, art: MarkerArt.vehicle(route: v.route, tier: .neutral, big: false),
                    zPriority: .init(rawValue: 400)
                )
                marker.opacity = 0
                let g = Glide(v, marker: marker, at: t)
                vehicles[v.tripId] = g
                restyle(g)
            }
        }
        for (id, g) in vehicles where !seen.contains(id) && !g.leaving {
            g.leaving = true
            g.fade(to: 0, at: t)
        }
        applyVisibility()
    }

    /// The plan of a vehicle's trip: from now on it follows its line (and its
    /// timetable, when its reports are timed).
    func setVehiclePlan(_ tripId: String, _ plan: TripPlan) {
        guard let g = vehicles[tripId], g.path == nil else { return }
        g.attach(plan, at: CACurrentMediaTime(), now: Date())
    }

    /// Tiers of the vehicles whose trips are on the board (others stay neutral and can't be tapped).
    func setVehicleTiers(_ tiers: [String: Tier]) {
        guard tiers != vehicleTiers else { return }
        vehicleTiers = tiers
        vehicles.values.forEach(restyle)
    }

    private func restyle(_ g: Glide) {
        let known = g.marker.roleTripID.flatMap { vehicleTiers[$0] }
        let tier = known ?? .neutral
        let tappable = known != nil
        let art = MarkerArt.vehicle(route: g.route, tier: tier, big: false)
        guard art.image !== g.marker.art.image || tappable != g.marker.tappable else { return }
        g.marker.art = art
        g.marker.tappable = tappable
        if let view = mapView.view(for: g.marker) { configure(view, with: g.marker) }
    }

    /// Hide platforms + vehicles while following a journey.
    private func applyVisibility() {
        let following = journey != nil
        for g in vehicles.values {
            show(g.marker, !following && g.kind.isShown(in: activeModes))
        }
        for p in platforms {
            guard let m = platformMarkers[p.key] else { continue }
            show(m, !following && (p.mode.map(activeModes.contains) ?? true))
        }
        if let stopMarker { show(stopMarker, !following && platforms.isEmpty) }
    }

    // MARK: - Journey mode

    /// Follow `j` (identified by `id`); the camera frames the vehicle and your stop.
    func showJourney(_ j: Journey, id: String, sheetHeight: CGFloat) {
        clearJourney(silent: true)
        journey = j
        journeyID = id
        journeyFocus = -1
        journeyTier = j.tier
        journeyPath = j.path.map { MKMapPoint($0.coord.coordinate) }
        journeyPathKm = j.path.map(\.km)
        kmFrom = j.vehicleKm
        kmTo = j.vehicleKm
        kmStart = CACurrentMediaTime()
        kmDuration = 0

        let mine = Marker(
            role: .journeyStop, at: j.stops[j.mine].coord,
            art: MarkerArt.journeyStop(name: j.stops[j.mine].name, tier: j.tier), zPriority: .init(rawValue: 500)
        )
        let vehicle = Marker(
            role: .journeyVehicle, at: journeyVehiclePosition(),
            art: MarkerArt.vehicle(route: j.route, tier: j.tier, big: true), zPriority: .init(rawValue: 600)
        )
        journeyMarkers = [mine, vehicle]
        journeyMine = mine
        journeyVehicle = vehicle
        journeyMarkers.forEach { show($0, true) }
        applyVisibility()
        pushJourneySnapshot()
        fitJourney(sheetHeight: sheetHeight)
    }

    /// A fresher state of the journey being shown: the vehicle glides to its new place.
    func updateJourney(_ j: Journey) {
        guard journey != nil else { return }
        let t = CACurrentMediaTime()
        if abs(j.vehicleKm - kmTo) > 0.0005 {
            let shown = displayedKm(at: t)
            // a fresh fix every poll (tracked) or every tick (estimated): glide across the gap
            kmDuration = max(0.3, min(10, t - kmStart))
            kmFrom = shown
            kmTo = j.vehicleKm
            kmStart = t
        }
        if j.tier != journeyTier {
            journeyTier = j.tier
            if let journeyMine {
                journeyMine.art = MarkerArt.journeyStop(name: j.stops[j.mine].name, tier: j.tier)
                if let view = mapView.view(for: journeyMine) { configure(view, with: journeyMine) }
            }
            if let journeyVehicle {
                journeyVehicle.art = MarkerArt.vehicle(route: j.route, tier: j.tier, big: true)
                if let view = mapView.view(for: journeyVehicle) { configure(view, with: journeyVehicle) }
            }
        }
        journey = j
    }

    func focusStop(_ i: Int) {
        guard let j = journey, j.stops.indices.contains(i) else { return }
        journeyFocus = i
        // centre in the map left visible above the sheet (the prototype centred
        // in the full view, which put the stop under the sheet)
        fly(to: j.stops[i].coord, zoom: max(currentZoom, 15.6), offset: visibleCentreOffset, duration: 0.6)
        pushJourneySnapshot()
    }

    func clearJourney(silent: Bool = false) {
        journeyMarkers.forEach { show($0, false) }
        journeyMarkers = []
        journeyVehicle = nil
        journeyMine = nil
        journeyPath = []
        journeyPathKm = []
        journeyRenderer?.update(nil)
        let had = journey != nil
        journey = nil
        journeyID = nil
        applyVisibility()
        if had, !silent {
            fly(to: center, zoom: Self.homeZoom, duration: 0.7)
        }
    }

    /// Back home: frames the followed journey, or the stop.
    func recenter(sheetHeight: CGFloat) {
        if journey != nil {
            fitJourney(sheetHeight: sheetHeight)
        } else {
            fly(to: center, zoom: Self.homeZoom, duration: 0.6)
        }
    }

    /// Where the centre of the map left visible above the sheet sits, relative to the view centre.
    private var visibleCentreOffset: CGPoint {
        let box = marginBox
        return CGPoint(x: box.midX - mapView.bounds.midX, y: box.midY - mapView.bounds.midY)
    }

    /// Keeps Apple's legal label above the sheet.
    func setBottomInset(_ inset: CGFloat) {
        mapView.layoutMargins = UIEdgeInsets(top: 0, left: 16, bottom: inset + 8, right: 16)
    }

    private func displayedKm(at t: CFTimeInterval) -> Double {
        guard kmDuration > 0 else { return kmTo }
        return kmFrom + (kmTo - kmFrom) * max(0, min(1, (t - kmStart) / kmDuration))
    }

    private func journeyVehiclePosition() -> LngLat {
        guard let j = journey else { return center }
        return Geo.point(on: j.path, atKm: displayedKm(at: CACurrentMediaTime())) ?? j.stops[j.mine].coord
    }

    private func pushJourneySnapshot() {
        guard let j = journey, let id = journeyID else { return }
        journeyRenderer?.update(JourneySnapshot(
            pathID: id,
            path: journeyPath,
            pathKm: journeyPathKm,
            vehicleKm: displayedKm(at: CACurrentMediaTime()),
            vehicle: MKMapPoint(journeyVehiclePosition().coordinate),
            stops: j.stops.map { MKMapPoint($0.coord.coordinate) },
            seg: j.seg, mine: j.mine, focus: journeyFocus, atStop: j.atStop
        ))
    }

    private func fitJourney(sheetHeight: CGFloat) {
        guard let j = journey else { return }
        let from = max(0, j.seg - 1)
        let to = min(j.stops.count - 1, max(j.mine, j.seg + 1) + 2)
        let coords = j.stops[from ... to].map(\.coord) + [journeyVehiclePosition()]
        fit(coords, padding: UIEdgeInsets(top: 120, left: 44, bottom: sheetHeight + 30, right: 44), maxZoom: 16.6, duration: 0.7)
    }

    // MARK: - Animation

    fileprivate func tick() {
        let t = CACurrentMediaTime()
        let now = Date()
        if journey == nil {
            var gone: [String] = []
            for (id, g) in vehicles {
                let opacity = g.opacity(at: t)
                if g.leaving, opacity <= 0 {
                    gone.append(id)
                    continue
                }
                guard g.marker.isOnMap else { continue }
                place(g.marker, at: g.position(at: t, now: now))
                if g.marker.opacity != opacity {
                    g.marker.opacity = opacity
                    mapView.view(for: g.marker)?.alpha = opacity
                }
                turn(g.marker, to: g.heading(at: t, now: now))
            }
            for id in gone {
                if let g = vehicles.removeValue(forKey: id) { show(g.marker, false) }
            }
        } else if let vehicle = journeyVehicle {
            place(vehicle, at: journeyVehiclePosition())
            if let j = journey { turn(vehicle, to: pathHeading(j.path, atKm: displayedKm(at: t))) }
            frame += 1
            if frame % 6 == 0 { pushJourneySnapshot() }
        }
    }

    /// Move a marker to `p` without pixel snapping. MapKit puts annotation views
    /// on whole pixels, x and y apart, so a vehicle creeping along a diagonal
    /// line (zoomed out, a pixel every few frames) staircases around it; the
    /// view's transform carries the sub-pixel rest MapKit rounded off.
    private func place(_ m: Marker, at p: LngLat) {
        if m.coordinate.latitude != p.lat || m.coordinate.longitude != p.lng {
            m.coordinate = p.coordinate
        }
        guard let view = mapView.view(for: m), let container = view.superview else { return }
        let exact = mapView.convert(p.coordinate, toPointTo: container)
        var dx = exact.x + view.centerOffset.x - view.center.x
        var dy = exact.y + view.centerOffset.y - view.center.y
        // more than a pixel off: MapKit is mid-layout (a zoom, a pan) — leave it be
        if abs(dx) > 1 || abs(dy) > 1 { dx = 0; dy = 0 }
        let transform = CGAffineTransform(scaleX: m.scale, y: m.scale).concatenating(CGAffineTransform(translationX: dx, y: dy))
        if view.transform != transform { view.transform = transform }
    }

    // MARK: - Camera
    //
    // Zoom levels follow MapLibre's 512px-tile convention so the prototype's
    // numbers carry over: one screen point spans 2^(19 − zoom) MKMapPoints.
    //
    // MapKit treats the layout-margin box (the map above the sheet) as its
    // viewport: the camera centres there and `visibleMapRect` spans it. The
    // prototype frames against the whole view, so we translate.

    private func mapPointsPerPoint(_ zoom: Double) -> Double { pow(2, 19 - zoom) }

    private var marginBox: CGRect {
        mapView.bounds.inset(by: mapView.layoutMargins)
    }

    /// Camera altitude per MKMapPoint of visible width — linear at a fixed latitude.
    private var distancePerMapPoint: Double {
        mapView.camera.centerCoordinateDistance / mapView.visibleMapRect.size.width
    }

    private var currentZoom: Double {
        let box = marginBox
        guard box.width > 0, mapView.visibleMapRect.size.width > 0 else { return Self.homeZoom }
        return 19 - log2(mapView.visibleMapRect.size.width / box.width)
    }

    private func rectCenter(for coord: LngLat, zoom: Double, offset: CGPoint = .zero) -> MKMapPoint {
        // `offset` is where the coordinate should land relative to the view centre
        let s = mapPointsPerPoint(zoom)
        let p = MKMapPoint(coord.coordinate)
        return MKMapPoint(x: p.x - offset.x * s, y: p.y - offset.y * s)
    }

    private func fly(to coord: LngLat, zoom: Double, offset: CGPoint = .zero, duration: TimeInterval) {
        setCamera(center: rectCenter(for: coord, zoom: zoom, offset: offset), zoom: zoom, duration: duration)
    }

    private func fit(_ coords: [LngLat], padding: UIEdgeInsets, maxZoom: Double, duration: TimeInterval) {
        let size = mapView.bounds.size
        guard size.width > 0, !coords.isEmpty else { return }
        let points = coords.map { MKMapPoint($0.coordinate) }
        let minX = points.map(\.x).min()!, maxX = points.map(\.x).max()!
        let minY = points.map(\.y).min()!, maxY = points.map(\.y).max()!
        let available = CGSize(
            width: max(40, size.width - padding.left - padding.right),
            height: max(40, size.height - padding.top - padding.bottom)
        )
        let scale = max((maxX - minX) / available.width, (maxY - minY) / available.height, mapPointsPerPoint(maxZoom))
        // centre the bounds inside the padded frame, then express that as a view-centre point
        let frameMid = CGPoint(x: padding.left + available.width / 2, y: padding.top + available.height / 2)
        let center = MKMapPoint(
            x: (minX + maxX) / 2 + (size.width / 2 - frameMid.x) * scale,
            y: (minY + maxY) / 2 + (size.height / 2 - frameMid.y) * scale
        )
        setCamera(center: center, zoom: 19 - log2(scale), duration: duration)
    }

    /// Put map point `center` at the view centre at `zoom`.
    private func setCamera(center: MKMapPoint, zoom: Double, duration: TimeInterval) {
        let size = mapView.bounds.size
        let box = marginBox
        guard size.width > 0, box.width > 0, mapView.visibleMapRect.size.width > 0 else { return }
        let s = mapPointsPerPoint(zoom)
        let cameraCenter = MKMapPoint(x: center.x + (box.midX - size.width / 2) * s, y: center.y + (box.midY - size.height / 2) * s)
        let camera = MKMapCamera(
            lookingAtCenter: cameraCenter.coordinate, fromDistance: distancePerMapPoint * box.width * s, pitch: 0, heading: 0
        )
        if duration > 0 {
            UIView.animate(withDuration: duration, delay: 0, options: [.curveEaseInOut, .allowUserInteraction, .beginFromCurrentState]) {
                self.mapView.camera = camera
            }
        } else {
            mapView.camera = camera
        }
    }

    /// MapLibre's minZoom 11 / maxZoom 18, as camera distances.
    private func calibrateZoomRange() {
        let box = marginBox
        guard box.width > 0, mapView.visibleMapRect.size.width > 0 else { return }
        let k = distancePerMapPoint
        mapView.cameraZoomRange = MKMapView.CameraZoomRange(
            minCenterCoordinateDistance: k * box.width * mapPointsPerPoint(18),
            maxCenterCoordinateDistance: k * box.width * mapPointsPerPoint(11)
        )
    }

    // MARK: - Annotations

    private func show(_ marker: Marker, _ visible: Bool) {
        guard visible != marker.isOnMap else { return }
        marker.isOnMap = visible
        if visible { mapView.addAnnotation(marker) } else { mapView.removeAnnotation(marker) }
    }

    /// Point a marker's wedge along `heading`, keeping the last one while it stands still.
    private func turn(_ m: Marker, to heading: Double?) {
        guard let heading else { return }
        if let old = m.heading, abs(old - heading) < 0.5 { return }
        m.heading = heading
        if let view = mapView.view(for: m) { orientHead(of: view, with: m) }
    }

    private static let headTag = 0x7AB1

    private func orientHead(of view: MKAnnotationView, with m: Marker) {
        var head = view.viewWithTag(Self.headTag) as? UIImageView
        guard let image = m.art.head, let heading = m.heading else {
            head?.isHidden = true
            return
        }
        if head == nil {
            let v = UIImageView()
            v.tag = Self.headTag
            view.addSubview(v)
            head = v
        }
        guard let head else { return }
        head.isHidden = false
        if head.image !== image {
            head.transform = .identity
            head.image = image
            head.frame = CGRect(origin: .zero, size: image.size)
        }
        head.transform = CGAffineTransform(rotationAngle: heading * .pi / 180)
    }

    private func configure(_ view: MKAnnotationView, with m: Marker) {
        let size = m.art.image.size
        view.image = m.art.image
        view.centerOffset = CGPoint(x: size.width / 2 - m.art.anchor.x, y: size.height / 2 - m.art.anchor.y)
        view.zPriority = m.zPriority
        view.displayPriority = .required
        view.collisionMode = .none
        view.canShowCallout = false
        view.isEnabled = m.tappable
        view.alpha = m.opacity
        view.transform = CGAffineTransform(scaleX: m.scale, y: m.scale)
        orientHead(of: view, with: m)
    }

    nonisolated func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
        MainActor.assumeIsolated {
            guard let m = annotation as? Marker else { return nil }
            let view = mapView.dequeueReusableAnnotationView(withIdentifier: "marker", for: m)
            configure(view, with: m)
            return view
        }
    }

    nonisolated func mapView(_ mapView: MKMapView, didSelect view: MKAnnotationView) {
        MainActor.assumeIsolated {
            guard let m = view.annotation as? Marker else { return }
            mapView.deselectAnnotation(m, animated: false)
            switch m.role {
            case let .platform(key): onSelectPlatform?(key)
            case let .vehicle(tripId): onVehicle?(tripId)
            default: break
            }
        }
    }

    nonisolated func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
        MainActor.assumeIsolated {
            if overlay is GroundScrim { return GroundScrimRenderer(overlay: overlay, dark: isDark) }
            guard overlay is JourneyOverlay else { return MKOverlayRenderer(overlay: overlay) }
            let renderer = JourneyRenderer(overlay: overlay, dark: isDark)
            journeyRenderer = renderer
            pushJourneySnapshot()
            return renderer
        }
    }
}

private extension Marker {
    var roleTripID: String? {
        if case let .vehicle(id) = role { return id }
        return nil
    }
}

/// Breaks the CADisplayLink → target retain cycle.
private final class DisplayLinkProxy: NSObject {
    weak var controller: StopMapController?

    init(_ controller: StopMapController) {
        self.controller = controller
    }

    @MainActor @objc func tick() {
        controller?.tick()
    }
}
