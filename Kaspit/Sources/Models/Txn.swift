import Foundation
import SwiftData

// שם המחלקה Txn (ולא Transaction) כדי לא להתנגש עם SwiftUI.Transaction.

enum ReviewStatus: String, Codable {
    case needsReview
    case reviewed
}

struct TxnSplit: Codable, Hashable, Identifiable {
    var id: UUID = UUID()
    var categoryUUID: UUID
    var amount: Decimal
    var note: String = ""
}

@Model
final class Txn {
    var uuid: UUID = UUID()
    /// סכום חתום: הוצאה שלילית, הכנסה חיובית.
    var amount: Decimal = 0
    var currencyCode: String = "ILS"
    /// תאריך העסקה.
    var date: Date = Date()
    /// מועד החיוב בפועל (כרטיסי אשראי).
    var chargeDate: Date?
    /// שם בית העסק כפי שהגיע מהבנק/חברת האשראי.
    var rawMerchant: String = ""
    /// שם תצוגה מנורמל.
    var displayName: String = ""
    var notes: String = ""
    var tags: [String] = []
    var statusRaw: String = ReviewStatus.needsReview.rawValue
    /// מוסתרת — לא נספרת בתקציב ובתזרים.
    var isHidden: Bool = false
    /// העברה פנימית — לא הוצאה ולא הכנסה.
    var isTransfer: Bool = false
    /// מזהה משותף לשתי רגלי העברה (עו"ש → אשראי, ביט בין חשבונות).
    var transferGroupID: UUID?
    /// תשלום X מתוך Y (עסקאות בתשלומים).
    var installmentNumber: Int?
    var installmentCount: Int?
    /// מזהה עסקת האם של פריסת תשלומים.
    var installmentGroupID: UUID?
    /// טביעת אצבע למניעת כפילויות בייבוא חוזר.
    var fingerprint: String = ""
    /// יעד חיסכון שהתנועה נספרת אליו.
    var goalUUID: UUID?
    var splits: [TxnSplit] = []
    var createdAt: Date = Date()

    var account: Account?
    var category: Category?

    var status: ReviewStatus {
        get { ReviewStatus(rawValue: statusRaw) ?? .needsReview }
        set { statusRaw = newValue.rawValue }
    }

    var isExpense: Bool { amount < 0 && !isTransfer }
    var isIncome: Bool { amount > 0 && !isTransfer }

    /// נספרת בתקציב ובתזרים?
    var countsInBudget: Bool { !isHidden && !isTransfer }

    /// התאריך שקובע לאיזה חודש תקציב התנועה שייכת.
    func budgetDate(usingChargeDate: Bool) -> Date {
        if usingChargeDate, let chargeDate { return chargeDate }
        return date
    }

    var installmentLabel: String? {
        guard let n = installmentNumber, let c = installmentCount, c > 1 else { return nil }
        return "תשלום \(n) מתוך \(c)"
    }

    init(amount: Decimal,
         date: Date,
         rawMerchant: String,
         displayName: String? = nil,
         account: Account? = nil,
         category: Category? = nil,
         currencyCode: String = "ILS",
         chargeDate: Date? = nil,
         installmentNumber: Int? = nil,
         installmentCount: Int? = nil,
         fingerprint: String = "") {
        self.amount = amount
        self.date = date
        self.rawMerchant = rawMerchant
        self.displayName = displayName ?? rawMerchant
        self.account = account
        self.category = category
        self.currencyCode = currencyCode
        self.chargeDate = chargeDate
        self.installmentNumber = installmentNumber
        self.installmentCount = installmentCount
        self.fingerprint = fingerprint
    }
}
