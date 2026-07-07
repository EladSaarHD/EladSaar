import Foundation
import LocalAuthentication
import SwiftUI

/// נעילת Face ID / Touch ID: בכניסה לאפליקציה ובחזרה מרקע.
@Observable
final class AppLockManager {
    var isLocked = false

    var isEnabled: Bool {
        get { UserDefaults.standard.bool(forKey: "appLockEnabled") }
        set {
            UserDefaults.standard.set(newValue, forKey: "appLockEnabled")
            if !newValue { isLocked = false }
        }
    }

    func lockIfNeeded() {
        if isEnabled { isLocked = true }
    }

    func unlock() async {
        guard isEnabled else { isLocked = false; return }
        let context = LAContext()
        context.localizedCancelTitle = "ביטול"
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            // אין ביומטריה/קוד מוגדרים במכשיר — לא נועלים את המשתמש בחוץ.
            isLocked = false
            return
        }
        do {
            let ok = try await context.evaluatePolicy(.deviceOwnerAuthentication,
                                                      localizedReason: "פתיחת כספית")
            if ok { isLocked = false }
        } catch {
            // נשאר נעול; המשתמש יכול לנסות שוב ממסך הנעילה.
        }
    }
}

struct LockScreenView: View {
    @Environment(AppLockManager.self) private var lock

    var body: some View {
        VStack(spacing: 24) {
            Image(systemName: "lock.circle.fill")
                .font(.system(size: 64))
                .foregroundStyle(.tint)
            Text("כספית נעולה")
                .font(.title2.bold())
            Button {
                Task { await lock.unlock() }
            } label: {
                Label("פתח עם Face ID", systemImage: "faceid")
                    .font(.headline)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(.ultraThinMaterial)
        .task { await lock.unlock() }
    }
}
