import Foundation

/// הצעת קטגוריזציה לתנועה חדשה.
struct CategorySuggestion {
    enum Source {
        case rule          // חוק משתמש
        case learned       // נלמד מתיקוני המשתמש
        case builtin       // מילון בתי העסק הישראלי
    }
    var categoryUUID: UUID?
    var categoryName: String?
    var displayName: String?
    var markTransfer: Bool = false
    var source: Source
}

/// המקבילה המקומית ל-AI של Copilot: שלוש שכבות —
/// 1. חוקי משתמש (עדיפות עליונה)
/// 2. למידה מהיסטוריית התיקונים (מפתח בית עסק → הקטגוריה האחרונה שנבחרה)
/// 3. מילון בתי עסק ישראלי מובנה
struct CategorizationEngine {

    /// זיכרון נלמד: מפתח בית עסק מנורמל → קטגוריה שהמשתמש בחר לאחרונה.
    /// נבנה מהיסטוריית התנועות המאושרות בכל הפעלה.
    var learned: [String: UUID] = [:]
    var rules: [RuleSpec] = []

    /// בניית הזיכרון הנלמד מהיסטוריה: (מפתח בית עסק, קטגוריה, תאריך אישור).
    static func buildLearned(from history: [(merchantKey: String, categoryUUID: UUID, date: Date)]) -> [String: UUID] {
        var latest: [String: (UUID, Date)] = [:]
        for item in history {
            if let existing = latest[item.merchantKey], existing.1 > item.date { continue }
            latest[item.merchantKey] = (item.categoryUUID, item.date)
        }
        return latest.mapValues { $0.0 }
    }

    func suggest(for facts: TxnFacts) -> CategorySuggestion? {
        // שכבה 1: חוקים
        let actions = RulesEngine.apply(rules: rules, to: facts)
        if !actions.isEmpty {
            return CategorySuggestion(categoryUUID: actions.categoryUUID,
                                      categoryName: nil,
                                      displayName: actions.renameTo,
                                      markTransfer: actions.markTransfer,
                                      source: .rule)
        }

        let key = MerchantNormalizer.merchantKey(facts.rawMerchant)

        // שכבה 2: נלמד — התאמה מדויקת ואז fuzzy (הכלה הדדית של המפתח)
        if let uuid = learned[key] {
            return CategorySuggestion(categoryUUID: uuid, categoryName: nil, displayName: nil, source: .learned)
        }
        if key.count >= 4 {
            for (learnedKey, uuid) in learned where learnedKey.count >= 4 {
                if learnedKey.contains(key) || key.contains(learnedKey) {
                    return CategorySuggestion(categoryUUID: uuid, categoryName: nil, displayName: nil, source: .learned)
                }
            }
        }

        // שכבה 3: מילון מובנה
        if let match = MerchantNormalizer.lookup(facts.rawMerchant) {
            return CategorySuggestion(categoryUUID: nil,
                                      categoryName: match.categoryName,
                                      displayName: match.displayName,
                                      markTransfer: match.isP2P,
                                      source: .builtin)
        }
        return nil
    }
}
