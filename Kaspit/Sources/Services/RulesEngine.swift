import Foundation

/// עובדות על תנועה — קלט טהור למנוע החוקים ולקטגוריזציה (ניתן לבדיקה ללא SwiftData).
struct TxnFacts {
    var rawMerchant: String
    var displayName: String
    var notes: String
    var amount: Decimal
    var accountUUID: UUID?
}

/// הפעולות שחוקים החליטו להחיל.
struct RuleActions {
    var categoryUUID: UUID?
    var renameTo: String?
    var tags: [String] = []
    var hide: Bool = false
    var markTransfer: Bool = false
    var skipReview: Bool = false

    var isEmpty: Bool {
        categoryUUID == nil && renameTo == nil && tags.isEmpty && !hide && !markTransfer && !skipReview
    }
}

/// ייצוג ערכי של חוק, כדי שהמנוע יהיה טהור. נבנה מ-Rule (SwiftData) בשכבת ה-UI.
struct RuleSpec {
    var priority: Int = 0
    var isEnabled: Bool = true
    var merchantContains: String?
    var merchantEquals: String?
    var descriptionContains: String?
    var amountMin: Decimal?
    var amountMax: Decimal?
    var accountUUID: UUID?
    var direction: String?   // "expense" / "income"

    var setCategoryUUID: UUID?
    var renameTo: String?
    var addTags: [String] = []
    var hide: Bool = false
    var markTransfer: Bool = false
    var skipReview: Bool = false
}

enum RulesEngine {

    static func matches(_ rule: RuleSpec, facts: TxnFacts) -> Bool {
        guard rule.isEnabled else { return false }
        let merchant = MerchantNormalizer.merchantKey(facts.rawMerchant)
        let display = facts.displayName.lowercased()

        if let needle = rule.merchantEquals {
            let key = MerchantNormalizer.merchantKey(needle)
            if merchant != key && display != needle.lowercased() { return false }
        }
        if let needle = rule.merchantContains {
            let key = needle.lowercased()
            if !merchant.contains(MerchantNormalizer.merchantKey(needle))
                && !facts.rawMerchant.lowercased().contains(key)
                && !display.contains(key) { return false }
        }
        if let needle = rule.descriptionContains,
           !facts.notes.lowercased().contains(needle.lowercased()) { return false }
        // תנאי סכום נבדקים על הערך המוחלט (סכומי הוצאה שמורים בשלילי).
        let absAmount = facts.amount < 0 ? -facts.amount : facts.amount
        if let minA = rule.amountMin, absAmount < minA { return false }
        if let maxA = rule.amountMax, absAmount > maxA { return false }
        if let acc = rule.accountUUID, facts.accountUUID != acc { return false }
        if let dir = rule.direction {
            if dir == "expense" && facts.amount >= 0 { return false }
            if dir == "income" && facts.amount <= 0 { return false }
        }
        return true
    }

    /// מחיל את כל החוקים התואמים לפי סדר עדיפות; חוק מוקדם קובע קטגוריה/שם,
    /// תגיות מצטברות מכל החוקים התואמים.
    static func apply(rules: [RuleSpec], to facts: TxnFacts) -> RuleActions {
        var actions = RuleActions()
        for rule in rules.sorted(by: { $0.priority < $1.priority }) where matches(rule, facts: facts) {
            if actions.categoryUUID == nil { actions.categoryUUID = rule.setCategoryUUID }
            if actions.renameTo == nil { actions.renameTo = rule.renameTo }
            actions.tags.append(contentsOf: rule.addTags.filter { !actions.tags.contains($0) })
            actions.hide = actions.hide || rule.hide
            actions.markTransfer = actions.markTransfer || rule.markTransfer
            actions.skipReview = actions.skipReview || rule.skipReview
        }
        return actions
    }
}

extension Rule {
    var spec: RuleSpec {
        RuleSpec(priority: priority,
                 isEnabled: isEnabled,
                 merchantContains: merchantContains,
                 merchantEquals: merchantEquals,
                 descriptionContains: descriptionContains,
                 amountMin: amountMin,
                 amountMax: amountMax,
                 accountUUID: accountUUID,
                 direction: direction,
                 setCategoryUUID: setCategoryUUID,
                 renameTo: renameTo,
                 addTags: addTags,
                 hide: hide,
                 markTransfer: markTransfer,
                 skipReview: skipReview)
    }
}
