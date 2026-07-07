import Foundation
import UserNotifications

/// התראות מקומיות: חיוב קרוב, חריגת תקציב, סיכום שבועי, עליית מחיר.
/// כל סוג ניתן לכיבוי בהגדרות (כמו ב-Copilot — רואים רק מה שרלוונטי).
enum NotificationKind: String, CaseIterable, Identifiable {
    case upcomingRecurring
    case budgetThreshold
    case largeTransaction
    case priceIncrease
    case weeklySummary
    case billingDateReminder

    var id: String { rawValue }

    var label: String {
        switch self {
        case .upcomingRecurring: return "חיוב חוזר עומד לרדת"
        case .budgetThreshold: return "התקרבות לתקרת תקציב"
        case .largeTransaction: return "תנועה גדולה"
        case .priceIncrease: return "עליית מחיר במנוי"
        case .weeklySummary: return "סיכום שבועי"
        case .billingDateReminder: return "תזכורת מועד חיוב אשראי"
        }
    }

    var defaultsKey: String { "notif_\(rawValue)" }
}

@MainActor
final class NotificationService {
    static let shared = NotificationService()

    func requestAuthorization() async -> Bool {
        (try? await UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .badge, .sound])) ?? false
    }

    func isEnabled(_ kind: NotificationKind) -> Bool {
        UserDefaults.standard.object(forKey: kind.defaultsKey) as? Bool ?? true
    }

    func setEnabled(_ kind: NotificationKind, _ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: kind.defaultsKey)
    }

    /// תזמון התראה על חיוב חוזר יום לפני הירידה הצפויה.
    func scheduleUpcomingRecurring(_ item: RecurringItem) {
        guard isEnabled(.upcomingRecurring) else { return }
        guard let fireDate = Calendar.current.date(byAdding: .day, value: -1, to: item.nextDate),
              fireDate > Date() else { return }

        let content = UNMutableNotificationContent()
        content.title = "חיוב קרוב: \(item.displayName)"
        content.body = "מחר צפוי לרדת חיוב של \(Formatters.currency(item.expectedAmount))"
        content.sound = .default

        var components = Calendar.current.dateComponents([.year, .month, .day], from: fireDate)
        components.hour = 9
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        let request = UNNotificationRequest(identifier: "recurring-\(item.uuid.uuidString)",
                                            content: content, trigger: trigger)
        UNUserNotificationCenter.current().add(request)
    }

    /// התראת חריגת תקציב מיידית (נקראת אחרי הוספת תנועה/ייבוא).
    func notifyBudgetThreshold(categoryName: String, spentPercent: Int) {
        guard isEnabled(.budgetThreshold) else { return }
        let content = UNMutableNotificationContent()
        content.title = "תקציב \(categoryName)"
        content.body = spentPercent >= 100
            ? "חרגת מהתקציב החודשי 😬"
            : "ניצלת \(spentPercent)% מהתקציב החודשי"
        content.sound = .default
        let request = UNNotificationRequest(identifier: "budget-\(categoryName)-\(spentPercent)",
                                            content: content,
                                            trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false))
        UNUserNotificationCenter.current().add(request)
    }

    /// סיכום שבועי קבוע — ראשון 09:00.
    func scheduleWeeklySummary() {
        guard isEnabled(.weeklySummary) else { return }
        let content = UNMutableNotificationContent()
        content.title = "הסיכום השבועי שלך מוכן"
        content.body = "בוא לראות כמה הוצאת השבוע ואיך אתה עומד מול התקציב"
        content.sound = .default
        var components = DateComponents()
        components.weekday = 1 // ראשון
        components.hour = 9
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: true)
        let request = UNNotificationRequest(identifier: "weekly-summary", content: content, trigger: trigger)
        UNUserNotificationCenter.current().add(request)
    }
}
