import Foundation

/// תנועה מופשטת לצורך התאמת העברות.
struct TransferCandidate {
    var id: UUID
    var accountUUID: UUID
    var accountKind: AccountKind
    var amount: Decimal
    var date: Date
    var merchantKey: String
}

struct TransferPair: Equatable {
    var outgoingID: UUID
    var incomingID: UUID
}

/// זיהוי העברות פנימיות כדי לא לספור פעמיים:
/// 1. זוגות בסכום הפוך בין שני חשבונות בחלון ימים קצר.
/// 2. חיוב חודשי מרוכז של כרטיס אשראי בעו"ש מול חשבון הכרטיס.
enum TransferMatcher {

    static let dayWindow = 4.0

    static func findPairs(in txns: [TransferCandidate]) -> [TransferPair] {
        var pairs: [TransferPair] = []
        var used = Set<UUID>()
        let outgoing = txns.filter { $0.amount < 0 }.sorted { $0.date < $1.date }
        let incoming = txns.filter { $0.amount > 0 }.sorted { $0.date < $1.date }

        for out in outgoing where !used.contains(out.id) {
            guard let match = incoming.first(where: { inc in
                !used.contains(inc.id)
                    && inc.accountUUID != out.accountUUID
                    && inc.amount == -out.amount
                    && abs(inc.date.timeIntervalSince(out.date)) <= dayWindow * 86_400
            }) else { continue }
            used.insert(out.id)
            used.insert(match.id)
            pairs.append(TransferPair(outgoingID: out.id, incomingID: match.id))
        }
        return pairs
    }

    /// זיהוי חיוב כרטיס אשראי מרוכז: תנועת חובה גדולה בעו"ש שהמפתח שלה מכיל
    /// שם חברת אשראי — מסומנת כהעברה (העסקאות הבודדות כבר נספרות בחשבון הכרטיס).
    static let cardIssuerKeys = ["ישראכרט", "isracard", "מקס", "max", "כאל", "cal", "לאומי קארד", "ויזה", "visa", "מסטרקארד", "mastercard", "אמריקן אקספרס", "amex", "דיינרס", "diners"]

    static func isCardSettlement(_ txn: TransferCandidate) -> Bool {
        guard txn.accountKind == .checking, txn.amount < 0 else { return false }
        return cardIssuerKeys.contains { txn.merchantKey.contains($0) }
    }
}
