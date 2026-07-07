import SwiftUI
import SwiftData

@main
struct KaspitApp: App {
    @State private var lock = AppLockManager()
    @Environment(\.scenePhase) private var scenePhase

    let container: ModelContainer = {
        let schema = Schema([
            Account.self, Txn.self, Category.self, BudgetEntry.self,
            RecurringItem.self, Rule.self, Holding.self, Goal.self,
            NetWorthSnapshot.self,
        ])
        // סנכרון iCloud אופציונלי: החלפת ה-configuration ל-cloudKitDatabase(.private) — שלב M3.
        let config = ModelConfiguration(schema: schema)
        do {
            return try ModelContainer(for: schema, configurations: [config])
        } catch {
            fatalError("ModelContainer failed: \(error)")
        }
    }()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(lock)
                .environment(\.locale, Locale(identifier: "he_IL"))
                .onChange(of: scenePhase) { _, phase in
                    if phase == .background { lock.lockIfNeeded() }
                }
                .task { lock.lockIfNeeded() }
        }
        .modelContainer(container)
    }
}
