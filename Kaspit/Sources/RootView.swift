import SwiftUI
import SwiftData

struct RootView: View {
    @Environment(AppLockManager.self) private var lock
    @Environment(\.modelContext) private var context
    @AppStorage("didOnboard") private var didOnboard = false
    @Query private var categories: [Category]

    var body: some View {
        ZStack {
            if didOnboard {
                mainTabs
            } else {
                OnboardingView()
            }
            if lock.isLocked {
                LockScreenView()
            }
        }
        .task { seedCategoriesIfNeeded() }
    }

    private var mainTabs: some View {
        TabView {
            DashboardView()
                .tabItem { Label("דשבורד", systemImage: "square.grid.2x2.fill") }
            TransactionsView()
                .tabItem { Label("תנועות", systemImage: "list.bullet.rectangle.fill") }
            BudgetView()
                .tabItem { Label("תקציב", systemImage: "chart.pie.fill") }
            RecurringsView()
                .tabItem { Label("הוראות קבע", systemImage: "arrow.triangle.2.circlepath") }
            AccountsView()
                .tabItem { Label("חשבונות", systemImage: "building.columns.fill") }
        }
    }

    private func seedCategoriesIfNeeded() {
        guard categories.isEmpty else { return }
        DefaultCategories.seed { context.insert($0) }
        try? context.save()
    }
}
