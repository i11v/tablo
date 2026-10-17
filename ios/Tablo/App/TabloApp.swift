import SwiftUI

@main
struct TabloApp: App {
    init() {
        Telemetry.configure()
    }

    var body: some Scene {
        WindowGroup {
            StopScreen()
        }
    }
}
