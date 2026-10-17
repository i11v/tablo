import CoreLocation
import Observation

/// When-in-use location. `coordinate` stays nil until a usable fix arrives and
/// returns to nil when access is withdrawn — the board then goes neutral.
@MainActor
@Observable
final class LocationService: NSObject, CLLocationManagerDelegate {
    private(set) var coordinate: LngLat?

    /// Fires on every accepted fix and on loss of access.
    @ObservationIgnored var onChange: (() -> Void)?

    @ObservationIgnored private let manager = CLLocationManager()
    @ObservationIgnored private var running = false

    /// Fixes coarser than this don't move the dot or the walk times.
    static let maxAccuracy: CLLocationAccuracy = 250

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        manager.distanceFilter = 5
        manager.activityType = .otherNavigation
    }

    func start() {
        running = true
        apply(manager.authorizationStatus)
    }

    func stop() {
        running = false
        manager.stopUpdatingLocation()
    }

    private func apply(_ status: CLAuthorizationStatus) {
        switch status {
        case .notDetermined:
            if running { manager.requestWhenInUseAuthorization() }
        case .authorizedWhenInUse, .authorizedAlways:
            if running { manager.startUpdatingLocation() }
        default:
            manager.stopUpdatingLocation()
            if coordinate != nil {
                coordinate = nil
                onChange?()
            }
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        MainActor.assumeIsolated {
            apply(manager.authorizationStatus)
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        MainActor.assumeIsolated {
            guard let fix = locations.last(where: { $0.horizontalAccuracy >= 0 && $0.horizontalAccuracy <= Self.maxAccuracy }) else { return }
            coordinate = LngLat(fix.coordinate.longitude, fix.coordinate.latitude)
            onChange?()
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        MainActor.assumeIsolated {
            // kCLErrorLocationUnknown is transient; denial arrives via the authorization callback
            if (error as? CLError)?.code == .denied { apply(.denied) }
        }
    }
}
